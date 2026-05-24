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
[Route("api/competitions/{competitionId:int}/teams")]
public class TeamsController : ControllerBase
{
    private readonly AppDbContext _db;
    public TeamsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IEnumerable<TeamDto>> List(int competitionId) =>
        (await _db.Teams
            .Include(t => t.Club).Include(t => t.Section).Include(t => t.Trainer)
            .Where(t => t.CompetitionId == competitionId)
            .OrderBy(t => t.DisplayName)
            .ToListAsync())
        .Select(t => t.ToDto());

    [HttpPost]
    [Authorize(Roles = Roles.Admin + "," + Roles.Trainer)]
    public async Task<ActionResult<TeamDto>> Create(int competitionId, CreateTeamRequest req)
    {
        var section = await _db.CompetitionSections.FindAsync(req.CompetitionSectionId);
        if (section is null || section.CompetitionId != competitionId)
            return BadRequest(new { message = "Section is not part of this competition." });

        var club = await _db.Clubs.FindAsync(req.ClubId);
        if (club is null) return BadRequest(new { message = "Club not found." });

        var display = string.IsNullOrWhiteSpace(req.Suffix)
            ? club.Name
            : $"{club.Name} {req.Suffix.Trim().ToUpperInvariant()}";

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var trainerUserId = req.TrainerUserId;
        if (string.IsNullOrEmpty(trainerUserId) && User.IsInRole(Roles.Trainer))
            trainerUserId = userId;

        var team = new Team
        {
            CompetitionId = competitionId,
            CompetitionSectionId = req.CompetitionSectionId,
            ClubId = req.ClubId,
            Suffix = req.Suffix.Trim().ToUpperInvariant(),
            DisplayName = display,
            BibColour = req.BibColour ?? club.BibColour,
            TrainerUserId = trainerUserId,
            IsHorsConcours = req.IsHorsConcours
        };
        _db.Teams.Add(team);
        await _db.SaveChangesAsync();

        await _db.Entry(team).Reference(t => t.Club).LoadAsync();
        await _db.Entry(team).Reference(t => t.Section).LoadAsync();
        await _db.Entry(team).Reference(t => t.Trainer).LoadAsync();
        return team.ToDto();
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<TeamDto>> Update(int competitionId, int id, UpdateTeamRequest req)
    {
        var t = await _db.Teams
            .Include(x => x.Club).Include(x => x.Section).Include(x => x.Trainer)
            .FirstOrDefaultAsync(x => x.Id == id && x.CompetitionId == competitionId);
        if (t is null) return NotFound();
        if (!string.IsNullOrWhiteSpace(req.Suffix))
        {
            t.Suffix = req.Suffix.Trim().ToUpperInvariant();
            t.DisplayName = string.IsNullOrWhiteSpace(t.Suffix)
                ? t.Club?.Name ?? t.DisplayName
                : $"{t.Club?.Name ?? string.Empty} {t.Suffix}".Trim();
        }
        if (req.IsHorsConcours.HasValue) t.IsHorsConcours = req.IsHorsConcours.Value;
        await _db.SaveChangesAsync();
        return t.ToDto();
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int competitionId, int id)
    {
        var t = await _db.Teams.FirstOrDefaultAsync(t => t.Id == id && t.CompetitionId == competitionId);
        if (t is null) return NotFound();
        _db.Teams.Remove(t);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("/api/trainer/my-teams")]
    [Authorize(Roles = Roles.Trainer + "," + Roles.Admin)]
    public async Task<IEnumerable<TeamDto>> MyTeams()
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Array.Empty<TeamDto>();
        return (await _db.Teams
            .Include(t => t.Club).Include(t => t.Section).Include(t => t.Trainer).Include(t => t.Competition)
            .Where(t => t.TrainerUserId == userId)
            .OrderByDescending(t => t.Competition!.StartDate)
            .ToListAsync())
        .Select(t => t.ToDto());
    }
}
