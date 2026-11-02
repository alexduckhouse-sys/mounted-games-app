using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;
using static MountedGames.Api.Tests.Infrastructure.StreamingApiFactory;

namespace MountedGames.Api.Tests.Streaming;

public class StreamsControllerTests : IClassFixture<StreamingApiFactory>
{
    private readonly StreamingApiFactory _f;
    public StreamsControllerTests(StreamingApiFactory factory) => _f = factory;

    public static IEnumerable<object[]> BroadcasterEndpoints => new[]
    {
        "start", "ready", "republish", "patch", "heartbeat", "end", "ice-servers", "stream-url"
    }.SelectMany(endpoint => new[] { "anonymous", "Member", "Manager", "other", "owner", "admin" }
        .Select(role => new object[] { endpoint, role }));

    [Theory]
    [MemberData(nameof(BroadcasterEndpoints))]
    public async Task EveryBroadcasterEndpointRequiresAdminOrOwningTrainer(string endpoint, string role)
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var competition = await _f.SeedCompetitionAsync(ownerUserId: auth.User.Id);
        using var admin = await _f.AdminAsync();
        var attempt = await _f.StartAsync(admin, competition);
        if (endpoint != "ready") await _f.ReadyAsync(admin, competition, attempt);
        using var client = role switch
        {
            "owner" => owner, "admin" => await _f.AdminAsync(), "anonymous" => _f.CreateClient(),
            "other" => await _f.TrainerAsync(), _ => (await _f.SignupAsync(role)).Client
        };
        var response = await SendEndpoint(client, endpoint, competition, attempt);
        var expected = role switch
        {
            "anonymous" => 401, "Member" or "Manager" => 403, "other" => 404,
            _ => endpoint is "heartbeat" or "end" or "stream-url" ? 204 : endpoint == "start" ? 201 : 200
        };
        Assert.Equal(expected, (int)response.StatusCode);
    }

    private static Task<HttpResponseMessage> SendEndpoint(HttpClient client, string endpoint, int competition, PublishResponse attempt) => endpoint switch
    {
        "start" => client.PostAsJsonAsync(Path(competition), new StartStreamRequest("Arena", "Other", VideoOffer, "0")),
        "ice-servers" => client.GetAsync(Path(competition, suffix: "/ice-servers")),
        "stream-url" => client.PutAsJsonAsync($"/api/competitions/{competition}/stream-url", new { streamUrl = "https://youtu.be/fake" }),
        "patch" => client.PatchAsJsonAsync(Path(competition, attempt.StreamId), new { audioMuted = true }),
        "republish" => client.PostAsJsonAsync(Path(competition, attempt.StreamId, "/republish"), new PublishRequest(VideoOffer, "0")),
        _ => client.PostAsJsonAsync(Path(competition, attempt.StreamId, $"/{endpoint}"), new { attempt = attempt.Attempt })
    };

    [Fact]
    public async Task DisabledStreamingIsEmptyAndReturns503()
    {
        using var f = new ApiFactory();
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var list = await f.CreateClient().GetFromJsonAsync<LiveStreamsResponse>(Path(competition));
        Assert.False(list!.Enabled);
        Assert.Empty(list.Streams);
        foreach (var endpoint in new[] { "start", "ice-servers", "ready", "republish", "patch", "heartbeat", "end" })
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await SendEndpoint(admin, endpoint, competition, new(1, 1, "fake"))).StatusCode);
    }

    [Fact]
    public async Task StartIsHiddenUntilReady_ThenPatchAndEndBroadcastOnlyPublicFields()
    {
        using var admin = await _f.AdminAsync();
        var competition = await _f.SeedCompetitionAsync();
        await using var hub = await _f.ConnectAsync(competition);
        var updates = new List<LiveStreamDto>();
        hub.On<LiveStreamDto>("streamUpdated", e => updates.Add(e));
        var attempt = await _f.StartAsync(admin, competition);
        Assert.Equal(1, attempt.Attempt);
        Assert.Equal("fake-answer", attempt.SdpAnswer);
        Assert.Equal(LiveStreamStatus.Starting, (await _f.StreamAsync(attempt.StreamId)).Status);
        var list = await admin.GetFromJsonAsync<LiveStreamsResponse>(Path(competition));
        Assert.Empty(list!.Streams);
        var next = Next<LiveStreamDto>(hub, "streamUpdated");
        using (next.Subscription)
        {
            var ready = await _f.ReadyAsync(admin, competition, attempt);
            Assert.Equal(LiveStreamStatus.Live, ready.Status);
            Assert.Equal(1, ready.Generation);
            Assert.True(ready.HasAudio);
            Assert.Equal(ready, await next.Task);
            Assert.Single(updates);
        }
        var json = await admin.GetStringAsync(Path(competition));
        Assert.DoesNotContain("sfu", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("pending", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("startedBy", json, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Z\"", json);
        foreach (var status in new[] { 1, 0 })
        {
            var changed = Next<LiveStreamDto>(hub, "streamUpdated");
            using (changed.Subscription)
            {
                var response = await admin.PatchAsJsonAsync(Path(competition, attempt.StreamId), new { status, audioMuted = true, caption = " Heat 1 " });
                var dto = await response.ReadAsync<LiveStreamDto>();
                Assert.Equal((LiveStreamStatus)status, dto.Status);
                Assert.Equal("Heat 1", dto.Caption);
                Assert.True(dto.AudioMuted);
                Assert.Equal(dto, await changed.Task);
            }
        }
        var ended = Next<LiveStreamDto>(hub, "streamUpdated");
        using (ended.Subscription)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(Path(competition, attempt.StreamId, "/end"), null)).StatusCode);
            Assert.Equal(LiveStreamStatus.Ended, (await ended.Task).Status);
        }
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(Path(competition, attempt.StreamId, "/end"), null)).StatusCode);
        Assert.Empty((await admin.GetFromJsonAsync<LiveStreamsResponse>(Path(competition)))!.Streams);
    }

    [Fact]
    public async Task ReadyRejectsStaleAndExpiredAttempts_RepublishPreservesCurrentUntilReady()
    {
        using var admin = await _f.AdminAsync();
        var competition = await _f.SeedCompetitionAsync();
        var first = await _f.StartAsync(admin, competition);
        var republish = await admin.PostAsJsonAsync(Path(competition, first.StreamId, "/republish"), new PublishRequest(VideoOffer, "0"));
        var second = await republish.ReadAsync<PublishResponse>();
        Assert.Equal(2, second.Attempt);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync(Path(competition, first.StreamId, "/ready"), new ReadyRequest(1))).StatusCode);
        await _f.ReadyAsync(admin, competition, second);
        var original = await _f.StreamAsync(first.StreamId);
        Assert.False(original.Simulcast);
        Assert.False(original.HasAudio);
        await admin.PatchAsJsonAsync(Path(competition, first.StreamId), new { status = 1 });
        var third = await (await admin.PostAsJsonAsync(Path(competition, first.StreamId, "/republish"), new PublishRequest(SimulcastOffer, "0", "1"))).ReadAsync<PublishResponse>();
        var pending = await _f.StreamAsync(first.StreamId);
        Assert.Equal(2, pending.Generation);
        Assert.Equal(original.SfuSessionId, pending.SfuSessionId);
        var ready = await _f.ReadyAsync(admin, competition, third);
        Assert.Equal(3, ready.Generation);
        Assert.Equal(LiveStreamStatus.Paused, ready.Status);
        Assert.True((await _f.StreamAsync(first.StreamId)).Simulcast);
        Assert.Contains(_f.SfuRequests, r => r.Url.EndsWith($"/{original.SfuSessionId}/tracks/close") && r.Body.GetProperty("force").GetBoolean());
        var fourth = await (await admin.PostAsJsonAsync(Path(competition, first.StreamId, "/republish"), new PublishRequest(VideoOffer, "0"))).ReadAsync<PublishResponse>();
        _f.Clock.Advance(TimeSpan.FromSeconds(30));
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync(Path(competition, first.StreamId, "/ready"), new ReadyRequest(fourth.Attempt))).StatusCode);
    }

    [Fact]
    public async Task TakeoverEndsPreviousOnlyAtReady_AndDuplicateAndCapChecksAreSerialised()
    {
        using var admin = await _f.AdminAsync();
        var competition = await _f.SeedCompetitionAsync();
        var first = await _f.StartAsync(admin, competition);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync(Path(competition), new StartStreamRequest("Arena", "Main", VideoOffer, "0"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync(Path(competition), new StartStreamRequest(" arena ", "MAIN", VideoOffer, "0"))).StatusCode);
        await _f.ReadyAsync(admin, competition, first);
        var replacement = await _f.StartAsync(admin, competition, takeover: true);
        Assert.Equal(LiveStreamStatus.Live, (await _f.StreamAsync(first.StreamId)).Status);
        await using var hub = await _f.ConnectAsync(competition);
        var got = Next<LiveStreamDto>(hub, "streamUpdated");
        using (got.Subscription)
        {
            await _f.ReadyAsync(admin, competition, replacement);
            Assert.Equal(first.StreamId, (await got.Task).Id);
            Assert.Equal(LiveStreamStatus.Ended, (await got.Task).Status);
        }
        var concurrent = await Task.WhenAll(Enumerable.Range(0, 12).Select(i =>
            admin.PostAsJsonAsync(Path(competition), new StartStreamRequest("Arena", $"Angle {i}", VideoOffer, "0"))));
        Assert.Equal(8, concurrent.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.Equal(4, concurrent.Count(r => r.StatusCode == HttpStatusCode.Conflict));
        var otherCompetition = await _f.SeedCompetitionAsync();
        var duplicateRace = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ =>
            admin.PostAsJsonAsync(Path(otherCompetition), new StartStreamRequest("Arena", "Main", VideoOffer, "0"))));
        Assert.Single(duplicateRace, r => r.StatusCode == HttpStatusCode.Created);
        Assert.Single(duplicateRace, r => r.StatusCode == HttpStatusCode.Conflict);
    }

    [Theory]
    [InlineData("arena-empty")]
    [InlineData("angle-empty")]
    [InlineData("arena-long")]
    [InlineData("angle-long")]
    [InlineData("video-empty")]
    [InlineData("offer-long")]
    [InlineData("offer-unicode")]
    [InlineData("offer-empty")]
    public async Task InvalidPublishRequestsReturnValidationProblem(string invalid)
    {
        using var admin = await _f.AdminAsync();
        var competition = await _f.SeedCompetitionAsync();
        var request = new StartStreamRequest(invalid == "arena-empty" ? " " : invalid == "arena-long" ? new string('a', 81) : "Arena",
            invalid == "angle-empty" ? " " : invalid == "angle-long" ? new string('a', 61) : "Main",
            invalid == "offer-long" ? new string('a', 20481) : invalid == "offer-unicode" ? new string('é', 10241) : invalid == "offer-empty" ? "" : VideoOffer,
            invalid == "video-empty" ? " " : "0");
        var response = await admin.PostAsJsonAsync(Path(competition), request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await response.ReadAsync<JsonElement>()).TryGetProperty("errors", out _));
        Assert.False(await _f.WithDbAsync(db => db.LiveStreams.AnyAsync(s => s.CompetitionId == competition)));
    }

    [Theory]
    [InlineData("/sessions/new", 500, "{}")]
    [InlineData("/tracks/new", 502, "{}")]
    [InlineData("/sessions/new", 200, "{\"errorCode\":\"NO_SESSION\"}")]
    [InlineData("/tracks/new", 200, "{\"tracks\":[{\"mid\":\"0\",\"errorCode\":\"TRACK_FAILED\"}]}")]
    [InlineData("/tracks/new", 200, "{\"errorCode\":\"OFFER_FAILED\"}")]
    public async Task UpstreamFailureLeavesNoRow(string path, int status, string body)
    {
        using var f = new StreamingApiFactory { FailPath = path, FailureStatus = (HttpStatusCode)status, FailureBody = body };
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var result = await admin.PostAsJsonAsync(Path(competition), new StartStreamRequest("Arena", "Main", VideoOffer, "0"));
        Assert.Equal(HttpStatusCode.BadGateway, result.StatusCode);
        Assert.False(await f.WithDbAsync(db => db.LiveStreams.AnyAsync()));
        if (path == "/tracks/new") Assert.Contains(f.SfuRequests, r => r.Url.EndsWith("/tracks/close"));
    }

    [Fact]
    public async Task TrimsNames_CaptionOmittedIsUnchanged_NullAndEmptyClear_HeartbeatAndEndedConflicts()
    {
        using var admin = await _f.AdminAsync();
        var competition = await _f.SeedCompetitionAsync();
        var attempt = await (await admin.PostAsJsonAsync(Path(competition), new StartStreamRequest(" Arena ", " Main ", VideoOffer, "0"))).ReadAsync<PublishResponse>();
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PatchAsJsonAsync(Path(competition, attempt.StreamId), new { status = 1 })).StatusCode);
        var ready = await _f.ReadyAsync(admin, competition, attempt);
        Assert.Equal("Arena", ready.ArenaName);
        Assert.Equal("Main", ready.AngleName);
        foreach (var clear in new string?[] { "", null })
        {
            await admin.PatchAsJsonAsync(Path(competition, attempt.StreamId), new { caption = "Heat 1" });
            var omitted = await admin.PatchAsJsonAsync(Path(competition, attempt.StreamId), new { audioMuted = false });
            Assert.Equal("Heat 1", (await omitted.ReadAsync<LiveStreamDto>()).Caption);
            var cleared = await admin.PatchAsJsonAsync(Path(competition, attempt.StreamId), new { caption = clear });
            Assert.Null((await cleared.ReadAsync<LiveStreamDto>()).Caption);
        }
        foreach (var invalid in new object[] { new { status = 2 }, new { status = 3 }, new { caption = new string('c', 81) }, new { caption = 12 } })
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PatchAsJsonAsync(Path(competition, attempt.StreamId), invalid)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(Path(competition, attempt.StreamId, "/republish"), new PublishRequest(VideoOffer, ""))).StatusCode);
        _f.Clock.Advance(TimeSpan.FromSeconds(15));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(Path(competition, attempt.StreamId, "/heartbeat"), null)).StatusCode);
        Assert.Equal(_f.Clock.GetUtcNow().UtcDateTime, (await _f.StreamAsync(attempt.StreamId)).LastHeartbeatAt);
        await admin.PostAsync(Path(competition, attempt.StreamId, "/end"), null);
        foreach (var endpoint in new[] { "ready", "heartbeat", "republish", "patch" })
            Assert.Equal(HttpStatusCode.Conflict, (await SendEndpoint(admin, endpoint, competition, attempt)).StatusCode);
    }

    [Fact]
    public async Task ForeignStreamIs404OnEveryStreamEndpoint()
    {
        using var admin = await _f.AdminAsync();
        var first = await _f.SeedCompetitionAsync();
        var other = await _f.SeedCompetitionAsync();
        var attempt = await _f.StartAsync(admin, first);
        foreach (var endpoint in new[] { "ready", "republish", "patch", "heartbeat", "end" })
            Assert.Equal(HttpStatusCode.NotFound, (await SendEndpoint(admin, endpoint, other, attempt)).StatusCode);
    }

    [Fact]
    public async Task IceServersUseStunByDefault_AndTurnIsFilteredCachedAndRefreshed()
    {
        using var admin = await _f.AdminAsync();
        var competition = await _f.SeedCompetitionAsync();
        var stun = await admin.GetFromJsonAsync<JsonElement>(Path(competition, suffix: "/ice-servers"));
        Assert.Equal("stun:stun.cloudflare.com:3478", stun.GetProperty("iceServers")[0].GetProperty("urls").GetString());
        using var f = new StreamingApiFactory();
        f.Settings["Cloudflare:TurnKeyId"] = "fake-turn";
        f.Settings["Cloudflare:TurnKeyApiToken"] = "fake-turn-token";
        using var turnAdmin = await f.AdminAsync();
        var turnComp = await f.SeedCompetitionAsync();
        var path = Path(turnComp, suffix: "/ice-servers");
        var ice = await turnAdmin.GetStringAsync(path);
        Assert.DoesNotContain(":53", ice);
        Assert.Contains("fake-turn-credential", ice);
        Assert.Equal(ice, await turnAdmin.GetStringAsync(path));
        Assert.Single(f.SfuRequests);
        var request = f.SfuRequests.Single();
        Assert.Equal("fake-turn-token", request.Token);
        Assert.Equal(21600, request.Body.GetProperty("ttl").GetInt32());
        f.Clock.Advance(TimeSpan.FromHours(1));
        Assert.Equal(HttpStatusCode.OK, (await turnAdmin.GetAsync(path)).StatusCode);
        Assert.Equal(2, f.SfuRequests.Count);
        f.Clock.Advance(TimeSpan.FromHours(1));
        f.FailPath = "/turn/";
        Assert.Equal(HttpStatusCode.BadGateway, (await turnAdmin.GetAsync(path)).StatusCode);
    }

    [Fact]
    public async Task StreamUrlChangesOnlyTheLink_AndCanBeCleared()
    {
        using var admin = await _f.AdminAsync();
        var competition = await _f.SeedCompetitionAsync();
        await _f.WithDbAsync(async db =>
        {
            var c = await db.Competitions.FindAsync(competition);
            c!.OrganiserName = "Fake organiser";
            c.PaymentDestination = "Fake payment instructions";
            await db.SaveChangesAsync();
        });
        foreach (var url in new string?[] { "https://youtube.com/watch?v=fake", null })
        {
            Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync($"/api/competitions/{competition}/stream-url", new { streamUrl = url })).StatusCode);
            var stored = await _f.WithDbAsync(db => db.Competitions.AsNoTracking().SingleAsync(c => c.Id == competition));
            Assert.Equal(url, stored.StreamUrl);
            Assert.Equal("Fake organiser", stored.OrganiserName);
            Assert.Equal("Fake payment instructions", stored.PaymentDestination);
        }
    }

    [Fact]
    public async Task HeartbeatTelemetry_AndCommandEndpoint_BroadcastEvents_AndAllowScopedStreamLinks()
    {
        using var admin = await _f.AdminAsync();
        var competition = await _f.SeedCompetitionAsync();
        var attempt = await _f.StartAsync(admin, competition, "Main Arena");
        await using var hub = await _f.ConnectAsync(competition);

        var telemetries = new List<JsonElement>();
        var commands = new List<JsonElement>();
        hub.On<JsonElement>("streamTelemetry", payload => telemetries.Add(payload));
        hub.On<JsonElement>("streamCommand", payload => commands.Add(payload));

        // Heartbeat with telemetry body updates AudioMuted and broadcasts streamTelemetry
        var hbResp = await admin.PostAsJsonAsync(Path(competition, attempt.StreamId, "/heartbeat"), new StreamTelemetryRequest(
            BatteryLevel: 0.82,
            BatteryCharging: true,
            Zoom: 2.0,
            MaxZoom: 4.0,
            Fps: 30,
            BitrateKbps: 2450,
            Signal: "good",
            AudioMuted: true,
            WindFilter: true,
            QualityPreset: "720p",
            CaptureResolution: "3840x2160"));
        Assert.Equal(HttpStatusCode.NoContent, hbResp.StatusCode);

        var updatedStream = await _f.WithDbAsync(db => db.LiveStreams.AsNoTracking().SingleAsync(s => s.Id == attempt.StreamId));
        Assert.True(updatedStream.AudioMuted);

        // Invalid JSON in heartbeat returns 400
        using var badHb = new HttpRequestMessage(HttpMethod.Post, Path(competition, attempt.StreamId, "/heartbeat"))
        {
            Content = new StringContent("{broken", System.Text.Encoding.UTF8, "application/json"),
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.SendAsync(badHb)).StatusCode);

        // Scoped link (Scope = 2 ScoreAndStream) can call /ice-servers and /command, while Scope = 0 Score is rejected (401)
        const string scoreOnlyToken = "mgs_score_only_token_123456";
        const string streamControlToken = "mgs_stream_ctrl_token_123456";
        var now = _f.Clock.GetUtcNow().UtcDateTime;
        await _f.WithDbAsync(async db =>
        {
            db.ScorerLinks.Add(new ScorerLink
            {
                CompetitionId = competition,
                Label = "Score Only",
                ArenaName = "Arena",
                Scope = 0,
                TokenHash = ScorerLinkTokens.Hash(scoreOnlyToken),
                CreatedByUserId = "admin",
                CreatedAt = now,
                ExpiresAt = now.AddDays(1),
            });
            db.ScorerLinks.Add(new ScorerLink
            {
                CompetitionId = competition,
                Label = "Judge + Stream",
                ArenaName = "Arena",
                Scope = 2,
                TokenHash = ScorerLinkTokens.Hash(streamControlToken),
                CreatedByUserId = "admin",
                CreatedAt = now,
                ExpiresAt = now.AddDays(1),
            });
            await db.SaveChangesAsync();
        });

        using var scoreOnlyClient = _f.CreateClient();
        scoreOnlyClient.DefaultRequestHeaders.Add(ScorerLinkTokens.Header, scoreOnlyToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await scoreOnlyClient.GetAsync(Path(competition, suffix: "/ice-servers"))).StatusCode);

        using var streamLinkClient = _f.CreateClient();
        streamLinkClient.DefaultRequestHeaders.Add(ScorerLinkTokens.Header, streamControlToken);
        Assert.Equal(HttpStatusCode.OK, (await streamLinkClient.GetAsync(Path(competition, suffix: "/ice-servers"))).StatusCode);

        // Valid commands (setZoom, selectAngle) return 204 NoContent
        var zoomCmd = await streamLinkClient.PostAsJsonAsync(Path(competition, attempt.StreamId, "/command"), new StreamCommandRequest("setZoom", "2"));
        Assert.Equal(HttpStatusCode.NoContent, zoomCmd.StatusCode);

        var cutCmd = await streamLinkClient.PostAsJsonAsync(Path(competition, attempt.StreamId, "/command"), new StreamCommandRequest("selectAngle", attempt.StreamId.ToString()));
        Assert.Equal(HttpStatusCode.NoContent, cutCmd.StatusCode);

        // Unsupported command returns 400 BadRequest
        var badCmd = await streamLinkClient.PostAsJsonAsync(Path(competition, attempt.StreamId, "/command"), new StreamCommandRequest("selfDestruct", "1"));
        Assert.Equal(HttpStatusCode.BadRequest, badCmd.StatusCode);
    }

    [Fact]
    public async Task HeartbeatTelemetry_SendsHealthToSpectators_ButDeviceStateOnlyToStaff()
    {
        var ownerAuth = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        using var owner = _f.WithToken(ownerAuth.Token);
        var competition = await _f.SeedCompetitionAsync(ownerUserId: ownerAuth.User.Id);
        var attempt = await _f.StartAsync(owner, competition, "Main Arena");

        await using var spectator = await _f.ConnectAsync(competition);
        await using var staff = await _f.ConnectAsync(competition, token: ownerAuth.Token);

        var staffFull = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        staff.On<JsonElement>("streamTelemetry", p =>
        {
            if (p.TryGetProperty("batteryLevel", out var b) && b.ValueKind == JsonValueKind.Number) staffFull.TrySetResult(p);
        });
        var spectatorEvents = new List<JsonElement>();
        spectator.On<JsonElement>("streamTelemetry", p => { lock (spectatorEvents) spectatorEvents.Add(p); });

        var hb = await owner.PostAsJsonAsync(Path(competition, attempt.StreamId, "/heartbeat"), new StreamTelemetryRequest(
            BatteryLevel: 0.82, BatteryCharging: true, Zoom: 2.0, MaxZoom: 4.0, Fps: 30, BitrateKbps: 2450,
            Signal: "good", AudioMuted: true, WindFilter: true, QualityPreset: "720p", CaptureResolution: "3840x2160"));
        Assert.Equal(HttpStatusCode.NoContent, hb.StatusCode);

        // Staff get the publisher's full device state.
        var full = await staffFull.Task.WaitAsync(TimeSpan.FromSeconds(15));
        Assert.Equal(0.82, full.GetProperty("batteryLevel").GetDouble());
        Assert.Equal(2.0, full.GetProperty("zoom").GetDouble());

        // Spectators only ever get stream health (frame rate, signal), never battery or zoom.
        await Task.Delay(500);
        List<JsonElement> seen;
        lock (spectatorEvents) seen = spectatorEvents.ToList();
        Assert.NotEmpty(seen);
        Assert.All(seen, p =>
        {
            Assert.Equal(30, p.GetProperty("fps").GetInt32());
            Assert.Equal("good", p.GetProperty("signal").GetString());
            Assert.False(p.TryGetProperty("batteryLevel", out var b) && b.ValueKind == JsonValueKind.Number);
            Assert.False(p.TryGetProperty("zoom", out var z) && z.ValueKind == JsonValueKind.Number);
        });
    }
}
