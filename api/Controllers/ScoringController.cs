using MountedGames.Api.Security;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;
using Npgsql;

namespace MountedGames.Api.Controllers;

[ApiController]
// The competition's owner, its team and admins run scoring; [CompetitionAccess] on each action picks the competition.
[Authorize(Policy = CompetitionStaff.Policy)]
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

    [EnableRateLimiting(RequestLimits.ScorePolicy)]
    [HttpPost("api/races/{raceId:int}/results")]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<HeatDto>> SubmitRaceResults(
        int raceId, SubmitRaceResultsRequest req, CancellationToken cancellationToken)
    {
        var race = await _db.Races
            .Include(r => r.Heat).ThenInclude(h => h!.Session)
            .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken);
        if (race is null) return NotFound();
        var correctionReason = req.Reason ?? Request.Headers["X-Score-Reason"].FirstOrDefault();
        if (correctionReason?.Length > 1000)
            return BadRequest(new { message = "Correction reason must be 1000 characters or fewer." });
        try
        {
            await _scoring.ApplyLegacyAsync(raceId, req.Places, req.Expected,
                User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
                correctionReason, cancellationToken);
        }
        catch (ScoreConflictException ex) { return await ScoreConflict(race, ex.Message, ex.ExistingPlaces, ex.IncomingPlaces); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) when (IsScoringConcurrency(ex))
        { return await ScoreConflict(race, "These results were changed on another device."); }

        var dto = await HeatDtoAsync(race.HeatId);
        var competitionId = race.Heat!.Session!.CompetitionId;
        await _live.ResultsUpdated(competitionId, new { sessionId = race.Heat.SessionId, heat = dto, clashResolved = raceId });
        await BroadcastRaceFinalAsync(raceId, competitionId);
        return dto;
    }

    /// <summary>
    /// ScoringService has already populated the final atomically with the score; broadcast its committed state.
    /// This read must never repeat the population or its push on an idempotent retry.
    /// </summary>
    private async Task BroadcastRaceFinalAsync(int raceId, int competitionId)
    {
        var sessionId = await _db.Races.Where(r => r.Id == raceId && r.Heat!.RaceRoundStage == RaceRoundStage.Qualifier
                && r.Heat.RaceRoundId != null)
            .Select(r => (int?)r.Heat!.SessionId).SingleOrDefaultAsync();
        if (sessionId is null) return;
        var session = await _db.Sessions.AsNoTracking()
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(s => s.Id == sessionId.Value);
        await _live.SessionUpdated(competitionId, session.ToDto());
    }

    [HttpGet("api/races/{raceId:int}/score")]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<RaceScoreDto>> GetRaceScore(int raceId, CancellationToken cancellationToken)
    {
        try { return await _scoring.GetAsync(raceId, cancellationToken); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    [HttpPut("api/races/{raceId:int}/score")]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<RaceScoreDto>> UpdateRaceScore(
        int raceId, UpdateRaceScoreRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var score = await _scoring.ApplyVersionedAsync(raceId, request,
                User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, cancellationToken);
            var competitionId = await CompetitionIdOfRaceAsync(raceId);
            await BroadcastScore(raceId);
            await BroadcastRaceFinalAsync(raceId, competitionId);
            return score;
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) when (ex.Message == "Race not found") { return NotFound(); }
        catch (ScoreConflictException ex) { return Conflict(new { message = ex.Message }); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) when (IsScoringConcurrency(ex))
        { return Conflict(new { message = "These results were changed on another device." }); }
    }

    [HttpGet("api/races/{raceId:int}/score/history")]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<IReadOnlyList<RaceScoreHistoryDto>>> ScoreHistory(
        int raceId, CancellationToken cancellationToken)
    {
        try { return Ok(await _scoring.HistoryAsync(raceId, cancellationToken)); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    [HttpPost("api/races/{raceId:int}/score/sign-off")]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public Task<ActionResult<RaceScoreDto>> SignOff(
        int raceId, ScoreActionRequest request, CancellationToken cancellationToken)
        => ScoreAction(raceId, request, true, cancellationToken);

    [HttpPost("api/races/{raceId:int}/score/reopen")]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public Task<ActionResult<RaceScoreDto>> Reopen(
        int raceId, ScoreActionRequest request, CancellationToken cancellationToken)
        => ScoreAction(raceId, request, false, cancellationToken);

    private async Task<ActionResult<RaceScoreDto>> ScoreAction(
        int raceId, ScoreActionRequest request, bool signOff, CancellationToken cancellationToken)
    {
        try
        {
            var actor = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            var score = signOff
                ? await _scoring.SignOffAsync(raceId, request, actor, cancellationToken)
                : await _scoring.ReopenAsync(raceId, request, actor, cancellationToken);
            await BroadcastScore(raceId);
            return score;
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreConflictException ex) { return Conflict(new { message = ex.Message }); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) when (IsScoringConcurrency(ex))
        { return Conflict(new { message = "These results were changed on another device." }); }
    }

    [HttpGet("api/sessions/{sessionId:int}/clashes")]
    [CompetitionAccess("sessionId", CompetitionResource.Session)]
    public ActionResult<IReadOnlyList<ScoreClashDto>> GetSessionClashes(int sessionId)
        => Ok(ScoringService.GetSessionClashes(sessionId));

    [HttpPost("api/races/{raceId:int}/clash/resolve")]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<HeatDto>> ResolveScoreClash(
        int raceId, ResolveScoreClashRequest req, CancellationToken cancellationToken)
    {
        var race = await _db.Races
            .Include(r => r.Heat).ThenInclude(h => h!.Session)
            .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken);
        if (race is null) return NotFound();

        if (req.UseIncoming)
        {
            var clash = ScoringService.GetRaceClash(raceId);
            var places = req.Places
                ?? clash?.IncomingPlaces.Select(p => new FinishingPlaceDto(p.TeamId, p.Place, p.Eliminated, p.Status, p.RefereeNote, p.Points)).ToList();
            if (places is null || places.Count == 0)
                return BadRequest(new { message = "Places are required to apply the submitted result." });
            try
            {
                await _scoring.ApplyLegacyAsync(raceId, places, expected: null,
                    User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
                    "Score clash resolved", cancellationToken);
            }
            catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
            catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        }
        else
        {
            ScoringService.DismissClash(raceId);
        }

        var dto = await HeatDtoAsync(race.HeatId);
        var competitionId = race.Heat!.Session!.CompetitionId;
        await _live.ResultsUpdated(competitionId, new { sessionId = race.Heat.SessionId, heat = dto, clashResolved = raceId });
        if (req.UseIncoming)
            await BroadcastRaceFinalAsync(raceId, competitionId);
        return dto;
    }

    [HttpDelete("api/races/{raceId:int}/score")]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<HeatDto>> ClearRaceScore(
        int raceId, [FromQuery] string? reason = null, CancellationToken cancellationToken = default)
    {
        var race = await _db.Races
            .Include(r => r.Heat).ThenInclude(h => h!.Session)
            .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken);
        if (race is null) return NotFound();
        try
        {
            var actor = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            await _scoring.ClearRaceForRerunAsync(raceId, actor, reason ?? "Score cleared.", cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (IsScoringConcurrency(ex))
        { return Conflict(new { message = "These results were changed on another device." }); }

        var dto = await HeatDtoAsync(race.HeatId);
        var competitionId = race.Heat!.Session!.CompetitionId;
        await _live.ResultsUpdated(competitionId, new { sessionId = race.Heat.SessionId, heat = dto, clashResolved = raceId });
        return dto;
    }

    private async Task<HeatDto> HeatDtoAsync(int heatId)
    {
        var heat = await _db.Heats
            .Include(h => h.Entries).ThenInclude(e => e.Team).ThenInclude(t => t!.Results)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(h => h.Id == heatId);
        return heat.ToDto();
    }

    private async Task<ActionResult<HeatDto>> ScoreConflict(
        Race race, string message,
        IReadOnlyList<ScorePlaceDto>? existingPlaces = null,
        IReadOnlyList<ScorePlaceDto>? incomingPlaces = null)
    {
        // The failed transaction can leave losing results tracked. Always build
        // the conflict snapshot from the committed database winner.
        _db.ChangeTracker.Clear();
        var heat = await HeatDtoAsync(race.HeatId);
        ScoreClashDto? clash = null;
        if (incomingPlaces is { Count: > 0 })
        {
            var existing = existingPlaces ?? heat.Races.FirstOrDefault(r => r.Id == race.Id)?.Results
                .Select(r => new ScorePlaceDto(r.TeamId, r.Placing ?? 0, r.Eliminated, r.Points, r.IsSitOut, r.Status, null))
                .ToList() ?? [];
            clash = new ScoreClashDto(
                race.Id, race.HeatId, race.Heat!.SessionId, race.Name, race.OrderIndex,
                existing, incomingPlaces, DateTime.UtcNow);
            await _live.ResultsUpdated(race.Heat.Session!.CompetitionId, new
            {
                sessionId = race.Heat.SessionId,
                heat,
                // ResultsUpdated is public: referee notes stay in the authorised HTTP response.
                clash = clash with
                {
                    ExistingPlaces = clash.ExistingPlaces.Select(p => p with { RefereeNote = null }).ToList(),
                    IncomingPlaces = clash.IncomingPlaces.Select(p => p with { RefereeNote = null }).ToList(),
                },
            });
        }
        return Conflict(new
        {
            message,
            sessionId = race.Heat!.SessionId,
            heat,
            clash,
        });
    }

    private Task<int> CompetitionIdOfRaceAsync(int raceId)
        => _db.Races.Where(r => r.Id == raceId).Select(r => r.Heat!.Session!.CompetitionId).FirstAsync();

    private async Task BroadcastScore(int raceId)
    {
        var race = await _db.Races.Include(r => r.Heat).ThenInclude(h => h!.Session)
            .FirstAsync(r => r.Id == raceId);
        var heat = await HeatDtoAsync(race.HeatId);
        await _live.ResultsUpdated(race.Heat!.Session!.CompetitionId,
            new { sessionId = race.Heat.SessionId, heat });
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
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<RaceDto>> StartRace(int raceId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] RaceClockRequest? req = null,
        CancellationToken cancellationToken = default)
    {
        var tappedAt = ClockTime(req?.At, DateTime.UtcNow);
        Race race;
        try
        {
            race = await _scoring.UpdateRaceClockAsync(
                raceId, true, tappedAt, req?.At is not null, cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (IsScoringConcurrency(ex))
        { return Conflict(new { message = "These results were changed on another device." }); }
        var dto = race.ToDto();
        var competitionId = race.Heat!.Session!.CompetitionId;
        var heatDto = await HeatDtoAsync(race.HeatId);
        await _live.ResultsUpdated(competitionId,
            new { sessionId = race.Heat.SessionId, raceId, started = race.StartedAt, heat = heatDto });
        return dto;
    }

    [HttpPost("api/heats/{heatId:int}/call-missing-team")]
    [CompetitionAccess("heatId", CompetitionResource.Heat)]
    public async Task<ActionResult<ChatMessageDto>> CallMissingTeam(
        int heatId, CallMissingTeamRequest req, CancellationToken cancellationToken = default)
    {
        ChatMessage msg;
        try
        {
            msg = await _scoring.CreateMissingTeamCallAsync(heatId, null, req.TeamId, null,
                User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
                User.FindFirst("fullName")?.Value ?? "Organiser", cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (ScoreConflictException ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (IsScoringConcurrency(ex))
        { return Conflict(new { message = "This heat changed on another device. Please try again." }); }

        var dto = msg.ToDto();
        await _live.Announcement(msg.CompetitionId, dto);
        await _live.ChatMessage(msg.CompetitionId, dto);
        return dto;
    }

    /// <summary>Admin stops the live clock — sets `FinishedAt` to the tap time.</summary>
    [HttpPost("api/races/{raceId:int}/stop")]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<RaceDto>> StopRace(int raceId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] RaceClockRequest? req = null,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var finishedAt = ClockTime(req?.At, now);
        Race race;
        try
        {
            race = await _scoring.UpdateRaceClockAsync(
                raceId, false, finishedAt, req?.At is not null, cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (IsScoringConcurrency(ex))
        { return Conflict(new { message = "These results were changed on another device." }); }
        var dto = race.ToDto();
        await _live.ResultsUpdated(race.Heat!.Session!.CompetitionId,
            new { sessionId = race.Heat.SessionId, raceId, finished = race.FinishedAt });
        return dto;
    }

    [HttpPut("api/heats/{heatId:int}/duration")]
    [CompetitionAccess("heatId", CompetitionResource.Heat)]
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

    internal static bool IsScoringConcurrency(Exception exception)
    {
        if (exception is DbUpdateConcurrencyException) return true;
        if (exception is PostgresException postgres)
            return postgres.SqlState is "40001" or "40P01"
                || postgres.SqlState == "23505"
                && (postgres.ConstraintName?.Contains("RaceScoreState", StringComparison.OrdinalIgnoreCase) == true
                    || postgres.ConstraintName?.Contains("RaceScoreEvent", StringComparison.OrdinalIgnoreCase) == true);
        if (exception is SqliteException sqlite)
            return sqlite.SqliteErrorCode is 5 or 6
                || sqlite.SqliteExtendedErrorCode == 2067
                && (sqlite.Message.Contains("RaceScoreState", StringComparison.OrdinalIgnoreCase)
                    || sqlite.Message.Contains("RaceScoreEvent", StringComparison.OrdinalIgnoreCase));
        return exception.InnerException is not null && IsScoringConcurrency(exception.InnerException);
    }
}

public record ResolveScoreClashRequest(bool UseIncoming, IReadOnlyList<FinishingPlaceDto>? Places = null);
