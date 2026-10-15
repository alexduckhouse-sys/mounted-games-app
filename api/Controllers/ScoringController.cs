using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Authorize(Roles = Roles.Admin)]
public class ScoringController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ScoringService _scoring;
    private readonly ILiveBroadcaster _live;

    public ScoringController(AppDbContext db, ScoringService scoring, ILiveBroadcaster live)
    {
        _db = db;
        _scoring = scoring;
        _live = live;
    }

    [HttpPost("api/races/{raceId:int}/results")]
    public async Task<ActionResult<HeatDto>> SubmitRaceResults(int raceId, SubmitRaceResultsRequest req)
    {
        var race = await _db.Races
            .Include(r => r.Heat).ThenInclude(h => h!.Session)
            .Include(r => r.Heat).ThenInclude(h => h!.Entries)
            .Include(r => r.Results)
            .FirstOrDefaultAsync(r => r.Id == raceId);
        if (race is null) return NotFound();

        if (req.Expected is not null)
        {
            var entryTeamIds = race.Heat!.Entries.Select(e => e.TeamId).ToHashSet();
            var current = ResultsKey(race.Results.Select(r => (r.TeamId, r.Placing ?? 0, r.Eliminated)));
            var incoming = ResultsKey(req.Places.Where(p => entryTeamIds.Contains(p.TeamId)).Select(p => (p.TeamId, p.Place, p.Eliminated)));
            // Already saved: a resend whose first reply was lost on the way back.
            if (current == incoming) return await HeatDtoAsync(race.HeatId);
            if (current != ResultsKey(req.Expected.Select(p => (p.TeamId, p.Place, p.Eliminated))))
                return Conflict(new
                {
                    message = "These results were changed on another device.",
                    sessionId = race.Heat.SessionId,
                    heat = await HeatDtoAsync(race.HeatId),
                });
        }

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var places = req.Places.Select(p => new FinishingPlace(p.TeamId, p.Place, p.Eliminated));
        await _scoring.ApplyRaceResultsAsync(raceId, places, userId);

        var dto = await HeatDtoAsync(race.HeatId);
        var competitionId = race.Heat!.Session!.CompetitionId;
        await _live.ResultsUpdated(competitionId, new { sessionId = race.Heat.SessionId, heat = dto });
        return dto;
    }

    private async Task<HeatDto> HeatDtoAsync(int heatId)
    {
        var heat = await _db.Heats
            .Include(h => h.Entries).ThenInclude(e => e.Team)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(h => h.Id == heatId);
        return heat.ToDto();
    }

    /// <summary>Order-independent summary of a race's placings; eliminated teams have no place.</summary>
    internal static string ResultsKey(IEnumerable<(int TeamId, int Place, bool Eliminated)> results)
        => string.Join(',', results
            .Select(r => r.Eliminated ? $"{r.TeamId}:E" : $"{r.TeamId}:{r.Place}")
            .Order(StringComparer.Ordinal));

    /// <summary>
    /// Admin starts a live clock for a race. Sets `StartedAt` to the tap time
    /// (idempotent — won't reset if already started) and clears `FinishedAt` so
    /// the timer runs again if you re-start a race in error.
    /// </summary>
    [HttpPost("api/races/{raceId:int}/start")]
    public async Task<ActionResult<RaceDto>> StartRace(int raceId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] RaceClockRequest? req = null)
    {
        var race = await _db.Races
            .Include(r => r.Heat).ThenInclude(h => h!.Session)
            .Include(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstOrDefaultAsync(r => r.Id == raceId);
        if (race is null) return NotFound();
        var tappedAt = ClockTime(req?.At, DateTime.UtcNow);
        // A retried Start can arrive after the Stop that followed it: keep the finish.
        if (req?.At is not null && race.FinishedAt is not null && race.FinishedAt >= tappedAt)
            return race.ToDto();
        if (race.StartedAt is null) race.StartedAt = tappedAt;
        race.FinishedAt = null;
        await _db.SaveChangesAsync();
        var dto = race.ToDto();
        await _live.ResultsUpdated(race.Heat!.Session!.CompetitionId,
            new { sessionId = race.Heat.SessionId, raceId, started = race.StartedAt });
        return dto;
    }

    /// <summary>Admin stops the live clock — sets `FinishedAt` to the tap time.</summary>
    [HttpPost("api/races/{raceId:int}/stop")]
    public async Task<ActionResult<RaceDto>> StopRace(int raceId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] RaceClockRequest? req = null)
    {
        var race = await _db.Races
            .Include(r => r.Heat).ThenInclude(h => h!.Session)
            .Include(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstOrDefaultAsync(r => r.Id == raceId);
        if (race is null) return NotFound();
        var now = DateTime.UtcNow;
        var finishedAt = ClockTime(req?.At, now);
        if (race.StartedAt is null || race.StartedAt > finishedAt) race.StartedAt = finishedAt.AddSeconds(-1);
        race.FinishedAt = finishedAt;
        await _db.SaveChangesAsync();
        var dto = race.ToDto();
        await _live.ResultsUpdated(race.Heat!.Session!.CompetitionId,
            new { sessionId = race.Heat.SessionId, raceId, finished = race.FinishedAt });
        return dto;
    }

    [HttpPut("api/heats/{heatId:int}/duration")]
    public async Task<ActionResult<HeatDto>> SetHeatDuration(int heatId, UpdateHeatDurationRequest req)
    {
        var heat = await _db.Heats
            .Include(h => h.Session)
            .Include(h => h.Entries).ThenInclude(e => e.Team)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstOrDefaultAsync(h => h.Id == heatId);
        if (heat is null) return NotFound();

        heat.DurationMinutes = req.DurationMinutes is > 0 ? req.DurationMinutes : null;
        await _db.SaveChangesAsync();

        var dto = heat.ToDto();
        var competitionId = heat.Session!.CompetitionId;
        await _live.ResultsUpdated(competitionId, new { sessionId = heat.SessionId, heat = dto });
        return dto;
    }

    /// <summary>
    /// Use the device's tap time when it is plausible: a request can sit in a
    /// phone's queue for a while on patchy signal, but never in the future.
    /// </summary>
    internal static DateTime ClockTime(DateTime? at, DateTime utcNow)
    {
        if (at is null) return utcNow;
        var tapped = at.Value.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(at.Value, DateTimeKind.Utc)
            : at.Value.ToUniversalTime();
        return tapped > utcNow || tapped < utcNow.AddMinutes(-10) ? utcNow : tapped;
    }
}
