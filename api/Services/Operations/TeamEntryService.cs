using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services.Operations;

/// <summary>
/// Marks a team withdrawn or a no-show, or reinstates it. Going out removes the team from every
/// unscored heat straight away (scored, signed-off and started heats keep it, so history is not rewritten)
/// and remembers where it was, so reinstating before a draw is applied can put it back. Rebalancing the
/// heats that are left is a separate, confirmed step: <see cref="WithdrawalRedrawService"/>.
/// </summary>
public class TeamEntryService(AppDbContext db)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaxReasonLength = 500;

    private sealed record RemovedPlace(int HeatId, int SessionId, int LaneIndex);

    public async Task<IReadOnlyList<TeamEntryDto>> ListAsync(int competitionId, CancellationToken ct = default)
    {
        if (!await db.Competitions.AnyAsync(c => c.Id == competitionId, ct))
            throw new KeyNotFoundException("Competition not found.");
        var teams = await db.Teams.AsNoTracking()
            .Include(t => t.Section)
            .Where(t => t.CompetitionId == competitionId)
            .OrderBy(t => t.CompetitionSectionId).ThenBy(t => t.DisplayName)
            .ToListAsync(ct);
        var events = await db.Set<TeamStatusEvent>().AsNoTracking()
            .Where(e => e.CompetitionId == competitionId)
            .ToListAsync(ct);
        var latest = events.GroupBy(e => e.TeamId).ToDictionary(g => g.Key, g => g.OrderBy(e => e.Id).Last());
        var draws = await db.Set<DrawChange>().AsNoTracking()
            .Where(d => d.CompetitionId == competitionId
                && (d.Kind == DrawChangeKind.SectionDraw || d.Kind == DrawChangeKind.Redraw))
            .Select(d => new { d.SectionId, d.CreatedAt })
            .ToListAsync(ct);
        var sectionsWithOut = teams.Where(t => t.EntryStatus != TeamEntryStatus.Active)
            .Select(t => t.CompetitionSectionId).ToHashSet();

        return teams.Select(t =>
        {
            latest.TryGetValue(t.Id, out var last);
            var out_ = t.EntryStatus != TeamEntryStatus.Active;
            return new TeamEntryDto(t.Id, t.DisplayName, t.CompetitionSectionId, t.Section?.DisplayName ?? string.Empty,
                t.IsHorsConcours, t.EntryStatus,
                out_ ? last?.Reason : null, out_ ? last?.CreatedAt : null,
                out_ && last is not null && !DrawDependsOn(draws.Where(d => d.SectionId == t.CompetitionSectionId).Select(d => d.CreatedAt), last),
                sectionsWithOut.Contains(t.CompetitionSectionId));
        }).ToList();
    }

    public async Task<SetTeamEntryStatusResult> SetStatusAsync(
        int competitionId, int teamId, SetTeamEntryStatusRequest request, string? actorUserId,
        CancellationToken ct = default)
    {
        if (!Enum.IsDefined(request.Status)) throw new EntryValidationException("Unknown status.");
        var reason = (request.Reason ?? string.Empty).Trim();
        if (reason.Length > MaxReasonLength)
            throw new EntryValidationException($"The reason must be {MaxReasonLength} characters or fewer.");
        if (request.Status == TeamEntryStatus.Withdrawn && reason.Length == 0) reason = "Withdrawn by organiser";
        if (request.Status == TeamEntryStatus.NoShow && reason.Length == 0) reason = "Did not arrive";

        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

            var team = await db.Teams.Include(t => t.Section)
                .FirstOrDefaultAsync(t => t.Id == teamId && t.CompetitionId == competitionId, ct)
                ?? throw new KeyNotFoundException("Team not found.");
            var previous = await db.Set<TeamStatusEvent>()
                .Where(e => e.TeamId == teamId).OrderByDescending(e => e.Id).FirstOrDefaultAsync(ct);

            // Asking for the status it already has changes nothing, so a retry is harmless.
            if (team.EntryStatus == request.Status)
                return new SetTeamEntryStatusResult(await EntryAsync(team, ct), 0, []);

            var changedSessions = new HashSet<int>();
            var placesChanged = 0;
            var removedJson = previous?.RemovedEntriesJson ?? "[]";

            if (team.EntryStatus == TeamEntryStatus.Active)
            {
                var removed = await RemoveFromUnscoredHeatsAsync(team, ct);
                removedJson = JsonSerializer.Serialize(removed, Json);
                placesChanged = removed.Count;
                foreach (var place in removed) changedSessions.Add(place.SessionId);
            }
            else if (request.Status == TeamEntryStatus.Active)
            {
                var draws = await db.Set<DrawChange>().AsNoTracking()
                    .Where(d => d.CompetitionId == competitionId
                        && d.SectionId == team.CompetitionSectionId
                        && (d.Kind == DrawChangeKind.SectionDraw || d.Kind == DrawChangeKind.Redraw))
                    .Select(d => d.CreatedAt).ToListAsync(ct);
                if (previous is not null && DrawDependsOn(draws, previous))
                    throw new DrawValidationException(
                        "A draw has been applied since this team went out, so it can't be reinstated here. Add it to a heat in the timetable editor.");
                var restored = await RestoreToHeatsAsync(team, previous, ct);
                placesChanged = restored.Count;
                foreach (var sessionId in restored) changedSessions.Add(sessionId);
                removedJson = "[]";
            }

            team.EntryStatus = request.Status;
            db.Set<TeamStatusEvent>().Add(new TeamStatusEvent
            {
                CompetitionId = competitionId,
                TeamId = teamId,
                Status = request.Status,
                Reason = reason,
                ActorUserId = actorUserId,
                RemovedEntriesJson = removedJson,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);

            return new SetTeamEntryStatusResult(await EntryAsync(team, ct), placesChanged, changedSessions.Order().ToList());
        });
    }

    /// <summary>A draw in the team's section made after the team went out was built without it.</summary>
    private static bool DrawDependsOn(IEnumerable<DateTime> drawTimes, TeamStatusEvent lastChange)
        => drawTimes.Any(at => at >= lastChange.CreatedAt);

    private async Task<TeamEntryDto> EntryAsync(Team team, CancellationToken ct)
    {
        var all = await ListAsync(team.CompetitionId, ct);
        return all.First(e => e.TeamId == team.Id);
    }

    private async Task<List<RemovedPlace>> RemoveFromUnscoredHeatsAsync(Team team, CancellationToken ct)
    {
        var entries = await db.HeatEntries
            .Include(e => e.Heat).ThenInclude(h => h!.Session)
            .Include(e => e.Heat).ThenInclude(h => h!.Entries)
            .Include(e => e.Heat).ThenInclude(h => h!.Races).ThenInclude(r => r.Results)
            .Where(e => e.TeamId == team.Id && e.Heat!.Session!.CompetitionId == team.CompetitionId)
            .ToListAsync(ct);
        var signedOff = await HeatProtection.SignedOffRaceIdsAsync(
            db, entries.SelectMany(e => e.Heat!.Races).Select(r => r.Id), ct);
        var removed = new List<RemovedPlace>();
        foreach (var entry in entries)
        {
            var heat = entry.Heat!;
            if (HeatProtection.IsProtected(heat, heat.Session!, signedOff)) continue;
            removed.Add(new RemovedPlace(heat.Id, heat.SessionId, entry.LaneIndex));
            db.HeatEntries.Remove(entry);
            var remaining = heat.Entries
                .Where(e => e.Id != entry.Id && e.TeamId != team.Id)
                .OrderBy(e => e.LaneIndex)
                .ThenBy(e => e.Id)
                .ToList();
            for (var i = 0; i < remaining.Count; i++)
                remaining[i].LaneIndex = i + 1;
        }
        return removed;
    }

    /// <summary>Puts a reinstated team back where it was. Returns the sessions it went back into.</summary>
    private async Task<List<int>> RestoreToHeatsAsync(Team team, TeamStatusEvent? previous, CancellationToken ct)
    {
        var restoredSessions = new List<int>();
        var places = string.IsNullOrWhiteSpace(previous?.RemovedEntriesJson)
            ? []
            : JsonSerializer.Deserialize<List<RemovedPlace>>(previous.RemovedEntriesJson, Json) ?? [];
        if (places.Count == 0) return restoredSessions;

        var heatIds = places.Select(p => p.HeatId).Distinct().ToList();
        var heats = await db.Heats
            .Include(h => h.Session)
            .Include(h => h.Entries)
            .Include(h => h.Races).ThenInclude(r => r.Results)
            .Where(h => heatIds.Contains(h.Id))
            .ToListAsync(ct);
        var signedOff = await HeatProtection.SignedOffRaceIdsAsync(db, heats.SelectMany(h => h.Races).Select(r => r.Id), ct);
        foreach (var place in places)
        {
            var heat = heats.FirstOrDefault(h => h.Id == place.HeatId);
            if (heat is null || HeatProtection.IsProtected(heat, heat.Session!, signedOff)) continue;
            if (heat.Entries.Any(e => e.TeamId == team.Id)) continue;
            var ordered = heat.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id).ToList();
            var targetLane = Math.Clamp(place.LaneIndex, 1, ordered.Count + 1);
            foreach (var existing in ordered.Where(e => e.LaneIndex >= targetLane))
                existing.LaneIndex++;
            db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = team.Id, LaneIndex = targetLane });
            restoredSessions.Add(heat.SessionId);
        }
        return restoredSessions;
    }
}
