using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Seasons;

public static class SeasonStandingsCalculator
{
    public static async Task<SeasonStandingsDto?> CalculateAsync(AppDbContext db, Guid seasonId, CancellationToken ct, string? ageGroup = null, SectionFormat? format = null)
    {
        var season = await db.Set<Season>()
            .AsNoTracking()
            .Include(x => x.Rounds).ThenInclude(x => x.Competition)
            .Include(x => x.Rounds).ThenInclude(x => x.CompetitionSection)
            .Include(x => x.Rounds).ThenInclude(x => x.Publications).ThenInclude(x => x.Results).ThenInclude(x => x.TeamProfile)!.ThenInclude(x => x!.Club)
            .SingleOrDefaultAsync(x => x.Id == seasonId, ct);
        if (season is null) return null;

        var filterAge = ageGroup?.Trim();
        var hasAgeFilter = !string.IsNullOrWhiteSpace(filterAge)
            && !string.Equals(filterAge, "all", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(filterAge, "All age groups", StringComparison.OrdinalIgnoreCase);

        var includedRounds = season.Rounds.Where(x => x.IsIncluded);
        if (format.HasValue) includedRounds = includedRounds.Where(x => x.CompetitionSection?.Format == format);
        if (hasAgeFilter)
        {
            includedRounds = includedRounds.Where(x =>
                string.Equals(x.CompetitionSection?.AgeGroup?.Trim(), filterAge, StringComparison.OrdinalIgnoreCase)
                || string.Equals(x.CompetitionSection?.DisplayName?.Trim(), filterAge, StringComparison.OrdinalIgnoreCase));
        }

        var latest = includedRounds
            .Select(x => new { Round = x, Publication = x.Publications.MaxBy(p => p.Version) })
            .Where(x => x.Publication is not null)
            .SelectMany(x => x.Publication!.Results.Select(result => new ResultWithRound(x.Round, result)))
            .GroupBy(x => x.Result.TeamProfileId)
            .Select(group => BuildTeam(group.ToList(), season.BestResultsToCount))
            .OrderByDescending(x => x.TotalPoints)
            .ThenByDescending(x => CountRoundWins(x.Rounds))
            .ThenBy(x => x.TeamName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.TeamProfileId)
            .ToList();

        var initialOnly = await SeasonRiderPrivacy.InitialOnlyProfilesAsync(db, latest.Select(x => x.TeamProfileId), ct);
        latest = latest.Select(row => row with { TeamName = SeasonRiderPrivacy.Display(row.TeamProfileId, row.TeamName, initialOnly) }).ToList();

        (long TotalPoints, int Wins)? previous = null;
        var rank = 0;
        var standings = new List<SeasonStandingDto>();
        for (var index = 0; index < latest.Count; index++)
        {
            var row = latest[index];
            var currentKey = (row.TotalPoints, CountRoundWins(row.Rounds));
            if (previous != currentKey) rank = index + 1;
            previous = currentKey;
            standings.Add(row with { Rank = rank });
        }

        return new SeasonStandingsDto(
            season.Id, season.Title, season.Year, season.Format, season.AgeGroup,
            season.BestResultsToCount, standings);
    }

    private static int CountRoundWins(IReadOnlyList<SeasonStandingRoundDto> rounds)
        => rounds.Count(r => r.EventRank == 1);

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
                countedRoundIds.Contains(x.Round.Id),
                x.Round.CompetitionSection?.AgeGroup ?? string.Empty,
                x.Round.CompetitionSection?.DisplayName ?? string.Empty,
                x.Round.PointsMultiplier > 0 ? x.Round.PointsMultiplier : 1.0))
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
