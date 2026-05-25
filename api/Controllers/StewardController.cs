using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
public class StewardController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILiveBroadcaster _live;

    public StewardController(AppDbContext db, ILiveBroadcaster live)
    {
        _db = db;
        _live = live;
    }

    /// <summary>
    /// Public — a volunteer steward watching a lane reports an elimination
    /// for the team currently in that lane on the named race.
    /// </summary>
    [HttpPost("api/races/{raceId:int}/steward-calls")]
    [AllowAnonymous]
    public async Task<ActionResult<StewardCallDto>> Create(int raceId, CreateStewardCallRequest req)
    {
        var race = await _db.Races
            .Include(r => r.Heat)
            .ThenInclude(h => h!.Session)
            .FirstOrDefaultAsync(r => r.Id == raceId);
        if (race is null || race.Heat?.Session is null) return NotFound();

        // Don't accept calls on races that have already been scored.
        if (race.IsComplete) return BadRequest(new { message = "This race is already complete." });

        // Block calls from IP-blocked sources (same network ban used for chat).
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        if (!string.IsNullOrEmpty(ip) && await _db.IpBlocks.AnyAsync(b => b.IpAddress == ip))
            return StatusCode(403, new { message = "Reporting from this network is blocked." });

        // Confirm the team is actually in this heat.
        var inHeat = await _db.HeatEntries.AnyAsync(e => e.HeatId == race.HeatId && e.TeamId == req.TeamId);
        if (!inHeat) return BadRequest(new { message = "Team is not in this heat." });

        // De-dupe: a single steward (by IP) shouldn't be able to spam multiple
        // calls for the same team on the same race within a minute.
        var since = DateTime.UtcNow.AddMinutes(-1);
        var alreadyCalled = !string.IsNullOrEmpty(ip)
            && await _db.StewardCalls.AnyAsync(c =>
                c.RaceId == raceId
                && c.TeamId == req.TeamId
                && c.IpAddress == ip
                && c.CreatedAt >= since);
        if (alreadyCalled)
        {
            return Conflict(new { message = "You already reported this team on this race — wait for an admin to review." });
        }

        var name = req.ReporterName?.Trim();
        if (!string.IsNullOrEmpty(name) && name.Length > 60) name = name[..60];

        var call = new StewardCall
        {
            RaceId = raceId,
            TeamId = req.TeamId,
            LaneIndex = req.LaneIndex,
            ReporterName = string.IsNullOrEmpty(name) ? null : name,
            IpAddress = ip,
        };
        _db.StewardCalls.Add(call);
        await _db.SaveChangesAsync();

        var loaded = await _db.StewardCalls
            .Include(c => c.Race).ThenInclude(r => r!.Heat).ThenInclude(h => h!.Session)
            .Include(c => c.Team)
            .FirstAsync(c => c.Id == call.Id);
        var dto = loaded.ToDto();
        await _live.StewardCallCreated(race.Heat.Session.CompetitionId, dto);
        return dto;
    }

    /// <summary>
    /// List all pending steward calls for a competition. Anyone can fetch
    /// (steward and admin views both consume it).
    /// </summary>
    [HttpGet("api/competitions/{competitionId:int}/steward-calls")]
    [AllowAnonymous]
    public async Task<IEnumerable<StewardCallDto>> List(int competitionId)
    {
        var calls = await _db.StewardCalls
            .Include(c => c.Race).ThenInclude(r => r!.Heat).ThenInclude(h => h!.Session)
            .Include(c => c.Team)
            .Where(c => c.Race!.Heat!.Session!.CompetitionId == competitionId)
            .OrderByDescending(c => c.CreatedAt)
            .Take(200)
            .ToListAsync();
        return calls.Select(c => c.ToDto());
    }

    /// <summary>Admin dismisses a single pending call.</summary>
    [HttpDelete("api/steward-calls/{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Dismiss(int id)
    {
        var call = await _db.StewardCalls
            .Include(c => c.Race).ThenInclude(r => r!.Heat).ThenInclude(h => h!.Session)
            .FirstOrDefaultAsync(c => c.Id == id);
        if (call is null) return NotFound();
        var competitionId = call.Race?.Heat?.Session?.CompetitionId ?? 0;
        _db.StewardCalls.Remove(call);
        await _db.SaveChangesAsync();
        if (competitionId > 0) await _live.StewardCallResolved(competitionId, id);
        return NoContent();
    }
}
