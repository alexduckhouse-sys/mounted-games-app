using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

public class LaneRotationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public LaneRotationTests(ApiFactory f) => _f = f;

    // ---- the lane maths ----

    [Theory]
    [InlineData(LaneRotationMode.MoveUp, 1, 0, 6, 1)]
    [InlineData(LaneRotationMode.MoveUp, 1, 1, 6, 2)]
    [InlineData(LaneRotationMode.MoveUp, 6, 1, 6, 1)]   // wraps round
    [InlineData(LaneRotationMode.MoveDown, 1, 1, 6, 6)] // wraps the other way
    [InlineData(LaneRotationMode.MoveDown, 4, 2, 6, 2)]
    [InlineData(LaneRotationMode.Stay, 3, 5, 6, 3)]
    public void PositionFor_ShiftsByTheModeAndWraps(LaneRotationMode mode, int drawn, int race, int teams, int expected)
        => Assert.Equal(expected, LaneRotation.PositionFor(drawn, race, teams, mode));

    [Fact]
    public void PositionFor_ReturnsTheDrawnLane_ForAnEmptyHeat() => Assert.Equal(3, LaneRotation.PositionFor(3, 2, 0, LaneRotationMode.MoveUp));

    [Theory]
    [InlineData(7, 6, 6)]
    [InlineData(4, 6, 4)]
    [InlineData(5, null, 5)]
    [InlineData(0, null, 1)]
    public void LanesInUse_IsTheLaneLimitOrTheNumberOfTeams(int teams, int? lanes, int expected)
        => Assert.Equal(expected, LaneRotation.LanesInUse(teams, lanes));

    [Fact]
    public void WithSevenTeamsInSixLanes_EachTeamSitsOutExactlyOneOfSevenRaces()
    {
        foreach (var mode in new[] { LaneRotationMode.MoveUp, LaneRotationMode.MoveDown })
            for (var team = 1; team <= 7; team++)
            {
                var sitOuts = Enumerable.Range(0, 7).Count(race => LaneRotation.SitsOut(team, race, 7, 6, mode));
                Assert.Equal(1, sitOuts);
            }
    }

    [Fact]
    public void WhenEveryoneHasALane_NobodySitsOut()
        => Assert.False(Enumerable.Range(1, 6).Any(team => LaneRotation.SitsOut(team, 3, 6, 6, LaneRotationMode.MoveUp)));

    // ---- scoring a heat with a team sitting out ----

    private async Task<(int[] Teams, int[] Races, int SessionId)> HeatAsync(LaneRotationMode mode = LaneRotationMode.MoveUp)
    {
        var a = await _f.CreateArenaAsync(4);
        await _f.WithDbAsync(async db =>
        {
            var s = await db.Sessions.SingleAsync(x => x.Id == a.SessionId);
            s.LanesPerHeat = 3;
            s.LaneRotationMode = mode;
            await db.SaveChangesAsync();
        });
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, raceCount: 2);
        return (a.TeamIds, races, a.SessionId);
    }

    private static string Url(int raceId) => $"/api/races/{raceId}/score";

    [Fact]
    public async Task SessionBase_IsTheLanesRaced_NotTheTeamsDrawn()
    {
        var (_, _, sessionId) = await HeatAsync();
        using var scope = _f.Services.CreateScope();
        Assert.Equal(3, await scope.ServiceProvider.GetRequiredService<ScoringService>().GetSessionBaseAsync(sessionId));
    }

    [Fact]
    public async Task ScoringATeamSittingOut_RecordsAnSOnZeroPoints_AndScoresTheRestOutOfTheLanesRaced()
    {
        var (teams, races, _) = await HeatAsync();
        var admin = await _f.AdminAsync();
        // Race 1 (index 0): positions 1 to 3 race, so the team drawn in lane 4 (teams[3]) sits out.
        var request = new UpdateRaceScoreRequest(
            [new(teams[0], 1, false), new(teams[1], 2, false), new(teams[2], 3, false), new(teams[3], 0, false)], 0, "r1", null);

        var response = await admin.PutAsJsonAsync(Url(races[0]), request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var saved = await response.ReadAsync<RaceScoreDto>();
        Assert.Equal(new[] { 3, 2, 1, 0 }, saved.Results.OrderBy(r => r.IsSitOut).ThenBy(r => r.Place).Select(r => r.Points));
        var sitter = saved.Results.Single(r => r.TeamId == teams[3]);
        Assert.True(sitter.IsSitOut);
        Assert.False(sitter.Eliminated);
        var stored = await _f.WithDbAsync(db => db.Results.SingleAsync(r => r.RaceId == races[0] && r.TeamId == teams[3]));
        Assert.Null(stored.Placing);
        Assert.True(stored.IsSitOut);
    }

    [Fact]
    public async Task ASittingOutTeam_IsFixedByTheServer_WhateverWasSent()
    {
        var (teams, races, _) = await HeatAsync();
        var admin = await _f.AdminAsync();
        // The client claims the sitting-out team came first and the others 2nd to 4th: the server knows better.
        var request = new UpdateRaceScoreRequest(
            [new(teams[0], 1, false), new(teams[1], 2, false), new(teams[2], 3, false), new(teams[3], 1, true)], 0, "r1", null);

        var saved = await (await admin.PutAsJsonAsync(Url(races[0]), request)).ReadAsync<RaceScoreDto>();

        Assert.True(saved.Results.Single(r => r.TeamId == teams[3]).IsSitOut);
        Assert.Equal(0, saved.Results.Single(r => r.TeamId == teams[3]).Points);
        Assert.False(saved.Results.Single(r => r.TeamId == teams[3]).Eliminated);
    }

    [Fact]
    public async Task TheSittingOutTeamMovesOn_WhenTheTeamsChangeLane()
    {
        var (teams, races, _) = await HeatAsync();
        var admin = await _f.AdminAsync();
        // Race 2 (index 1): everyone moves up a lane, so lane 3 (teams[2]) now has the position past the last lane.
        var request = new UpdateRaceScoreRequest(
            [new(teams[0], 1, false), new(teams[1], 2, false), new(teams[2], 0, false), new(teams[3], 3, false)], 0, "r2", null);

        var saved = await (await admin.PutAsJsonAsync(Url(races[1]), request)).ReadAsync<RaceScoreDto>();

        Assert.Equal(new[] { teams[2] }, saved.Results.Where(r => r.IsSitOut).Select(r => r.TeamId));
    }

    [Fact]
    public async Task StayingInLane_DoesNotMoveTheSittingOutTeam_BetweenRaces()
    {
        var (teams, races, _) = await HeatAsync(LaneRotationMode.Stay);
        var admin = await _f.AdminAsync();
        var request = new UpdateRaceScoreRequest(
            [new(teams[0], 1, false), new(teams[1], 2, false), new(teams[2], 3, false), new(teams[3], 0, false)], 0, "r2", null);

        var saved = await (await admin.PutAsJsonAsync(Url(races[1]), request)).ReadAsync<RaceScoreDto>();

        Assert.Equal(new[] { teams[3] }, saved.Results.Where(r => r.IsSitOut).Select(r => r.TeamId));
    }

    [Fact]
    public async Task PlacesAboveTheLanesRaced_AreRefused()
    {
        var (teams, races, _) = await HeatAsync();
        var admin = await _f.AdminAsync();
        var request = new UpdateRaceScoreRequest(
            [new(teams[0], 1, false), new(teams[1], 2, false), new(teams[2], 4, false), new(teams[3], 0, false)], 0, "bad", null);

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(Url(races[0]), request)).StatusCode);
    }

    [Fact]
    public async Task ARacingTeamWithoutAPlace_IsStillRefused()
    {
        var (teams, races, _) = await HeatAsync();
        var admin = await _f.AdminAsync();
        var request = new UpdateRaceScoreRequest(
            [new(teams[0], 1, false), new(teams[1], 2, false), new(teams[2], 0, false), new(teams[3], 0, false)], 0, "bad", null);

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(Url(races[0]), request)).StatusCode);
    }

    // ---- settings ----

    [Fact]
    public async Task SessionSettings_ChooseTheRotation_AndTheDefaultIsMovingUp()
    {
        var a = await _f.CreateArenaAsync(2);
        var admin = await _f.AdminAsync();
        var url = $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}/settings";

        var before = await _f.WithDbAsync(db => db.Sessions.Where(s => s.Id == a.SessionId).Select(s => s.LaneRotationMode).SingleAsync());
        var updated = await (await admin.PutAsJsonAsync(url, new UpdateSessionSettingsRequest(null, null, LaneRotationMode.MoveDown))).ReadAsync<SessionDto>();
        var bad = await admin.PutAsJsonAsync(url, new { laneRotationMode = 99 });

        Assert.Equal(LaneRotationMode.MoveUp, before);
        Assert.Equal(LaneRotationMode.MoveDown, updated.LaneRotationMode);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task StayInLane_IsRefused_WhenAHeatHasMoreTeamsThanLanes()
    {
        var (_, _, sessionId) = await HeatAsync();
        var competitionId = await _f.WithDbAsync(db => db.Sessions.Where(s => s.Id == sessionId).Select(s => s.CompetitionId).SingleAsync());
        var admin = await _f.AdminAsync();

        var r = await admin.PutAsJsonAsync($"/api/competitions/{competitionId}/sessions/{sessionId}/settings",
            new UpdateSessionSettingsRequest(null, null, LaneRotationMode.Stay));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }
}
