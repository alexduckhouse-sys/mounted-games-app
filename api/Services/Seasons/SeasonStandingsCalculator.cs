using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Services.Seasons;

public static class SeasonStandingsCalculator
{
    public static async Task<SeasonStandingsDto?> CalculateAsync(AppDbContext db, Guid seasonId, CancellationToken ct)
    {
        var season = await db.Set<Season>()
            .AsNoTracking()
            .Include(x => x.Rounds).ThenInclude(x => x.Competition)
            .Include(x => x.Rounds).ThenInclude(x => x.Publications).ThenInclude(x => x.Results).ThenInclude(x => x.TeamProfile)!.ThenInclude(x => x!.Club)
            .SingleOrDefaultAsync(x => x.Id == seasonId, ct);
        if (season is null) return null;

        var latest = season.Rounds
            .Where(x => x.IsIncluded)
            .Select(x => new { Round = x, Publication = x.Publications.MaxBy(p => p.Version) })
            .Where(x => x.Publication is not null)
            .SelectMany(x => x.Publication!.Results.Select(result => new ResultWithRound(x.Round, result)))
            .GroupBy(x => x.Result.TeamProfileId)
            .Select(group => BuildTeam(group.ToList(), season.BestResultsToCount))
            .OrderByDescending(x => x.TotalPoints)
            .ThenBy(x => x.TeamName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.TeamProfileId)
            .ToList();

        long? previousPoints = null;
        var rank = 0;
        var standings = new List<SeasonStandingDto>();
        for (var index = 0; index < latest.Count; index++)
        {
            var row = latest[index];
            if (previousPoints != row.TotalPoints) rank = index + 1;
            previousPoints = row.TotalPoints;
            standings.Add(row with { Rank = rank });
        }

        return new SeasonStandingsDto(
            season.Id, season.Title, season.Year, season.Format, season.AgeGroup,
            season.BestResultsToCount, standings);
    }

    private static SeasonStandingDto BuildTeam(IReadOnlyList<ResultWithRound> entries, int? bestResultsToCount)
    {
        var count = bestResultsToCount ?? entries.Count;
        var countedRoundIds = entries
            .OrderByDescending(x => x.Result.SeasonPoints)
            .ThenBy(x => x.Round.OrderIndex)
            .ThenBy(x => x.Round.Id)
            .Take(count)
            .Select(x => x.Round.Id)
            .ToHashSet();
        var first = entries[0].Result;
        var rounds = entries
            .OrderBy(x => x.Round.OrderIndex)
            .ThenBy(x => x.Round.Id)
            .Select(x => new SeasonStandingRoundDto(
                x.Round.Id,
                x.Round.Competition?.Name ?? string.Empty,
                x.Round.Competition?.StartDate ?? default,
                x.Result.EventRank,
                x.Result.SeasonPoints,
                countedRoundIds.Contains(x.Round.Id)))
            .ToArray();
        return new SeasonStandingDto(
            0,
            first.TeamProfileId,
            first.TeamProfile?.DisplayName ?? first.TeamName,
            first.TeamProfile?.Club?.Name ?? first.ClubName,
            rounds.Where(x => x.Counted).Sum(x => (long)x.SeasonPoints),
            rounds);
    }

    private sealed record ResultWithRound(SeasonRound Round, SeasonRoundResult Result);
}
