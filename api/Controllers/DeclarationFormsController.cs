using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.DecForms;

namespace MountedGames.Api.Controllers;

public record DeclarationLockTimeDto(int CompetitionId, DateTime? DeclarationsCloseAt, bool IsClosed);
public record SetDeclarationLockTimeRequest(DateTime? DeclarationsCloseAt);

[ApiController]
[Route("api/declaration-forms")]
public class DeclarationFormsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly UserManager<AppUser> _users;
    private readonly TimeProvider _clock;
    public DeclarationFormsController(AppDbContext db, UserManager<AppUser> users, TimeProvider clock)
    {
        _db = db;
        _users = users;
        _clock = clock;
    }

    private Task<DateTime?> GetDeclarationsCloseAtAsync(int competitionId) =>
        _db.Set<CompetitionDeclarationLock>().AsNoTracking()
            .Where(x => x.CompetitionId == competitionId).Select(x => x.DeclarationsCloseAt).SingleOrDefaultAsync();

    private bool IsClosed(DateTime? closeAt) => closeAt.HasValue && _clock.GetUtcNow().UtcDateTime >= closeAt.Value;

    [HttpGet("competition/{competitionId:int}/lock-time")]
    public async Task<ActionResult<DeclarationLockTimeDto>> GetLockTime(int competitionId)
    {
        if (!await _db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();
        var closeAt = await GetDeclarationsCloseAtAsync(competitionId);
        return new DeclarationLockTimeDto(competitionId, closeAt, IsClosed(closeAt));
    }

    [HttpPut("competition/{competitionId:int}/lock-time")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<DeclarationLockTimeDto>> SetLockTime(int competitionId, SetDeclarationLockTimeRequest req)
    {
        if (!await _db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();
        DateTime? closeAtUtc = req.DeclarationsCloseAt.HasValue
            ? (req.DeclarationsCloseAt.Value.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(req.DeclarationsCloseAt.Value, DateTimeKind.Utc)
                : req.DeclarationsCloseAt.Value.ToUniversalTime())
            : null;
        var settings = await _db.Set<CompetitionDeclarationLock>().FindAsync(competitionId);
        if (settings is null)
        {
            settings = new CompetitionDeclarationLock { CompetitionId = competitionId };
            _db.Add(settings);
        }
        settings.DeclarationsCloseAt = closeAtUtc;
        await _db.SaveChangesAsync();
        return new DeclarationLockTimeDto(competitionId, closeAtUtc, IsClosed(closeAtUtc));
    }

    [HttpGet]
    public async Task<IEnumerable<DeclarationFormDto>> List(
        [FromQuery] int? competitionId = null,
        [FromQuery] int? teamId = null)
    {
        var isAdmin = User.IsInRole(Roles.Admin);
        var uid = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        var mySignupTeamIds = await SignedUpTeamIdsAsync(uid);
        var q = _db.DeclarationForms
            .Include(d => d.Team).ThenInclude(t => t!.Competition)
            .Include(d => d.SubmittedBy)
            .Include(d => d.Riders)
            .AsQueryable();

        // Public declarations omit private details; drafts are visible only to their owners.
        if (!isAdmin)
            q = q.Where(d => d.IsLocked || (uid != null && (d.SubmittedByUserId == uid || d.Team!.TrainerUserId == uid || mySignupTeamIds.Contains(d.TeamId)
                || (User.IsInRole(Roles.Trainer) && d.Team.Competition!.CreatedByUserId == uid)
                || _db.CompetitionCollaborators.Any(k => k.CompetitionId == d.Team.CompetitionId && k.UserId == uid))));
        if (competitionId.HasValue)
            q = q.Where(d => d.Team!.CompetitionId == competitionId);
        if (teamId.HasValue)
            q = q.Where(d => d.TeamId == teamId);

        var helping = await HelpingAsync(uid);
        var forms = await q.OrderByDescending(d => d.SubmittedAt).ToListAsync();
        var entryNames = await EntryTeamNamesAsync(forms.Select(d => d.TeamId));
        return forms.Select(d => d.ToDto(CanReadPrivate(d, helping, mySignupTeamIds), entryNames.GetValueOrDefault(d.TeamId)));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<DeclarationFormDto>> Get(int id)
    {
        var d = await _db.DeclarationForms
            .Include(d => d.Team).ThenInclude(t => t!.Competition)
            .Include(d => d.SubmittedBy)
            .Include(d => d.Riders)
            .FirstOrDefaultAsync(d => d.Id == id);
        if (d is null) return NotFound();
        var uid = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var canRead = CanReadPrivate(d, await HelpingAsync(uid), await SignedUpTeamIdsAsync(uid));
        if (!d.IsLocked && !canRead) return NotFound();
        return d.ToDto(canRead, (await EntryTeamNamesAsync([d.TeamId])).GetValueOrDefault(d.TeamId));
    }

    /// <summary>
    /// The team name each team's entrants gave when they entered (the first named entry, if several), so a dec form is
    /// clearly the one for that entry even if the form's own team name is edited later. Public like the team's name.
    /// </summary>
    private async Task<Dictionary<int, string>> EntryTeamNamesAsync(IEnumerable<int> teamIds)
    {
        var ids = teamIds.Distinct().ToArray();
        var rows = await _db.SectionSignups.AsNoTracking()
            .Where(s => s.TeamId != null && ids.Contains(s.TeamId.Value) && s.TeamName != null && s.TeamName != "")
            .OrderBy(s => s.CreatedAt).Select(s => new { TeamId = s.TeamId!.Value, s.TeamName }).ToListAsync();
        return rows.GroupBy(r => r.TeamId).ToDictionary(g => g.Key, g => g.First().TeamName!);
    }

    /// <summary>The competitions this user is a competition admin of.</summary>
    private async Task<HashSet<int>> HelpingAsync(string? uid) => string.IsNullOrEmpty(uid) ? []
        : (await _db.CompetitionCollaborators.AsNoTracking().Where(k => k.UserId == uid).Select(k => k.CompetitionId).ToListAsync()).ToHashSet();

    private IQueryable<SectionSignup> TrustedEntries(string uid) => _db.SectionSignups.AsNoTracking()
        .Where(s => s.UserId == uid
            && (s.Status == SignupPaymentStatus.Pending || s.Status == SignupPaymentStatus.Paid)
            && _db.Set<SignupMatchmaking>().Any(m => m.SignupId == s.Id && m.DeclarationAccessGranted)
            && !_db.Set<SignupExtras>().Any(x => x.SignupId == s.Id && (x.IsWithdrawn || x.IsWaitlist)));

    private async Task<HashSet<int>> SignedUpTeamIdsAsync(string? uid)
    {
        if (string.IsNullOrEmpty(uid)) return [];
        var trusted = TrustedEntries(uid);
        return (await _db.Teams.AsNoTracking().Where(t => trusted.Any(s =>
                s.CompetitionSectionId == t.CompetitionSectionId
                && (s.TeamId == t.Id || _db.Set<SignupTeamLink>().Any(l => l.SignupId == s.Id && l.TeamId == t.Id))))
            .Select(t => t.Id).ToListAsync()).ToHashSet();
    }

    private Task<bool> HasTeamSignupAsync(string? userId, Team team) => string.IsNullOrEmpty(userId)
        ? Task.FromResult(false)
        : TrustedEntries(userId).AnyAsync(s => s.CompetitionSectionId == team.CompetitionSectionId
            && (s.TeamId == team.Id || _db.Set<SignupTeamLink>().Any(l => l.SignupId == s.Id && l.TeamId == team.Id)));

    private bool CanReadPrivate(DeclarationForm form, HashSet<int> helping, HashSet<int> mySignupTeamIds)
    {
        var uid = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return User.IsInRole(Roles.Admin) || (!string.IsNullOrEmpty(uid)
            && (form.SubmittedByUserId == uid || form.Team?.TrainerUserId == uid
                || (form.Team is not null && mySignupTeamIds.Contains(form.Team.Id))
                || (User.IsInRole(Roles.Trainer) && form.Team?.Competition?.CreatedByUserId == uid)
                || (form.Team is not null && helping.Contains(form.Team.CompetitionId))));
    }

    /// <summary>Pony heights in hands, as a decimal (13.2 is 13 hands 2 inches). Shetlands to big horses fit inside.</summary>
    private const decimal MinPonyHands = 5m, MaxPonyHands = 20m;

    [HttpPost]
    [Authorize]
    public async Task<ActionResult<DeclarationFormDto>> Submit(SubmitDeclarationFormRequest req)
    {
        var team = await _db.Teams.Include(t => t.Club).Include(t => t.Competition)
            .FirstOrDefaultAsync(t => t.Id == req.TeamId);
        var isTeamStaffRole = User.IsInRole(Roles.Admin) || User.IsInRole(Roles.Trainer) || User.IsInRole(Roles.Manager);
        if (team is null) return isTeamStaffRole ? BadRequest(new { message = "Team not found." }) : Forbid();

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var isAdmin = User.IsInRole(Roles.Admin);
        var canManageCompetition = isAdmin || await _db.CanManageAsync(User, team.CompetitionId);
        // Only the team's own trainer, the Team Manager of its club, someone who organises its
        // competition, or a rider who entered this team/pair/individual entry may submit or overwrite a declaration.
        if (!isAdmin && !(userId is not null && team.TrainerUserId == userId)
            && !await _db.IsClubManagerAsync(User, team.ClubId)
            && !canManageCompetition
            && !await HasTeamSignupAsync(userId, team))
            return Forbid();

        if (!req.AcceptTerms)
            return BadRequest(new { message = "Agree to the terms and conditions to submit the dec form." });
        if (req.Riders.Any(r => r.PonyHeightHands is { } hh && (hh < MinPonyHands || hh > MaxPonyHands)))
            return BadRequest(new { message = $"A pony's height must be between {MinPonyHands} and {MaxPonyHands} hands." });

        // What this competition asks for. A competition that never set one up keeps the standard form, with nothing newly refused.
        var explicitConfig = DecFormConfig.Parse(team.Competition?.DecFormConfigJson);
        var config = explicitConfig ?? DecFormConfig.Standard;
        var year = DateTime.UtcNow.Year;
        var built = new List<RiderEntry>();
        foreach (var r in req.Riders)
        {
            var entry = new RiderEntry { PonyHeightHands = r.PonyHeightHands, DateOfBirth = r.DateOfBirth, HorseName = r.HorseName };
            if (DecFormRules.Apply(config, explicitConfig is null, r, r.IsReserve, entry, year) is { } problem)
                return BadRequest(new { message = problem });
            built.Add(entry);
        }

        // A club's team managers and trainers share its saved riders; anyone else uses the riders they saved.
        var sharesRoster = isAdmin || await _db.SharesClubRosterAsync(User, team.ClubId);
        var savedIds = req.Riders.Where(r => r.SavedRiderId.HasValue).Select(r => r.SavedRiderId!.Value).Distinct().ToArray();
        var permittedSavedCount = await _db.SavedRiders.CountAsync(r => savedIds.Contains(r.Id)
            && r.ClubId == team.ClubId && (sharesRoster || (userId != null && r.CreatedByUserId == userId)));
        if (permittedSavedCount != savedIds.Length) return BadRequest(new { message = "A saved rider is not available to this account." });

        if (!canManageCompetition && IsClosed(await GetDeclarationsCloseAtAsync(team.CompetitionId)))
            return BadRequest(new { message = "Declarations have closed for this competition. Contact the organiser for changes." });

        // The coach's phone and the bib follow the setup too. A competition with no setup keeps the standard form, which refuses nothing new.
        var phoneText = req.TrainerPhone?.Trim();
        string? trainerPhone = null;
        if (config.TrainerPhone != FieldRequirement.Off)
        {
            if (string.IsNullOrEmpty(phoneText))
            {
                if (config.TrainerPhone == FieldRequirement.Required && explicitConfig is not null)
                    return BadRequest(new { message = "The trainer's phone number is needed." });
            }
            else if (explicitConfig is null) trainerPhone = phoneText.Length > 40 ? phoneText[..40] : phoneText; // the standard form keeps what was typed, as before
            else if (PhoneNumbers.TryNormalise(phoneText, out var phone)) trainerPhone = phone;
            else
                return BadRequest(new { message = "Enter the trainer's phone number as a UK or Irish number, like 07123 456789." });
        }
        var bibWithoutFlag = System.Text.RegularExpressions.Regex.Replace(req.BibDescription ?? string.Empty, @"^\[flag:[a-z0-9-]+\]\s*", string.Empty, System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
        var flagMatch = System.Text.RegularExpressions.Regex.Match(req.BibDescription ?? string.Empty, @"^(\[flag:[a-z0-9-]+\])", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var flagPrefix = flagMatch.Success ? flagMatch.Groups[1].Value : null;
        if (config.Bib == FieldRequirement.Required && explicitConfig is not null && string.IsNullOrWhiteSpace(bibWithoutFlag))
            return BadRequest(new { message = "The bib or number is needed." });

        var submitter = userId is null ? null : await _users.FindByIdAsync(userId);
        if (trainerPhone is not null && submitter is not null && submitter.PhoneNumber != trainerPhone)
        {
            submitter.PhoneNumber = trainerPhone;
            await _users.UpdateAsync(submitter);
        }

        // The team's name is editable on the form; it's the page title everywhere else too.
        var teamName = req.TeamName?.Trim();
        if (!string.IsNullOrEmpty(teamName)) team.DisplayName = teamName;

        if (req.BibDescription is not null)
        {
            var effectiveBib = config.Bib == FieldRequirement.Off
                ? System.Text.RegularExpressions.Regex.Replace(team.BibDescription ?? string.Empty, @"^\[flag:[a-z0-9-]+\]\s*", string.Empty, System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim()
                : bibWithoutFlag;
            var combined = string.Join(" ", new[] { flagPrefix, effectiveBib }.Where(s => !string.IsNullOrWhiteSpace(s)));
            team.BibDescription = string.IsNullOrWhiteSpace(combined) ? null : combined;
        }

        // One declaration per team: submitting again updates it instead of adding a second form.
        var forms = await _db.DeclarationForms.Include(f => f.Riders)
            .Where(f => f.TeamId == team.Id).OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).ToListAsync();
        var form = forms.FirstOrDefault();
        if (form is null)
        {
            form = new DeclarationForm { TeamId = team.Id };
            _db.DeclarationForms.Add(form);
        }
        else
        {
            // Older duplicates (from before this rule) fold into the latest.
            foreach (var old in forms.Skip(1)) _db.DeclarationForms.Remove(old);
            _db.RiderEntries.RemoveRange(form.Riders);
            form.Riders.Clear();
        }
        form.SubmittedByUserId = userId;
        form.SubmittedAt = DateTime.UtcNow;
        form.Notes = req.Notes;
        form.IsLocked = true;
        form.TrainerPhone = trainerPhone;
        form.TrainerName = string.IsNullOrWhiteSpace(req.TrainerName) ? submitter?.FullName : req.TrainerName.Trim();
        form.TermsAcceptedAt = form.SubmittedAt;
        form.TermsAcceptedByUserId = userId;
        var order = 0;
        for (var i = 0; i < req.Riders.Count; i++)
        {
            var r = req.Riders[i];
            var kept = built[i];
            form.Riders.Add(new RiderEntry
            {
                SavedRiderId = r.SavedRiderId,
                FullName = r.FullName,
                DateOfBirth = kept.DateOfBirth,
                HorseName = r.HorseName,
                PonyHeightHands = kept.PonyHeightHands,
                BirthYear = kept.BirthYear,
                AgeGroup = kept.AgeGroup,
                WeightKg = kept.WeightKg,
                PonyPassportNumber = kept.PonyPassportNumber,
                PonyAge = kept.PonyAge,
                MembershipNumber = kept.MembershipNumber,
                EmergencyContactName = kept.EmergencyContactName,
                EmergencyContactPhone = kept.EmergencyContactPhone,
                MedicalNotes = kept.MedicalNotes,
                CustomValuesJson = kept.CustomValuesJson,
                FlagsJson = kept.FlagsJson,
                BibColour = string.IsNullOrWhiteSpace(r.BibColour) ? null : r.BibColour.Trim(),
                IsCaptain = r.IsCaptain,
                IsReserve = r.IsReserve,
                IsGuestRider = r.IsGuestRider,
                OrderIndex = r.OrderIndex == 0 ? order : r.OrderIndex,
                UseInitialOnly = r.UseInitialOnly,
                NoFilming = r.NoFilming
            });
            order++;
        }

        if (req.SaveToRoster)
        {
            var clubRiders = await _db.SavedRiders
                .Where(s => s.ClubId == team.ClubId && (sharesRoster || s.CreatedByUserId == userId))
                .ToListAsync();
            foreach (var (r, kept, index) in req.Riders.Select((r, i) => (r, built[i], i)).Where(x => !x.r.IsGuestRider && !string.IsNullOrWhiteSpace(x.r.FullName)))
            {
                var fullName = r.FullName.Trim();
                var horseName = string.IsNullOrWhiteSpace(r.HorseName) ? null : r.HorseName.Trim();

                SavedRider? linked = null;
                if (r.SavedRiderId.HasValue)
                {
                    linked = clubRiders.FirstOrDefault(s => s.Id == r.SavedRiderId.Value);
                    var changedHorse = linked is not null
                        && !string.IsNullOrWhiteSpace(linked.HorseName)
                        && !string.IsNullOrWhiteSpace(horseName)
                        && !string.Equals(linked.HorseName.Trim(), horseName, StringComparison.OrdinalIgnoreCase);
                    if (!changedHorse) continue;
                }

                var rosterDob = kept.DateOfBirth ?? (config.Dob != FieldRequirement.Off && config.DobFormat == DobFormat.Full ? linked?.DateOfBirth : null);
                var existing = clubRiders.FirstOrDefault(s =>
                    string.Equals(s.FullName.Trim(), fullName, StringComparison.OrdinalIgnoreCase)
                    && (string.Equals(
                            string.IsNullOrWhiteSpace(s.HorseName) ? null : s.HorseName.Trim(),
                            horseName,
                            StringComparison.OrdinalIgnoreCase)
                        || (r.SavedRiderId is null && string.IsNullOrWhiteSpace(s.HorseName))));

                if (existing is null)
                {
                    var added = new SavedRider
                    {
                        ClubId = team.ClubId,
                        CreatedByUserId = userId,
                        FullName = fullName,
                        DateOfBirth = rosterDob,
                        HorseName = horseName,
                        PonyHeightHands = kept.PonyHeightHands,
                        UseInitialOnly = r.UseInitialOnly,
                        NoFilming = r.NoFilming
                    };
                    _db.SavedRiders.Add(added);
                    clubRiders.Add(added);
                    existing = added;
                }
                else
                {
                    existing.DateOfBirth ??= rosterDob;
                    existing.HorseName ??= horseName;
                    existing.PonyHeightHands ??= kept.PonyHeightHands;
                    existing.UseInitialOnly = r.UseInitialOnly;
                    existing.NoFilming = r.NoFilming;
                    existing.UpdatedAt = DateTime.UtcNow;
                }
                // Link a first saved entry, while retaining an explicitly selected rider's identity.
                if (r.SavedRiderId is null)
                {
                    var submittedRider = form.Riders.ElementAt(index);
                    submittedRider.SavedRiderId = existing.Id == 0 ? null : existing.Id;
                    submittedRider.SavedRider = existing;
                }
            }
        }

        await _db.SaveChangesAsync();

        await _db.Entry(form).Reference(f => f.Team).LoadAsync();
        await _db.Entry(form).Reference(f => f.SubmittedBy).LoadAsync();
        return form.ToDto(includePrivate: true, (await EntryTeamNamesAsync([form.TeamId])).GetValueOrDefault(form.TeamId));
    }

    [HttpDelete("{id:int}")]
    [Authorize]
    public async Task<IActionResult> Delete(int id)
    {
        var d = await _db.DeclarationForms.Include(d => d.Team).FirstOrDefaultAsync(d => d.Id == id);
        if (d is null) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var canDelete = User.IsInRole(Roles.Admin)
            || d.SubmittedByUserId == userId
            || d.Team?.TrainerUserId == userId
            || (d.Team is not null && (
                await _db.IsClubManagerAsync(User, d.Team.ClubId)
                || await _db.CanManageAsync(User, d.Team.CompetitionId)
                || await HasTeamSignupAsync(userId, d.Team)));
        if (!canDelete)
            return Forbid();
        var canManageCompetition = User.IsInRole(Roles.Admin)
            || (d.Team is not null && await _db.CanManageAsync(User, d.Team.CompetitionId));
        if (!canManageCompetition && d.Team is not null && IsClosed(await GetDeclarationsCloseAtAsync(d.Team.CompetitionId)))
            return BadRequest(new { message = "Declarations have closed for this competition. Contact the organiser for changes." });
        _db.DeclarationForms.Remove(d);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
