using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

public class ExplicitRaceTimingTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task FirstFlagDownReplacesLegacyInference_AndDoubleTapKeepsFirstTime()
    {
        var arena = await factory.CreateArenaAsync(2);
        var (_, races) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        var old = DateTime.UtcNow.AddMinutes(-15);
        await factory.WithDbAsync(async db => { (await db.Races.FindAsync(races[0]))!.StartedAt = old; await db.SaveChangesAsync(); });
        var client = await factory.AdminAsync();
        var tapped = old.AddMinutes(3);
        var first = await (await client.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(tapped))).ReadAsync<RaceDto>();
        var repeated = await (await client.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(tapped.AddMinutes(1)))).ReadAsync<RaceDto>();
        Assert.True(first.StartIsExplicit);
        Assert.Equal(tapped, first.StartedAt);
        Assert.Equal(tapped, repeated.StartedAt);
    }

    [Fact]
    public async Task OfflineScoreKeepsTapTime_AndLateStartCannotReopenCompletedScores()
    {
        var arena = await factory.CreateArenaAsync(2);
        var (_, races) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        var client = await factory.AdminAsync();
        var start = DateTime.UtcNow.AddMinutes(-40);
        var finish = start.AddMinutes(3);
        (await client.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(start))).EnsureSuccessStatusCode();
        var response = await client.PostAsJsonAsync($"/api/races/{races[0]}/results", new SubmitRaceResultsRequest(
            [new(arena.TeamIds[0], 1, false), new(arena.TeamIds[1], 2, false)], FinishedAt: finish));
        response.EnsureSuccessStatusCode();
        var retried = await (await client.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(start))).ReadAsync<RaceDto>();
        Assert.Equal(start, retried.StartedAt);
        Assert.Equal(finish, retried.FinishedAt);
        Assert.True(retried.IsComplete);
        Assert.Equal(2, retried.Results.Count);
        await factory.WithDbAsync(async db => Assert.Null((await db.Races.FindAsync(races[1]))!.StartedAt));
    }

    [Fact]
    public async Task FinishBeforeStartIsRejectedWithoutSavingScores()
    {
        var arena = await factory.CreateArenaAsync(2);
        var (_, races) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        var client = await factory.AdminAsync();
        var start = DateTime.UtcNow.AddMinutes(-2);
        (await client.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(start))).EnsureSuccessStatusCode();
        var response = await client.PostAsJsonAsync($"/api/races/{races[0]}/results", new SubmitRaceResultsRequest(
            [new(arena.TeamIds[0], 1, false)], FinishedAt: start.AddSeconds(-1)));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await factory.WithDbAsync(async db => Assert.False(await db.Results.AnyAsync(r => r.RaceId == races[0])));
    }
    [Fact]
    public async Task OvernightTapIsRetained_ButOutsideEventOrSevenDayWindowIsRejected()
    {
        var arena = await factory.CreateArenaAsync(2);
        var (_, races) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 3);
        await factory.WithDbAsync(async db => {
            var competition = (await db.Competitions.FindAsync(arena.CompetitionId))!;
            competition.StartDate = DateTime.UtcNow.Date.AddDays(-3);
            competition.EndDate = DateTime.UtcNow.Date;
            await db.SaveChangesAsync();
        });
        var client = await factory.AdminAsync();
        var overnight = DateTime.UtcNow.AddDays(-1);
        var saved = await (await client.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(overnight))).ReadAsync<RaceDto>();
        Assert.Equal(overnight, saved.StartedAt);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/races/{races[1]}/start", new RaceClockRequest(DateTime.UtcNow.AddDays(-5)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/races/{races[2]}/start", new RaceClockRequest(DateTime.UtcNow.AddDays(-8)))).StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OfflineScoresUploadedInReverseOrder_KeepEarliestStartAndLatestFinish(bool separateHeats)
    {
        var arena = await factory.CreateArenaAsync(2);
        var (firstHeatId, firstRaces) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: separateHeats ? 1 : 2);
        var secondHeatId = firstHeatId;
        var secondRaceId = separateHeats ? 0 : firstRaces[1];
        if (separateHeats)
        {
            var (heatId, races) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds, "Heat 2", 2, 1);
            secondHeatId = heatId;
            secondRaceId = races[0];
        }
        var client = await factory.AdminAsync();
        var firstStart = DateTime.UtcNow.AddMinutes(-30);
        var firstFinish = firstStart.AddMinutes(5);
        var secondStart = firstStart.AddMinutes(7);
        var secondFinish = firstStart.AddMinutes(10);
        var places = new FinishingPlaceDto[] { new(arena.TeamIds[0], 1, false), new(arena.TeamIds[1], 2, false) };

        // R2 finishes at 10:10, but its upload arrives before R1's 10:05 finish.
        (await client.PostAsJsonAsync($"/api/races/{secondRaceId}/start", new RaceClockRequest(secondStart))).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync($"/api/races/{secondRaceId}/results", new SubmitRaceResultsRequest(places, FinishedAt: secondFinish))).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync($"/api/races/{firstRaces[0]}/start", new RaceClockRequest(firstStart))).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync($"/api/races/{firstRaces[0]}/results", new SubmitRaceResultsRequest(places, FinishedAt: firstFinish))).EnsureSuccessStatusCode();

        await factory.WithDbAsync(async db => {
            var firstHeat = (await db.Heats.FindAsync(firstHeatId))!;
            var secondHeat = (await db.Heats.FindAsync(secondHeatId))!;
            var session = (await db.Sessions.FindAsync(arena.SessionId))!;
            Assert.Equal(firstStart, firstHeat.StartedAt);
            Assert.Equal(separateHeats ? firstFinish : secondFinish, firstHeat.FinishedAt);
            Assert.Equal(secondFinish, secondHeat.FinishedAt);
            Assert.Equal(firstStart, session.StartedAt);
            Assert.Equal(secondFinish, session.FinishedAt);
            Assert.Equal(firstStart, (await db.Races.FindAsync(firstRaces[0]))!.StartedAt);
            Assert.Equal(secondStart, (await db.Races.FindAsync(secondRaceId))!.StartedAt);
        });
    }

}
