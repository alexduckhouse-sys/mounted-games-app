using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Controllers;

[ApiController]
public class SignupController : ControllerBase
{
    private readonly AppDbContext _db;
    public SignupController(AppDbContext db) => _db = db;

    /// <summary>
    /// Sign up to a comp section. The amount is captured from the section's
    /// price at signup time so it can't drift if the organiser later edits it.
    /// Payment integration is deferred — Status starts at Pending and an
    /// organiser flips it to Paid once funds land in their PaymentDestination.
    /// Entrants must be signed in; the public can't enter.
    /// </summary>
    [HttpPost("api/competitions/{competitionId:int}/sections/{sectionId:int}/signups")]
    [Authorize]
    public async Task<ActionResult<SectionSignupDto>> Create(int competitionId, int sectionId, CreateSectionSignupRequest req,
        // Taken here, not in the constructor, so only entering a competition needs the email services.
        [FromServices] SignupConfirmationService confirmation, [FromServices] EmailOptInService optIns, [FromServices] TimeProvider clock)
    {
        // Admin role runs comps — they explicitly shouldn't be entering them.
        // Guard at the API layer too so a stray UI bug or curl can't slip through.
        if (User.IsInRole(Roles.Admin))
            return StatusCode(403, new { message = "Admins organise comps and can't sign up as entrants." });

        var section = await _db.CompetitionSections
            .Include(s => s.Competition)
            .Include(s => s.Signups)
            .FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == competitionId);
        if (section is null) return NotFound();

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var requestId = req.RequestId?.Trim();
        if (string.IsNullOrEmpty(requestId)) requestId = null;
        // A retry of the same submit gets the original entry back: no second entry and no second email.
        if (requestId is not null)
        {
            var replay = await FindReplayAsync(sectionId, userId, requestId);
            if (replay is not null) return replay.ToDto();
        }

        if (section.Competition?.SignupsLocked == true)
            return StatusCode(403, new { message = "Signups are closed for this competition." });
        var name = req.FullName?.Trim();
        if (string.IsNullOrEmpty(name)) return BadRequest(new { message = "Full name required." });

        string? contactEmail = null;
        if (!string.IsNullOrWhiteSpace(req.ContactEmail))
        {
            if (!EmailAddresses.TryNormalise(req.ContactEmail, out var normalised))
                return BadRequest(new { message = "That email address doesn't look right. Please check it, or leave it blank." });
            contactEmail = normalised;
        }
        if (req.EmailOptIn && contactEmail is null)
            return BadRequest(new { message = "Add your email address if you'd like emails when new competitions open." });
        if (req.EmailOptIn && req.EmailOptInVersion != EmailOptInWording.Version)
            return BadRequest(new { message = "The wording next to the email box has changed. Please reload the page and read it again." });

        // Honour the section's signup cap, counting Paid + Pending only.
        if (section.MaxParticipants.HasValue)
        {
            var active = section.Signups.Count(s =>
                s.Status == SignupPaymentStatus.Paid || s.Status == SignupPaymentStatus.Pending);
            if (active >= section.MaxParticipants.Value)
                return StatusCode(403, new { message = $"Section is full ({section.MaxParticipants} max)." });
        }

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        if (!string.IsNullOrEmpty(ip) && await _db.IpBlocks.AnyAsync(b => b.IpAddress == ip))
            return StatusCode(403, new { message = "Signups from this network are blocked." });

        // Optional team-code join: if the entrant supplies a code that matches
        // a team in this comp (case-insensitive), link the signup directly.
        int? teamId = null;
        var teamCode = req.TeamCode?.Trim();
        if (!string.IsNullOrEmpty(teamCode))
        {
            var lowered = teamCode.ToLower();
            var team = await _db.Teams
                .Where(t => t.CompetitionId == competitionId
                    && t.SupporterJoinKey != null
                    && t.SupporterJoinKey.ToLower() == lowered)
                .Select(t => new { t.Id })
                .FirstOrDefaultAsync();
            if (team is not null) teamId = team.Id;
        }

        // Free entries are complete immediately. Paid entries stay Pending until
        // the organiser confirms an external payment, or the owner uses the
        // explicitly test-only checkout on a demo competition.
        var isFree = section.PriceMinor == 0;
        var signup = new SectionSignup
        {
            CompetitionSectionId = sectionId,
            UserId = userId,
            FullName = name.Length > 200 ? name[..200] : name,
            PonyClubName = req.PonyClubName?.Trim(),
            ContactInfo = req.ContactInfo?.Trim(),
            ContactEmail = contactEmail,
            ClientRequestId = requestId,
            UseInitialOnly = req.UseInitialOnly,
            NoFilming = req.NoFilming,
            AmountMinor = section.PriceMinor,
            TeamId = teamId,
            Status = isFree ? SignupPaymentStatus.Paid : SignupPaymentStatus.Pending,
            PaidAt = isFree ? DateTime.UtcNow : null,
        };
        _db.SectionSignups.Add(signup);

        // Consent is stored in the same save as the entry, so there is never an entry without its record or the reverse.
        var optIn = OptInOutcome.NotAsked;
        string? unsubscribeToken = null;
        if (req.EmailOptIn && contactEmail is not null)
        {
            var result = await optIns.AddAsync(contactEmail, EmailOptInWording.Version, EmailOptInWording.SignupSource);
            optIn = result.Joined ? OptInOutcome.Joined : OptInOutcome.AlreadyOnList;
            unsubscribeToken = result.UnsubscribeToken;
        }

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (requestId is not null)
        {
            // Two copies of the same submit arrived together; the other one won. Return its entry.
            _db.ChangeTracker.Clear();
            var winner = await FindReplayAsync(sectionId, userId, requestId);
            if (winner is not null) return winner.ToDto();
            throw;
        }

        // One confirmation, sent here and now (the API can be asleep a moment later). Whatever happens, the entry stays.
        if (contactEmail is not null)
        {
            var status = await confirmation.SendAsync(signup, section.Competition!, section, optIn, unsubscribeToken);
            try
            {
                signup.ConfirmationEmailStatus = status;
                signup.ConfirmationEmailAt = clock.GetUtcNow().UtcDateTime;
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // The entry is already saved; only the note about the email is lost.
            }
        }

        var loaded = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstAsync(s => s.Id == signup.Id);
        return loaded.ToDto();
    }

    private Task<SectionSignup?> FindReplayAsync(int sectionId, string? userId, string requestId)
        => _db.SectionSignups.Include(s => s.Section).AsNoTracking()
            .FirstOrDefaultAsync(s => s.CompetitionSectionId == sectionId && s.UserId == userId && s.ClientRequestId == requestId);

    /// <summary>Contact and payment details are restricted to the competition organiser.</summary>
    [HttpGet("api/competitions/{competitionId:int}/signups")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IEnumerable<SectionSignupDto>> List(int competitionId)
    {
        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
        return rows.Select(r => r.ToDto());
    }

    /// <summary>Organiser (trainer or admin) marks a signup paid / refunded / cancelled.</summary>
    [HttpPut("api/signups/{id:int}/status")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id", CompetitionResource.Signup)]
    public async Task<ActionResult<SectionSignupDto>> UpdateStatus(int id, UpdateSignupStatusRequest req)
    {
        var signup = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (signup is null) return NotFound();
        var isDemo = await _db.Set<EventCommerceSettings>()
            .AnyAsync(x => x.CompetitionId == signup.Section!.CompetitionId && x.IsDemo);
        var hasTestPayment = await _db.Set<TestPaymentRecord>()
            .AnyAsync(x => x.Target == TestPaymentTarget.SectionSignup && x.TargetId == id);
        if (isDemo || hasTestPayment)
            return Conflict(new { message = "Demo entry payments can only be changed through the labelled test checkout." });
        signup.Status = req.Status;
        signup.PaidAt = req.Status == SignupPaymentStatus.Paid ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync();
        return signup.ToDto();
    }

    [HttpDelete("api/signups/{id:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id", CompetitionResource.Signup)]
    public async Task<IActionResult> Delete(int id)
    {
        var signup = await _db.SectionSignups.FindAsync(id);
        if (signup is null) return NotFound();
        var hasTestPayment = await _db.Set<TestPaymentRecord>()
            .AnyAsync(x => x.Target == TestPaymentTarget.SectionSignup && x.TargetId == id);
        if (hasTestPayment || (signup.AmountMinor > 0 &&
                signup.Status is SignupPaymentStatus.Paid or SignupPaymentStatus.Refunded))
            return Conflict(new { message = "This signup has payment history and must be kept for the audit record." });
        if (signup.AmountMinor > 0)
        {
            signup.Status = SignupPaymentStatus.Cancelled;
            signup.PaidAt = null;
            await _db.SaveChangesAsync();
            return NoContent();
        }
        _db.SectionSignups.Remove(signup);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Returns the calling user's own signups across every competition.
    /// Powers the /me/signups page so a logged-in person can see "what
    /// have I signed up to and have I paid yet".
    /// </summary>
    [HttpGet("api/me/signups")]
    [Authorize]
    public async Task<ActionResult<IEnumerable<MySignupDto>>> MySignups()
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        var rows = await _db.SectionSignups
            .Include(s => s.Section).ThenInclude(sec => sec!.Competition)
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
        var teamIds = rows.Where(r => r.TeamId.HasValue).Select(r => r.TeamId!.Value).ToList();
        var teams = teamIds.Count == 0
            ? new Dictionary<int, Team>()
            : await _db.Teams.Where(t => teamIds.Contains(t.Id))
                .ToDictionaryAsync(t => t.Id, t => t);
        return rows.Select(r =>
            r.ToMyDto(r.TeamId.HasValue && teams.TryGetValue(r.TeamId.Value, out var t) ? t : null)
        ).ToList();
    }

    /// <summary>
    /// Auto-form teams from paid signups in a section. With Preview=true returns
    /// what the bin would look like (grouped by pony club, suffixed A/B/C…) without
    /// touching the DB. With Preview=false creates the Team rows and updates
    /// each signup's TeamId. Unpaid signups are ignored entirely.
    ///
    /// Team-size rule: <c>RidersPerTeam</c> (defaults to 4 for Teams, 2 for Pairs,
    /// 1 for Individual). Signups from the same Pony Club are grouped together;
    /// if a club has more signups than fit one team, the extras spill into a
    /// second team (suffix B), and so on. Clubs with fewer signups than a full
    /// team still get their own (short) team — the organiser can merge or move
    /// people manually via the Teams tab later.
    /// </summary>
    [HttpPost("api/competitions/{competitionId:int}/sections/{sectionId:int}/form-teams")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<FormTeamsResult>> FormTeams(int competitionId, int sectionId, FormTeamsFromSignupsRequest req)
    {
        var section = await _db.CompetitionSections
            .Include(s => s.Competition)
            .FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == competitionId);
        if (section is null) return NotFound();

        var defaultSize = section.Format switch
        {
            SectionFormat.Pairs => 2,
            SectionFormat.Individual => 1,
            _ => 4,
        };
        var ridersPerTeam = Math.Clamp(req.RidersPerTeam ?? defaultSize, 1, 12);

        var paidSignups = await _db.SectionSignups
            .Where(s => s.CompetitionSectionId == sectionId && s.Status == SignupPaymentStatus.Paid)
            .OrderBy(s => s.CreatedAt)
            .ToListAsync();
        if (paidSignups.Count == 0)
            return BadRequest(new { message = "No paid signups to form teams from." });

        // Resolve each signup's club. PonyClubName is free text — try a
        // case-insensitive exact match against the Clubs table first; fall
        // back to "Unaffiliated" if blank or no match.
        var allClubs = await _db.Clubs.ToListAsync();
        var clubsByName = allClubs.ToDictionary(c => c.Name, c => c, StringComparer.OrdinalIgnoreCase);
        var unaffiliated = allClubs.FirstOrDefault(c => string.Equals(c.Name, "Unaffiliated", StringComparison.OrdinalIgnoreCase));
        if (unaffiliated is null)
        {
            unaffiliated = new Club { Name = "Unaffiliated" };
            _db.Clubs.Add(unaffiliated);
            await _db.SaveChangesAsync();
            allClubs.Add(unaffiliated);
            clubsByName[unaffiliated.Name] = unaffiliated;
        }

        // Bin by club then split into teams of `ridersPerTeam`.
        var byClub = paidSignups
            .GroupBy(s =>
            {
                var name = (s.PonyClubName ?? string.Empty).Trim();
                return string.IsNullOrEmpty(name) || !clubsByName.TryGetValue(name, out var club)
                    ? unaffiliated.Id : club.Id;
            })
            .OrderBy(g => allClubs.First(c => c.Id == g.Key).Name)
            .ToList();

        var previews = new List<FormedTeamPreview>();
        foreach (var group in byClub)
        {
            var club = allClubs.First(c => c.Id == group.Key);
            var ordered = group.OrderBy(s => s.CreatedAt).ToList();
            for (var i = 0; i < ordered.Count; i += ridersPerTeam)
            {
                var slice = ordered.Skip(i).Take(ridersPerTeam).ToList();
                var suffixIdx = i / ridersPerTeam;
                var suffix = ((char)('A' + suffixIdx)).ToString();
                previews.Add(new FormedTeamPreview(
                    club.Name, club.Id, suffix,
                    slice.Select(x => x.Id).ToList(),
                    slice.Select(x => x.FullName).ToList()));
            }
        }

        if (req.Preview)
        {
            return new FormTeamsResult(true, ridersPerTeam, paidSignups.Count, previews, Array.Empty<TeamDto>());
        }

        if (req.ReplaceExisting)
        {
            // Drop teams that were previously auto-formed for this section
            // and were never used (no heat entries, no dec forms).
            var sectionTeams = await _db.Teams
                .Include(t => t.HeatEntries)
                .Include(t => t.DeclarationForms)
                .Where(t => t.CompetitionSectionId == sectionId)
                .ToListAsync();
            foreach (var t in sectionTeams)
            {
                if (t.HeatEntries.Count > 0 || t.DeclarationForms.Count > 0) continue;
                // Detach signups so we can re-bin them.
                var linkedSignups = await _db.SectionSignups
                    .Where(s => s.TeamId == t.Id).ToListAsync();
                foreach (var s in linkedSignups) s.TeamId = null;
                _db.Teams.Remove(t);
            }
            await _db.SaveChangesAsync();
        }

        var created = new List<Team>();
        foreach (var preview in previews)
        {
            // Find next available suffix in case existing teams already use A/B.
            var existingSuffixes = await _db.Teams
                .Where(t => t.CompetitionSectionId == sectionId && t.ClubId == preview.ClubId)
                .Select(t => t.Suffix)
                .ToListAsync();
            var suffix = preview.Suffix;
            var bump = 0;
            while (existingSuffixes.Contains(suffix, StringComparer.OrdinalIgnoreCase))
            {
                bump++;
                suffix = ((char)('A' + (preview.Suffix[0] - 'A') + bump)).ToString();
                if (bump > 25) break;
            }

            var team = new Team
            {
                CompetitionId = competitionId,
                CompetitionSectionId = sectionId,
                ClubId = preview.ClubId,
                Suffix = suffix,
                DisplayName = $"{preview.ClubName} {suffix}".Trim(),
                BibColour = allClubs.First(c => c.Id == preview.ClubId).BibColour,
            };
            _db.Teams.Add(team);
            await _db.SaveChangesAsync();
            created.Add(team);

            // Link each signup in the preview to the new team.
            foreach (var signupId in preview.SignupIds)
            {
                var signup = await _db.SectionSignups.FindAsync(signupId);
                if (signup is not null) signup.TeamId = team.Id;
            }
        }
        await _db.SaveChangesAsync();

        // Reload teams with club / section for proper DTO mapping.
        var createdIds = created.Select(t => t.Id).ToList();
        var loaded = await _db.Teams
            .Include(t => t.Club).Include(t => t.Section).Include(t => t.Trainer)
            .Where(t => createdIds.Contains(t.Id))
            .ToListAsync();
        return new FormTeamsResult(false, ridersPerTeam, paidSignups.Count, previews, loaded.Select(t => t.ToDto()).ToList());
    }
}
