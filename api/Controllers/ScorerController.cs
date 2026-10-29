using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Security;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

/// <summary>
/// What a scorer link can do: read its competition's timetable, and enter or replace scores in every arena.
/// No account, no JWT: <see cref="ScorerLinkAccessAttribute"/> checks the <c>X-Scorer-Token</c> header. There is
/// deliberately no clock, sign-off, timetable, team, entry or chat action here. A race outside the link's
/// competition is 404, exactly as if it didn't exist. Scores still go through <see cref="ScoringService"/>.
/// </summary>
[ApiController]
[ScorerLinkAccess]
public class ScorerController(AppDbContext db, ScoringService scoring, ILiveBroadcaster live) : ControllerBase
{
    private ScorerLink Link => ScorerLinkAccessAttribute.Current(HttpContext);
    private string ActorLabel => $"Scorer link: {Link.Label}";

    [EnableRateLimiting(RequestLimits.ScorerReadPolicy)]
    [HttpGet("api/scorer/session")]
    public async Task<ActionResult<ScorerSessionDto>> GetSession(CancellationToken ct)
    {
        var link = Link;
        var competition = await db.Competitions.AsNoTracking().FirstAsync(c => c.Id == link.CompetitionId, ct);
        var sessions = await db.Sessions.AsNoTracking().AsSplitQuery()
            .Where(s => s.CompetitionId == link.CompetitionId)
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .ToListAsync(ct);
        var ordered = sessions
            .OrderBy(s => s.ScheduledStart ?? DateTime.MaxValue)
            .ThenBy(s => s.OrderIndex)
            .ThenBy(s => s.Id)
            .Select(s => s.ToDto())
            .ToList();
        return new ScorerSessionDto(link.Label, competition.Id, competition.Name, link.ArenaName, link.ExpiresAt, ordered, link.Scope);
    }

    [EnableRateLimiting(RequestLimits.ScorerReadPolicy)]
    [HttpGet("api/scorer/races/{raceId:int}/score")]
    public async Task<ActionResult<RaceScoreDto>> GetScore(int raceId, CancellationToken ct)
    {
        if (Link.Scope == ScorerLink.ScopeCamera) return StatusCode(StatusCodes.Status403Forbidden, new { message = "This link is for the tripod camera only." });
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
        if (Link.Scope == ScorerLink.ScopeCamera) return StatusCode(StatusCodes.Status403Forbidden, new { message = "This link is for the tripod camera only." });
        if (!await InScopeAsync(raceId, ct)) return NotFound();
        if (request.Places?.Any(p => p.RefereeNote is { Length: > 1000 }) == true)
            return BadRequest(new { message = "Note must be 1000 characters or fewer." });
        try
        {
            // A scorer link can record why an eliminated team is out; leaving a note null keeps any note staff set.
            var score = await scoring.ApplyVersionedAsync(raceId, request, null, ct, ActorLabel);
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
        if (Link.Scope == ScorerLink.ScopeCamera) return StatusCode(StatusCodes.Status403Forbidden, new { message = "This link is for the tripod camera only." });
        if (!await InScopeAsync(raceId, ct)) return NotFound();
        var race = await db.Races.Include(r => r.Heat).ThenInclude(h => h!.Session)
            .FirstOrDefaultAsync(r => r.Id == raceId, ct);
        if (race is null) return NotFound();
        if (req.Reason?.Length > 1000) return BadRequest(new { message = "Correction reason must be 1000 characters or fewer." });
        if (req.Places.Any(p => p.RefereeNote is { Length: > 1000 }))
            return BadRequest(new { message = "Note must be 1000 characters or fewer." });
        try
        {
            await scoring.ApplyLegacyAsync(raceId, req.Places, req.Expected, null, req.Reason, ct, ActorLabel, req.FinishedAt);
        }
        catch (ScoreConflictException ex) { return await ConflictAsync(race, ex.Message); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) when (ScoringController.IsScoringConcurrency(ex))
        { return await ConflictAsync(race, "These results were changed on another device."); }

        var dto = await HeatDtoAsync(race.HeatId);
        var competitionId = race.Heat!.Session!.CompetitionId;
        await live.ResultsUpdated(competitionId, new { sessionId = race.Heat.SessionId, heat = dto });
        await BroadcastSessionAsync(race.Heat.SessionId, competitionId);
        return dto;
    }

    /// <summary>Record the flag-down time within the scorer link's competition.</summary>
    [HttpPost("api/scorer/races/{raceId:int}/start")]
    public async Task<ActionResult<RaceDto>> StartRace(int raceId, RaceClockRequest request, CancellationToken ct)
    {
        if (Link.Scope == ScorerLink.ScopeCamera) return StatusCode(403);
        if (!await InScopeAsync(raceId, ct)) return NotFound();
        try
        {
            var race = await scoring.UpdateRaceClockAsync(raceId, true,
                request.At ?? DateTime.UtcNow, request.At is not null, ct);
            await BroadcastAsync(raceId);
            return race.ToDto();
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (ScoringController.IsScoringConcurrency(ex))
        { return Conflict(new { message = "The race changed on another device. Try again." }); }
    }

    /// <summary>Allows a collecting-ring steward or scorer link to update a lane's gate check-in status.</summary>
    [HttpPut("api/scorer/heats/{heatId:int}/gate-check")]
    public async Task<ActionResult<SessionDto>> UpdateGateCheck(int heatId, UpdateGateCheckRequest req, CancellationToken ct)
    {
        if (Link.Scope == ScorerLink.ScopeCamera)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "This link is for the tripod camera only." });

        if (!SessionsController.TryNormalizeGateCheckStatus(req.Status, out var normalizedStatus))
            return BadRequest(new { message = "Status must be 'at-gate', 'warming-up', 'missing', or null." });

        var heat = await db.Heats
            .Include(h => h.Session)
            .Include(h => h.Entries)
            .FirstOrDefaultAsync(h => h.Id == heatId && h.Session!.CompetitionId == Link.CompetitionId, ct);
        if (heat?.Session is null) return NotFound();

        if (!heat.Entries.Any(e => e.TeamId == req.TeamId))
            return BadRequest(new { message = "Team is not in this heat." });

        heat.Session.Notes = SessionsController.ApplyGateCheckNote(heat.Session.Notes, heatId, req.TeamId, normalizedStatus);
        await db.SaveChangesAsync(ct);

        var session = await db.Sessions.AsNoTracking()
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(s => s.Id == heat.SessionId, ct);
        var dto = session.ToDto();
        await live.SessionUpdated(Link.CompetitionId, dto);
        return dto;
    }

    /// <summary>True only for a race in this link's competition.</summary>
    private Task<bool> InScopeAsync(int raceId, CancellationToken ct)
    {
        var link = Link;
        return db.Races.AsNoTracking().AnyAsync(r => r.Id == raceId
            && r.Heat!.Session!.CompetitionId == link.CompetitionId, ct);
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
        var competitionId = race.Heat!.Session!.CompetitionId;
        await live.ResultsUpdated(competitionId,
            new { sessionId = race.Heat.SessionId, heat = await HeatDtoAsync(race.HeatId) });
        await BroadcastSessionAsync(race.Heat.SessionId, competitionId);
    }

    private async Task BroadcastSessionAsync(int sessionId, int competitionId)
    {
        var session = await db.Sessions.AsNoTracking()
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(s => s.Id == sessionId);
        await live.SessionUpdated(competitionId, session.ToDto());
    }
}
