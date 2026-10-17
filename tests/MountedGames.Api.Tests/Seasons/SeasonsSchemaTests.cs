using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Seasons;

public class SeasonsSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public SeasonsSchemaTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task ExistingSqliteDatabaseGainsSeasonsAndPreservesPublishedHistoryOnRestart()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var team = await db.Teams.AsNoTracking().FirstAsync();
        var userId = await db.Users.Select(x => x.Id).FirstAsync();
        var results = await db.Results.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Points }).ToListAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE SeasonRoundResult; DROP TABLE SeasonRoundPublication; DROP TABLE SeasonRound; DROP TABLE SeasonPlacePoints; DROP TABLE Season; DROP TABLE EventTeamProfileLink; DROP TABLE TeamProfile;");

        await DbInitializer.SeedAsync(_factory.Services);
        var profile = new TeamProfile { OwnerUserId = userId, ClubId = team.ClubId, Suffix = team.Suffix, DisplayName = "Synthetic stable team" };
        db.Add(new EventTeamProfileLink { TeamProfile = profile, TeamId = team.Id, CompetitionId = team.CompetitionId, LinkedByUserId = userId });
        var season = new Season { OwnerUserId = userId, Title = "Synthetic season", Year = 2030,
            AgeGroup = "Synthetic", BestResultsToCount = 1, PlacePoints = [new SeasonPlacePoints { Place = 1, Points = 20 }] };
        var round = new SeasonRound { Season = season, CompetitionId = team.CompetitionId, CompetitionSectionId = team.CompetitionSectionId, OrderIndex = 1 };
        var publication = new SeasonRoundPublication { SeasonRound = round, Version = 1, PublishedByUserId = userId, SourceFingerprint = "synthetic-version-one",
            Results = [new SeasonRoundResult { TeamProfile = profile, EventTeamId = team.Id, TeamName = "Name at publication", ClubName = "Synthetic club", EventRank = 1, EventPoints = 42, SeasonPoints = 20 }] };
        db.Add(publication);
        await db.SaveChangesAsync();
        await DbInitializer.SeedAsync(_factory.Services);
        db.ChangeTracker.Clear();

        Assert.Equal(1, (await db.Set<Season>().SingleAsync()).BestResultsToCount);
        Assert.Equal(20, (await db.Set<SeasonPlacePoints>().SingleAsync()).Points);
        Assert.True((await db.Set<SeasonRound>().SingleAsync()).IsIncluded);
        Assert.Equal(1, (await db.Set<SeasonRoundPublication>().SingleAsync()).Version);
        var savedResult = await db.Set<SeasonRoundResult>().SingleAsync();
        Assert.True(savedResult.Id > 0);
        Assert.Equal("Name at publication", savedResult.TeamName);
        Assert.Equal(20, savedResult.SeasonPoints);
        Assert.Equal(profile.Id, (await db.Set<EventTeamProfileLink>().SingleAsync()).TeamProfileId);
        Assert.Equal("Synthetic stable team", (await db.Set<TeamProfile>().SingleAsync()).DisplayName);
        Assert.Equal(results, await db.Results.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Points }).ToListAsync());
    }
}
