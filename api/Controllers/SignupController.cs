using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

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
    /// </summary>
    [HttpPost("api/competitions/{competitionId:int}/sections/{sectionId:int}/signups")]
    [AllowAnonymous]
    public async Task<ActionResult<SectionSignupDto>> Create(int competitionId, int sectionId, CreateSectionSignupRequest req)
    {
        var section = await _db.CompetitionSections
            .Include(s => s.Competition)
            .FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == competitionId);
        if (section is null) return NotFound();
        if (section.Competition?.SignupsLocked == true)
            return StatusCode(403, new { message = "Signups are closed for this competition." });
        var name = req.FullName?.Trim();
        if (string.IsNullOrEmpty(name)) return BadRequest(new { message = "Full name required." });

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        if (!string.IsNullOrEmpty(ip) && await _db.IpBlocks.AnyAsync(b => b.IpAddress == ip))
            return StatusCode(403, new { message = "Signups from this network are blocked." });

        var signup = new SectionSignup
        {
            CompetitionSectionId = sectionId,
            UserId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
            FullName = name.Length > 200 ? name[..200] : name,
            PonyClubName = req.PonyClubName?.Trim(),
            ContactInfo = req.ContactInfo?.Trim(),
            AmountMinor = section.PriceMinor,
            Status = section.PriceMinor == 0 ? SignupPaymentStatus.Paid : SignupPaymentStatus.Pending,
            PaidAt = section.PriceMinor == 0 ? DateTime.UtcNow : null,
        };
        _db.SectionSignups.Add(signup);
        await _db.SaveChangesAsync();
        var loaded = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstAsync(s => s.Id == signup.Id);
        return loaded.ToDto();
    }

    /// <summary>List signups for a competition. Public — useful for organisers
    /// to share a "current entries" page; payment status visible only to
    /// admins/trainers (TODO).</summary>
    [HttpGet("api/competitions/{competitionId:int}/signups")]
    [AllowAnonymous]
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
    [Authorize(Roles = Roles.Organiser)]
    public async Task<ActionResult<SectionSignupDto>> UpdateStatus(int id, UpdateSignupStatusRequest req)
    {
        var signup = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (signup is null) return NotFound();
        signup.Status = req.Status;
        signup.PaidAt = req.Status == SignupPaymentStatus.Paid ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync();
        return signup.ToDto();
    }

    [HttpDelete("api/signups/{id:int}")]
    [Authorize(Roles = Roles.Organiser)]
    public async Task<IActionResult> Delete(int id)
    {
        var signup = await _db.SectionSignups.FindAsync(id);
        if (signup is null) return NotFound();
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
    [Authorize(Roles = Roles.Organiser)]
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
