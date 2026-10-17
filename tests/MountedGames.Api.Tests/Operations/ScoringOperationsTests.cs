using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class ScoringOperationsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ScoringOperationsTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task VersionedScore_RejectsStaleRevision_AndRecordsCorrectionBeforeAfterAndReason()
    {
        var (arena, raceId) = await RaceAsync();
        var admin = await _f.AdminAsync();
        var first = Request(arena, 0, "save-1", null, winnerIndex: 0);
        var saved = await (await admin.PutAsJsonAsync(Url(raceId), first)).ReadAsync<RaceScoreDto>();

        var stale = await admin.PutAsJsonAsync(Url(raceId), Request(arena, 0, "save-stale", "Swap placings", 1));
        var correctedResponse = await admin.PutAsJsonAsync(Url(raceId), Request(arena, saved.Revision, "save-2", "Judge corrected the order", 1));

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(HttpStatusCode.OK, correctedResponse.StatusCode);
        var corrected = await correctedResponse.ReadAsync<RaceScoreDto>();
        Assert.Equal(2, corrected.Revision);
        Assert.Equal(arena.TeamIds[1], corrected.Results.Single(r => r.Place == 1).TeamId);
        var history = await (await admin.GetAsync($"{Url(raceId)}/history")).ReadAsync<List<RaceScoreHistoryDto>>();
        Assert.Equal(2, history.Count);
        Assert.Equal(RaceScoreEventKind.ResultsCorrected, history[1].Kind);
        Assert.Equal("Judge corrected the order", history[1].Reason);
        Assert.Equal(arena.TeamIds[0], history[1].Before.Single(r => r.Place == 1).TeamId);
        Assert.Equal(arena.TeamIds[1], history[1].After.Single(r => r.Place == 1).TeamId);
        Assert.False(string.IsNullOrWhiteSpace(history[1].ActorUserId));
    }

    [Fact]
    public async Task IdenticalRequestId_IsIdempotent_AndDifferentPayloadConflicts()
    {
        var (arena, raceId) = await RaceAsync();
        var admin = await _f.AdminAsync();
        var request = Request(arena, 0, "offline-save-1", null, 0);
        var first = await (await admin.PutAsJsonAsync(Url(raceId), request)).ReadAsync<RaceScoreDto>();

        var retry = await (await admin.PutAsJsonAsync(Url(raceId), request)).ReadAsync<RaceScoreDto>();
        var reused = await admin.PutAsJsonAsync(Url(raceId), Request(arena, 0, "offline-save-1", null, 1));

        Assert.Equal(first.Revision, retry.Revision);
        Assert.True(retry.IdempotentReplay);
        Assert.Equal(HttpStatusCode.Conflict, reused.StatusCode);
        Assert.Single(await _f.WithDbAsync(db => db.Set<RaceScoreEvent>().Where(e => e.RaceId == raceId).ToListAsync()));
    }

    [Fact]
    public async Task SignedOffScore_BlocksResultsAndClock_UntilReopenedWithReason()
    {
        var (arena, raceId) = await RaceAsync();
        var admin = await _f.AdminAsync();
        var saved = await (await admin.PutAsJsonAsync(Url(raceId), Request(arena, 0, "score", null, 0))).ReadAsync<RaceScoreDto>();
        var signed = await (await admin.PostAsJsonAsync($"{Url(raceId)}/sign-off",
            new ScoreActionRequest(saved.Revision, "sign", "Chief judge confirmed"))).ReadAsync<RaceScoreDto>();

        Assert.True(signed.IsSignedOff);
        Assert.Equal(HttpStatusCode.Conflict,
            (await admin.PutAsJsonAsync(Url(raceId), Request(arena, signed.Revision, "blocked", "Attempt", 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await admin.PostAsync($"/api/races/{raceId}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync($"{Url(raceId)}/reopen",
                new ScoreActionRequest(signed.Revision, "bad-reopen", null))).StatusCode);

        var reopened = await (await admin.PostAsJsonAsync($"{Url(raceId)}/reopen",
            new ScoreActionRequest(signed.Revision, "reopen", "Appeal accepted"))).ReadAsync<RaceScoreDto>();
        var corrected = await admin.PutAsJsonAsync(Url(raceId),
            Request(arena, reopened.Revision, "corrected", "Appeal changed placing", 1));

        Assert.False(reopened.IsSignedOff);
        Assert.Equal(HttpStatusCode.OK, corrected.StatusCode);
        var history = await (await admin.GetAsync($"{Url(raceId)}/history")).ReadAsync<List<RaceScoreHistoryDto>>();
        Assert.Equal(new[]
        {
            RaceScoreEventKind.ResultsRecorded, RaceScoreEventKind.SignedOff,
            RaceScoreEventKind.Reopened, RaceScoreEventKind.ResultsCorrected,
        }, history.Select(h => h.Kind));
    }

    [Fact]
    public async Task SignOff_RejectsCompletedRaceWithoutRecordedResults()
    {
        var (_, raceId) = await RaceAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Races.FindAsync(raceId))!.IsComplete = true;
            await db.SaveChangesAsync();
        });

        var response = await (await _f.AdminAsync()).PostAsJsonAsync($"{Url(raceId)}/sign-off",
            new ScoreActionRequest(1, "empty-sign-off", null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.Set<RaceScoreEvent>()
            .Where(e => e.RaceId == raceId).ToListAsync()));
    }

    [Fact]
    public async Task SignOff_RejectsPartialLegacyResults()
    {
        var (arena, raceId) = await RaceAsync();
        var admin = await _f.AdminAsync();
        await admin.PostAsJsonAsync($"/api/races/{raceId}/results",
            new SubmitRaceResultsRequest([new(arena.TeamIds[0], 1, false)]));

        var response = await admin.PostAsJsonAsync($"{Url(raceId)}/sign-off",
            new ScoreActionRequest(1, "partial-sign-off", null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task SignOff_RejectsResultsForTeamOutsideHeat()
    {
        var (arena, raceId) = await RaceAsync();
        var otherTeam = await _f.SeedTeamAsync(
            arena.CompetitionId, arena.SectionId, await _f.SeedClubAsync());
        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.FindAsync(raceId);
            race!.IsComplete = true;
            db.Results.AddRange(
                new MountedGames.Api.Entities.Result
                {
                    RaceId = raceId, TeamId = arena.TeamIds[0], Placing = 1, Points = 2,
                },
                new MountedGames.Api.Entities.Result
                {
                    RaceId = raceId, TeamId = otherTeam, Placing = 2, Points = 1,
                });
            await db.SaveChangesAsync();
        });

        var response = await (await _f.AdminAsync()).PostAsJsonAsync($"{Url(raceId)}/sign-off",
            new ScoreActionRequest(1, "unknown-team-sign-off", null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ReplayingSignOffAfterReopen_ReturnsConflictInsteadOfCurrentOpenState()
    {
        var (arena, raceId) = await RaceAsync();
        var admin = await _f.AdminAsync();
        var saved = await (await admin.PutAsJsonAsync(
            Url(raceId), Request(arena, 0, "score-replay", null, 0))).ReadAsync<RaceScoreDto>();
        var signOff = new ScoreActionRequest(saved.Revision, "sign-replay", "Chief judge confirmed");
        var signed = await (await admin.PostAsJsonAsync($"{Url(raceId)}/sign-off", signOff))
            .ReadAsync<RaceScoreDto>();
        await admin.PostAsJsonAsync($"{Url(raceId)}/reopen",
            new ScoreActionRequest(signed.Revision, "reopen-replay", "Review requested"));

        var replay = await admin.PostAsJsonAsync($"{Url(raceId)}/sign-off", signOff);

        Assert.Equal(HttpStatusCode.Conflict, replay.StatusCode);
        Assert.False((await (await admin.GetAsync(Url(raceId))).ReadAsync<RaceScoreDto>()).IsSignedOff);
    }

    [Fact]
    public async Task VersionedScore_AllowsSharedPlacings_AndAwardsEachTeamFullPlacePoints()
    {
        var (arena, raceId) = await RaceAsync();
        var request = new UpdateRaceScoreRequest(
            [new(arena.TeamIds[0], 1, false), new(arena.TeamIds[1], 1, false)],
            0, "shared-place", null);

        var saved = await (await (await _f.AdminAsync()).PutAsJsonAsync(Url(raceId), request))
            .ReadAsync<RaceScoreDto>();

        Assert.All(saved.Results, result =>
        {
            Assert.Equal(1, result.Place);
            Assert.Equal(2, result.Points);
        });
    }

    [Fact]
    public async Task ConcurrentWriters_WithSameRevision_CannotBothWin()
    {
        var (arena, raceId) = await RaceAsync();
        var firstClient = await _f.AdminAsync();
        var secondClient = await _f.AdminAsync();
        var firstTask = firstClient.PutAsJsonAsync(Url(raceId), Request(arena, 0, "phone-a", null, 0));
        var secondTask = secondClient.PutAsJsonAsync(Url(raceId), Request(arena, 0, "phone-b", null, 1));

        var responses = await Task.WhenAll(firstTask, secondTask);

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        Assert.Single(await _f.WithDbAsync(db => db.Set<RaceScoreEvent>().Where(e => e.RaceId == raceId).ToListAsync()));
    }

    [Fact]
    public async Task VersionedScore_ValidatesDuplicateTeamsAndCorrectionReason()
    {
        var (arena, raceId) = await RaceAsync();
        var admin = await _f.AdminAsync();
        var duplicate = new UpdateRaceScoreRequest(
            [new(arena.TeamIds[0], 1, false), new(arena.TeamIds[0], 2, false)], 0, "dup", null);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(Url(raceId), duplicate)).StatusCode);
        var saved = await (await admin.PutAsJsonAsync(Url(raceId), Request(arena, 0, "first", null, 0))).ReadAsync<RaceScoreDto>();

        var correction = await admin.PutAsJsonAsync(Url(raceId), Request(arena, saved.Revision, "second", null, 1));

        Assert.Equal(HttpStatusCode.BadRequest, correction.StatusCode);
    }

    [Fact]
    public async Task VersionedScore_RequiresEveryHeatTeam_AndRejectsUnknownTeamsAndImpossiblePlaces()
    {
        var (arena, raceId) = await RaceAsync();
        var admin = await _f.AdminAsync();
        var missing = new UpdateRaceScoreRequest([new(arena.TeamIds[0], 1, false)], 0, "missing", null);
        var unknown = new UpdateRaceScoreRequest(
            [new(arena.TeamIds[0], 1, false), new(999999, 2, false)], 0, "unknown", null);
        var impossible = new UpdateRaceScoreRequest(
            [new(arena.TeamIds[0], 3, false), new(arena.TeamIds[1], 2, false)], 0, "place", null);

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(Url(raceId), missing)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(Url(raceId), unknown)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(Url(raceId), impossible)).StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.Results.Where(r => r.RaceId == raceId).ToListAsync()));
    }

    [Fact]
    public async Task VersionedScore_RejectsNullPlacesAndOverlongReason()
    {
        var (arena, raceId) = await RaceAsync();
        var admin = await _f.AdminAsync();
        var nullPlaces = await admin.PutAsync(Url(raceId),
            new StringContent("{\"places\":null,\"expectedRevision\":0,\"requestId\":\"null\"}",
                System.Text.Encoding.UTF8, "application/json"));
        var longReason = new UpdateRaceScoreRequest(
            [new(arena.TeamIds[0], 1, false), new(arena.TeamIds[1], 2, false)],
            0, "long-reason", new string('x', 1001));

        Assert.Equal(HttpStatusCode.BadRequest, nullPlaces.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(Url(raceId), longReason)).StatusCode);
    }

    [Fact]
    public async Task LegacyCorrectionReasonHeader_IsStored_WithoutChangingBodyContract()
    {
        var (arena, raceId) = await RaceAsync();
        var admin = await _f.AdminAsync();
        var firstPlaces = new[] { new FinishingPlaceDto(arena.TeamIds[0], 1, false), new FinishingPlaceDto(arena.TeamIds[1], 2, false) };
        await admin.PostAsJsonAsync($"/api/races/{raceId}/results", new SubmitRaceResultsRequest(firstPlaces, []));
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/races/{raceId}/results")
        {
            Content = JsonContent.Create(new SubmitRaceResultsRequest(
                [new(arena.TeamIds[1], 1, false), new(arena.TeamIds[0], 2, false)], firstPlaces)),
        };
        request.Headers.Add("X-Score-Reason", "Photo finish reviewed");

        var response = await admin.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var history = await (await admin.GetAsync($"{Url(raceId)}/history")).ReadAsync<List<RaceScoreHistoryDto>>();
        Assert.Equal("Photo finish reviewed", history.Last().Reason);
    }

    private async Task<(Arena Arena, int RaceId)> RaceAsync()
    {
        var arena = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        return (arena, races[0]);
    }

    private static UpdateRaceScoreRequest Request(Arena arena, int revision, string id, string? reason, int winnerIndex)
    {
        var loser = winnerIndex == 0 ? 1 : 0;
        return new UpdateRaceScoreRequest(
            [new(arena.TeamIds[winnerIndex], 1, false), new(arena.TeamIds[loser], 2, false)],
            revision, id, reason);
    }

    private static string Url(int raceId) => $"/api/races/{raceId}/score";
}
