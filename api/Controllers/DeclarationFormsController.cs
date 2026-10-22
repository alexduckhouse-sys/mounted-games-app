using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

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
        return (await q.OrderByDescending(d => d.SubmittedAt).ToListAsync()).Select(d => d.ToDto(CanReadPrivate(d, helping)));
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
        return d.ToDto(canRead);
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

    [HttpPost]
    [Authorize(Roles = Roles.TeamWork)]
    public async Task<ActionResult<DeclarationFormDto>> Submit(SubmitDeclarationFormRequest req)
    {
        var team = await _db.Teams.Include(t => t.Club).Include(t => t.Competition)
            .FirstOrDefaultAsync(t => t.Id == req.TeamId);
        if (team is null) return BadRequest(new { message = "Team not found." });

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var isAdmin = User.IsInRole(Roles.Admin);
        // Only the team's own trainer, or someone who organises its competition, may submit or overwrite a
        // declaration. An unclaimed team is not open to everyone.
        if (!isAdmin && !(userId is not null && team.TrainerUserId == userId)
            && !await CanOrganiseAsync(team.CompetitionId, userId))
            return Forbid();

        var savedIds = req.Riders.Where(r => r.SavedRiderId.HasValue).Select(r => r.SavedRiderId!.Value).Distinct().ToArray();
        var permittedSavedCount = await _db.SavedRiders.CountAsync(r => savedIds.Contains(r.Id)
            && r.ClubId == team.ClubId && (isAdmin || (userId != null && r.CreatedByUserId == userId)));
        if (permittedSavedCount != savedIds.Length) return BadRequest(new { message = "A saved rider is not available to this account." });

        if (!string.IsNullOrWhiteSpace(req.TrainerPhone) && userId is not null)
        {
            var trainer = await _users.FindByIdAsync(userId);
            if (trainer is not null && trainer.PhoneNumber != req.TrainerPhone)
            {
                trainer.PhoneNumber = req.TrainerPhone.Trim();
                await _users.UpdateAsync(trainer);
            }
        }

        var form = new DeclarationForm
        {
            TeamId = team.Id,
            SubmittedByUserId = userId,
            Notes = req.Notes,
            IsLocked = true
        };
        var order = 0;
        foreach (var r in req.Riders)
        {
            form.Riders.Add(new RiderEntry
            {
                SavedRiderId = r.SavedRiderId,
                FullName = r.FullName,
                DateOfBirth = r.DateOfBirth,
                HorseName = r.HorseName,
                BibColour = string.IsNullOrWhiteSpace(r.BibColour) ? null : r.BibColour.Trim(),
                IsCaptain = r.IsCaptain,
                IsReserve = r.IsReserve,
                OrderIndex = r.OrderIndex == 0 ? order : r.OrderIndex,
                UseInitialOnly = r.UseInitialOnly,
                NoFilming = r.NoFilming
            });
            order++;
        }
        _db.DeclarationForms.Add(form);

        if (req.SaveToRoster)
        {
            foreach (var r in req.Riders.Where(r => r.SavedRiderId is null && !string.IsNullOrWhiteSpace(r.FullName)))
            {
                var existing = await _db.SavedRiders.FirstOrDefaultAsync(s =>
                    s.ClubId == team.ClubId && s.CreatedByUserId == userId && s.FullName == r.FullName);
                if (existing is null)
                {
                    _db.SavedRiders.Add(new SavedRider
                    {
                        ClubId = team.ClubId,
                        CreatedByUserId = userId,
                        FullName = r.FullName,
                        DateOfBirth = r.DateOfBirth,
                        HorseName = r.HorseName,
                        UseInitialOnly = r.UseInitialOnly,
                        NoFilming = r.NoFilming
                    });
                }
                else
                {
                    existing.DateOfBirth ??= r.DateOfBirth;
                    existing.HorseName ??= r.HorseName;
                    existing.UseInitialOnly = r.UseInitialOnly;
                    existing.NoFilming = r.NoFilming;
                    existing.UpdatedAt = DateTime.UtcNow;
                }
            }
        }

        await _db.SaveChangesAsync();

        await _db.Entry(form).Reference(f => f.Team).LoadAsync();
        await _db.Entry(form).Reference(f => f.SubmittedBy).LoadAsync();
        return form.ToDto(includePrivate: true);
    }

    /// <summary>
    /// Mirrors <see cref="CompetitionAccessAttribute"/>: the competition's owning Trainer, or anyone on its team.
    /// Admins are handled by the caller.
    /// </summary>
    private async Task<bool> CanOrganiseAsync(int competitionId, string? userId)
    {
        if (string.IsNullOrEmpty(userId)) return false;
        var owner = User.IsInRole(Roles.Trainer);
        return await _db.Competitions.AsNoTracking().AnyAsync(c => c.Id == competitionId
            && ((owner && c.CreatedByUserId == userId)
                || _db.CompetitionCollaborators.Any(k => k.CompetitionId == c.Id && k.UserId == userId)));
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
