using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services.Operations;

public sealed class ProtestValidationException(string message) : InvalidOperationException(message);
public sealed class ProtestConflictException(string message) : InvalidOperationException(message);

/// <summary>What a protest write changed, so the controller can tell staff and, when the public flag moved, everyone.</summary>
public sealed record ProtestChange(ProtestDto Protest, int SessionId, int HeatId, bool FlagsChanged);

/// <summary>
/// The protest and referee-decision log (decided 22 October 2026): staff log a protest against a race or a
/// whole heat, then uphold or dismiss it with a written decision, or record that it was withdrawn. An open
/// protest blocks signing off the races it covers (<c>ScoringService</c> checks this table). The only public
/// trace is <see cref="Entities.Race.HasOpenProtest"/>, kept in step here inside the same transaction.
/// Nothing here writes results: a decision that changes a score is a correction through <c>ScoringService</c>.
/// </summary>
public class ProtestService(AppDbContext db)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaxTextLength = 1000;
    public const int MaxNameLength = 120;
    public const int MaxRequestIdLength = 100;
    public const int MaxConcernedTeams = 20;

    public async Task<IReadOnlyList<ProtestDto>> ListAsync(
        int competitionId, bool openOnly, int? heatId, int? raceId, CancellationToken ct = default)
    {
        var query = db.Set<Protest>().AsNoTracking().Where(p => p.CompetitionId == competitionId);
        if (openOnly) query = query.Where(p => p.Status == ProtestStatus.Open);
        if (heatId is not null) query = query.Where(p => p.HeatId == heatId);
        // A race's protests include the ones against its whole heat, since those block it too.
        if (raceId is not null)
        {
            var raceHeat = await db.Races.AsNoTracking().Where(r => r.Id == raceId).Select(r => (int?)r.HeatId).FirstOrDefaultAsync(ct);
            query = query.Where(p => p.RaceId == raceId || (p.RaceId == null && p.HeatId == raceHeat));
        }
        var protests = await query.OrderBy(p => p.Status == ProtestStatus.Open ? 0 : 1)
            .ThenByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id).ToListAsync(ct);
        return await ToDtosAsync(protests, ct);
    }

    public async Task<ProtestChange> CreateAsync(
        int competitionId, CreateProtestRequest request, string? actorUserId, CancellationToken ct = default)
    {
        var reason = Required(request.Reason, "Say what the protest is about.");
        var requestId = Required(request.RequestId, "A request id is required.");
        if (requestId.Length > MaxRequestIdLength) throw new ProtestValidationException("The request id is too long.");
        var raisedByName = string.IsNullOrWhiteSpace(request.RaisedByName) ? null : request.RaisedByName.Trim();
        if (raisedByName?.Length > MaxNameLength)
            throw new ProtestValidationException($"Keep who raised it to {MaxNameLength} characters or fewer.");
        var concerns = (request.ConcernsTeamIds ?? []).Distinct().ToList();
        if (concerns.Count > MaxConcernedTeams) throw new ProtestValidationException("That's too many teams for one protest.");
        if (request.HeatId is null && request.RaceId is null)
            throw new ProtestValidationException("Choose the race or heat the protest is about.");

        return await InTransactionAsync(async () =>
        {
            var existing = await db.Set<Protest>().AsNoTracking()
                .FirstOrDefaultAsync(p => p.CompetitionId == competitionId && p.RequestId == requestId, ct);
            if (existing is not null)
            {
                // A retry from a phone on poor signal: hand back the first one, change nothing.
                var dto = (await ToDtosAsync([existing], ct))[0];
                return new ProtestChange(dto, dto.SessionId, existing.HeatId, false);
            }

            int heatId;
            if (request.RaceId is { } raceId)
            {
                var race = await db.Races.AsNoTracking()
                    .Where(r => r.Id == raceId && r.Heat!.Session!.CompetitionId == competitionId)
                    .Select(r => new { r.HeatId }).FirstOrDefaultAsync(ct)
                    ?? throw new ProtestValidationException("That race isn't in this competition.");
                if (request.HeatId is { } given && given != race.HeatId)
                    throw new ProtestValidationException("That race isn't in that heat.");
                heatId = race.HeatId;
            }
            else
            {
                heatId = request.HeatId!.Value;
                if (!await db.Heats.AnyAsync(h => h.Id == heatId && h.Session!.CompetitionId == competitionId, ct))
                    throw new ProtestValidationException("That heat isn't in this competition.");
            }

            var teamIds = concerns.Concat(request.RaisedByTeamId is { } t ? [t] : Array.Empty<int>()).Distinct().ToList();
            if (teamIds.Count > 0)
            {
                var found = await db.Teams.CountAsync(x => teamIds.Contains(x.Id) && x.CompetitionId == competitionId, ct);
                if (found != teamIds.Count) throw new ProtestValidationException("Some of those teams aren't in this competition.");
            }

            var protest = new Protest
            {
                CompetitionId = competitionId,
                HeatId = heatId,
                RaceId = request.RaceId,
                RaisedByTeamId = request.RaisedByTeamId,
                ConcernsTeamIdsJson = JsonSerializer.Serialize(concerns, Json),
                RaisedByName = raisedByName,
                Reason = reason,
                Status = ProtestStatus.Open,
                CreatedByUserId = actorUserId,
                CreatedAt = DateTime.UtcNow,
                RequestId = requestId,
            };
            db.Add(protest);
            await db.SaveChangesAsync(ct);
            var changed = await SyncFlagsAsync(heatId, ct);
            await db.SaveChangesAsync(ct);
            var created = (await ToDtosAsync([protest], ct))[0];
            return new ProtestChange(created, created.SessionId, heatId, changed);
        }, ct);
    }

    public Task<ProtestChange> DecideAsync(
        int competitionId, int protestId, DecideProtestRequest request, string? actorUserId, CancellationToken ct = default)
    {
        if (request.Outcome is not (ProtestStatus.Upheld or ProtestStatus.Dismissed))
            throw new ProtestValidationException("Choose whether the protest is upheld or dismissed.");
        var decision = Required(request.Decision, "Write down the decision and the reason for it.");
        return CloseAsync(competitionId, protestId, request.Outcome, decision, actorUserId, ct);
    }

    public Task<ProtestChange> WithdrawAsync(
        int competitionId, int protestId, WithdrawProtestRequest request, string? actorUserId, CancellationToken ct = default)
    {
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note?.Length > MaxTextLength)
            throw new ProtestValidationException($"Keep the note to {MaxTextLength} characters or fewer.");
        return CloseAsync(competitionId, protestId, ProtestStatus.Withdrawn, note, actorUserId, ct);
    }

    private Task<ProtestChange> CloseAsync(
        int competitionId, int protestId, ProtestStatus status, string? decision, string? actorUserId, CancellationToken ct)
        => InTransactionAsync(async () =>
        {
            var protest = await db.Set<Protest>()
                .FirstOrDefaultAsync(p => p.Id == protestId && p.CompetitionId == competitionId, ct)
                ?? throw new KeyNotFoundException("Protest not found.");
            if (protest.Status != ProtestStatus.Open)
                throw new ProtestConflictException(protest.Status == ProtestStatus.Withdrawn
                    ? "This protest has already been withdrawn."
                    : "This protest has already been decided.");
            protest.Status = status;
            protest.Decision = decision;
            protest.DecidedByUserId = actorUserId;
            protest.DecidedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            var changed = await SyncFlagsAsync(protest.HeatId, ct);
            await db.SaveChangesAsync(ct);
            var dto = (await ToDtosAsync([protest], ct))[0];
            return new ProtestChange(dto, dto.SessionId, protest.HeatId, changed);
        }, ct);

    /// <summary>Sets each race's public flag from the open protests on its heat. True when any flag moved.</summary>
    private async Task<bool> SyncFlagsAsync(int heatId, CancellationToken ct)
    {
        var open = await db.Set<Protest>().AsNoTracking()
            .Where(p => p.HeatId == heatId && p.Status == ProtestStatus.Open)
            .Select(p => p.RaceId).ToListAsync(ct);
        var races = await db.Races.Where(r => r.HeatId == heatId).ToListAsync(ct);
        var changed = false;
        foreach (var race in races)
        {
            var flagged = open.Any(id => id is null || id == race.Id);
            if (race.HasOpenProtest == flagged) continue;
            race.HasOpenProtest = flagged;
            changed = true;
        }
        return changed;
    }

    private async Task<T> InTransactionAsync<T>(Func<Task<T>> action, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            // Serializable, and it reads the races' sign-off state, so a protest and a sign-off racing on
            // another instance can't both commit (one of them gets a serialisation failure and a 409).
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var value = await action();
            await transaction.CommitAsync(ct);
            return value;
        });
    }

    private async Task<IReadOnlyList<ProtestDto>> ToDtosAsync(IReadOnlyList<Protest> protests, CancellationToken ct)
    {
        if (protests.Count == 0) return [];
        var heatIds = protests.Select(p => p.HeatId).Distinct().ToList();
        var heats = await db.Heats.AsNoTracking().Where(h => heatIds.Contains(h.Id))
            .Select(h => new { h.Id, h.Label, h.OrderIndex, h.SessionId, SessionName = h.Session!.Name })
            .ToDictionaryAsync(h => h.Id, ct);
        var races = await db.Races.AsNoTracking().Where(r => heatIds.Contains(r.HeatId))
            .Select(r => new { r.Id, r.HeatId, r.Name }).ToListAsync(ct);
        var raceIds = races.Select(r => r.Id).ToList();
        var signedOff = (await db.Set<RaceScoreState>().AsNoTracking()
            .Where(s => raceIds.Contains(s.RaceId) && s.IsSignedOff).Select(s => s.RaceId).ToListAsync(ct)).ToHashSet();
        var concerns = protests.ToDictionary(p => p.Id, p => ReadIds(p.ConcernsTeamIdsJson));
        var teamIds = concerns.Values.SelectMany(x => x)
            .Concat(protests.Where(p => p.RaisedByTeamId is not null).Select(p => p.RaisedByTeamId!.Value)).Distinct().ToList();
        var teams = await db.Teams.AsNoTracking().Where(t => teamIds.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id, t => t.DisplayName, ct);

        return protests.Select(p =>
        {
            var heat = heats[p.HeatId];
            var raceName = races.FirstOrDefault(r => r.Id == p.RaceId)?.Name;
            var covered = races.Where(r => r.HeatId == p.HeatId && (p.RaceId is null || r.Id == p.RaceId));
            return new ProtestDto(p.Id, p.CompetitionId, heat.SessionId, heat.SessionName,
                p.HeatId, heat.Label, heat.OrderIndex, p.RaceId, raceName,
                p.RaisedByTeamId is { } raised && teams.TryGetValue(raised, out var raisedName) ? new ProtestTeamDto(raised, raisedName) : null,
                concerns[p.Id].Where(teams.ContainsKey).Select(id => new ProtestTeamDto(id, teams[id])).ToList(),
                p.RaisedByName, p.Reason, p.Status, p.Decision,
                p.CreatedByUserId, p.CreatedAt, p.DecidedByUserId, p.DecidedAt,
                covered.Any(r => signedOff.Contains(r.Id)));
        }).ToList();
    }

    private static IReadOnlyList<int> ReadIds(string json)
    {
        try { return JsonSerializer.Deserialize<List<int>>(json, Json) ?? []; }
        catch (JsonException) { return []; }
    }

    private static string Required(string? value, string message)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ProtestValidationException(message);
        var trimmed = value.Trim();
        if (trimmed.Length > MaxTextLength)
            throw new ProtestValidationException($"Keep it to {MaxTextLength} characters or fewer.");
        return trimmed;
    }
}
