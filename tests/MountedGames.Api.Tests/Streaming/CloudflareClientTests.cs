using System.Text.Json;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services.Streaming;
using MountedGames.Api.Tests.Infrastructure;
using static MountedGames.Api.Tests.Infrastructure.StreamingApiFactory;

namespace MountedGames.Api.Tests.Streaming;

public class CloudflareClientTests
{
    [Theory]
    [InlineData("a=simulcast:send f;h;q\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n", false)]
    [InlineData("m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=simulcast:send f;h;q\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n", false)]
    [InlineData("m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=simulcast:recv f;h;q\r\n", false)]
    [InlineData(VideoOffer, false)]
    [InlineData(SimulcastOffer, true)]
    [InlineData("m=video 9 UDP/TLS/RTP/SAVPF 96\na=simulcast:send f;h;q\n", true)]
    public void SimulcastMustBeSendInAVideoMediaSection(string sdp, bool expected) =>
        Assert.Equal(expected, StreamsController.HasVideoSimulcast(sdp));

    [Fact]
    public async Task NewSessionsAreCreatedWithoutABody()
    {
        using var f = new StreamingApiFactory();
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        await f.StartAsync(admin, competition);
        var created = Assert.Single(f.SfuRequests, r => r.Url.EndsWith("/sessions/new"));
        Assert.Equal(JsonValueKind.Undefined, created.Body.ValueKind);
    }

    [Theory]
    [InlineData("/sessions/new", "{}")]
    [InlineData("/sessions/new", "[]")]
    [InlineData("/sessions/new", "not-json")]
    [InlineData("/sessions/new", "{\"sessionId\":42}")]
    [InlineData("/sessions/new", "{\"sessionId\":\"fake-session\",\"errorCode\":null}")]
    [InlineData("/tracks/new", "{}")]
    [InlineData("/tracks/new", "{\"sessionDescription\":{\"type\":\"offer\",\"sdp\":\"fake\"}}")]
    [InlineData("/tracks/new", "{\"sessionDescription\":{\"type\":\"answer\",\"sdp\":\"\"}}")]
    public async Task MalformedSfuResponsesReturn502AndCloseCreatedSessions(string path, string response)
    {
        using var f = new StreamingApiFactory { FailPath = path, FailureBody = response, FailureStatus = HttpStatusCode.OK };
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var result = await admin.PostAsJsonAsync(Path(competition), new StartStreamRequest("Arena", "Main", VideoOffer, "0"));
        Assert.Equal(HttpStatusCode.BadGateway, result.StatusCode);
        if (path == "/tracks/new") Assert.Contains(f.SfuRequests, r => r.Url.EndsWith("/tracks/close"));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"iceServers\":[null]}")]
    [InlineData("{\"iceServers\":[{}]}")]
    [InlineData("{\"iceServers\":[{\"urls\":[123]}]}")]
    [InlineData("{\"iceServers\":[{\"urls\":123}]}")]
    public async Task MalformedTurnResponsesReturn502(string response)
    {
        using var f = new StreamingApiFactory { FailPath = "/turn/", FailureStatus = HttpStatusCode.OK, FailureBody = response };
        f.Settings["Cloudflare:TurnKeyId"] = "fake-key";
        f.Settings["Cloudflare:TurnKeyApiToken"] = "fake-token";
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        Assert.Equal(HttpStatusCode.BadGateway, (await admin.GetAsync(Path(competition, suffix: "/ice-servers"))).StatusCode);
    }

    [Fact]
    public async Task TransportFailuresAreSafe_AndCloseNeverFailsTheEndRequest()
    {
        using var f = new StreamingApiFactory();
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var attempt = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, attempt);
        f.FailPath = "/sessions/new";
        f.ThrowFailure = true;
        Assert.Equal(HttpStatusCode.BadGateway, (await admin.PostAsJsonAsync(Path(competition, attempt.StreamId, "/republish"), new PublishRequest(VideoOffer, "0"))).StatusCode);
        Assert.Equal(1, (await f.StreamAsync(attempt.StreamId)).Generation);
        f.FailPath = "/tracks/close";
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(Path(competition, attempt.StreamId, "/end"), null)).StatusCode);
        var client = f.Services.GetRequiredService<IHttpClientFactory>().CreateClient(CloudflareSfuClient.HttpClientName);
        Assert.Equal(TimeSpan.FromSeconds(10), client.Timeout);
    }
}
