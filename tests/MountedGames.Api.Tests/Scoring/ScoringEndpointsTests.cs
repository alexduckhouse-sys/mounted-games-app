using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

public class ScoringEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ScoringEndpointsTests(ApiFactory f) => _f = f;

    private static FinishingPlaceDto P(int team, int place, bool elim = false) => new(team, place, elim);

    private static async Task<HttpResponseMessage> Submit(
        HttpClient c, int raceId, FinishingPlaceDto[] places,
        FinishingPlaceDto[]? expected = null, string? reason = null)
    {
        return await c.PostAsJsonAsync($"/api/races/{raceId}/results",
            new SubmitRaceResultsRequest(places, expected, reason));
    }

    public static IEnumerable<object[]> Endpoints() => new[]
    {
        new object[] { "POST", "/api/races/1/results" },
        new object[] { "GET", "/api/races/1/score" },
        new object[] { "PUT", "/api/races/1/score" },
        new object[] { "GET", "/api/races/1/score/history" },
        new object[] { "POST", "/api/races/1/score/sign-off" },
        new object[] { "POST", "/api/races/1/score/reopen" },
        new object[] { "POST", "/api/races/1/start" },
        new object[] { "POST", "/api/races/1/stop" },
        new object[] { "PUT", "/api/heats/1/duration" },
    };

    private static HttpRequestMessage Req(string method, string path)
        => new(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) };

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Returns401_WhenAnonymous(string method, string path)
    {
        var r = await _f.CreateClient().SendAsync(Req(method, path));
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Returns403_WhenMemberIsOnNoCompetitionTeam(string method, string path)
    {
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.SendAsync(Req(method, path));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Returns404_WhenTrainerDoesNotRunTheCompetition(string method, string path)
    {
        var r = await (await _f.TrainerAsync()).SendAsync(Req(method, path));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- results ----

    [Fact]
    public async Task SubmitResults_ScoresFieldSizeMinusPlace_AndMarksRaceComplete()
    {
        var a = await _f.CreateArenaAsync(4);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();

        var r = await Submit(admin, races[0], new[] { P(a.TeamIds[2], 1), P(a.TeamIds[0], 2), P(a.TeamIds[3], 3), P(a.TeamIds[1], 4) });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var heat = await r.ReadAsync<HeatDto>();
        var race = heat.Races.Single();
        Assert.True(race.IsComplete);
        Assert.Equal(new[] { 4.0, 3.0, 2.0, 1.0 }, race.Results.Select(x => x.Points));
        Assert.Equal(new[] { 1, 2, 3, 4 }, race.Results.Select(x => x.Placing!.Value));
        Assert.Equal(a.TeamIds[2], race.Results[0].TeamId);
    }

    [Fact]
    public async Task SubmitResults_EliminatedTeamsScoreZero_AndSortLast()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();

        var heat = await (await Submit(admin, races[0], new[] { P(a.TeamIds[0], 1, true), P(a.TeamIds[1], 1), P(a.TeamIds[2], 2) })).ReadAsync<HeatDto>();

        var results = heat.Races.Single().Results;
        Assert.Equal(new[] { a.TeamIds[1], a.TeamIds[2], a.TeamIds[0] }, results.Select(x => x.TeamId));
        Assert.Equal(new[] { 3.0, 2.0, 0.0 }, results.Select(x => x.Points));
        Assert.True(results[2].Eliminated);
        Assert.Null(results[2].Placing);
    }

    [Fact]
    public async Task SubmitResults_UsesLargestHeatInSessionAsBase()
    {
        var a = await _f.CreateArenaAsync(6);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds.Take(4), "Big", 1);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds.Skip(4), "Small", 2);
        var admin = await _f.AdminAsync();

        var heat = await (await Submit(admin, races[0], new[] { P(a.TeamIds[4], 1), P(a.TeamIds[5], 2) })).ReadAsync<HeatDto>();

        Assert.Equal(new[] { 4.0, 3.0 }, heat.Races.Single().Results.Select(x => x.Points));
    }

    [Fact]
    public async Task SubmitResults_PlaceBeyondField_ScoresZero_AndUnknownTeamsAreIgnored()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds.Take(2));
        var admin = await _f.AdminAsync();

        var heat = await (await Submit(admin, races[0], new[] { P(a.TeamIds[0], 5), P(a.TeamIds[2], 1), P(a.TeamIds[1], 0) })).ReadAsync<HeatDto>();

        var results = heat.Races.Single().Results;
        Assert.Equal(2, results.Count);
        Assert.All(results, x => Assert.Equal(0, x.Points));
    }

    [Fact]
    public async Task SubmitResults_QualifierHeat_GivesOnePointPerFinisher()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Race Q1", 1, stage: RaceRoundStage.Qualifier, roundId: 1);
        var admin = await _f.AdminAsync();

        var heat = await (await Submit(admin, races[0], new[] { P(a.TeamIds[0], 1), P(a.TeamIds[1], 2), P(a.TeamIds[2], 3, true) })).ReadAsync<HeatDto>();

        Assert.Equal(new[] { 1.0, 1.0, 0.0 }, heat.Races.Single().Results.Select(x => x.Points));
    }

    [Fact]
    public async Task SubmitResults_Rescoring_ReplacesPreviousResults_AndRecordsAdmin()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        await Submit(admin, races[0], new[] { P(a.TeamIds[0], 1), P(a.TeamIds[1], 2) });

        var heat = await (await Submit(admin, races[0],
            new[] { P(a.TeamIds[1], 1), P(a.TeamIds[0], 2) }, reason: "Finish order corrected"))
            .ReadAsync<HeatDto>();

        Assert.Equal(a.TeamIds[1], heat.Races.Single().Results[0].TeamId);
        var stored = await _f.WithDbAsync(db => db.Results.Where(x => x.RaceId == races[0]).ToListAsync());
        Assert.Equal(2, stored.Count);
        Assert.All(stored, x => Assert.False(string.IsNullOrEmpty(x.RecordedByUserId)));
    }

    [Fact]
    public async Task SubmitResults_Returns404_WhenRaceMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await Submit(admin, 999999, Array.Empty<FinishingPlaceDto>());
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- results: optimistic concurrency (Expected) ----

    [Fact]
    public async Task SubmitResults_WithMatchingExpected_Applies()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var first = new[] { P(a.TeamIds[0], 1), P(a.TeamIds[1], 2) };
        await Submit(admin, races[0], first);

        var r = await Submit(admin, races[0],
            new[] { P(a.TeamIds[1], 1), P(a.TeamIds[0], 2) }, expected: first,
            reason: "Finish order corrected");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(a.TeamIds[1], (await r.ReadAsync<HeatDto>()).Races.Single().Results[0].TeamId);
    }

    [Fact]
    public async Task SubmitResults_WithEmptyExpected_AppliesToUnscoredRace()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();

        var r = await Submit(admin, races[0], new[] { P(a.TeamIds[0], 1) }, expected: Array.Empty<FinishingPlaceDto>());

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Single((await r.ReadAsync<HeatDto>()).Races.Single().Results);
    }

    [Fact]
    public async Task SubmitResults_Resend_ReturnsExistingResults_WithoutRewriting()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var places = new[] { P(a.TeamIds[0], 1), P(a.TeamIds[1], 2, true) };
        await Submit(admin, races[0], places);
        var idsBefore = (await _f.WithDbAsync(db => db.Results.Where(x => x.RaceId == races[0]).Select(x => x.Id).ToListAsync())).Order().ToList();

        // The phone never saw the first reply, so it still believes the race is unscored.
        var r = await Submit(admin, races[0], places, expected: Array.Empty<FinishingPlaceDto>());

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(2, (await r.ReadAsync<HeatDto>()).Races.Single().Results.Count);
        var idsAfter = (await _f.WithDbAsync(db => db.Results.Where(x => x.RaceId == races[0]).Select(x => x.Id).ToListAsync())).Order().ToList();
        Assert.Equal(idsBefore, idsAfter);
    }

    [Fact]
    public async Task SubmitResults_ChangedExistingResults_RequiresReason()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var places = new[] { P(a.TeamIds[0], 1), P(a.TeamIds[1], 2) };
        await Submit(admin, races[0], places);

        var missingReason = await Submit(admin, races[0],
            new[] { P(a.TeamIds[1], 1), P(a.TeamIds[0], 2) }, expected: places);
        var idempotentRetry = await Submit(admin, races[0], places, expected: Array.Empty<FinishingPlaceDto>());

        Assert.Equal(HttpStatusCode.BadRequest, missingReason.StatusCode);
        Assert.Equal(HttpStatusCode.OK, idempotentRetry.StatusCode);
    }

    [Fact]
    public async Task SubmitResults_WithStaleExpected_Returns409_AndCurrentHeat()
    {
        var a = await _f.CreateArenaAsync(2);
        var (heatId, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        await Submit(admin, races[0], new[] { P(a.TeamIds[0], 1), P(a.TeamIds[1], 2) });

        var r = await Submit(admin, races[0],
            new[] { P(a.TeamIds[1], 1), P(a.TeamIds[0], 2) },
            expected: Array.Empty<FinishingPlaceDto>());

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        Assert.Equal("These results were changed on another device.", doc.RootElement.GetProperty("message").GetString());
        Assert.Equal(a.SessionId, doc.RootElement.GetProperty("sessionId").GetInt32());
        Assert.Equal(heatId, doc.RootElement.GetProperty("heat").GetProperty("id").GetInt32());
        // Stored results are untouched: team 0 is still the winner.
        var winner = await _f.WithDbAsync(db => db.Results.SingleAsync(x => x.RaceId == races[0] && x.Placing == 1));
        Assert.Equal(a.TeamIds[0], winner.TeamId);
        var responseWinner = doc.RootElement.GetProperty("heat").GetProperty("races")[0]
            .GetProperty("results")[0].GetProperty("teamId").GetInt32();
        Assert.Equal(winner.TeamId, responseWinner);
    }

    [Fact]
    public async Task SubmitResults_ConcurrentLoserConflictBodyMatchesCommittedWinner()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var firstClient = await _f.AdminAsync();
        var secondClient = await _f.AdminAsync();

        var responses = await Task.WhenAll(
            Submit(firstClient, races[0],
                [P(a.TeamIds[0], 1), P(a.TeamIds[1], 2)], expected: []),
            Submit(secondClient, races[0],
                [P(a.TeamIds[1], 1), P(a.TeamIds[0], 2)], expected: []));

        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
        var conflict = Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);
        var committedWinner = await _f.WithDbAsync(db => db.Results
            .SingleAsync(result => result.RaceId == races[0] && result.Placing == 1));
        using var document = JsonDocument.Parse(await conflict.Content.ReadAsStringAsync());
        var responseWinner = document.RootElement.GetProperty("heat").GetProperty("races")[0]
            .GetProperty("results")[0].GetProperty("teamId").GetInt32();
        Assert.Equal(committedWinner.TeamId, responseWinner);
    }

    [Fact]
    public async Task SubmitResults_ExpectedComparison_IgnoresOrderAndEliminatedPlaceNumbers()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        await Submit(admin, races[0], new[] { P(a.TeamIds[0], 1), P(a.TeamIds[1], 2, true) });

        // Same results listed in a different order, with a meaningless place on the eliminated team.
        var expected = new[] { P(a.TeamIds[1], 7, true), P(a.TeamIds[0], 1) };
        var r = await Submit(admin, races[0], new[] { P(a.TeamIds[2], 1) }, expected,
            reason: "Eliminated team removed after review");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var results = (await r.ReadAsync<HeatDto>()).Races.Single().Results;
        Assert.Equal(a.TeamIds[2], Assert.Single(results).TeamId);
    }

    // ---- clock: start ----

    [Fact]
    public async Task StartRace_WithoutBody_StampsNow()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var before = DateTime.UtcNow;

        var r = await admin.PostAsync($"/api/races/{races[0]}/start", null);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var race = await r.ReadAsync<RaceDto>();
        Assert.InRange(race.StartedAt!.Value, before.AddSeconds(-1), DateTime.UtcNow.AddSeconds(1));
        Assert.Null(race.FinishedAt);
    }

    [Fact]
    public async Task StartRace_UsesDeviceTapTime_WhenPlausible()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var tapped = DateTime.UtcNow.AddMinutes(-3);

        var race = await (await admin.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(tapped))).ReadAsync<RaceDto>();

        Assert.True((race.StartedAt!.Value - tapped).Duration() < TimeSpan.FromMilliseconds(5));
    }

    [Fact]
    public async Task StartRace_IgnoresTapTimeInTheFuture_OrOlderThanTenMinutes()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var (_, races2) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "H2", 2);
        var admin = await _f.AdminAsync();

        var future = await (await admin.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(DateTime.UtcNow.AddHours(1)))).ReadAsync<RaceDto>();
        var stale = await (await admin.PostAsJsonAsync($"/api/races/{races2[0]}/start", new RaceClockRequest(DateTime.UtcNow.AddMinutes(-30)))).ReadAsync<RaceDto>();

        Assert.True(future.StartedAt!.Value < DateTime.UtcNow.AddMinutes(1));
        Assert.True(stale.StartedAt!.Value > DateTime.UtcNow.AddMinutes(-1));
    }

    [Fact]
    public async Task StartRace_TreatsUnspecifiedKindAsUtc_AndConvertsOffsets()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var (_, races2) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "H2", 2);
        var admin = await _f.AdminAsync();
        var tapped = DateTime.UtcNow.AddMinutes(-2);

        // No "Z": must be read as UTC, not shifted by the server's local zone.
        var naive = $$"""{"at":"{{tapped:yyyy-MM-ddTHH:mm:ss.fff}}"}""";
        var r1 = await admin.PostAsync($"/api/races/{races[0]}/start", new StringContent(naive, System.Text.Encoding.UTF8, "application/json"));
        var race1 = await r1.ReadAsync<RaceDto>();
        Assert.True((race1.StartedAt!.Value - tapped).Duration() < TimeSpan.FromSeconds(1));

        // The same instant expressed with a +02:00 offset.
        var withOffset = $$"""{"at":"{{new DateTimeOffset(tapped).ToOffset(TimeSpan.FromHours(2)):yyyy-MM-ddTHH:mm:ss.fffzzz}}"}""";
        var r2 = await admin.PostAsync($"/api/races/{races2[0]}/start", new StringContent(withOffset, System.Text.Encoding.UTF8, "application/json"));
        var race2 = await r2.ReadAsync<RaceDto>();
        Assert.True((race2.StartedAt!.Value - tapped).Duration() < TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task StartRace_AfterFinishedRun_UsesNewRunStart_AndClearsFinish()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var firstStart = DateTime.UtcNow.AddMinutes(-4);
        var stop = DateTime.UtcNow.AddMinutes(-3);
        await admin.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(firstStart));
        await admin.PostAsJsonAsync($"/api/races/{races[0]}/stop", new RaceClockRequest(stop));

        var newStart = DateTime.UtcNow.AddMinutes(-1);
        var restarted = await (await admin.PostAsJsonAsync(
            $"/api/races/{races[0]}/start", new RaceClockRequest(newStart))).ReadAsync<RaceDto>();

        Assert.True((restarted.StartedAt!.Value - newStart).Duration() < TimeSpan.FromMilliseconds(5));
        Assert.Null(restarted.FinishedAt);
    }

    [Fact]
    public async Task StartRace_RetriedStartArrivingAfterStop_KeepsTheFinish()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var start = DateTime.UtcNow.AddMinutes(-4);
        var stop = DateTime.UtcNow.AddMinutes(-2);
        await admin.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(start));
        await admin.PostAsJsonAsync($"/api/races/{races[0]}/stop", new RaceClockRequest(stop));

        var retried = await (await admin.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(start))).ReadAsync<RaceDto>();

        Assert.NotNull(retried.FinishedAt);
        Assert.True((retried.FinishedAt!.Value - stop).Duration() < TimeSpan.FromMilliseconds(5));
    }

    [Fact]
    public async Task StartRace_WithoutTapTime_AfterFinish_ClearsFinish()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        await admin.PostAsJsonAsync($"/api/races/{races[0]}/stop", new RaceClockRequest(null));

        var race = await (await admin.PostAsync($"/api/races/{races[0]}/start", null)).ReadAsync<RaceDto>();

        Assert.Null(race.FinishedAt);
        Assert.NotNull(race.StartedAt);
    }

    [Fact]
    public async Task StartRace_Returns404_WhenRaceMissing()
    {
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/races/999999/start", null)).StatusCode);
    }

    // ---- clock: stop ----

    [Fact]
    public async Task StopRace_WithoutStart_BackdatesStartByOneSecond()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();

        var race = await (await admin.PostAsync($"/api/races/{races[0]}/stop", null)).ReadAsync<RaceDto>();

        Assert.Equal(TimeSpan.FromSeconds(1), race.FinishedAt!.Value - race.StartedAt!.Value);
    }

    [Fact]
    public async Task StopRace_AfterStart_KeepsStart_AndStampsFinish()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var start = DateTime.UtcNow.AddMinutes(-5);
        var stop = DateTime.UtcNow.AddMinutes(-1);
        await admin.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(start));

        var race = await (await admin.PostAsJsonAsync($"/api/races/{races[0]}/stop", new RaceClockRequest(stop))).ReadAsync<RaceDto>();

        Assert.True((race.StartedAt!.Value - start).Duration() < TimeSpan.FromMilliseconds(5));
        Assert.True((race.FinishedAt!.Value - stop).Duration() < TimeSpan.FromMilliseconds(5));
    }

    [Fact]
    public async Task StopRace_DelayedStopFromEarlierRun_DoesNotFinishNewerRestart()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var firstStart = DateTime.UtcNow.AddMinutes(-6);
        var oldStop = DateTime.UtcNow.AddMinutes(-5);
        var newStart = DateTime.UtcNow.AddMinutes(-2);
        await admin.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(firstStart));
        await admin.PostAsJsonAsync($"/api/races/{races[0]}/stop", new RaceClockRequest(oldStop));
        await admin.PostAsJsonAsync($"/api/races/{races[0]}/start", new RaceClockRequest(newStart));

        var race = await (await admin.PostAsJsonAsync(
            $"/api/races/{races[0]}/stop", new RaceClockRequest(oldStop))).ReadAsync<RaceDto>();

        Assert.True((race.StartedAt!.Value - newStart).Duration() < TimeSpan.FromMilliseconds(5));
        Assert.Null(race.FinishedAt);
    }

    [Fact]
    public async Task StopRace_Returns404_WhenRaceMissing()
    {
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/races/999999/stop", null)).StatusCode);
    }

    // ---- heat duration ----

    [Fact]
    public async Task SetHeatDuration_StoresPositiveMinutes_AndClearsOtherwise()
    {
        var a = await _f.CreateArenaAsync(2);
        var (heatId, _) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();

        var set = await (await admin.PutAsJsonAsync($"/api/heats/{heatId}/duration", new UpdateHeatDurationRequest(7))).ReadAsync<HeatDto>();
        Assert.Equal(7, set.DurationMinutes);

        var cleared = await (await admin.PutAsJsonAsync($"/api/heats/{heatId}/duration", new UpdateHeatDurationRequest(0))).ReadAsync<HeatDto>();
        Assert.Null(cleared.DurationMinutes);
        Assert.Null((await _f.WithDbAsync(db => db.Heats.SingleAsync(h => h.Id == heatId))).DurationMinutes);
    }

    [Fact]
    public async Task SetHeatDuration_Returns404_WhenHeatMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync("/api/heats/999999/duration", new UpdateHeatDurationRequest(5));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- score clash resolution & clear race score ----

    [Fact]
    public async Task SubmitResults_ClashIsRecorded_AndResolvedByOrganiser()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        await Submit(admin, races[0], new[] { P(a.TeamIds[0], 1), P(a.TeamIds[1], 2) });

        // Second scorer submits different placings believing the race is unscored.
        var conflict = await Submit(admin, races[0],
            new[] { P(a.TeamIds[1], 1), P(a.TeamIds[0], 2) },
            expected: Array.Empty<FinishingPlaceDto>());

        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        using var doc = JsonDocument.Parse(await conflict.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.TryGetProperty("clash", out var clashEl));
        Assert.Equal(races[0], clashEl.GetProperty("raceId").GetInt32());

        var clashesResp = await admin.GetAsync($"/api/sessions/{a.SessionId}/clashes");
        Assert.Equal(HttpStatusCode.OK, clashesResp.StatusCode);
        using var clashesDoc = JsonDocument.Parse(await clashesResp.Content.ReadAsStringAsync());
        Assert.Contains(clashesDoc.RootElement.EnumerateArray(), c => c.GetProperty("raceId").GetInt32() == races[0]);

        var resolveResp = await admin.PostAsJsonAsync(
            $"/api/races/{races[0]}/clash/resolve",
            new { useIncoming = true, places = new[] { P(a.TeamIds[1], 1), P(a.TeamIds[0], 2) } });
        Assert.Equal(HttpStatusCode.OK, resolveResp.StatusCode);
        var resolvedHeat = await resolveResp.ReadAsync<HeatDto>();
        Assert.Equal(a.TeamIds[1], resolvedHeat.Races.Single().Results[0].TeamId);

        var afterResp = await admin.GetAsync($"/api/sessions/{a.SessionId}/clashes");
        using var afterDoc = JsonDocument.Parse(await afterResp.Content.ReadAsStringAsync());
        Assert.DoesNotContain(afterDoc.RootElement.EnumerateArray(), c => c.GetProperty("raceId").GetInt32() == races[0]);
    }

    [Fact]
    public async Task ClearRaceScore_ResetsRaceAndRemovesResults()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        await Submit(admin, races[0], new[] { P(a.TeamIds[0], 1), P(a.TeamIds[1], 2) });

        var r = await admin.DeleteAsync($"/api/races/{races[0]}/score");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var heat = await r.ReadAsync<HeatDto>();
        var race = heat.Races.Single();
        Assert.False(race.IsComplete);
        Assert.Empty(race.Results);
    }

    [Fact]
    public async Task RefereeCards_TeamFlags_AndCompetitionCardSetting_RoundTripAcrossEndpoints()
    {
        var a = await _f.CreateArenaAsync(2);
        var (heatId, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();

        // Enable UseRefereeCards on the competition.
        var compBefore = await (await admin.GetAsync($"/api/competitions/{a.CompetitionId}")).ReadAsync<CompetitionDetail>();
        Assert.False(compBefore.UseRefereeCards);

        var updateComp = await admin.PutAsJsonAsync($"/api/competitions/{a.CompetitionId}", new UpdateCompetitionRequest(
            compBefore.Name, compBefore.Location, compBefore.Description,
            compBefore.Latitude, compBefore.Longitude, compBefore.What3Words, compBefore.AppleMapsUrl,
            compBefore.StartDate, compBefore.EndDate, compBefore.IsActive, compBefore.IsArchived,
            UseRefereeCards: true));
        Assert.Equal(HttpStatusCode.OK, updateComp.StatusCode);

        // Set team flag on team 0 and assign a yellow card before any race is scored.
        var updateTeam = await admin.PutAsJsonAsync($"/api/competitions/{a.CompetitionId}/teams/{a.TeamIds[0]}",
            new { bibDescription = "Red with white spots", flag = "gb-wls" });
        Assert.Equal(HttpStatusCode.OK, updateTeam.StatusCode);
        var teamWithFlag = await updateTeam.ReadAsync<TeamDto>();
        Assert.Equal("gb-wls", teamWithFlag.Flag);

        var cardResp = await admin.PutAsJsonAsync($"/api/competitions/{a.CompetitionId}/teams/{a.TeamIds[0]}/card",
            new SetTeamCardRequest("yellow"));
        Assert.Equal(HttpStatusCode.OK, cardResp.StatusCode);
        var cardedTeam = await cardResp.ReadAsync<TeamDto>();
        Assert.Equal("yellow", cardedTeam.RefereeCard);
        Assert.Equal("gb-wls", cardedTeam.Flag);
        Assert.DoesNotContain("[card:", cardedTeam.BibDescription ?? string.Empty);

        // Score a race with [under-review] and [card:red] on team 1.
        var scoreResp = await Submit(admin, races[0], new[]
        {
            P(a.TeamIds[0], 1),
            new FinishingPlaceDto(a.TeamIds[1], 2, false, RefereeNote: "[card:red] [under-review] Lane interference"),
        });
        Assert.Equal(HttpStatusCode.OK, scoreResp.StatusCode);
        var scoredHeat = await scoreResp.ReadAsync<HeatDto>();
        var r1 = scoredHeat.Races.Single().Results.Single(r => r.TeamId == a.TeamIds[1]);
        Assert.Equal("red", r1.RefereeCard);
        Assert.True(r1.UnderReview);

        // Standings and CompetitionDetail include RefereeCard and Flag.
        var standings = await (await admin.GetAsync($"/api/competitions/{a.CompetitionId}/standings")).ReadAsync<List<StandingRow>>();
        var row0 = standings.Single(s => s.TeamId == a.TeamIds[0]);
        var row1 = standings.Single(s => s.TeamId == a.TeamIds[1]);
        Assert.Equal("yellow", row0.RefereeCard);
        Assert.Equal("gb-wls", row0.Flag);
        Assert.Equal("red", row1.RefereeCard);

        var compAfter = await (await admin.GetAsync($"/api/competitions/{a.CompetitionId}")).ReadAsync<CompetitionDetail>();
        Assert.True(compAfter.UseRefereeCards);
        var heatEntry0 = compAfter.Sessions.Single(s => s.Id == a.SessionId).Heats.Single(h => h.Id == heatId)
            .Entries.Single(e => e.TeamId == a.TeamIds[0]);
        Assert.Equal("yellow", heatEntry0.RefereeCard);
        Assert.Equal("gb-wls", heatEntry0.Flag);

        // Clear card on team 1.
        var clearCard = await admin.PutAsJsonAsync($"/api/competitions/{a.CompetitionId}/teams/{a.TeamIds[1]}/card",
            new SetTeamCardRequest(null));
        Assert.Equal(HttpStatusCode.OK, clearCard.StatusCode);
        Assert.Null((await clearCard.ReadAsync<TeamDto>()).RefereeCard);
    }
}
