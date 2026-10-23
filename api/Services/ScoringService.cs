using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services;

public record FinishingPlace(int TeamId, int Place, bool Eliminated);

public sealed class ScoreConflictException(string message) : InvalidOperationException(message);
public sealed class ScoreSignedOffException(string message) : InvalidOperationException(message);
public sealed class ScoreValidationException(string message) : InvalidOperationException(message);

public class ScoringService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly AppDbContext _db;

    public ScoringService(AppDbContext db) => _db = db;

    /// <summary>The largest field that races at once in the session: a heat with more teams than lanes races only the lanes.</summary>
    public async Task<int> GetSessionBaseAsync(int sessionId)
    {
        var heats = await _db.Heats
            .Where(h => h.SessionId == sessionId)
            .Select(h => new { Size = h.Entries.Count, Lanes = h.Session!.LanesPerHeat })
            .ToListAsync();
        return heats.Count == 0 ? 0 : heats.Max(h => LaneRotation.LanesInUse(h.Size, h.Lanes));
    }

    public int PointsForPlace(int place, int sessionBase, bool eliminated)
    {
        if (eliminated) return 0;
        if (place < 1 || place > sessionBase) return 0;
        return sessionBase - place + 1;
    }

    public async Task<IReadOnlyList<Result>> ApplyRaceResultsAsync(
        int raceId,
        IEnumerable<FinishingPlace> finishingPlaces,
        string? recordedByUserId,
        string? reason = null)
    {
        var places = finishingPlaces.ToList();
        await ApplyCoreAsync(raceId, places, recordedByUserId,
            expectedRevision: null, expectedResults: null,
            requestId: $"legacy-{Guid.NewGuid():N}", reason,
            strictValidation: false, CancellationToken.None);
        return await _db.Results.AsNoTracking().Where(r => r.RaceId == raceId)
            .OrderBy(r => r.Eliminated).ThenBy(r => r.Placing).ThenBy(r => r.TeamId).ToListAsync();
    }

    public Task<RaceScoreDto> ApplyVersionedAsync(
        int raceId, UpdateRaceScoreRequest request, string? actorUserId,
        CancellationToken cancellationToken = default, string? actorLabel = null)
    {
        if (request.Places is null)
            throw new ScoreValidationException("Places are required.");
        return ApplyCoreAsync(raceId,
            request.Places.Select(p => new FinishingPlace(p.TeamId, p.Place, p.Eliminated)).ToList(),
            actorUserId, request.ExpectedRevision, null, request.RequestId, request.Reason,
            strictValidation: true, cancellationToken, actorLabel);
    }

    public Task<RaceScoreDto> ApplyLegacyAsync(
        int raceId, IReadOnlyList<FinishingPlaceDto> places,
        IReadOnlyList<FinishingPlaceDto>? expected, string? actorUserId, string? reason = null,
        CancellationToken cancellationToken = default, string? actorLabel = null)
        => ApplyCoreAsync(raceId,
            places.Select(p => new FinishingPlace(p.TeamId, p.Place, p.Eliminated)).ToList(),
            actorUserId, null,
            expected?.Select(p => new FinishingPlace(p.TeamId, p.Place, p.Eliminated)).ToList(),
            $"legacy-{Guid.NewGuid():N}", reason, strictValidation: false, cancellationToken, actorLabel);

    public async Task<RaceScoreDto> GetAsync(int raceId, CancellationToken cancellationToken = default)
    {
        var race = await _db.Races.AsNoTracking().Include(r => r.Results)
            .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken)
            ?? throw new KeyNotFoundException("Race not found.");
        var state = await _db.Set<RaceScoreState>().AsNoTracking()
            .SingleOrDefaultAsync(s => s.RaceId == raceId, cancellationToken);
        return ToDto(raceId, state?.Revision ?? (race.Results.Count > 0 || race.IsComplete ? 1 : 0),
            state?.IsSignedOff ?? false, state?.SignedOffAt, state?.SignedOffByUserId,
            Snapshot(race.Results));
    }

    public async Task<IReadOnlyList<RaceScoreHistoryDto>> HistoryAsync(
        int raceId, CancellationToken cancellationToken = default)
    {
        if (!await _db.Races.AnyAsync(r => r.Id == raceId, cancellationToken))
            throw new KeyNotFoundException("Race not found.");
        var events = await _db.Set<RaceScoreEvent>().AsNoTracking()
            .Where(e => e.RaceId == raceId).OrderBy(e => e.Revision).ToListAsync(cancellationToken);
        return events.Select(e => new RaceScoreHistoryDto(e.Revision, e.Kind,
            Deserialize(e.BeforeJson), Deserialize(e.AfterJson), e.ActorUserId, e.Reason, e.CreatedAt, e.ActorLabel)).ToList();
    }

    public Task<RaceScoreDto> SignOffAsync(
        int raceId, ScoreActionRequest request, string? actorUserId,
        CancellationToken cancellationToken = default)
        => ApplyActionAsync(raceId, request, actorUserId, RaceScoreEventKind.SignedOff, cancellationToken);

    public Task<RaceScoreDto> ReopenAsync(
        int raceId, ScoreActionRequest request, string? actorUserId,
        CancellationToken cancellationToken = default)
        => ApplyActionAsync(raceId, request, actorUserId, RaceScoreEventKind.Reopened, cancellationToken);

    public Task<Race> UpdateRaceClockAsync(
        int raceId, bool start, DateTime at, bool hasClientTimestamp,
        CancellationToken cancellationToken = default)
        => ExecuteTransactionAsync(async () =>
        {
            var race = await _db.Races
                .Include(r => r.Heat).ThenInclude(h => h!.Session)
                .Include(r => r.Results).ThenInclude(result => result.Team)
                .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken)
                ?? throw new KeyNotFoundException("Race not found.");
            if (await _db.Set<RaceScoreState>()
                    .AnyAsync(state => state.RaceId == raceId && state.IsSignedOff, cancellationToken))
                throw new ScoreSignedOffException(
                    "Signed-off results must be reopened before race timing can be edited.");

            if (start)
            {
                // A retried Start can arrive after the Stop that followed it: keep the finish.
                if (hasClientTimestamp && race.FinishedAt is not null && race.FinishedAt >= at)
                    return race;
                if (race.FinishedAt is not null)
                {
                    // This is a newer run. Its start becomes the ordering marker
                    // used to reject a delayed Stop from the previous run.
                    race.StartedAt = at;
                    race.FinishedAt = null;
                }
                else
                {
                    // Duplicate Start taps during the same live run are idempotent.
                    race.StartedAt ??= at;
                }
            }
            else
            {
                // A delayed Stop from an earlier run must not finish a newer restart.
                if (hasClientTimestamp && race.StartedAt is not null && race.StartedAt > at)
                    return race;
                if (race.StartedAt is null || race.StartedAt > at)
                    race.StartedAt = at.AddSeconds(-1);
                race.FinishedAt = at;
            }
            await _db.SaveChangesAsync(cancellationToken);
            return race;
        }, cancellationToken);

    private async Task<RaceScoreDto> ApplyCoreAsync(
        int raceId, IReadOnlyList<FinishingPlace> finishingPlaces, string? actorUserId,
        int? expectedRevision, IReadOnlyList<FinishingPlace>? expectedResults,
        string requestId, string? reason, bool strictValidation,
        CancellationToken cancellationToken, string? actorLabel = null)
    {
        ValidateRequest(finishingPlaces, requestId);
        if (reason?.Trim().Length > 1000)
            throw new ScoreValidationException("Reason must be 1000 characters or fewer.");
        requestId = requestId.Trim();
        return await ExecuteTransactionAsync(async () =>
        {
        var race = await _db.Races
            .Include(r => r.Heat).ThenInclude(h => h!.Entries)
            .Include(r => r.Heat).ThenInclude(h => h!.Races)
            .Include(r => r.Heat).ThenInclude(h => h!.Session)
            .Include(r => r.Results)
            .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken)
            ?? throw new InvalidOperationException("Race not found");
        var heat = race.Heat ?? throw new InvalidOperationException("Race has no heat");
        // With more teams than lanes some teams have no lane this race: they sit it out, whatever was sent for them.
        var sitOut = SitOutTeamIds(race, heat);
        if (sitOut.Count > 0)
            finishingPlaces = finishingPlaces.Select(p => sitOut.Contains(p.TeamId) ? p with { Place = 0, Eliminated = false } : p).ToList();
        if (strictValidation && finishingPlaces.Any(p => !p.Eliminated && p.Place < 1 && !sitOut.Contains(p.TeamId)))
            throw new ScoreValidationException("A non-eliminated team must have a placing of at least 1.");
        var state = await GetOrCreateStateAsync(race, cancellationToken);
        var current = Snapshot(race.Results);
        var entryTeamIds = heat.Entries.Select(e => e.TeamId).ToHashSet();
        if (strictValidation && entryTeamIds.Count == 0)
            throw new ScoreValidationException("This race has no teams to score.");
        if (strictValidation && (finishingPlaces.Count != entryTeamIds.Count
                || !finishingPlaces.Select(p => p.TeamId).ToHashSet().SetEquals(entryTeamIds)))
            throw new ScoreValidationException("Submit one result for every team in the heat.");
        var sessionBase = await GetSessionBaseAsync(heat.SessionId);
        if (sessionBase < 1) sessionBase = heat.Entries.Count;
        // A race final is scored on its own field: last place in a final of 4 takes 2 points, a point more than
        // a team that only qualified and didn't make it through, whatever size the qualifiers were.
        if (heat.RaceRoundStage == RaceRoundStage.Final) sessionBase = heat.Entries.Count + 1;
        var racing = heat.Entries.Count - sitOut.Count;
        if (strictValidation && finishingPlaces.Any(p => !p.Eliminated && p.Place > racing))
            throw new ScoreValidationException($"Placings must be between 1 and {racing}.");
        var accepted = strictValidation
            ? finishingPlaces.ToList()
            : finishingPlaces.Where(p => entryTeamIds.Contains(p.TeamId)).ToList();
        var incomingCore = accepted.Select(p => new CorePlace(p.TeamId, p.Eliminated ? null : p.Place, p.Eliminated))
            .OrderBy(p => p.TeamId).ToList();
        var currentCore = current.Select(p => new CorePlace(p.TeamId, p.Eliminated ? null : p.Place, p.Eliminated))
            .OrderBy(p => p.TeamId).ToList();
        var payloadFingerprint = PayloadFingerprint("results", incomingCore, expectedRevision, reason);

        var replay = await ReplayAsync(raceId, requestId, payloadFingerprint, state, current, cancellationToken);
        if (replay is not null)
            return replay;

        if (incomingCore.SequenceEqual(currentCore))
            return ToDto(raceId, state.Revision, state.IsSignedOff, state.SignedOffAt,
                state.SignedOffByUserId, current, true);
        if (state.IsSignedOff)
            throw new ScoreSignedOffException("Signed-off results must be reopened before they can be edited.");
        if (expectedRevision.HasValue && state.Revision != expectedRevision.Value)
            throw new ScoreConflictException("These results were changed on another device.");
        if (expectedResults is not null)
        {
            var expectedCore = expectedResults.Where(p => entryTeamIds.Contains(p.TeamId))
                .Select(p => new CorePlace(p.TeamId, p.Eliminated ? null : p.Place, p.Eliminated))
                .OrderBy(p => p.TeamId).ToList();
            if (!expectedCore.SequenceEqual(currentCore))
                throw new ScoreConflictException("These results were changed on another device.");
        }
        if (current.Count > 0 && string.IsNullOrWhiteSpace(reason))
            throw new ScoreValidationException("A reason is required when correcting results.");

        var now = DateTime.UtcNow;
        var isQualifier = heat.RaceRoundStage == RaceRoundStage.Qualifier;
        var fresh = accepted.Select(fp => new Result
        {
            RaceId = raceId,
            TeamId = fp.TeamId,
            Placing = fp.Eliminated || sitOut.Contains(fp.TeamId) ? null : fp.Place,
            Eliminated = fp.Eliminated,
            IsSitOut = sitOut.Contains(fp.TeamId),
            Points = sitOut.Contains(fp.TeamId) ? 0
                : isQualifier ? (fp.Eliminated ? 0 : 1) : PointsForPlace(fp.Place, sessionBase, fp.Eliminated),
            RecordedAt = now,
            RecordedByUserId = actorUserId,
        }).ToList();
        var after = Snapshot(fresh);
        _db.Results.RemoveRange(race.Results);
        await _db.Results.AddRangeAsync(fresh, cancellationToken);
        race.IsComplete = true;
        race.StartedAt ??= now;
        race.FinishedAt ??= now;
        state.Revision++;
        state.UpdatedAt = now;
        _db.Add(new RaceScoreEvent
        {
            RaceId = raceId,
            Revision = state.Revision,
            Kind = current.Count == 0 ? RaceScoreEventKind.ResultsRecorded : RaceScoreEventKind.ResultsCorrected,
            BeforeJson = JsonSerializer.Serialize(current, Json),
            AfterJson = JsonSerializer.Serialize(after, Json),
            ActorUserId = actorUserId,
            ActorLabel = actorLabel,
            Reason = string.IsNullOrWhiteSpace(reason) ? "Initial results recorded." : reason.Trim(),
            RequestId = requestId,
            PayloadFingerprint = payloadFingerprint,
            CreatedAt = now,
        });
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(raceId, state.Revision, false, null, null, after);
        }, cancellationToken);
    }

    private async Task<RaceScoreDto> ApplyActionAsync(
        int raceId, ScoreActionRequest request, string? actorUserId,
        RaceScoreEventKind kind, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.RequestId) || request.RequestId.Trim().Length > 100)
            throw new ScoreValidationException("RequestId is required and must be 100 characters or fewer.");
        if (request.Reason?.Trim().Length > 1000)
            throw new ScoreValidationException("Reason must be 1000 characters or fewer.");
        if (kind == RaceScoreEventKind.Reopened && string.IsNullOrWhiteSpace(request.Reason))
            throw new ScoreValidationException("A reason is required when reopening results.");

        return await ExecuteTransactionAsync(async () =>
        {
        var race = await _db.Races
            .Include(r => r.Results)
            .Include(r => r.Heat).ThenInclude(h => h!.Entries)
            .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken)
            ?? throw new KeyNotFoundException("Race not found.");
        var state = await GetOrCreateStateAsync(race, cancellationToken);
        var snapshot = Snapshot(race.Results);
        var fingerprint = PayloadFingerprint(kind.ToString(), snapshot, request.ExpectedRevision, request.Reason);
        var replay = await ReplayAsync(raceId, request.RequestId.Trim(), fingerprint, state, snapshot, cancellationToken);
        if (replay is not null)
        {
            var replayTargetIsSignedOff = kind == RaceScoreEventKind.SignedOff;
            if (state.IsSignedOff != replayTargetIsSignedOff)
                throw new ScoreConflictException("This scoring action has since been superseded.");
            return replay;
        }
        if (state.Revision != request.ExpectedRevision)
            throw new ScoreConflictException("These results were changed on another device.");
        if (kind == RaceScoreEventKind.SignedOff)
        {
            if (state.IsSignedOff) throw new ScoreConflictException("These results are already signed off.");
            var entryTeamIds = race.Heat?.Entries.Select(entry => entry.TeamId).ToHashSet() ?? [];
            var resultTeamIds = race.Results.Select(result => result.TeamId).ToHashSet();
            if (!race.IsComplete || entryTeamIds.Count == 0
                || race.Results.Count != entryTeamIds.Count || !resultTeamIds.SetEquals(entryTeamIds))
                throw new ScoreValidationException("Only recorded race results can be signed off.");
            state.IsSignedOff = true;
            state.SignedOffAt = DateTime.UtcNow;
            state.SignedOffByUserId = actorUserId;
        }
        else
        {
            if (!state.IsSignedOff) throw new ScoreConflictException("These results are not signed off.");
            state.IsSignedOff = false;
            state.SignedOffAt = null;
            state.SignedOffByUserId = null;
        }
        state.Revision++;
        state.UpdatedAt = DateTime.UtcNow;
        _db.Add(new RaceScoreEvent
        {
            RaceId = raceId,
            Revision = state.Revision,
            Kind = kind,
            BeforeJson = JsonSerializer.Serialize(snapshot, Json),
            AfterJson = JsonSerializer.Serialize(snapshot, Json),
            ActorUserId = actorUserId,
            Reason = string.IsNullOrWhiteSpace(request.Reason)
                ? "Results signed off." : request.Reason.Trim(),
            RequestId = request.RequestId.Trim(),
            PayloadFingerprint = fingerprint,
            CreatedAt = state.UpdatedAt,
        });
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(raceId, state.Revision, state.IsSignedOff, state.SignedOffAt,
            state.SignedOffByUserId, snapshot);
        }, cancellationToken);
    }

    private async Task<T> ExecuteTransactionAsync<T>(Func<Task<T>> action, CancellationToken cancellationToken)
    {
        var strategy = _db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            // A provider retry must not reuse mutations tracked by the failed attempt.
            _db.ChangeTracker.Clear();
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var result = await action();
            await transaction.CommitAsync(cancellationToken);
            return result;
        });
    }

    private async Task<RaceScoreState> GetOrCreateStateAsync(Race race, CancellationToken cancellationToken)
    {
        var state = await _db.Set<RaceScoreState>().SingleOrDefaultAsync(s => s.RaceId == race.Id, cancellationToken);
        if (state is not null) return state;
        state = new RaceScoreState
        {
            RaceId = race.Id,
            Revision = race.Results.Count > 0 || race.IsComplete ? 1 : 0,
            UpdatedAt = DateTime.UtcNow,
        };
        _db.Add(state);
        return state;
    }

    private async Task<RaceScoreDto?> ReplayAsync(int raceId, string requestId, string fingerprint,
        RaceScoreState state, IReadOnlyList<ScorePlaceDto> current, CancellationToken cancellationToken)
    {
        var previous = await _db.Set<RaceScoreEvent>().AsNoTracking()
            .SingleOrDefaultAsync(e => e.RaceId == raceId && e.RequestId == requestId, cancellationToken);
        if (previous is null) return null;
        if (previous.PayloadFingerprint != fingerprint)
            throw new ScoreConflictException("RequestId was already used for a different scoring action.");
        return ToDto(raceId, state.Revision, state.IsSignedOff, state.SignedOffAt,
            state.SignedOffByUserId, current, true);
    }

    private static void ValidateRequest(IReadOnlyList<FinishingPlace> places, string requestId)
    {
        if (string.IsNullOrWhiteSpace(requestId) || requestId.Trim().Length > 100)
            throw new ScoreValidationException("RequestId is required and must be 100 characters or fewer.");
        if (places.GroupBy(p => p.TeamId).Any(g => g.Count() > 1))
            throw new ScoreValidationException("Each team can appear only once.");
    }

    /// <summary>The teams with no lane in this race. Empty unless the heat has more teams than the session has lanes.</summary>
    private static HashSet<int> SitOutTeamIds(Race race, Heat heat)
    {
        var teams = heat.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id).ToList();
        var lanes = heat.Session?.LanesPerHeat;
        if (lanes is not > 0 || teams.Count <= lanes) return [];
        var raceIndex = heat.Races.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id).ToList().FindIndex(r => r.Id == race.Id);
        var mode = heat.Session!.LaneRotationMode;
        return teams
            .Select((entry, index) => (entry.TeamId, Drawn: index + 1))
            .Where(t => LaneRotation.SitsOut(t.Drawn, Math.Max(raceIndex, 0), teams.Count, lanes, mode))
            .Select(t => t.TeamId)
            .ToHashSet();
    }

    private static List<ScorePlaceDto> Snapshot(IEnumerable<Result> results) => results
        .Select(r => new ScorePlaceDto(r.TeamId, r.Placing ?? 0, r.Eliminated, r.Points, r.IsSitOut))
        .OrderBy(r => r.Eliminated).ThenBy(r => r.Place).ThenBy(r => r.TeamId).ToList();

    private static IReadOnlyList<ScorePlaceDto> Deserialize(string json)
        => JsonSerializer.Deserialize<List<ScorePlaceDto>>(json, Json) ?? [];

    private static string PayloadFingerprint(string action, object payload, int? expectedRevision, string? reason)
    {
        var value = JsonSerializer.Serialize(new { action, payload, expectedRevision, reason = reason?.Trim() }, Json);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    }

    private static RaceScoreDto ToDto(int raceId, int revision, bool signedOff,
        DateTime? signedOffAt, string? signedOffBy, IReadOnlyList<ScorePlaceDto> results,
        bool replay = false)
        => new(raceId, revision, signedOff, signedOffAt, signedOffBy, results, replay);

    private sealed record CorePlace(int TeamId, int? Place, bool Eliminated);
}
