using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

public record FinishingPlace(int TeamId, int Place, bool Eliminated);

public class ScoringService
{
    private readonly AppDbContext _db;

    public ScoringService(AppDbContext db) => _db = db;

    public async Task<int> GetSessionBaseAsync(int sessionId)
    {
        var sizes = await _db.Heats
            .Where(h => h.SessionId == sessionId)
            .Select(h => h.Entries.Count)
            .ToListAsync();
        return sizes.Count == 0 ? 0 : sizes.Max();
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
        string? recordedByUserId)
    {
        var race = await _db.Races
            .Include(r => r.Heat).ThenInclude(h => h!.Entries)
            .Include(r => r.Results)
            .FirstOrDefaultAsync(r => r.Id == raceId)
            ?? throw new InvalidOperationException("Race not found");

        var heat = race.Heat ?? throw new InvalidOperationException("Race has no heat");
        var sessionBase = await GetSessionBaseAsync(heat.SessionId);
        if (sessionBase < 1) sessionBase = heat.Entries.Count;

        _db.Results.RemoveRange(race.Results);

        var entryTeamIds = heat.Entries.Select(e => e.TeamId).ToHashSet();
        var now = DateTime.UtcNow;
        var fresh = new List<Result>();
        // Qualifier heats in race-finals format score 1 per finisher / 0 per
        // elimination, regardless of placing. The race final scores normally.
        var isQualifier = heat.RaceRoundStage == RaceRoundStage.Qualifier;

        foreach (var fp in finishingPlaces)
        {
            if (!entryTeamIds.Contains(fp.TeamId)) continue;
            var points = isQualifier
                ? (fp.Eliminated ? 0 : 1)
                : PointsForPlace(fp.Place, sessionBase, fp.Eliminated);
            fresh.Add(new Result
            {
                RaceId = raceId,
                TeamId = fp.TeamId,
                Placing = fp.Eliminated ? null : fp.Place,
                Eliminated = fp.Eliminated,
                Points = points,
                RecordedAt = now,
                RecordedByUserId = recordedByUserId
            });
        }

        await _db.Results.AddRangeAsync(fresh);
        race.IsComplete = true;
        race.FinishedAt = now;
        if (race.StartedAt is null) race.StartedAt = now;
        // Any pending steward calls for this race are resolved by the result —
        // wipe them so they don't reappear next time admin opens the race.
        var pending = await _db.StewardCalls.Where(c => c.RaceId == raceId).ToListAsync();
        if (pending.Count > 0) _db.StewardCalls.RemoveRange(pending);
        await _db.SaveChangesAsync();

        return fresh;
    }
}
