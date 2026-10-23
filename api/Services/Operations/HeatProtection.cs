using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services.Operations;

public sealed class EntryValidationException(string message) : InvalidOperationException(message);

/// <summary>
/// Which heats a withdrawal or re-draw may touch. A heat is protected, and never changed, once it has been
/// started or finished, any of its races has saved results or is marked complete, any race is signed off, or
/// its session has finished. Everything else is "unscored".
/// </summary>
public static class HeatProtection
{
    /// <summary>Of these races, the ones whose results are signed off.</summary>
    public static async Task<HashSet<int>> SignedOffRaceIdsAsync(
        AppDbContext db, IEnumerable<int> raceIds, CancellationToken ct = default)
    {
        var ids = raceIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        return (await db.Set<RaceScoreState>().AsNoTracking()
            .Where(s => s.IsSignedOff && ids.Contains(s.RaceId))
            .Select(s => s.RaceId)
            .ToListAsync(ct)).ToHashSet();
    }

    /// <summary>The heat must have its <c>Races</c> (with <c>Results</c>) loaded.</summary>
    public static bool IsProtected(Heat heat, Session session, IReadOnlySet<int> signedOffRaceIds)
        => session.Status == SessionStatus.Finished
            || session.FinishedAt is not null
            || heat.StartedAt is not null
            || heat.FinishedAt is not null
            || heat.Races.Any(r => r.IsComplete
                || r.StartedAt is not null
                || r.FinishedAt is not null
                || r.Results.Count > 0
                || signedOffRaceIds.Contains(r.Id));
}
