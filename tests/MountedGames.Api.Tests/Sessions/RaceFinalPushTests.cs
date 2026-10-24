using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;
using MountedGames.Api.Tests.Push;

namespace MountedGames.Api.Tests.Sessions;

public class RaceFinalPushTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private sealed record Round(HttpClient Admin, HeatDto First, HeatDto Second, HeatDto Final, string TrainerId, HttpClient Trainer);

    private async Task<Round> Arrange()
    {
        var arena = await factory.CreateArenaAsync(4, raceFinals: true);
        var admin = await factory.AdminAsync();
        var generated = await admin.PostAsJsonAsync($"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/generate-race-finals",
            new GenerateRaceFinalsRequest(arena.TeamIds, ["Example race"], 2, true));
        generated.EnsureSuccessStatusCode();
        var session = await generated.ReadAsync<SessionDto>();
        var (trainer, auth) = await factory.SignupAsync("Member");
        await factory.InDbAsync(async db =>
        {
            (await db.Teams.FindAsync(session.Heats[0].Entries[0].TeamId))!.TrainerUserId = auth.User.Id;
            (await db.Sessions.FindAsync(arena.SessionId))!.ArenaName = "Main";
            await db.SaveChangesAsync();
        });
        return new Round(admin, session.Heats[0], session.Heats[1], session.Heats[2], auth.User.Id, trainer);
    }

    private static UpdateRaceScoreRequest Score(HeatDto heat, string requestId, int revision = 0)
        => new(heat.Entries.Select((entry, index) => new FinishingPlaceDto(entry.TeamId, index + 1, false)).ToList(), revision, requestId, null);

    [Theory]
    [InlineData(false, HttpStatusCode.Created)]
    [InlineData(true, HttpStatusCode.Created)]
    [InlineData(false, HttpStatusCode.InternalServerError)]
    [InlineData(true, HttpStatusCode.InternalServerError)]
    public async Task AutomaticFinalPush_FollowsCommit_AndNeverRepeatsOnReplay(bool viaLink, HttpStatusCode pushStatus)
    {
        var round = await Arrange();
        var endpoint = PushTests.AllowedEndpoint();
        var received = 0;
        var requireFinal = false;
        var observedCommittedFinal = false;
        factory.Http.Respond(endpoint, _ =>
        {
            received++;
            if (requireFinal)
                observedCommittedFinal = factory.InDbAsync(async db =>
                    await db.HeatEntries.CountAsync(e => e.HeatId == round.Final.Id) == 2
                    && await db.Races.AnyAsync(r => r.Id == round.Second.Races[0].Id && r.IsComplete)).GetAwaiter().GetResult();
            return new HttpResponseMessage(pushStatus);
        });
        (await round.Trainer.PostAsJsonAsync("/api/push/subscribe", FakePushService.Subscription(endpoint))).EnsureSuccessStatusCode();
        HttpClient client = round.Admin;
        var prefix = "/api/races";
        if (viaLink)
        {
            var competitionId = await factory.InDbAsync(async db => (await db.Sessions.FindAsync(round.First.SessionId))!.CompetitionId);
            var response = await round.Admin.PostAsJsonAsync($"/api/competitions/{competitionId}/scorer-links", new { label = "Example volunteer", arenaName = "Main" });
            response.EnsureSuccessStatusCode();
            var link = await response.ReadAsync<CreatedScorerLinkDto>();
            client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Scorer-Token", link.Token);
            prefix = "/api/scorer/races";
        }
        (await client.PutAsJsonAsync($"{prefix}/{round.First.Races[0].Id}/score", Score(round.First, "first"))).EnsureSuccessStatusCode();
        Assert.Equal(1, received); // First heat results only; the other qualifier is unfinished.
        Assert.Equal(0, await factory.InDbAsync(db => db.HeatEntries.CountAsync(e => e.HeatId == round.Final.Id)));
        requireFinal = true;
        var url = $"{prefix}/{round.Second.Races[0].Id}/score";
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync(url, Score(round.Second, "wrong-revision", 99))).StatusCode);
        Assert.Equal(1, received);
        (await client.PutAsJsonAsync(url, Score(round.Second, "second"))).EnsureSuccessStatusCode();
        Assert.Equal(2, received);
        Assert.True(observedCommittedFinal);
        var before = await factory.InDbAsync(db => db.HeatEntries.Where(e => e.HeatId == round.Final.Id).OrderBy(e => e.LaneIndex).Select(e => e.Id).ToListAsync());
        (await client.PutAsJsonAsync(url, Score(round.Second, "second"))).EnsureSuccessStatusCode();
        Assert.Equal(2, received);
        Assert.Equal(before, await factory.InDbAsync(db => db.HeatEntries.Where(e => e.HeatId == round.Final.Id).OrderBy(e => e.LaneIndex).Select(e => e.Id).ToListAsync()));
    }

    [Fact]
    public async Task FailedFinalPopulation_RollsBackScoreWithoutSendingDrawPush()
    {
        var round = await Arrange();
        using var push = new FakePushService(factory.Http, HttpStatusCode.Created);
        (await round.Trainer.PostAsJsonAsync("/api/push/subscribe", FakePushService.Subscription(push.Endpoint))).EnsureSuccessStatusCode();
        (await round.Admin.PutAsJsonAsync($"/api/races/{round.First.Races[0].Id}/score", Score(round.First, "first"))).EnsureSuccessStatusCode();
        Assert.Equal(1, push.Received);
        var trigger = $"fail_final_{round.Final.Id}";
        // SQL identifiers cannot be parameters; both interpolations come solely from an integer fixture id.
        var createTrigger = $"CREATE TRIGGER {trigger} BEFORE INSERT ON HeatEntries WHEN NEW.HeatId = {round.Final.Id} BEGIN SELECT RAISE(ABORT, 'Example population failure'); END;";
        await factory.InDbAsync(db => db.Database.ExecuteSqlRawAsync(createTrigger));
        try
        {
            using var scope = factory.Services.CreateScope();
            await Assert.ThrowsAsync<DbUpdateException>(() => scope.ServiceProvider.GetRequiredService<ScoringService>()
                .ApplyVersionedAsync(round.Second.Races[0].Id, Score(round.Second, "second"), null));
            Assert.False(await factory.InDbAsync(db => db.Races.Where(r => r.Id == round.Second.Races[0].Id).Select(r => r.IsComplete).SingleAsync()));
            Assert.Equal(0, await factory.InDbAsync(db => db.HeatEntries.CountAsync(e => e.HeatId == round.Final.Id)));
            Assert.Equal(1, push.Received);
        }
        finally
        {
            var dropTrigger = $"DROP TRIGGER {trigger};";
            await factory.InDbAsync(db => db.Database.ExecuteSqlRawAsync(dropTrigger));
        }
    }
}
