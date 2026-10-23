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
            await Service(scope).ApplyRaceResultsAsync(
                races[0], Array.Empty<FinishingPlace>(), null, "Results withdrawn after review");

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
    public async Task ApplyRaceResults_FinalHeat_IsScoredOnItsOwnFieldPlusOne()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Final", 1, stage: RaceRoundStage.Final, roundId: 1);
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[] { new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 2, false) }, null);

        // A final is scored on its own field of four: 5 for the win, down to 2 for last (one more than a qualifier's 1).
        Assert.Equal(new[] { 5, 4 }, fresh.Select(r => r.Points));
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

    [Fact]
    public async Task ApplyRaceResults_TransitionsSessionToInArena_AndFinishedWhenAllRacesComplete()
    {
        var a = await _f.CreateArenaAsync(2);
        var (heatId, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, raceCount: 2);
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(races[0],
            new[] { new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 2, false) }, null);

        var midSession = await _f.WithDbAsync(db => db.Sessions.SingleAsync(s => s.Id == a.SessionId));
        var midHeat = await _f.WithDbAsync(db => db.Heats.SingleAsync(h => h.Id == heatId));
        Assert.Equal(SessionStatus.InArena, midSession.Status);
        Assert.NotNull(midSession.StartedAt);
        Assert.NotNull(midHeat.StartedAt);
        Assert.Null(midHeat.FinishedAt);

        await Service(scope).ApplyRaceResultsAsync(races[1],
            new[] { new FinishingPlace(a.TeamIds[1], 1, false), new FinishingPlace(a.TeamIds[0], 2, false) }, null);

        var endSession = await _f.WithDbAsync(db => db.Sessions.SingleAsync(s => s.Id == a.SessionId));
        var endHeat = await _f.WithDbAsync(db => db.Heats.SingleAsync(h => h.Id == heatId));
        Assert.Equal(SessionStatus.Finished, endSession.Status);
        Assert.NotNull(endSession.FinishedAt);
        Assert.NotNull(endHeat.FinishedAt);
    }

    [Fact]
    public async Task ApplyRaceResults_AutoPopulatesFinalHeat_WhenBothQualifiersComplete()
    {
        var a = await _f.CreateArenaAsync(6, raceFinals: true);
        var (_, q1Races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds[..3], "Q1", 1, stage: RaceRoundStage.Qualifier, roundId: 1);
        var (_, q2Races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds[3..], "Q2", 2, stage: RaceRoundStage.Qualifier, roundId: 1);
        var (finalHeatId, _) = await _f.AddHeatAsync(a.SessionId, Array.Empty<int>(), "Final", 3, stage: RaceRoundStage.Final, roundId: 1);
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(q1Races[0],
            new[] { new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 2, false), new FinishingPlace(a.TeamIds[2], 3, false) }, null);
        await Service(scope).ApplyRaceResultsAsync(q2Races[0],
            new[] { new FinishingPlace(a.TeamIds[3], 1, false), new FinishingPlace(a.TeamIds[4], 2, false), new FinishingPlace(a.TeamIds[5], 3, false) }, null);

        var finalEntries = await _f.WithDbAsync(db => db.HeatEntries
            .Where(e => e.HeatId == finalHeatId)
            .OrderBy(e => e.LaneIndex)
            .Select(e => e.TeamId)
            .ToListAsync());
        Assert.Equal(new[] { a.TeamIds[0], a.TeamIds[3], a.TeamIds[1], a.TeamIds[4], a.TeamIds[2], a.TeamIds[5] }, finalEntries);
    }

    [Fact]
    public async Task ApplyRaceResults_HorsConcoursScoresZero_AndCompactsCompetitivePlacings()
    {
        var a = await _f.CreateArenaAsync(3);
        await _f.WithDbAsync(async db =>
        {
            (await db.Teams.SingleAsync(t => t.Id == a.TeamIds[0])).IsHorsConcours = true;
            await db.SaveChangesAsync();
        });
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();

        // Team 0 (HC) finishes 1st physically, Team 1 finishes 2nd, Team 2 finishes 3rd.
        var results = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[]
            {
                new FinishingPlace(a.TeamIds[0], 1, false),
                new FinishingPlace(a.TeamIds[1], 2, false),
                new FinishingPlace(a.TeamIds[2], 3, false),
            }, null);

        var byTeam = results.ToDictionary(r => r.TeamId, r => r.Points);
        Assert.Equal(0, byTeam[a.TeamIds[0]]);
        Assert.Equal(3, byTeam[a.TeamIds[1]]);
        Assert.Equal(2, byTeam[a.TeamIds[2]]);
    }

    [Fact]
    public async Task OverrideRacePoints_AndAdjustTeamPoints_ApplyCustomAndDeltaPoints()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();
        var svc = Service(scope);

        await svc.ApplyRaceResultsAsync(races[0],
            new[]
            {
                new FinishingPlace(a.TeamIds[0], 1, false),
                new FinishingPlace(a.TeamIds[1], 2, false),
                new FinishingPlace(a.TeamIds[2], 3, false),
            }, null);

        var overridden = await svc.OverrideRacePointsAsync(races[0], a.TeamIds[1], 10, "Combined heat bonus", null);
        Assert.Equal(10, overridden.Results.Single(r => r.TeamId == a.TeamIds[1]).Points);

        var adjusted = await svc.AdjustTeamPointsAsync(races[0], a.TeamIds[0], -2, "Jury penalty", null);
        Assert.Equal(1, adjusted.Results.Single(r => r.TeamId == a.TeamIds[0]).Points);
    }
}
