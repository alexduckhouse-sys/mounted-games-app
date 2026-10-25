using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.EventTools;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Saved starting points: a competition's set-up (no teams, heats, results, entries or payments) kept under a name, to begin
/// new competitions from. Private to the organiser who saved it; admins see and manage all. Someone else's starting point is
/// a 404, never a 403, so its existence isn't revealed.
/// </summary>
[ApiController]
[Authorize(Roles = Roles.Organiser)]
public sealed class StartingPointsController(AppDbContext db) : ControllerBase
{
    private string UserId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    private bool IsAdmin => User.IsInRole(Roles.Admin);

    [HttpGet("api/starting-points")]
    public async Task<ActionResult<IReadOnlyList<StartingPointDto>>> List(CancellationToken ct)
    {
        var userId = UserId;
        var query = db.StartingPoints.AsNoTracking();
        if (!IsAdmin) query = query.Where(p => p.OwnerUserId == userId);
        var points = await query.OrderByDescending(p => p.UpdatedAt).ThenByDescending(p => p.Id).ToListAsync(ct);
        var owners = new Dictionary<string, string>();
        if (IsAdmin)
        {
            var ids = points.Select(p => p.OwnerUserId).Distinct().ToList();
            owners = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FullName, ct);
        }
        return points.Select(p => ToDto(p, userId, owners.GetValueOrDefault(p.OwnerUserId))).ToList();
    }

    [HttpPost("api/competitions/{competitionId:int}/starting-points")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<StartingPointDto>> Save(int competitionId, SaveStartingPointRequest request, CancellationToken ct)
    {
        var name = CleanName(request.Name);
        if (name is null) return BadRequest(new { message = $"Give the starting point a name of up to {StartingPoint.MaxNameLength} characters." });
        var userId = UserId;
        if (await db.StartingPoints.CountAsync(p => p.OwnerUserId == userId, ct) >= StartingPoint.MaxPerOwner)
            return BadRequest(new { message = $"You can keep up to {StartingPoint.MaxPerOwner} starting points. Remove one first." });

        CompetitionSetup setup;
        try { setup = await new CompetitionSetupService(db).ReadAsync(competitionId, ct); }
        catch (EventToolsException ex) { return Problem(statusCode: ex.StatusCode, title: "Starting point not saved", detail: ex.Message); }
        var sourceName = await db.Competitions.AsNoTracking().Where(c => c.Id == competitionId).Select(c => c.Name).FirstAsync(ct);

        var point = new StartingPoint
        {
            Name = name, OwnerUserId = userId, SourceName = sourceName.Length > 200 ? sourceName[..200] : sourceName,
            SetupJson = setup.ToJson(),
        };
        db.StartingPoints.Add(point);
        await db.SaveChangesAsync(ct);
        return Created($"/api/starting-points/{point.Id}", ToDto(point, userId, null));
    }

    [HttpPut("api/starting-points/{id:int}")]
    public async Task<ActionResult<StartingPointDto>> Rename(int id, RenameStartingPointRequest request, CancellationToken ct)
    {
        var point = await FindAsync(id, ct);
        if (point is null) return NotFound();
        var name = CleanName(request.Name);
        if (name is null) return BadRequest(new { message = $"Give the starting point a name of up to {StartingPoint.MaxNameLength} characters." });
        point.Name = name;
        point.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return ToDto(point, UserId, null);
    }

    [HttpDelete("api/starting-points/{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var point = await FindAsync(id, ct);
        if (point is null) return NotFound();
        db.StartingPoints.Remove(point);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Creates a competition, owned by the caller, from the starting point. The start date is required, because a competition needs one.</summary>
    [HttpPost("api/starting-points/{id:int}/competition")]
    public async Task<ActionResult<CloneCompetitionResultDto>> CreateCompetition(
        int id, CreateFromStartingPointRequest request, CancellationToken ct)
    {
        var point = await FindAsync(id, ct);
        if (point is null) return NotFound();
        var setup = CompetitionSetup.Parse(point.SetupJson);
        if (setup is null) return Problem(statusCode: 409, title: "Competition cannot be created", detail: "This starting point can't be read. Save it again from a competition.");
        try
        {
            var (competition, sections, sessions) = await new CompetitionSetupService(db)
                .CreateAsync(setup, request.Name, request.StartDate, request.EndDate, UserId, ct);
            return Created($"/api/competitions/{competition.Id}",
                new CloneCompetitionResultDto(competition.Id, competition.Name, sections, 0, sessions, 0, 0));
        }
        catch (EventToolsException ex)
        {
            return Problem(statusCode: ex.StatusCode, title: "Competition cannot be created", detail: ex.Message);
        }
    }

    private async Task<StartingPoint?> FindAsync(int id, CancellationToken ct)
    {
        var userId = UserId;
        return await db.StartingPoints.FirstOrDefaultAsync(p => p.Id == id && (IsAdmin || p.OwnerUserId == userId), ct);
    }

    private static string? CleanName(string? name)
    {
        var clean = name?.Trim();
        return string.IsNullOrEmpty(clean) || clean.Length > StartingPoint.MaxNameLength ? null : clean;
    }

    private static StartingPointDto ToDto(StartingPoint p, string viewerId, string? ownerName)
    {
        var setup = CompetitionSetup.Parse(p.SetupJson);
        return new StartingPointDto(p.Id, p.Name, p.SourceName, setup?.Sections.Count ?? 0, setup?.Sessions.Count ?? 0,
            p.CreatedAt, p.UpdatedAt, p.OwnerUserId == viewerId, ownerName);
    }
}
