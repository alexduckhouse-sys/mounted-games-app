using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

public class ScoringServiceTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ScoringServiceTests(ApiFactory f) => _f = f;

    private ScoringService Service(IServiceScope scope) => scope.ServiceProvider.GetRequiredService<ScoringService>();

    [Theory]
    [InlineData(1, 5, false, 5)]
    [InlineData(2, 5, false, 4)]
    [InlineData(5, 5, false, 1)]
    [InlineData(6, 5, false, 0)]   // beyond the field
    [InlineData(0, 5, false, 0)]   // no place recorded
    [InlineData(-1, 5, false, 0)]
    [InlineData(1, 5, true, 0)]    // eliminated teams never score
    [InlineData(1, 0, false, 0)]   // empty session
    public void PointsForPlace_AwardsFieldSizeMinusPlacePlusOne(int place, int sessionBase, bool eliminated, int expected)
    {
        var svc = new ScoringService(null!);
        Assert.Equal(expected, svc.PointsForPlace(place, sessionBase, eliminated));
    }

    [Fact]
    public async Task GetSessionBase_IsZero_ForSessionWithoutHeats()
    {
        var a = await _f.CreateArenaAsync();
        using var scope = _f.Services.CreateScope();
        Assert.Equal(0, await Service(scope).GetSessionBaseAsync(a.SessionId));
    }

    [Fact]
    public async Task GetSessionBase_IsLargestHeat()
    {
        var a = await _f.CreateArenaAsync(5);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds.Take(2), "Small", 1);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Big", 2);
        using var scope = _f.Services.CreateScope();
        Assert.Equal(5, await Service(scope).GetSessionBaseAsync(a.SessionId));
    }

    [Fact]
    public async Task ApplyRaceResults_Throws_WhenRaceMissing()
    {
        using var scope = _f.Services.CreateScope();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Service(scope).ApplyRaceResultsAsync(999999, Array.Empty<FinishingPlace>(), null));
        Assert.Equal("Race not found", ex.Message);
    }

    [Fact]
    public async Task ApplyRaceResults_ScoresByPlace_AndRecordsUser()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[] { new FinishingPlace(a.TeamIds[1], 1, false), new FinishingPlace(a.TeamIds[0], 2, false), new FinishingPlace(a.TeamIds[2], 9, true) },
            "user-1");

        Assert.Equal(new[] { 3, 2, 0 }, fresh.Select(r => r.Points));
        Assert.All(fresh, r => Assert.Equal("user-1", r.RecordedByUserId));
        Assert.Null(fresh[2].Placing);
        Assert.True(fresh[2].Eliminated);
        var race = await _f.WithDbAsync(db => db.Races.SingleAsync(r => r.Id == races[0]));
        Assert.True(race.IsComplete);
    }

    [Fact]
    public async Task ApplyRaceResults_IgnoresTeamsNotInTheHeat()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds.Take(2));
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[] { new FinishingPlace(a.TeamIds[2], 1, false), new FinishingPlace(a.TeamIds[0], 2, false) }, null);

        Assert.Equal(a.TeamIds[0], Assert.Single(fresh).TeamId);
    }

    [Fact]
    public async Task ApplyRaceResults_WithNoPlaces_ClearsResultsButMarksComplete()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(races[0], new[] { new FinishingPlace(a.TeamIds[0], 1, false) }, null);

        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(races[0], Array.Empty<FinishingPlace>(), null);

        Assert.Empty(await _f.WithDbAsync(db => db.Results.Where(r => r.RaceId == races[0]).ToListAsync()));
        Assert.True((await _f.WithDbAsync(db => db.Races.SingleAsync(r => r.Id == races[0]))).IsComplete);
    }

    [Fact]
    public async Task ApplyRaceResults_UsesHeatSize_WhenSessionBaseIsZero()
    {
        // Only possible when the race's own heat has no entries: nothing can score, but it must not throw.
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, Array.Empty<int>());
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0], new[] { new FinishingPlace(a.TeamIds[0], 1, false) }, null);

        Assert.Empty(fresh);
    }

    [Fact]
    public async Task ApplyRaceResults_QualifierHeat_ScoresOnePerFinisher_RegardlessOfPlace()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Q", 1, stage: RaceRoundStage.Qualifier, roundId: 1);
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[]
            {
                new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 4, false),
                new FinishingPlace(a.TeamIds[2], 2, true),
            }, null);

        Assert.Equal(new[] { 1, 1, 0 }, fresh.Select(r => r.Points));
    }

    [Fact]
    public async Task ApplyRaceResults_FinalHeat_ScoresNormally()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Final", 1, stage: RaceRoundStage.Final, roundId: 1);
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[] { new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 2, false) }, null);

        Assert.Equal(new[] { 4, 3 }, fresh.Select(r => r.Points));
    }

    [Fact]
    public async Task ApplyRaceResults_KeepsExistingClockTimes()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var started = DateTime.UtcNow.AddMinutes(-5);
        var finished = DateTime.UtcNow.AddMinutes(-4);
        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.SingleAsync(r => r.Id == races[0]);
            race.StartedAt = started;
            race.FinishedAt = finished;
            await db.SaveChangesAsync();
        });
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(races[0], new[] { new FinishingPlace(a.TeamIds[0], 1, false) }, null);

        var race2 = await _f.WithDbAsync(db => db.Races.SingleAsync(r => r.Id == races[0]));
        Assert.Equal(started, race2.StartedAt);
        Assert.Equal(finished, race2.FinishedAt);
    }

    [Fact]
    public async Task ApplyRaceResults_StampsClockTimes_WhenNoneRecorded()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(races[0], new[] { new FinishingPlace(a.TeamIds[0], 1, false) }, null);

        var race = await _f.WithDbAsync(db => db.Races.SingleAsync(r => r.Id == races[0]));
        Assert.NotNull(race.StartedAt);
        Assert.NotNull(race.FinishedAt);
    }
}
