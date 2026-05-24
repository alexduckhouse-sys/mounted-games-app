using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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
            .FirstOrDefaultAsync(r => r.Id == raceId);
        if (race is null) return NotFound();

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var places = req.Places.Select(p => new FinishingPlace(p.TeamId, p.Place, p.Eliminated));
        await _scoring.ApplyRaceResultsAsync(raceId, places, userId);

        var heatId = race.HeatId;
        var refreshed = await _db.Heats
            .Include(h => h.Entries).ThenInclude(e => e.Team)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(h => h.Id == heatId);
        var dto = refreshed.ToDto();

        var competitionId = race.Heat!.Session!.CompetitionId;
        await _live.ResultsUpdated(competitionId, new { sessionId = race.Heat.SessionId, heat = dto });
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
}
