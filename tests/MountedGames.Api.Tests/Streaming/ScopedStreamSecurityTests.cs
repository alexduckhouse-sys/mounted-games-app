using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;
using static MountedGames.Api.Tests.Infrastructure.StreamingApiFactory;

namespace MountedGames.Api.Tests.Streaming;

public class ScopedStreamSecurityTests(StreamingApiFactory f) : IClassFixture<StreamingApiFactory>
{
    private async Task<HttpClient> Link(int competition, int scope, string arena = "Arena", bool revoked = false, bool expired = false)
    {
        var token = ScorerLinkTokens.Generate();
        var now = f.Clock.GetUtcNow().UtcDateTime;
        await f.WithDbAsync(async db =>
        {
            db.ScorerLinks.Add(new ScorerLink
            {
                CompetitionId = competition, Scope = scope, ArenaName = arena, Label = "Fake camera",
                TokenHash = ScorerLinkTokens.Hash(token), CreatedAt = now,
                ExpiresAt = now.AddMinutes(expired ? -1 : 60), RevokedAt = revoked ? now : null,
            });
            await db.SaveChangesAsync();
        });
        var client = f.CreateClient();
        client.DefaultRequestHeaders.Add(ScorerLinkTokens.Header, token);
        return client;
    }

    [Theory]
    [InlineData(ScorerLink.ScopeScore)]
    [InlineData(ScorerLink.ScopeCamera)]
    [InlineData(ScorerLink.ScopeScoreAndStream)]
    public async Task NoQrLinkCanReadPublisherNames(int scope)
    {
        var competition = await f.SeedCompetitionAsync();
        using var link = await Link(competition, scope);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await link.GetAsync(Path(competition, suffix: "/publishers"))).StatusCode);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task LinkCanManageItsOwnPublisherAndTakeOverItsOwnAngle(int scope)
    {
        var competition = await f.SeedCompetitionAsync();
        using var link = await Link(competition, scope);
        var attempt = await f.StartAsync(link, competition);
        await f.ReadyAsync(link, competition, attempt);
        Assert.Equal(HttpStatusCode.OK, (await link.PatchAsJsonAsync(Path(competition, attempt.StreamId), new { audioMuted = true })).StatusCode);
        var republish = await link.PostAsJsonAsync(Path(competition, attempt.StreamId, "/republish"), new PublishRequest(VideoOffer, "0"));
        republish.EnsureSuccessStatusCode();
        await f.ReadyAsync(link, competition, await republish.ReadAsync<PublishResponse>());
        Assert.Equal(HttpStatusCode.NoContent, (await link.PostAsync(Path(competition, attempt.StreamId, "/heartbeat"), null)).StatusCode);
        var replacement = await f.StartAsync(link, competition, takeover: true);
        await f.ReadyAsync(link, competition, replacement);
        Assert.Equal(LiveStreamStatus.Ended, (await f.StreamAsync(attempt.StreamId)).Status);
        Assert.Equal(HttpStatusCode.NoContent, (await link.PostAsync(Path(competition, replacement.StreamId, "/end"), null)).StatusCode);
    }

    [Theory]
    [InlineData(1, "Arena")]
    [InlineData(2, "Arena")]
    [InlineData(1, "Other arena")]
    [InlineData(2, "Other arena")]
    [InlineData(1, "All arenas")]
    [InlineData(2, "All arenas")]
    public async Task LifecycleCannotMutateAnotherPublisherEvenWithArenaAccess(int scope, string arena)
    {
        var competition = await f.SeedCompetitionAsync();
        using var admin = await f.AdminAsync();
        var attempt = await f.StartAsync(admin, competition);
        using var link = await Link(competition, scope, arena);
        foreach (var endpoint in new[] { "ready", "republish", "heartbeat", "end", "patch" })
        {
            var response = endpoint switch
            {
                "patch" => await link.PatchAsJsonAsync(Path(competition, attempt.StreamId), new { audioMuted = true }),
                "republish" => await link.PostAsJsonAsync(Path(competition, attempt.StreamId, "/republish"), new PublishRequest(VideoOffer, "0")),
                _ => await link.PostAsJsonAsync(Path(competition, attempt.StreamId, "/" + endpoint), new { attempt = attempt.Attempt }),
            };
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }
        Assert.Equal(LiveStreamStatus.Starting, (await f.StreamAsync(attempt.StreamId)).Status);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task LinkCannotTakeOverStaffOrAnotherLinksStream(int scope)
    {
        var competition = await f.SeedCompetitionAsync();
        using var admin = await f.AdminAsync();
        var staff = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, staff);
        using var otherLink = await Link(competition, scope);
        var other = await f.StartAsync(otherLink, competition, angle: "Other");
        await f.ReadyAsync(otherLink, competition, other);
        using var link = await Link(competition, scope);
        foreach (var angle in new[] { "Main", "Other" })
        {
            var response = await link.PostAsJsonAsync(Path(competition), new StartStreamRequest("Arena", angle, VideoOffer, "0", TakeOver: true));
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
        Assert.Equal(LiveStreamStatus.Live, (await f.StreamAsync(staff.StreamId)).Status);
        Assert.Equal(LiveStreamStatus.Live, (await f.StreamAsync(other.StreamId)).Status);
    }

    [Theory]
    [InlineData(1, "Arena", 401)]
    [InlineData(2, "Arena", 204)]
    [InlineData(2, "Other arena", 404)]
    [InlineData(2, "All arenas", 204)]
    public async Task OnlyControllerLinksCanCommandStreamsWithinTheirArena(int scope, string arena, int expected)
    {
        var competition = await f.SeedCompetitionAsync();
        using var admin = await f.AdminAsync();
        var attempt = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, attempt);
        using var link = await Link(competition, scope, arena);
        var response = await link.PostAsJsonAsync(Path(competition, attempt.StreamId, "/command"), new StreamCommandRequest("setZoom", "2"));
        Assert.Equal(expected, (int)response.StatusCode);
    }

    [Fact]
    public async Task ControllerCannotSelectAnotherArenaThroughTheCommandValue()
    {
        var competition = await f.SeedCompetitionAsync();
        using var admin = await f.AdminAsync();
        var attempt = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, attempt);
        var otherResponse = await admin.PostAsJsonAsync(Path(competition), new StartStreamRequest("Other arena", "Main", VideoOffer, "0"));
        otherResponse.EnsureSuccessStatusCode();
        var other = await otherResponse.ReadAsync<PublishResponse>();
        await f.ReadyAsync(admin, competition, other);
        using var link = await Link(competition, 2);
        var response = await link.PostAsJsonAsync(Path(competition, attempt.StreamId, "/command"),
            new StreamCommandRequest("selectAngle", other.StreamId.ToString()));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await link.PostAsJsonAsync(Path(competition, attempt.StreamId, "/command"),
            new StreamCommandRequest("selectAngle", attempt.StreamId.ToString()))).StatusCode);
    }

    [Fact]
    public async Task PublisherCannotMutateItsOwnStreamAfterArenaGrantChanges()
    {
        var competition = await f.SeedCompetitionAsync();
        using var link = await Link(competition, 1);
        var attempt = await f.StartAsync(link, competition);
        await f.ReadyAsync(link, competition, attempt);
        await f.WithDbAsync(async db =>
        {
            var tokenHash = ScorerLinkTokens.Hash(link.DefaultRequestHeaders.GetValues(ScorerLinkTokens.Header).Single());
            var stored = db.ScorerLinks.Single(x => x.TokenHash == tokenHash);
            stored.ArenaName = "Other arena";
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.NotFound, (await link.PostAsync(Path(competition, attempt.StreamId, "/end"), null)).StatusCode);
        Assert.Equal(LiveStreamStatus.Live, (await f.StreamAsync(attempt.StreamId)).Status);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task LinksCannotEditGlobalOverlaysOrOtherStaffResources(int scope)
    {
        var competition = await f.SeedCompetitionAsync();
        using var link = await Link(competition, scope, "All arenas");
        foreach (var route in new[] { "overlays", "scorer-links", "sessions", "teams" })
        {
            var request = new HttpRequestMessage(route == "overlays" ? HttpMethod.Put : HttpMethod.Post, $"/api/competitions/{competition}/{route}")
            { Content = JsonContent.Create(new { }) };
            Assert.Equal(HttpStatusCode.Unauthorized, (await link.SendAsync(request)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await link.PostAsJsonAsync($"/api/competitions/{competition}/overlays/score-card", new { })).StatusCode);
    }

    [Theory]
    [InlineData(true, false, false)]
    [InlineData(false, true, false)]
    [InlineData(false, false, true)]
    public async Task RevokedExpiredOrForeignCompetitionLinksCannotAuthenticate(bool revoked, bool expired, bool foreign)
    {
        var competition = await f.SeedCompetitionAsync();
        using var link = await Link(competition, 2, revoked: revoked, expired: expired);
        var target = foreign ? await f.SeedCompetitionAsync() : competition;
        Assert.Equal(HttpStatusCode.Unauthorized, (await link.GetAsync(Path(target, suffix: "/ice-servers"))).StatusCode);
    }
}
