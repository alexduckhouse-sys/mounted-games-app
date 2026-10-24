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
        finishingPlaces = Normalise(finishingPlaces);
        if (reason?.Trim().Length > 1000)
            throw new ScoreValidationException("Reason must be 1000 characters or fewer.");
        requestId = requestId.Trim();
        return await ExecuteTransactionAsync(async () =>
        {
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
        int EffectivePlace(FinishingPlace fp)
        {
            if (fp.Eliminated || fp.Place < 1 || hcTeamIds.Count == 0) return fp.Place;
            var hcAhead = accepted.Count(other =>
                !other.Eliminated && !sitOut.Contains(other.TeamId) && hcTeamIds.Contains(other.TeamId)
                && other.Place > 0 && other.Place < fp.Place);
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
            double placing = fp.Eliminated || hcTeamIds.Contains(fp.TeamId) ? 0
                : isQualifier ? 1 : PointsForPlace(effPlace, effBase, fp.Eliminated);
            if (!TryParsePointsDirective(fp.Note, out var overridePts, out var deltaPts))
                return fp.Eliminated || hcTeamIds.Contains(fp.TeamId) ? 0 : fp.Points ?? placing;
            var points = overridePts ?? placing + deltaPts!.Value;
            PointValues.Validate(points);
            return points;
        }
        var incomingCore = accepted.Select(p => new CorePlace(p.TeamId, p.Eliminated ? null : p.Place, p.Eliminated,
                p.Status ?? ResultStatus.Finished, CleanNoteOrNull(p.Note), PointsFor(p)))
            .OrderBy(p => p.TeamId).ToList();
        var currentCore = current.Select(p => new CorePlace(p.TeamId, p.Eliminated ? null : p.Place, p.Eliminated,
                p.Status, p.RefereeNote, p.Points))
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
            // What the scorer saw: places and why teams did not finish. The private note is not part of it (the
            // scorer's screen may not show it), and a status the caller left out is not checked.
            var seen = expectedResults.Where(p => entryTeamIds.Contains(p.TeamId)).OrderBy(p => p.TeamId).ToList();
            var unchanged = seen.Count == currentCore.Count && seen.Zip(currentCore).All(pair =>
                pair.First.TeamId == pair.Second.TeamId
                && pair.First.Eliminated == pair.Second.Eliminated
                && (pair.First.Eliminated ? null : (int?)pair.First.Place) == pair.Second.Place
                && (pair.First.Status is null
                    || ResultStatuses.Of(pair.First.Eliminated, pair.First.Status.Value) == pair.Second.Status));
            if (!unchanged)
                throw new ScoreConflictException("These results were changed on another device.");
        }
        if (current.Count > 0 && string.IsNullOrWhiteSpace(reason))
            throw new ScoreValidationException("A reason is required when correcting results.");

        var now = DateTime.UtcNow;
        var fresh = accepted.Select(fp => new Result
        {
            RaceId = raceId,
            TeamId = fp.TeamId,
            Placing = fp.Eliminated || sitOut.Contains(fp.TeamId) ? null : fp.Place,
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
        await _db.SaveChangesAsync(cancellationToken);
        if (fresh.Count > 0)
        {
            if (isQualifier && heat.RaceRoundId is not null)
                await new RaceFinalService(_db).TryAutoPopulateAsync(raceId, cancellationToken);
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
                    await _db.SaveChangesAsync(cancellationToken);
                }
            }
        }
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
