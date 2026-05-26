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

        var q = _db.DeclarationForms
            .Include(d => d.Team).ThenInclude(t => t!.Competition)
            .Include(d => d.SubmittedBy)
            .Include(d => d.Riders)
            .AsQueryable();

        // Everyone (anonymous, trainer, admin) sees all locked forms; admins also see drafts.
        if (!isAdmin)
            q = q.Where(d => d.IsLocked);
        if (competitionId.HasValue)
            q = q.Where(d => d.Team!.CompetitionId == competitionId);
        if (teamId.HasValue)
            q = q.Where(d => d.TeamId == teamId);

        return (await q.OrderByDescending(d => d.SubmittedAt).ToListAsync()).Select(d => d.ToDto());
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
        return d.ToDto();
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
        // Trainers may submit for any team unless it's already assigned to a *different* trainer.
        if (!isAdmin && team.TrainerUserId is not null && team.TrainerUserId != userId)
            return Forbid();

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
                OrderIndex = r.OrderIndex == 0 ? order : r.OrderIndex
            });
            order++;
        }
        _db.DeclarationForms.Add(form);

        if (req.SaveToRoster)
        {
            foreach (var r in req.Riders.Where(r => r.SavedRiderId is null && !string.IsNullOrWhiteSpace(r.FullName)))
            {
                var existing = await _db.SavedRiders.FirstOrDefaultAsync(s =>
                    s.ClubId == team.ClubId && s.FullName == r.FullName);
                if (existing is null)
                {
                    _db.SavedRiders.Add(new SavedRider
                    {
                        ClubId = team.ClubId,
                        FullName = r.FullName,
                        DateOfBirth = r.DateOfBirth,
                        HorseName = r.HorseName
                    });
                }
                else
                {
                    existing.DateOfBirth ??= r.DateOfBirth;
                    existing.HorseName ??= r.HorseName;
                    existing.UpdatedAt = DateTime.UtcNow;
                }
            }
        }

        await _db.SaveChangesAsync();

        await _db.Entry(form).Reference(f => f.Team).LoadAsync();
        await _db.Entry(form).Reference(f => f.SubmittedBy).LoadAsync();
        return form.ToDto();
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
