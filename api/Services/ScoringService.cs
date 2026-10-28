using System.Collections.Concurrent;
using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Hubs;

namespace MountedGames.Api.Services;

/// <param name="Status">Why the team did not finish; null means Eliminated when <paramref name="Eliminated"/> is set.</param>
/// <param name="Note">The referee's private note. Null keeps the note the result already has; empty clears it.</param>
/// <param name="Points">Optional points for a finisher, whole or half (a dead heat, say). Null means the place decides.</param>
public record FinishingPlace(int TeamId, int Place, bool Eliminated, ResultStatus? Status = null, string? Note = null, double? Points = null);

public enum CombinedHeatScoringMode
{
    BySection = 0,
    Combined = 1,
}

public record ScoreClashDto(
    int RaceId,
    int HeatId,
    int SessionId,
    string RaceName,
    int RaceOrder,
    IReadOnlyList<ScorePlaceDto> ExistingPlaces,
    IReadOnlyList<ScorePlaceDto> IncomingPlaces,
    DateTime DetectedAt);

public sealed class ScoreConflictException(
    string message,
    IReadOnlyList<ScorePlaceDto>? existingPlaces = null,
    IReadOnlyList<ScorePlaceDto>? incomingPlaces = null) : InvalidOperationException(message)
{
    public IReadOnlyList<ScorePlaceDto>? ExistingPlaces { get; } = existingPlaces;
    public IReadOnlyList<ScorePlaceDto>? IncomingPlaces { get; } = incomingPlaces;
}
public sealed class ScoreSignedOffException(string message) : InvalidOperationException(message);
public sealed class ScoreValidationException(string message) : InvalidOperationException(message);

public class ScoringService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly ConcurrentDictionary<int, ScoreClashDto> ActiveClashes = new();
    private readonly AppDbContext _db;
    private readonly PushNotifier? _push;
    private readonly ILogger<ScoringService>? _log;
    private readonly ILiveBroadcaster? _live;
    private readonly List<(int CompetitionId, int MessageId)> _clearedCalls = [];

    public static IReadOnlyList<ScoreClashDto> GetSessionClashes(int sessionId)
        => ActiveClashes.Values.Where(c => c.SessionId == sessionId).OrderBy(c => c.RaceOrder).ThenBy(c => c.RaceId).ToList();

    public static ScoreClashDto? GetRaceClash(int raceId)
        => ActiveClashes.GetValueOrDefault(raceId);

    public static void DismissClash(int raceId)
        => ActiveClashes.TryRemove(raceId, out _);

    public ScoringService(AppDbContext db, PushNotifier? push = null, ILogger<ScoringService>? log = null, ILiveBroadcaster? live = null)
    {
        _db = db;
        _push = push;
        _log = log;
        _live = live;
    }

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

    /// <summary>
    /// Splits the combined points of the places occupied by a dead heat (rounded to the nearest 0.5).
    /// For example, two teams tied for 1st in a 5-team heat split 1st (5) and 2nd (4) for 4.5 points each.
    /// </summary>
    public double DeadHeatPointsForPlace(int place, int tiedCount, int sessionBase, bool eliminated)
    {
        if (eliminated || place < 1 || tiedCount <= 1) return PointsForPlace(place, sessionBase, eliminated);
        var total = 0.0;
        for (var i = 0; i < tiedCount; i++)
            total += PointsForPlace(place + i, sessionBase, false);
        return Math.Round((total / tiedCount) * 2, MidpointRounding.AwayFromZero) / 2.0;
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
            request.Places.Select(p => new FinishingPlace(p.TeamId, p.Place, p.Eliminated, p.Status, p.RefereeNote, p.Points)).ToList(),
            actorUserId, request.ExpectedRevision, null, request.RequestId, request.Reason,
            strictValidation: true, cancellationToken, actorLabel);
    }

    public Task<RaceScoreDto> ApplyLegacyAsync(
        int raceId, IReadOnlyList<FinishingPlaceDto> places,
        IReadOnlyList<FinishingPlaceDto>? expected, string? actorUserId, string? reason = null,
        CancellationToken cancellationToken = default, string? actorLabel = null)
        => ApplyCoreAsync(raceId,
            places.Select(p => new FinishingPlace(p.TeamId, p.Place, p.Eliminated, p.Status, p.RefereeNote, p.Points)).ToList(),
            actorUserId, null,
            expected?.Select(p => new FinishingPlace(p.TeamId, p.Place, p.Eliminated, p.Status)).ToList(),
            $"legacy-{Guid.NewGuid():N}", reason, strictValidation: false, cancellationToken, actorLabel);

    public Task<RaceScoreDto> OverrideRacePointsAsync(
        int raceId, int teamId, double points, string reason,
        string? actorUserId = null, CancellationToken cancellationToken = default)
        => ApplyPointChangeAsync(raceId, teamId, points, isDelta: false, reason, actorUserId, cancellationToken);

    public Task<RaceScoreDto> AdjustTeamPointsAsync(
        int raceId, int teamId, double pointsDelta, string reason,
        string? actorUserId = null, CancellationToken cancellationToken = default)
        => ApplyPointChangeAsync(raceId, teamId, pointsDelta, isDelta: true, reason, actorUserId, cancellationToken);

    public static bool IsUnderReview(string? note)
        => !string.IsNullOrWhiteSpace(note) && note.Contains("[under-review]", StringComparison.OrdinalIgnoreCase);

    public static CombinedHeatScoringMode ResolveCombinedScoringMode(
        string? sessionNotes, string? heatLabel = null, bool hasMultipleSections = false)
    {
        var text = $"{sessionNotes} {heatLabel}";
        if (text.Contains("[scoring:combined]", StringComparison.OrdinalIgnoreCase))
            return CombinedHeatScoringMode.Combined;
        if (text.Contains("[scoring:by-section]", StringComparison.OrdinalIgnoreCase))
            return CombinedHeatScoringMode.BySection;
        return hasMultipleSections ? CombinedHeatScoringMode.BySection : CombinedHeatScoringMode.Combined;
    }

    public static string ApplyScoringModeTag(string? notes, CombinedHeatScoringMode mode)
    {
        var cleaned = Regex.Replace(notes ?? string.Empty, @"\[scoring:(?:by-section|combined)\]\s*", string.Empty, RegexOptions.IgnoreCase).Trim();
        var tag = mode == CombinedHeatScoringMode.BySection ? "[scoring:by-section]" : "[scoring:combined]";
        return string.IsNullOrEmpty(cleaned) ? tag : $"{tag} {cleaned}";
    }

    public async Task<RaceScoreDto> SetUnderReviewAsync(
        int raceId, int teamId, bool underReview, string? note = null,
        string? actorUserId = null, CancellationToken cancellationToken = default)
    {
        var race = await _db.Races.AsNoTracking()
            .Include(r => r.Results)
            .Include(r => r.Heat).ThenInclude(h => h!.Entries)
            .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken)
            ?? throw new KeyNotFoundException("Race not found.");
        var entries = race.Heat?.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id).ToList() ?? [];
        var existingByTeam = race.Results.ToDictionary(r => r.TeamId);
        var places = entries.Select((e, idx) =>
        {
            existingByTeam.TryGetValue(e.TeamId, out var r);
            var curNote = r?.RefereeNote ?? string.Empty;
            if (e.TeamId == teamId)
            {
                var stripped = Regex.Replace(curNote, @"\[under-review\]\s*", string.Empty, RegexOptions.IgnoreCase).Trim();
                // A new note replaces the old text but keeps its points directive, or the points would silently change.
                var directive = Regex.Match(stripped, @"\[(?:pts|adj):[^\]]*\]", RegexOptions.IgnoreCase);
                var custom = string.IsNullOrWhiteSpace(note) ? stripped
                    : directive.Success ? $"{directive.Value} {note.Trim()}" : note.Trim();
                curNote = underReview
                    ? (string.IsNullOrEmpty(custom) ? "[under-review]" : $"[under-review] {custom}")
                    : custom;
            }
            return new FinishingPlace(
                e.TeamId,
                r is not null ? (r.Placing ?? 0) : idx + 1,
                r?.Eliminated ?? false,
                r is not null ? ResultStatuses.Of(r) : ResultStatus.Finished,
                string.IsNullOrWhiteSpace(curNote) ? string.Empty : curNote,
                r?.Points);
        }).ToList();
        var reasonText = underReview
            ? (string.IsNullOrWhiteSpace(note) ? "Flagged result under review." : $"Under review: {note.Trim()}")
            : "Cleared under-review flag.";
        return await ApplyCoreAsync(raceId, places, actorUserId, null, null,
            $"review-{Guid.NewGuid():N}", reasonText, strictValidation: false, cancellationToken);
    }

    public Task<RaceScoreDto> ClearRaceForRerunAsync(
        int raceId, string? actorUserId = null, string? reason = null,
        CancellationToken cancellationToken = default)
        => ExecuteTransactionAsync(async () =>
        {
            var race = await _db.Races
                .Include(r => r.Results)
                .Include(r => r.Heat).ThenInclude(h => h!.Session)
                .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken)
                ?? throw new KeyNotFoundException("Race not found.");
            var state = await GetOrCreateStateAsync(race, cancellationToken);
            if (state.IsSignedOff)
                throw new ScoreSignedOffException("Signed-off results must be reopened before they can be cleared.");
            var current = Snapshot(race.Results);
            var now = DateTime.UtcNow;
            _db.Results.RemoveRange(race.Results);
            race.IsComplete = false;
            race.StartedAt = null;
            race.FinishedAt = null;
            if (race.Heat is { } heat)
            {
                heat.FinishedAt = null;
                if (heat.Session is { Status: SessionStatus.Finished } session)
                {
                    session.Status = SessionStatus.InArena;
                    session.FinishedAt = null;
                    session.ProvisionalUntil = null;
                    session.OfficialConfirmedAt = null;
                }
            }
            state.Revision++;
            state.UpdatedAt = now;
            var reasonText = string.IsNullOrWhiteSpace(reason) ? "Cleared for re-run." : reason.Trim();
            _db.Add(new RaceScoreEvent
            {
                RaceId = raceId,
                Revision = state.Revision,
                Kind = RaceScoreEventKind.ResultsCorrected,
                BeforeJson = JsonSerializer.Serialize(current, Json),
                AfterJson = JsonSerializer.Serialize(Array.Empty<ScorePlaceDto>(), Json),
                ActorUserId = actorUserId,
                Reason = reasonText,
                RequestId = $"rerun-{Guid.NewGuid():N}",
                PayloadFingerprint = PayloadFingerprint("rerun", Array.Empty<ScorePlaceDto>(), null, reasonText),
                CreatedAt = now,
            });
            await _db.SaveChangesAsync(cancellationToken);
            ActiveClashes.TryRemove(raceId, out _);
            if (race.Heat?.Session is { } clearedSession)
                StandingsService.Invalidate(clearedSession.CompetitionId);
            return ToDto(raceId, state.Revision, false, null, null, Array.Empty<ScorePlaceDto>());
        }, cancellationToken);

    private async Task<RaceScoreDto> ApplyPointChangeAsync(
        int raceId, int teamId, double value, bool isDelta, string reason,
        string? actorUserId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(reason))
            throw new ScoreValidationException("A reason is required when adjusting or overriding points.");
        var race = await _db.Races.AsNoTracking()
            .Include(r => r.Results)
            .Include(r => r.Heat).ThenInclude(h => h!.Entries)
            .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken)
            ?? throw new KeyNotFoundException("Race not found.");
        var entries = race.Heat?.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id).ToList() ?? [];
        var existingByTeam = race.Results.ToDictionary(r => r.TeamId);
        PointValues.Validate(Math.Abs(value));
        var directive = isDelta ? $"[adj:{(value < 0 ? "-" : "+")}{PointValues.Format(Math.Abs(value))}]" : $"[pts:{PointValues.Format(value)}]";
        var note = $"{directive} {reason.Trim()}";
        // Only this team's note changes: the directive in it decides its points, so a later re-save of the heat keeps them.
        // Everyone else keeps the points they have (a dead heat's half points included).
        var places = entries.Select((e, idx) => existingByTeam.TryGetValue(e.TeamId, out var r)
            ? e.TeamId == teamId
                ? new FinishingPlace(e.TeamId, r.Placing ?? 0, r.Eliminated, ResultStatuses.Of(r), note)
                : new FinishingPlace(e.TeamId, r.Placing ?? 0, r.Eliminated, ResultStatuses.Of(r), r.RefereeNote, r.Points)
            : new FinishingPlace(e.TeamId, idx + 1, false, ResultStatus.Finished, e.TeamId == teamId ? note : null)).ToList();
        return await ApplyCoreAsync(raceId, places, actorUserId, null, null,
            $"adj-{Guid.NewGuid():N}", reason, strictValidation: false, cancellationToken);
    }

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

    // A real row update makes call creation and scoring contend on the same heat in
    // PostgreSQL and SQLite, including requests handled by different API instances.
    private Task<int> LockHeatForRaceAsync(int raceId, CancellationToken cancellationToken)
        => _db.Heats.Where(h => h.Races.Any(r => r.Id == raceId))
            .ExecuteUpdateAsync(setters => setters.SetProperty(h => h.StartedAt, h => h.StartedAt), cancellationToken);

    public Task<ChatMessage> CreateMissingTeamCallAsync(int heatId, int? competitionId, int? teamId,
        string? body, string? userId, string authorName, CancellationToken cancellationToken = default)
        => ExecuteTransactionAsync(async () =>
        {
            var exists = await _db.Heats.Where(h => h.Id == heatId
                    && (competitionId == null || h.Session!.CompetitionId == competitionId))
                .ExecuteUpdateAsync(setters => setters.SetProperty(h => h.StartedAt, h => h.StartedAt), cancellationToken);
            if (exists == 0) throw new KeyNotFoundException("Heat not found.");
            var heat = await _db.Heats.Include(h => h.Session)
                .Include(h => h.Entries).ThenInclude(e => e.Team).Include(h => h.Races)
                .SingleAsync(h => h.Id == heatId, cancellationToken);
            if (heat.StartedAt.HasValue || heat.FinishedAt.HasValue
                || heat.Races.Any(r => r.StartedAt.HasValue || r.FinishedAt.HasValue || r.IsComplete))
                throw new ScoreConflictException("This heat has already started.");
            if (teamId is not null)
            {
                var entry = heat.Entries.SingleOrDefault(e => e.TeamId == teamId)
                    ?? throw new ScoreValidationException("Team is not in this heat.");
                var arena = string.IsNullOrWhiteSpace(heat.Session!.ArenaName) ? "Main Arena" : heat.Session.ArenaName.Trim();
                var label = string.IsNullOrWhiteSpace(heat.Label) ? $"Heat {heat.OrderIndex}" : heat.Label;
                body = $"🔔 Ring call ({arena}): {entry.Team?.DisplayName ?? "Unnamed team"} (Lane {entry.LaneIndex}) needed at the collecting ring now for {label}.";
            }
            var msg = new ChatMessage
            {
                CompetitionId = heat.Session!.CompetitionId, UserId = userId,
                AuthorName = authorName.Length > 60 ? authorName[..60] : authorName,
                Body = body!.Trim(), Type = ChatMessageType.Announcement, Tag = $"missing-team:{heatId}",
            };
            _db.ChatMessages.Add(msg);
            await _db.SaveChangesAsync(cancellationToken);
            return msg;
        }, cancellationToken);

    public Task<T> WithChatLockAsync<T>(int competitionId, Func<Task<T>> action,
        CancellationToken cancellationToken = default)
        => ExecuteTransactionAsync(async () =>
        {
            await _db.Competitions.Where(c => c.Id == competitionId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(c => c.Name, c => c.Name), cancellationToken);
            return await action();
        }, cancellationToken);

    private async Task ClearMissingTeamCallsAsync(Heat heat, CancellationToken cancellationToken)
    {
        var tag = $"missing-team:{heat.Id}";
        var calls = await _db.ChatMessages.Where(m => m.CompetitionId == heat.Session!.CompetitionId
                && m.Tag == tag && m.Type == ChatMessageType.Announcement
                && !m.AdminOnly && m.RecipientUserId == null)
            .ToListAsync(cancellationToken);
        _db.ChatMessages.RemoveRange(calls);
        _clearedCalls.AddRange(calls.Select(m => (m.CompetitionId, m.Id)));
    }

    public Task<Race> UpdateRaceClockAsync(
        int raceId, bool start, DateTime at, bool hasClientTimestamp,
        CancellationToken cancellationToken = default)
        => ExecuteTransactionAsync(async () =>
        {
            await LockHeatForRaceAsync(raceId, cancellationToken);
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

                if (race.Heat is { } heat)
                {
                    heat.StartedAt ??= at;
                    if (heat.Session is { } session)
                    {
                        session.StartedAt ??= at;
                        if (session.Status == SessionStatus.Upcoming)
                            session.Status = SessionStatus.InArena;
                    }
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
            await ClearMissingTeamCallsAsync(race.Heat!, cancellationToken);
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
        finishingPlaces = Normalise(finishingPlaces);
        if (reason?.Trim().Length > 1000)
            throw new ScoreValidationException("Reason must be 1000 characters or fewer.");
        requestId = requestId.Trim();
        int? populatedFinalHeatId = null;
        var dto = await ExecuteTransactionAsync(async () =>
        {
        // Reset on every execution-strategy attempt, including an idempotent replay after an ambiguous commit.
        populatedFinalHeatId = null;
        await LockHeatForRaceAsync(raceId, cancellationToken);
        var race = await _db.Races
            .Include(r => r.Heat).ThenInclude(h => h!.Entries).ThenInclude(e => e.Team)
            .Include(r => r.Heat).ThenInclude(h => h!.Races)
            .Include(r => r.Heat).ThenInclude(h => h!.Session)
            .Include(r => r.Results)
            .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken)
            ?? throw new InvalidOperationException("Race not found");
        var heat = race.Heat ?? throw new InvalidOperationException("Race has no heat");
        // With more teams than lanes some teams have no lane this race: they sit it out, whatever was sent for them.
        var sitOut = SitOutTeamIds(race, heat);
        if (sitOut.Count > 0)
            finishingPlaces = finishingPlaces.Select(p => sitOut.Contains(p.TeamId) ? p with { Place = 0, Eliminated = false, Status = ResultStatus.Finished } : p).ToList();
        if (strictValidation && finishingPlaces.Any(p => !p.Eliminated && p.Place < 1 && !sitOut.Contains(p.TeamId)))
            throw new ScoreValidationException("A non-eliminated team must have a placing of at least 1.");
        var state = await GetOrCreateStateAsync(race, cancellationToken);
        var current = Snapshot(race.Results);
        // A note left out (null) keeps the one the result already has; an empty one clears it.
        var currentNotes = race.Results.Where(r => r.RefereeNote != null).ToDictionary(r => r.TeamId, r => r.RefereeNote);
        finishingPlaces = finishingPlaces
            .Select(p => p.Note is null && currentNotes.TryGetValue(p.TeamId, out var kept) ? p with { Note = kept } : p)
            .ToList();
        var entryTeamIds = heat.Entries.Select(e => e.TeamId).ToHashSet();
        if (strictValidation && entryTeamIds.Count == 0)
            throw new ScoreValidationException("This race has no teams to score.");
        if (strictValidation && (finishingPlaces.Count != entryTeamIds.Count
                || !finishingPlaces.Select(p => p.TeamId).ToHashSet().SetEquals(entryTeamIds)))
            throw new ScoreValidationException("Submit one result for every team in the heat.");
        var sessionBase = await GetSessionBaseAsync(heat.SessionId);
        if (sessionBase < 1) sessionBase = heat.Entries.Count;
        // A lettered Final heat ("A Final", "B Final", etc.) is scored on its own preserved field size,
        // not the largest heat in the finals session.
        if (FinalsTiers.ParseLabel(heat.Label) is not null)
        {
            var ownBase = LaneRotation.LanesInUse(heat.Entries.Count, heat.Session?.LanesPerHeat);
            if (ownBase > 0) sessionBase = ownBase;
        }
        // A race final is scored on its own field: last place in a final of 4 takes 2 points, a point more than
        // a team that only qualified and didn't make it through, whatever size the qualifiers were.
        if (heat.RaceRoundStage == RaceRoundStage.Final) sessionBase = heat.Entries.Count + 1;
        var racing = heat.Entries.Count - sitOut.Count;
        if (strictValidation && finishingPlaces.Any(p => !p.Eliminated && p.Place > racing))
            throw new ScoreValidationException($"Placings must be between 1 and {racing}.");
        var accepted = strictValidation
            ? finishingPlaces.ToList()
            : finishingPlaces.Where(p => entryTeamIds.Contains(p.TeamId)).ToList();
        var hcTeamIds = heat.Entries
            .Where(e => e.Team?.IsHorsConcours == true)
            .Select(e => e.TeamId)
            .ToHashSet();
        var teamSectionById = heat.Entries
            .Where(e => e.Team is not null)
            .ToDictionary(e => e.TeamId, e => e.Team!.CompetitionSectionId);
        var hasMultipleSections = teamSectionById.Values.Distinct().Count() > 1;
        var combinedScoringMode = ResolveCombinedScoringMode(heat.Session?.Notes, heat.Label, hasMultipleSections);
        var isQualifier = heat.RaceRoundStage == RaceRoundStage.Qualifier;
        // A section can count its final's race points double (standard format only). The multiplier applies to the
        // points a place earns, here and nowhere else, so every total, standing and export reads the doubled figure.
        var doubledSectionIds = new HashSet<int>();
        if (SectionScoring.IsFinalHeat(heat))
        {
            var sectionIds = teamSectionById.Values.Distinct().ToList();
            doubledSectionIds = (await _db.CompetitionSections.AsNoTracking()
                    .Where(sec => sectionIds.Contains(sec.Id) && !sec.UsesRaceFinals && sec.DoublePointsInFinal)
                    .Select(sec => sec.Id).ToListAsync(cancellationToken)).ToHashSet();
        }
        int FinalMultiplier(int teamId)
            => teamSectionById.TryGetValue(teamId, out var sectionId) && doubledSectionIds.Contains(sectionId) ? 2 : 1;
        int EffectivePlace(FinishingPlace fp)
        {
            if (fp.Eliminated || fp.Place < 1 || hcTeamIds.Count == 0 || hcTeamIds.Contains(fp.TeamId)) return fp.Place;
            var hcAhead = accepted.Count(other =>
                !other.Eliminated && !sitOut.Contains(other.TeamId) && hcTeamIds.Contains(other.TeamId)
                && other.Place > 0 && other.Place < fp.Place
                && !accepted.Any(nhc => !hcTeamIds.Contains(nhc.TeamId) && !nhc.Eliminated && !sitOut.Contains(nhc.TeamId)
                    && nhc.Place == other.Place
                    && (string.IsNullOrWhiteSpace(other.Note) || !other.Note.Contains("[dead-heat]", StringComparison.OrdinalIgnoreCase))));
            return Math.Max(1, fp.Place - hcAhead);
        }
        (int Place, int Base) EffectiveSectionScore(FinishingPlace fp)
        {
            if ( !hasMultipleSections
                || combinedScoringMode != CombinedHeatScoringMode.BySection
                || isQualifier
                || heat.RaceRoundStage == RaceRoundStage.Final
                || !teamSectionById.TryGetValue(fp.TeamId, out var secId))
            {
                return (EffectivePlace(fp), sessionBase);
            }
            var sectionSize = heat.Entries.Count(e => !sitOut.Contains(e.TeamId) && teamSectionById.GetValueOrDefault(e.TeamId) == secId);
            if (fp.Eliminated || fp.Place < 1) return (0, sectionSize);
            var sectionAhead = accepted.Count(other =>
                other.TeamId != fp.TeamId
                && !other.Eliminated
                && !sitOut.Contains(other.TeamId)
                && !hcTeamIds.Contains(other.TeamId)
                && teamSectionById.GetValueOrDefault(other.TeamId) == secId
                && other.Place > 0 && other.Place < fp.Place);
            return (sectionAhead + 1, Math.Max(1, sectionSize));
        }
        // The referee note's points directive wins ([pts:N] sets, [adj:±N] moves the placing points; never stored points,
        // so re-saving can't apply an adjustment twice), then any points sent with the place (a dead heat), then the
        // placing. Sit-outs always score 0.
        double PointsFor(FinishingPlace fp)
        {
            if (sitOut.Contains(fp.TeamId)) return 0;
            var (effPlace, effBase) = EffectiveSectionScore(fp);
            var isDeadHeatNote = !fp.Eliminated && fp.Place >= 1
                && !string.IsNullOrWhiteSpace(fp.Note)
                && fp.Note.Contains("[dead-heat]", StringComparison.OrdinalIgnoreCase);
            var tiedCount = isDeadHeatNote
                ? accepted.Count(other => !other.Eliminated && !sitOut.Contains(other.TeamId) && !hcTeamIds.Contains(other.TeamId) && other.Place == fp.Place
                    && (!hasMultipleSections || combinedScoringMode != CombinedHeatScoringMode.BySection
                        || isQualifier || heat.RaceRoundStage == RaceRoundStage.Final
                        || teamSectionById.GetValueOrDefault(other.TeamId) == teamSectionById.GetValueOrDefault(fp.TeamId)))
                : 1;
            double placing = fp.Eliminated || hcTeamIds.Contains(fp.TeamId) ? 0
                : isQualifier ? 1
                : (tiedCount > 1 ? DeadHeatPointsForPlace(effPlace, tiedCount, effBase, fp.Eliminated)
                    : PointsForPlace(effPlace, effBase, fp.Eliminated)) * FinalMultiplier(fp.TeamId);
            if (!TryParsePointsDirective(fp.Note, out var overridePts, out var deltaPts))
                return fp.Eliminated || hcTeamIds.Contains(fp.TeamId) ? 0 : fp.Points ?? placing;
            var points = overridePts ?? placing + deltaPts!.Value;
            PointValues.Validate(points);
            return points;
        }
        int? StoredPlacing(FinishingPlace fp)
        {
            if (fp.Eliminated || sitOut.Contains(fp.TeamId)) return null;
            if (fp.Place < 1) return fp.Place;
            return EffectiveSectionScore(fp).Place;
        }
        var incomingCore = accepted.Select(p => new CorePlace(p.TeamId, StoredPlacing(p), p.Eliminated,
                p.Status ?? ResultStatus.Finished, CleanNoteOrNull(p.Note), PointsFor(p)))
            .OrderBy(p => p.TeamId).ToList();
        var currentCore = current.Select(p => new CorePlace(p.TeamId, p.Eliminated ? null : p.Place, p.Eliminated,
                p.Status, p.RefereeNote, p.Points))
            .OrderBy(p => p.TeamId).ToList();
        var payloadFingerprint = PayloadFingerprint("results", incomingCore, expectedRevision, reason);

        var replay = await ReplayAsync(raceId, requestId, payloadFingerprint, state, current, cancellationToken);
        if (replay is not null)
            return replay;

        var samePlacingsAndPoints = incomingCore.Count == currentCore.Count
            && incomingCore.Zip(currentCore).All(pair =>
                pair.First.TeamId == pair.Second.TeamId
                && pair.First.Place == pair.Second.Place
                && pair.First.Eliminated == pair.Second.Eliminated
                && pair.First.Status == pair.Second.Status
                && Math.Abs(pair.First.Points - pair.Second.Points) < 1e-6);

        if (incomingCore.SequenceEqual(currentCore)
            || (samePlacingsAndPoints && expectedResults is { Count: 0 } && !expectedRevision.HasValue && string.IsNullOrWhiteSpace(reason)))
            return ToDto(raceId, state.Revision, state.IsSignedOff, state.SignedOffAt,
                state.SignedOffByUserId, current, true);
        if (state.IsSignedOff)
            throw new ScoreSignedOffException("Signed-off results must be reopened before they can be edited.");

        IReadOnlyList<ScorePlaceDto> IncomingSnapshot() => incomingCore
            .Select(p => new ScorePlaceDto(p.TeamId, p.Place ?? 0, p.Eliminated, p.Points, sitOut.Contains(p.TeamId), p.Status, p.Note))
            .OrderBy(r => r.Eliminated).ThenBy(r => r.Place).ThenBy(r => r.TeamId).ToList();

        ScoreConflictException RecordClashAndThrow(string msg)
        {
            var incomingSnap = IncomingSnapshot();
            if (current.Count > 0 && incomingSnap.Count > 0)
            {
                ActiveClashes[raceId] = new ScoreClashDto(
                    raceId, heat.Id, heat.SessionId, race.Name, race.OrderIndex,
                    current, incomingSnap, DateTime.UtcNow);
            }
            return new ScoreConflictException(msg, current, incomingSnap);
        }

        if (expectedRevision.HasValue && state.Revision != expectedRevision.Value)
            throw RecordClashAndThrow("These results were changed on another device.");
        if (expectedResults is not null)
        {
            // What the scorer saw: places and why teams did not finish. The private note is not part of it (the
            // scorer's screen may not show it), and a status the caller left out is not checked.
            var seen = expectedResults.Where(p => entryTeamIds.Contains(p.TeamId)).OrderBy(p => p.TeamId).ToList();
            var unchanged = seen.Count == currentCore.Count && seen.Zip(currentCore).All(pair =>
                pair.First.TeamId == pair.Second.TeamId
                && pair.First.Eliminated == pair.Second.Eliminated
                && (pair.First.Eliminated
                    ? pair.Second.Place is null
                    : pair.First.Place == pair.Second.Place || StoredPlacing(pair.First) == pair.Second.Place)
                && (pair.First.Status is null
                    || ResultStatuses.Of(pair.First.Eliminated, pair.First.Status.Value) == pair.Second.Status));
            if (!unchanged)
                throw RecordClashAndThrow("These results were changed on another device.");
        }
        if (current.Count > 0 && string.IsNullOrWhiteSpace(reason))
            throw new ScoreValidationException("A reason is required when correcting results.");

        var now = DateTime.UtcNow;
        var fresh = accepted.Select(fp => new Result
        {
            RaceId = raceId,
            TeamId = fp.TeamId,
            Placing = StoredPlacing(fp),
            Eliminated = fp.Eliminated,
            Status = fp.Eliminated ? fp.Status ?? ResultStatus.Eliminated : ResultStatus.Finished,
            RefereeNote = CleanNoteOrNull(fp.Note),
            IsSitOut = sitOut.Contains(fp.TeamId),
            Points = PointsFor(fp),
            RecordedAt = now,
            RecordedByUserId = actorUserId,
        }).ToList();
        var after = Snapshot(fresh);
        _db.Results.RemoveRange(race.Results);
        await _db.Results.AddRangeAsync(fresh, cancellationToken);
        race.IsComplete = true;
        race.StartedAt ??= now;
        race.FinishedAt ??= now;
        if (fresh.Count > 0)
        {
            var nextRace = heat.Races
                .OrderBy(r => r.OrderIndex)
                .ThenBy(r => r.Id)
                .FirstOrDefault(r => r.Id != raceId && !r.IsComplete && (r.OrderIndex > race.OrderIndex || (r.OrderIndex == race.OrderIndex && r.Id > race.Id)));
            if (nextRace is not null)
                nextRace.StartedAt ??= now;
            heat.StartedAt ??= now;
            if (heat.Races.Count > 0 && heat.Races.All(r => r.Id == raceId || r.IsComplete))
                heat.FinishedAt ??= now;
            if (heat.Session is { } session)
            {
                session.StartedAt ??= now;
                if (session.Status == SessionStatus.Upcoming)
                    session.Status = SessionStatus.InArena;
            }
        }
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
        await ClearMissingTeamCallsAsync(heat, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        ActiveClashes.TryRemove(raceId, out _);
        if (heat.Session is { } scoredSession)
            StandingsService.Invalidate(scoredSession.CompetitionId);
        if (fresh.Count > 0)
        {
            if (isQualifier && heat.RaceRoundId is not null)
                populatedFinalHeatId = await new RaceFinalService(_db).TryAutoPopulateAsync(raceId, cancellationToken);
            if (heat.Session is { } session)
            {
                var sessionHeats = await _db.Heats.AsNoTracking()
                    .Include(h => h.Races)
                    .Where(h => h.SessionId == session.Id)
                    .ToListAsync(cancellationToken);
                if (sessionHeats.Count > 0 && sessionHeats.All(h => h.Races.Count > 0 && h.Races.All(r => r.IsComplete)))
                {
                    session.Status = SessionStatus.Finished;
                    session.FinishedAt ??= now;
                    session.ProvisionalUntil = now.AddMinutes(15);
                    session.OfficialConfirmedAt = null;
                    await _db.SaveChangesAsync(cancellationToken);
                }
            }
        }
        return ToDto(raceId, state.Revision, false, null, null, after);
        }, cancellationToken);
        if (!dto.IdempotentReplay && _push is not null)
        {
            if (populatedFinalHeatId.HasValue)
                await new RaceFinalService(_db, _push).NotifyDrawAsync(populatedFinalHeatId.Value, cancellationToken);
            await TryNotifyHeatCompleteAsync(raceId, cancellationToken);
        }
        return dto;
    }

    private async Task TryNotifyHeatCompleteAsync(int raceId, CancellationToken ct)
    {
        try
        {
            var heat = await _db.Heats.AsNoTracking()
                .Include(h => h.Session)
                .Include(h => h.Entries).ThenInclude(e => e.Team)
                .Include(h => h.Races).ThenInclude(r => r.Results)
                .FirstOrDefaultAsync(h => h.Races.Any(r => r.Id == raceId), ct);
            if (heat is null || heat.Races.Count == 0 || heat.Races.Any(r => !r.IsComplete))
                return;

            var heatLabel = !string.IsNullOrWhiteSpace(heat.Label) ? heat.Label! : $"Heat {heat.OrderIndex}";
            var compId = heat.Session?.CompetitionId ?? 0;
            var url = compId > 0 ? $"/competitions/{compId}" : null;

            var teamTotals = heat.Entries
                .Select(e => new
                {
                    e.TeamId,
                    TeamName = e.Team?.DisplayName ?? "Unnamed team",
                    Points = heat.Races.SelectMany(r => r.Results).Where(res => res.TeamId == e.TeamId).Sum(res => res.Points),
                })
                .OrderByDescending(x => x.Points)
                .ThenBy(x => x.TeamId)
                .ToList();

            var messages = new List<(int TeamId, PushPayload Payload)>();
            var rank = 1;
            for (var i = 0; i < teamTotals.Count; i++)
            {
                if (i > 0 && teamTotals[i].Points < teamTotals[i - 1].Points)
                    rank = i + 1;
                var row = teamTotals[i];
                var ord = PushNotifier.Ordinal(rank);
                messages.Add((row.TeamId, new PushPayload(
                    Title: "Your heat's results are in",
                    Body: $"{ord} in {heatLabel} · {PointValues.Format(row.Points)} pts ({row.TeamName})",
                    Tag: $"heat-results:{heat.Id}:{row.TeamId}",
                    Url: url)));
            }
            await _push!.NotifyPerTeamAsync(messages, ct);
        }
        catch (Exception ex)
        {
            // Keep the committed score, and log no recipient, payload or exception message.
            _log?.LogWarning("Heat result notification failed for race {RaceId} ({FailureType}).", raceId, ex.GetType().Name);
        }
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
            // An open protest on this race, or on its whole heat, has to be decided or withdrawn first.
            if (await _db.Set<Protest>().AnyAsync(p => p.Status == ProtestStatus.Open && p.HeatId == race.HeatId
                    && (p.RaceId == null || p.RaceId == raceId), cancellationToken))
                throw new ScoreConflictException(
                    "This race has an open protest. Decide it or mark it withdrawn before signing off.");
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
        _clearedCalls.Clear();
        var result = await strategy.ExecuteAsync(async () =>
        {
            // A provider retry must not reuse mutations tracked by the failed attempt.
            _db.ChangeTracker.Clear();
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var value = await action();
            await transaction.CommitAsync(cancellationToken);
            return value;
        });
        if (_live is not null && _clearedCalls.Count > 0)
        {
            // Keep deletion notifications across a retry after an ambiguous commit, but
            // do not announce a deletion from an attempt that rolled back and left the row.
            var ids = _clearedCalls.Select(c => c.MessageId).Distinct().ToArray();
            var remaining = await _db.ChatMessages.AsNoTracking().Where(m => ids.Contains(m.Id))
                .Select(m => m.Id).ToListAsync(cancellationToken);
            foreach (var (competitionId, messageId) in _clearedCalls.Distinct())
                if (!remaining.Contains(messageId)) await _live.ChatMessageDeleted(competitionId, messageId);
        }
        return result;
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
        .Select(r => new ScorePlaceDto(r.TeamId, r.Placing ?? 0, r.Eliminated, r.Points, r.IsSitOut,
            ResultStatuses.Of(r), r.RefereeNote))
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

    private sealed record CorePlace(int TeamId, int? Place, bool Eliminated, ResultStatus Status, string? Note, double Points);

    /// <summary>Reads a <c>[pts:N]</c> or <c>[adj:±N]</c> directive from a referee note; N must be whole or half.</summary>
    private static bool TryParsePointsDirective(string? note, out double? overridePts, out double? deltaPts)
    {
        overridePts = null;
        deltaPts = null;
        if (string.IsNullOrWhiteSpace(note)) return false;
        var ptsMatch = Regex.Match(note, @"\[pts:(\d+(?:\.\d+)?)\]", RegexOptions.IgnoreCase);
        if (ptsMatch.Success && double.TryParse(ptsMatch.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture, out var pts))
        {
            PointValues.Validate(pts);
            overridePts = pts;
            return true;
        }
        var adjMatch = Regex.Match(note, @"\[adj:([+-]?\d+(?:\.\d+)?)\]", RegexOptions.IgnoreCase);
        if (adjMatch.Success && double.TryParse(adjMatch.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture, out var adj))
        {
            PointValues.Validate(Math.Abs(adj));
            deltaPts = adj;
            return true;
        }
        return false;
    }

    private static string? CleanNoteOrNull(string? note) => ResultStatuses.CleanNote(note);

    /// <summary>
    /// A team that did not finish is Eliminated unless the caller says why. A status other than Finished
    /// means the team did not finish, whatever <c>Eliminated</c> says, and a finisher has no status.
    /// </summary>
    private static List<FinishingPlace> Normalise(IReadOnlyList<FinishingPlace> places)
        => places.Select(p =>
        {
            if (p.Status is { } status && !Enum.IsDefined(status))
                throw new ScoreValidationException("Unknown result status.");
            ResultStatuses.CleanNote(p.Note);
            if (p.Points is { } points)
                PointValues.Validate(points);
            var eliminated = p.Eliminated || p.Status is { } s && s != ResultStatus.Finished;
            return p with
            {
                Eliminated = eliminated,
                Status = eliminated ? p.Status is null or ResultStatus.Finished ? ResultStatus.Eliminated : p.Status : ResultStatus.Finished,
            };
        }).ToList();
}
