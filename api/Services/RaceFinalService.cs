using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// Heat-heat-final: two qualifier heats feed a final. The top finishers of each qualifier are
/// interleaved (Q1 first, Q2 first, Q1 second, ...) into the final's lanes.
/// </summary>
public sealed class RaceFinalService(AppDbContext db, PushNotifier? push = null)
{
    /// <summary>How many teams go through from each qualifier when the session doesn't say.</summary>
    public const int DefaultQualifiers = 3;

    /// <summary>
    /// Fills <paramref name="finalHeat"/> (loaded with its session and entries) from its round's qualifiers.
    /// Returns an error message, or null when the final was filled.
    /// </summary>
    public async Task<string?> PopulateAsync(Heat finalHeat, int topN, CancellationToken ct = default)
    {
        if (finalHeat.RaceRoundStage != RaceRoundStage.Final || finalHeat.RaceRoundId is null)
            return "This heat isn't a race-final scaffold.";
        if (topN < 1) return "TopN must be at least 1.";

        var siblings = await db.Heats
            .Include(h => h.Races).ThenInclude(r => r.Results)
            .Where(h => h.SessionId == finalHeat.SessionId
                && h.RaceRoundId == finalHeat.RaceRoundId
                && h.RaceRoundStage == RaceRoundStage.Qualifier)
            .OrderBy(h => h.OrderIndex)
            .ToListAsync(ct);
        if (siblings.Count < 2) return "Both qualifier heats must exist before populating the final.";

        // A team that has since withdrawn, or is hors concours, keeps its result but doesn't go through to the final.
        var resultTeamIds = siblings.SelectMany(h => h.Races).SelectMany(r => r.Results).Select(r => r.TeamId).Distinct().ToList();
        var outIds = (await db.Teams
            .Where(t => resultTeamIds.Contains(t.Id) && (t.EntryStatus != TeamEntryStatus.Active || t.IsHorsConcours))
            .Select(t => t.Id).ToListAsync(ct)).ToHashSet();

        int?[] TopPlacings(Heat h) => h.Races
            .SelectMany(r => r.Results)
            .Where(r => !r.Eliminated && r.Placing.HasValue && !outIds.Contains(r.TeamId))
            .OrderBy(r => r.Placing!.Value)
            .Take(topN)
            .Select(r => (int?)r.TeamId)
            .ToArray();

        var q1Top = TopPlacings(siblings[0]);
        var q2Top = TopPlacings(siblings[1]);
        if (q1Top.Length == 0 && q2Top.Length == 0) return "No qualifier results recorded yet.";

        // Interleave: Q1[1], Q2[1], Q1[2], Q2[2], ... up to LanesPerHeat lanes.
        var lanes = finalHeat.Session?.LanesPerHeat ?? (q1Top.Length + q2Top.Length);
        var interleaved = new List<int>();
        for (var i = 0; i < topN && interleaved.Count < lanes; i++)
        {
            if (i < q1Top.Length && q1Top[i].HasValue && interleaved.Count < lanes)
                interleaved.Add(q1Top[i]!.Value);
            if (i < q2Top.Length && q2Top[i].HasValue && interleaved.Count < lanes)
                interleaved.Add(q2Top[i]!.Value);
        }

        db.HeatEntries.RemoveRange(finalHeat.Entries);
        await db.SaveChangesAsync(ct);
        var lane = 1;
        foreach (var teamId in interleaved)
            db.HeatEntries.Add(new HeatEntry { HeatId = finalHeat.Id, TeamId = teamId, LaneIndex = lane++ });
        await db.SaveChangesAsync(ct);

        if (push is not null && db.Database.CurrentTransaction is null)
            await NotifyDrawAsync(finalHeat.Id, ct);
        return null;
    }

    /// <summary>Deliver only after the final entries and their triggering score have committed.</summary>
    public async Task NotifyDrawAsync(int finalHeatId, CancellationToken ct = default)
    {
        if (push is null) return;
        try
        {
            var final = await db.Heats.AsNoTracking().Include(h => h.Session)
                .Include(h => h.Entries).ThenInclude(e => e.Team).SingleAsync(h => h.Id == finalHeatId, ct);
            var heatLabel = !string.IsNullOrWhiteSpace(final.Label) ? final.Label : $"Heat {final.OrderIndex}";
            var messages = final.Entries.Select(entry => (entry.TeamId, new PushPayload(
                Title: "Finals draw published",
                Body: $"You are in the {heatLabel}, Lane {entry.LaneIndex} ({entry.Team?.DisplayName ?? "Unnamed team"})",
                Tag: $"finals-draw:{final.Id}:{entry.TeamId}",
                Url: $"/competitions/{final.Session!.CompetitionId}")));
            await push.NotifyPerTeamAsync(messages, ct);
        }
        catch
        {
            // Delivery failure must not turn a committed score or draw into a failed save.
        }
    }

    /// <summary>
    /// After a qualifier race is scored: once both qualifiers of the round are complete, fill the round's
    /// final from them (using the session's qualifier count). Leaves a final that already has results
    /// alone. Returns the final heat id when the final was filled, otherwise null.
    /// </summary>
    public async Task<int?> TryAutoPopulateAsync(int raceId, CancellationToken ct = default)
    {
        var heat = await db.Heats.Include(h => h.Session).FirstOrDefaultAsync(h => h.Races.Any(r => r.Id == raceId), ct);
        if (heat is null || heat.RaceRoundStage != RaceRoundStage.Qualifier || heat.RaceRoundId is null) return null;

        var round = await db.Heats
            .Include(h => h.Session).Include(h => h.Entries).Include(h => h.Races)
            .Where(h => h.SessionId == heat.SessionId && h.RaceRoundId == heat.RaceRoundId)
            .ToListAsync(ct);
        var qualifiers = round.Where(h => h.RaceRoundStage == RaceRoundStage.Qualifier).ToList();
        var final = round.FirstOrDefault(h => h.RaceRoundStage == RaceRoundStage.Final);
        if (final is null || qualifiers.Count < 2) return null;
        if (qualifiers.Any(q => q.Races.Count == 0 || q.Races.Any(r => !r.IsComplete))) return null;
        if (final.Races.Any(r => r.IsComplete)) return null;

        var error = await PopulateAsync(final, heat.Session?.QualifiersPerHeat ?? DefaultQualifiers, ct);
        return error is null ? final.Id : null;
    }
}
