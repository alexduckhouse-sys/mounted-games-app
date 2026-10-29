using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services.Operations;

public sealed record DrawUndoEntrySnapshot(int TeamId, int LaneIndex, string? BibColourOverride = null);
public sealed record DrawUndoRaceSnapshot(string Name, int OrderIndex);
public sealed record DrawUndoHeatSnapshot(
    int OriginalHeatId,
    string? Label,
    int OrderIndex,
    DateTime? ScheduledStart,
    int? DurationMinutes,
    int? RaceRoundId,
    RaceRoundStage RaceRoundStage,
    IReadOnlyList<DrawUndoEntrySnapshot> Entries,
    IReadOnlyList<DrawUndoRaceSnapshot> Races);
public sealed record DrawUndoSessionSnapshot(
    int SessionId,
    string SessionName,
    int? LanesPerHeat,
    IReadOnlyList<DrawUndoHeatSnapshot> Heats);
public sealed record DrawUndoSnapshot(
    string Kind,
    string Label,
    int? SectionId,
    int? SessionId,
    IReadOnlyList<DrawUndoSessionSnapshot> Sessions);

public static class DrawUndoService
{
    public static readonly TimeSpan UndoWindow = TimeSpan.FromMinutes(30);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string BuildSnapshotJson(
        string kind,
        string label,
        IEnumerable<Session> sessions,
        int? sectionId = null,
        int? sessionId = null)
    {
        var sessionList = sessions
            .OrderBy(s => s.OrderIndex).ThenBy(s => s.Id)
            .Select(s => new DrawUndoSessionSnapshot(
                s.Id,
                s.Name,
                s.LanesPerHeat,
                s.Heats
                    .OrderBy(h => h.OrderIndex).ThenBy(h => h.Id)
                    .Select(h => new DrawUndoHeatSnapshot(
                        h.Id,
                        h.Label,
                        h.OrderIndex,
                        h.ScheduledStart,
                        h.DurationMinutes,
                        h.RaceRoundId,
                        h.RaceRoundStage,
                        h.Entries
                            .OrderBy(e => e.LaneIndex).ThenBy(e => e.TeamId)
                            .Select(e => new DrawUndoEntrySnapshot(e.TeamId, e.LaneIndex, e.BibColourOverride))
                            .ToList(),
                        h.Races
                            .OrderBy(r => r.OrderIndex).ThenBy(r => r.Id)
                            .Select(r => new DrawUndoRaceSnapshot(r.Name, r.OrderIndex))
                            .ToList()))
                    .ToList()))
            .ToList();

        var snapshot = new DrawUndoSnapshot(kind, label, sectionId, sessionId, sessionList);
        return JsonSerializer.Serialize(snapshot, JsonOptions);
    }

    public static void RecordSessionSnapshot(
        AppDbContext db,
        int competitionId,
        Session session,
        string kind,
        string label,
        string? actorUserId = null)
    {
        var json = BuildSnapshotJson(kind, label, [session], session.CompetitionSectionId, session.Id);
        db.Set<DrawChange>().Add(new DrawChange
        {
            CompetitionId = competitionId,
            SectionId = session.CompetitionSectionId ?? 0,
            Kind = DrawChangeKind.UndoSnapshot,
            RequestId = $"undo-{Guid.NewGuid():N}",
            Fingerprint = $"session-{session.Id}",
            ActorUserId = actorUserId,
            ResultJson = json,
            CreatedAt = DateTime.UtcNow,
        });
    }

    public static async Task<DrawUndoStatusDto> GetStatusAsync(
        AppDbContext db,
        int competitionId,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var cutoff = now - UndoWindow;
        var candidates = await db.Set<DrawChange>().AsNoTracking()
            .Where(d => d.CompetitionId == competitionId
                && (d.Kind == DrawChangeKind.SectionDraw || d.Kind == DrawChangeKind.UndoSnapshot)
                && d.CreatedAt >= cutoff)
            .OrderByDescending(d => d.CreatedAt)
            .ThenByDescending(d => d.Id)
            .ToListAsync(cancellationToken);

        foreach (var candidate in candidates)
        {
            var snapshot = TryParseSnapshot(candidate.ResultJson);
            if (snapshot is null || snapshot.Sessions.Count == 0) continue;

            var totalHeats = snapshot.Sessions.Sum(s => s.Heats.Count);
            return new DrawUndoStatusDto(
                true,
                candidate.Id,
                snapshot.Kind,
                snapshot.Label,
                snapshot.SectionId,
                snapshot.SessionId,
                candidate.CreatedAt,
                candidate.CreatedAt.Add(UndoWindow),
                totalHeats,
                snapshot.Sessions.Count);
        }

        return EmptyStatus();
    }

    public static async Task<(DrawUndoResultDto Result, IReadOnlyList<int> ChangedSessionIds)> UndoAsync(
        AppDbContext db,
        int competitionId,
        CancellationToken cancellationToken = default)
    {
        var exists = await db.Competitions.AsNoTracking()
            .AnyAsync(c => c.Id == competitionId, cancellationToken);
        if (!exists) throw new KeyNotFoundException("Competition not found.");

        var now = DateTime.UtcNow;
        var cutoff = now - UndoWindow;
        var candidates = await db.Set<DrawChange>()
            .Where(d => d.CompetitionId == competitionId
                && (d.Kind == DrawChangeKind.SectionDraw || d.Kind == DrawChangeKind.UndoSnapshot)
                && d.CreatedAt >= cutoff)
            .OrderByDescending(d => d.CreatedAt)
            .ThenByDescending(d => d.Id)
            .ToListAsync(cancellationToken);

        DrawChange? targetChange = null;
        DrawUndoSnapshot? snapshot = null;
        foreach (var candidate in candidates)
        {
            var parsed = TryParseSnapshot(candidate.ResultJson);
            if (parsed is not null && parsed.Sessions.Count > 0)
            {
                targetChange = candidate;
                snapshot = parsed;
                break;
            }
        }

        if (targetChange is null || snapshot is null)
            throw new InvalidOperationException("There is no recent draw or heat change available to undo.");

        var sessionIds = snapshot.Sessions.Select(s => s.SessionId).Distinct().ToList();
        var sessions = await db.Sessions
            .Where(s => s.CompetitionId == competitionId && sessionIds.Contains(s.Id))
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .ToListAsync(cancellationToken);

        var validTeamIds = (await db.Teams.AsNoTracking()
                .Where(t => t.CompetitionId == competitionId)
                .Select(t => t.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        var restoredSessions = 0;
        var restoredHeats = 0;
        var changedSessionIds = new List<int>();

        foreach (var sessionSnap in snapshot.Sessions)
        {
            var session = sessions.FirstOrDefault(s => s.Id == sessionSnap.SessionId);
            if (session is null) continue;

            var snapHeatIds = sessionSnap.Heats
                .Where(h => h.OriginalHeatId > 0)
                .Select(h => h.OriginalHeatId)
                .ToHashSet();

            // Ensure no newly created heat that we would remove has scored results.
            var removableHeats = session.Heats.Where(h => !snapHeatIds.Contains(h.Id)).ToList();
            if (removableHeats.Any(HasScoredResults))
                throw new InvalidOperationException("Cannot undo because races have already been scored in the affected heats.");

            foreach (var removeHeat in removableHeats)
            {
                db.Heats.Remove(removeHeat);
                session.Heats.Remove(removeHeat);
            }

            if (sessionSnap.LanesPerHeat.HasValue)
                session.LanesPerHeat = sessionSnap.LanesPerHeat;

            foreach (var heatSnap in sessionSnap.Heats.OrderBy(h => h.OrderIndex))
            {
                var existingHeat = heatSnap.OriginalHeatId > 0
                    ? session.Heats.FirstOrDefault(h => h.Id == heatSnap.OriginalHeatId)
                    : null;

                if (existingHeat is not null)
                {
                    if (HasScoredResults(existingHeat)) continue;

                    existingHeat.Label = heatSnap.Label;
                    existingHeat.OrderIndex = heatSnap.OrderIndex;
                    existingHeat.ScheduledStart = heatSnap.ScheduledStart;
                    existingHeat.DurationMinutes = heatSnap.DurationMinutes;
                    existingHeat.RaceRoundId = heatSnap.RaceRoundId;
                    existingHeat.RaceRoundStage = heatSnap.RaceRoundStage;

                    db.HeatEntries.RemoveRange(existingHeat.Entries);
                    existingHeat.Entries.Clear();
                    foreach (var entrySnap in heatSnap.Entries.Where(e => validTeamIds.Contains(e.TeamId)))
                    {
                        existingHeat.Entries.Add(new HeatEntry
                        {
                            HeatId = existingHeat.Id,
                            TeamId = entrySnap.TeamId,
                            LaneIndex = entrySnap.LaneIndex,
                            BibColourOverride = entrySnap.BibColourOverride,
                        });
                    }

                    db.Races.RemoveRange(existingHeat.Races);
                    existingHeat.Races.Clear();
                    foreach (var raceSnap in heatSnap.Races.OrderBy(r => r.OrderIndex))
                    {
                        existingHeat.Races.Add(new Race
                        {
                            HeatId = existingHeat.Id,
                            Name = raceSnap.Name,
                            OrderIndex = raceSnap.OrderIndex,
                            IsComplete = false,
                        });
                    }

                    restoredHeats++;
                }
                else
                {
                    var restoredHeat = new Heat
                    {
                        SessionId = session.Id,
                        Label = heatSnap.Label,
                        OrderIndex = heatSnap.OrderIndex,
                        ScheduledStart = heatSnap.ScheduledStart,
                        DurationMinutes = heatSnap.DurationMinutes,
                        RaceRoundId = heatSnap.RaceRoundId,
                        RaceRoundStage = heatSnap.RaceRoundStage,
                        Entries = heatSnap.Entries
                            .Where(e => validTeamIds.Contains(e.TeamId))
                            .Select(e => new HeatEntry
                            {
                                TeamId = e.TeamId,
                                LaneIndex = e.LaneIndex,
                                BibColourOverride = e.BibColourOverride,
                            })
                            .ToList(),
                        Races = heatSnap.Races
                            .OrderBy(r => r.OrderIndex)
                            .Select(r => new Race
                            {
                                Name = r.Name,
                                OrderIndex = r.OrderIndex,
                                IsComplete = false,
                            })
                            .ToList(),
                    };
                    session.Heats.Add(restoredHeat);
                    restoredHeats++;
                }
            }

            restoredSessions++;
            changedSessionIds.Add(session.Id);
        }

        // Mark SectionDraw snapshot as consumed while keeping the SectionDraw audit row; remove UndoSnapshot rows.
        if (targetChange.Kind == DrawChangeKind.SectionDraw)
            targetChange.ResultJson = "{}";
        else
            db.Set<DrawChange>().Remove(targetChange);
        await db.SaveChangesAsync(cancellationToken);

        var nextStatus = await GetStatusAsync(db, competitionId, cancellationToken);
        return (
            new DrawUndoResultDto(true, snapshot.Label, restoredSessions, restoredHeats, nextStatus),
            changedSessionIds);
    }

    public static DrawUndoStatusDto EmptyStatus() =>
        new(false, null, null, null, null, null, null, null, 0, 0);

    private static bool HasScoredResults(Heat heat) =>
        heat.StartedAt != null || heat.Races.Any(r => r.IsComplete || r.StartedAt != null || r.Results.Count > 0);

    private static DrawUndoSnapshot? TryParseSnapshot(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json == "{}") return null;
        try
        {
            return JsonSerializer.Deserialize<DrawUndoSnapshot>(json, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
