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

[ApiController]
[Route("api/declaration-forms")]
public class DeclarationFormsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly UserManager<AppUser> _users;
    public DeclarationFormsController(AppDbContext db, UserManager<AppUser> users)
    {
        _db = db;
        _users = users;
    }

    [HttpGet]
    public async Task<IEnumerable<DeclarationFormDto>> List(
        [FromQuery] int? competitionId = null,
        [FromQuery] int? teamId = null)
    {
        var isAdmin = User.IsInRole(Roles.Admin);
        var uid = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        var q = _db.DeclarationForms
            .Include(d => d.Team).ThenInclude(t => t!.Competition)
            .Include(d => d.SubmittedBy)
            .Include(d => d.Riders)
            .AsQueryable();

        // Public declarations omit private details; drafts are visible only to their owners.
        if (!isAdmin)
            q = q.Where(d => d.IsLocked || (uid != null && (d.SubmittedByUserId == uid || d.Team!.TrainerUserId == uid
                || (User.IsInRole(Roles.Trainer) && d.Team.Competition!.CreatedByUserId == uid)
                || _db.CompetitionCollaborators.Any(k => k.CompetitionId == d.Team.CompetitionId && k.UserId == uid))));
        if (competitionId.HasValue)
            q = q.Where(d => d.Team!.CompetitionId == competitionId);
        if (teamId.HasValue)
            q = q.Where(d => d.TeamId == teamId);

        var helping = await HelpingAsync(uid);
        var forms = await q.OrderByDescending(d => d.SubmittedAt).ToListAsync();
        var entryNames = await EntryTeamNamesAsync(forms.Select(d => d.TeamId));
        return forms.Select(d => d.ToDto(CanReadPrivate(d, helping), entryNames.GetValueOrDefault(d.TeamId)));
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
        var canRead = CanReadPrivate(d, await HelpingAsync(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value));
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

    private bool CanReadPrivate(DeclarationForm form, HashSet<int> helping)
    {
        var uid = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return User.IsInRole(Roles.Admin) || (!string.IsNullOrEmpty(uid)
            && (form.SubmittedByUserId == uid || form.Team?.TrainerUserId == uid
                || (User.IsInRole(Roles.Trainer) && form.Team?.Competition?.CreatedByUserId == uid)
                || (form.Team is not null && helping.Contains(form.Team.CompetitionId))));
    }

    /// <summary>Pony heights in hands, as a decimal (13.2 is 13 hands 2 inches). Shetlands to big horses fit inside.</summary>
    private const decimal MinPonyHands = 5m, MaxPonyHands = 20m;

    [HttpPost]
    [Authorize(Roles = Roles.TeamWork)]
    public async Task<ActionResult<DeclarationFormDto>> Submit(SubmitDeclarationFormRequest req)
    {
        var team = await _db.Teams.Include(t => t.Club).Include(t => t.Competition)
            .FirstOrDefaultAsync(t => t.Id == req.TeamId);
        if (team is null) return BadRequest(new { message = "Team not found." });

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var isAdmin = User.IsInRole(Roles.Admin);
        // Only the team's own trainer, the Team Manager of its club, or someone who organises its
        // competition, may submit or overwrite a declaration. An unclaimed team is not open to everyone.
        if (!isAdmin && !(userId is not null && team.TrainerUserId == userId)
            && !await _db.IsClubManagerAsync(User, team.ClubId)
            && !await _db.CanManageAsync(User, team.CompetitionId))
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
        if (config.Bib == FieldRequirement.Required && explicitConfig is not null && string.IsNullOrWhiteSpace(req.BibDescription))
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

        if (req.BibDescription is not null && config.Bib != FieldRequirement.Off)
            team.BibDescription = string.IsNullOrWhiteSpace(req.BibDescription) ? null : req.BibDescription.Trim();

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
                BirthYear = kept.BirthYear, AgeGroup = kept.AgeGroup, WeightKg = kept.WeightKg,
                PonyPassportNumber = kept.PonyPassportNumber, PonyAge = kept.PonyAge,
                MembershipNumber = kept.MembershipNumber, EmergencyContactName = kept.EmergencyContactName,
                EmergencyContactPhone = kept.EmergencyContactPhone, MedicalNotes = kept.MedicalNotes,
                CustomValuesJson = kept.CustomValuesJson, FlagsJson = kept.FlagsJson,
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
            foreach (var (r, kept) in req.Riders.Select((r, i) => (r, built[i])).Where(x => x.r.SavedRiderId is null && !x.r.IsGuestRider && !string.IsNullOrWhiteSpace(x.r.FullName)))
            {
                var existing = await _db.SavedRiders.FirstOrDefaultAsync(s =>
                    s.ClubId == team.ClubId && s.FullName == r.FullName
                    && (sharesRoster || s.CreatedByUserId == userId));
                if (existing is null)
                {
                    _db.SavedRiders.Add(new SavedRider
                    {
                        ClubId = team.ClubId,
                        CreatedByUserId = userId,
                        FullName = r.FullName,
                        DateOfBirth = kept.DateOfBirth,
                        HorseName = r.HorseName,
                        PonyHeightHands = kept.PonyHeightHands,
                        UseInitialOnly = r.UseInitialOnly,
                        NoFilming = r.NoFilming
                    });
                }
                else
                {
                    existing.DateOfBirth ??= kept.DateOfBirth;
                    existing.HorseName ??= r.HorseName;
                    existing.PonyHeightHands ??= kept.PonyHeightHands;
                    existing.UseInitialOnly = r.UseInitialOnly;
                    existing.NoFilming = r.NoFilming;
                    existing.UpdatedAt = DateTime.UtcNow;
                }
            }
        }

        await _db.SaveChangesAsync();

        await _db.Entry(form).Reference(f => f.Team).LoadAsync();
        await _db.Entry(form).Reference(f => f.SubmittedBy).LoadAsync();
        return form.ToDto(includePrivate: true, (await EntryTeamNamesAsync([form.TeamId])).GetValueOrDefault(form.TeamId));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.TeamWork)]
    public async Task<IActionResult> Delete(int id)
    {
        var d = await _db.DeclarationForms.Include(d => d.Team).FirstOrDefaultAsync(d => d.Id == id);
        if (d is null) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!User.IsInRole(Roles.Admin) && d.SubmittedByUserId != userId && d.Team?.TrainerUserId != userId)
            return Forbid();
        _db.DeclarationForms.Remove(d);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
