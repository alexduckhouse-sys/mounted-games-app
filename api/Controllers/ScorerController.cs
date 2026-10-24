using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

/// <summary>
/// What a scorer link can do: read its arena's timetable, and enter or replace scores for heats in that arena.
/// No account, no JWT: <see cref="ScorerLinkAccessAttribute"/> checks the <c>X-Scorer-Token</c> header. There is
/// deliberately no clock, sign-off, timetable, team, entry or chat action here. A race outside the link's
/// competition and arena is 404, exactly as if it didn't exist. Scores still go through <see cref="ScoringService"/>.
/// </summary>
[ApiController]
[ScorerLinkAccess]
public class ScorerController(AppDbContext db, ScoringService scoring, ILiveBroadcaster live) : ControllerBase
{
    private ScorerLink Link => ScorerLinkAccessAttribute.Current(HttpContext);
    private string ActorLabel => $"Scorer link: {Link.Label}";

    [EnableRateLimiting("public-read")]
    [HttpGet("api/scorer/session")]
    public async Task<ActionResult<ScorerSessionDto>> GetSession(CancellationToken ct)
    {
        var link = Link;
        var isAllArenas = link.ArenaName == "All arenas";
        var isMainArena = link.ArenaName == "Main arena";
        var competition = await db.Competitions.AsNoTracking().FirstAsync(c => c.Id == link.CompetitionId, ct);
        var sessions = await db.Sessions.AsNoTracking().AsSplitQuery()
            .Where(s => s.CompetitionId == link.CompetitionId && (isAllArenas || s.ArenaName == link.ArenaName || (isMainArena && (s.ArenaName == null || s.ArenaName == ""))))
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .OrderBy(s => s.OrderIndex).ToListAsync(ct);
        return new ScorerSessionDto(link.Label, competition.Id, competition.Name, link.ArenaName, link.ExpiresAt,
            sessions.Select(s => s.ToDto()).ToList());
    }

    [EnableRateLimiting("public-read")]
    [HttpGet("api/scorer/races/{raceId:int}/score")]
    public async Task<ActionResult<RaceScoreDto>> GetScore(int raceId, CancellationToken ct)
    {
        if (!await InScopeAsync(raceId, ct)) return NotFound();
        try
        {
            var score = await scoring.GetAsync(raceId, ct);
            // Referee notes are for staff: a scorer link never reads them.
            return score with { Results = score.Results.Select(r => r with { RefereeNote = null }).ToList() };
        }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    /// <summary>Versioned save with an idempotent <c>RequestId</c> and an expected revision.</summary>
    [HttpPut("api/scorer/races/{raceId:int}/score")]
    public async Task<ActionResult<RaceScoreDto>> UpdateScore(int raceId, UpdateRaceScoreRequest request, CancellationToken ct)
    {
        if (!await InScopeAsync(raceId, ct)) return NotFound();
        if (request.Places?.Any(p => p.RefereeNote is { Length: > 1000 }) == true)
            return BadRequest(new { message = "Note must be 1000 characters or fewer." });
        try
        {
            // A scorer link can't write referee notes either; leaving one out keeps the note staff set.
            var withoutNotes = request with { Places = request.Places?.Select(p => p with { RefereeNote = null }).ToList() };
            var score = await scoring.ApplyVersionedAsync(raceId, withoutNotes, null, ct, ActorLabel);
            await BroadcastAsync(raceId);
            return score with { Results = score.Results.Select(r => r with { RefereeNote = null }).ToList() };
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) when (ex.Message == "Race not found") { return NotFound(); }
        catch (ScoreConflictException ex) { return Conflict(new { message = ex.Message }); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) when (ScoringController.IsScoringConcurrency(ex))
        { return Conflict(new { message = "These results were changed on another device." }); }
    }

    /// <summary>
    /// The save the phone's outbox sends: places plus the results the scorer saw, answered with the heat, or with the
    /// winning heat on a conflict. Same behaviour as the staff endpoint of the same shape.
    /// </summary>
    [HttpPost("api/scorer/races/{raceId:int}/results")]
    public async Task<ActionResult<HeatDto>> SubmitResults(int raceId, SubmitRaceResultsRequest req, CancellationToken ct)
    {
        if (!await InScopeAsync(raceId, ct)) return NotFound();
        var race = await db.Races.Include(r => r.Heat).ThenInclude(h => h!.Session)
            .FirstOrDefaultAsync(r => r.Id == raceId, ct);
        if (race is null) return NotFound();
        if (req.Reason?.Length > 1000) return BadRequest(new { message = "Correction reason must be 1000 characters or fewer." });
        if (req.Places.Any(p => p.RefereeNote is { Length: > 1000 }))
            return BadRequest(new { message = "Note must be 1000 characters or fewer." });
        try
        {
            await scoring.ApplyLegacyAsync(raceId, req.Places.Select(p => p with { RefereeNote = null }).ToList(), req.Expected, null, req.Reason, ct, ActorLabel);
        }
        catch (ScoreConflictException ex) { return await ConflictAsync(race, ex.Message); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) when (ScoringController.IsScoringConcurrency(ex))
        { return await ConflictAsync(race, "These results were changed on another device."); }

        var dto = await HeatDtoAsync(race.HeatId);
        await live.ResultsUpdated(race.Heat!.Session!.CompetitionId, new { sessionId = race.Heat.SessionId, heat = dto });
        return dto;
    }

    /// <summary>True only for a race in this link's competition and arena.</summary>
    private Task<bool> InScopeAsync(int raceId, CancellationToken ct)
    {
        var link = Link;
        var isAllArenas = link.ArenaName == "All arenas";
        var isMainArena = link.ArenaName == "Main arena";
        return db.Races.AsNoTracking().AnyAsync(r => r.Id == raceId
            && r.Heat!.Session!.CompetitionId == link.CompetitionId
            && (isAllArenas || r.Heat.Session.ArenaName == link.ArenaName || (isMainArena && (r.Heat.Session.ArenaName == null || r.Heat.Session.ArenaName == ""))), ct);
    }

    private async Task<HeatDto> HeatDtoAsync(int heatId)
    {
        var heat = await db.Heats
            .Include(h => h.Entries).ThenInclude(e => e.Team)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(h => h.Id == heatId);
        return heat.ToDto();
    }

    private async Task<ActionResult<HeatDto>> ConflictAsync(Race race, string message)
    {
        // The failed transaction can leave losing results tracked; answer from the committed database.
        db.ChangeTracker.Clear();
        return Conflict(new { message, sessionId = race.Heat!.SessionId, heat = await HeatDtoAsync(race.HeatId) });
    }

    private async Task BroadcastAsync(int raceId)
    {
        var race = await db.Races.AsNoTracking().Include(r => r.Heat).ThenInclude(h => h!.Session).FirstAsync(r => r.Id == raceId);
        await live.ResultsUpdated(race.Heat!.Session!.CompetitionId,
            new { sessionId = race.Heat.SessionId, heat = await HeatDtoAsync(race.HeatId) });
    }
}
