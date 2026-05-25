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
    [Authorize(Roles = Roles.Admin + "," + Roles.Trainer)]
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
    [Authorize(Roles = Roles.Admin + "," + Roles.Trainer)]
    public async Task<IActionResult> Delete(int competitionId, int id)
    {
        var t = await _db.Teams.FirstOrDefaultAsync(t => t.Id == id && t.CompetitionId == competitionId);
        if (t is null) return NotFound();
        _db.Teams.Remove(t);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("/api/trainer/my-teams")]
    [Authorize]
    public async Task<IEnumerable<TeamDto>> MyTeams()
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Array.Empty<TeamDto>();
        // Includes both the user's coached teams AND any team they're an accepted
        // supporter of. Caller (My Teams page) splits on `relationship`.
        var teams = await _db.Teams
            .Include(t => t.Club).Include(t => t.Section).Include(t => t.Trainer).Include(t => t.Competition)
            .Include(t => t.Supporters)
            .Where(t => t.TrainerUserId == userId
                || t.Supporters.Any(s => s.UserId == userId && s.Status == TeamSupporterStatus.Accepted))
            .OrderByDescending(t => t.Competition!.StartDate)
            .ToListAsync();
        return teams.Select(t => t.ToDtoFor(userId));
    }

    [HttpPost("{teamId:int}/supporter-key")]
    [Authorize]
    public async Task<ActionResult<GenerateJoinKeyResponse>> RotateJoinKey(int teamId)
    {
        var (team, err) = await LoadTeamForTrainerAsync(teamId);
        if (err != null) return err;
        team!.SupporterJoinKey = GenerateKey();
        await _db.SaveChangesAsync();
        return new GenerateJoinKeyResponse(team.SupporterJoinKey!);
    }

    [HttpDelete("{teamId:int}/supporter-key")]
    [Authorize]
    public async Task<IActionResult> RevokeJoinKey(int teamId)
    {
        var (team, err) = await LoadTeamForTrainerAsync(teamId);
        if (err != null) return err;
        team!.SupporterJoinKey = null;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{teamId:int}/supporters")]
    [Authorize]
    public async Task<ActionResult<IEnumerable<TeamSupporterDto>>> ListSupporters(int teamId)
    {
        var (team, err) = await LoadTeamForTrainerAsync(teamId);
        if (err != null) return err;
        var rows = await _db.TeamSupporters
            .Include(s => s.User).Include(s => s.Team)
            .Where(s => s.TeamId == team!.Id)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
        return Ok(rows.Select(s => s.ToDto()));
    }

    [HttpPost("/api/teams/join")]
    [Authorize]
    public async Task<ActionResult<TeamSupporterDto>> Join(JoinTeamRequest req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        var key = req.Key?.Trim();
        if (string.IsNullOrEmpty(key)) return BadRequest(new { message = "Join key required." });

        var team = await _db.Teams
            .Include(t => t.Competition).Include(t => t.Trainer)
            .FirstOrDefaultAsync(t => t.SupporterJoinKey == key);
        if (team is null) return NotFound(new { message = "No team matches that key. Double-check with the trainer." });

        // Don't let the team's own trainer request to "support" their own team.
        if (team.TrainerUserId == userId)
            return BadRequest(new { message = "You're already the trainer of this team." });

        var existing = await _db.TeamSupporters
            .Include(s => s.Team).Include(s => s.User)
            .FirstOrDefaultAsync(s => s.TeamId == team.Id && s.UserId == userId);
        if (existing is not null) return Ok(existing.ToDto());

        var row = new TeamSupporter
        {
            TeamId = team.Id,
            UserId = userId,
            Status = TeamSupporterStatus.Pending,
        };
        _db.TeamSupporters.Add(row);
        await _db.SaveChangesAsync();
        var loaded = await _db.TeamSupporters
            .Include(s => s.User).Include(s => s.Team)
            .FirstAsync(s => s.Id == row.Id);
        return Ok(loaded.ToDto());
    }

    [HttpPut("/api/team-supporters/{id:int}/accept")]
    [Authorize]
    public async Task<ActionResult<TeamSupporterDto>> Accept(int id)
    {
        var row = await _db.TeamSupporters
            .Include(s => s.Team).Include(s => s.User)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (row is null) return NotFound();
        if (!await ViewerOwnsTeamAsync(row.TeamId)) return Forbid();
        row.Status = TeamSupporterStatus.Accepted;
        await _db.SaveChangesAsync();
        return row.ToDto();
    }

    [HttpDelete("/api/team-supporters/{id:int}")]
    [Authorize]
    public async Task<IActionResult> RemoveSupporter(int id)
    {
        var row = await _db.TeamSupporters
            .Include(s => s.Team)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (row is null) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        // The supporter themselves can leave; the trainer (or admin) can kick.
        var canRemove = row.UserId == userId || await ViewerOwnsTeamAsync(row.TeamId);
        if (!canRemove) return Forbid();
        _db.TeamSupporters.Remove(row);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Loads a team if the current viewer trains it (or is Admin).</summary>
    private async Task<(Team? team, ActionResult? error)> LoadTeamForTrainerAsync(int teamId)
    {
        var team = await _db.Teams.FirstOrDefaultAsync(t => t.Id == teamId);
        if (team is null) return (null, NotFound());
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return (null, Unauthorized());
        if (team.TrainerUserId != userId && !User.IsInRole(Roles.Admin)) return (null, Forbid());
        return (team, null);
    }

    private async Task<bool> ViewerOwnsTeamAsync(int teamId)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return false;
        if (User.IsInRole(Roles.Admin)) return true;
        return await _db.Teams.AnyAsync(t => t.Id == teamId && t.TrainerUserId == userId);
    }

    private static string GenerateKey()
    {
        // Short, unambiguous join key — no I/0/1/O.
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var rng = System.Security.Cryptography.RandomNumberGenerator.Create();
        var bytes = new byte[8];
        rng.GetBytes(bytes);
        var sb = new System.Text.StringBuilder(8);
        foreach (var b in bytes) sb.Append(chars[b % chars.Length]);
        return sb.ToString();
    }
}
