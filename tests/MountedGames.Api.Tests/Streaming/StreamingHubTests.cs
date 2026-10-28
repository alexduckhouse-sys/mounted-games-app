using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Dtos;
using MountedGames.Api.Hubs;
using MountedGames.Api.Tests.Infrastructure;
using static MountedGames.Api.Tests.Infrastructure.StreamingApiFactory;

namespace MountedGames.Api.Tests.Streaming;

public class StreamingHubTests : IClassFixture<StreamingApiFactory>
{
    private readonly StreamingApiFactory _f;
    public StreamingHubTests(StreamingApiFactory factory) => _f = factory;

    internal static async Task<(HttpClient Admin, int Competition, PublishResponse Attempt)> LiveAsync(StreamingApiFactory f, bool audio = true, bool simulcast = true)
    {
        var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var attempt = await f.StartAsync(admin, competition, audio: audio, simulcast: simulcast);
        await f.ReadyAsync(admin, competition, attempt);
        return (admin, competition, attempt);
    }

    private static async Task ErrorAsync(string code, Func<Task> call)
    {
        var error = await Assert.ThrowsAsync<HubException>(call);
        Assert.Contains($"{code}: ", error.Message);
        Assert.DoesNotContain("fake-sfu", error.Message);
        Assert.DoesNotContain("fake-app-token", error.Message);
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task AnonymousWatchAndAnswerPullOnlyPublishedTracks(bool audio, bool simulcast)
    {
        var (admin, competition, attempt) = await LiveAsync(_f, audio, simulcast);
        using (admin)
        await using (var hub = await _f.ConnectAsync(competition))
        {
            var watch = await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
            Assert.True(Guid.TryParse(watch.WatchId, out _));
            Assert.Equal("fake-offer", watch.SdpOffer);
            Assert.Equal(1, watch.Generation);
            Assert.Single(watch.IceServers);
            var pull = _f.SfuRequests.Last(r => r.Url.EndsWith("/tracks/new"));
            Assert.DoesNotContain(watch.WatchId, pull.Url);
            Assert.Equal("fake-app-token", pull.Token);
            var tracks = pull.Body.GetProperty("tracks");
            Assert.Equal(audio ? 2 : 1, tracks.GetArrayLength());
            Assert.Equal("remote", tracks[0].GetProperty("location").GetString());
            Assert.Equal("video", tracks[0].GetProperty("trackName").GetString());
            Assert.Equal((await _f.StreamAsync(attempt.StreamId)).SfuSessionId, tracks[0].GetProperty("sessionId").GetString());
            Assert.Equal(simulcast, tracks[0].TryGetProperty("simulcast", out var layers));
            if (simulcast)
            {
                Assert.Equal("f", layers.GetProperty("preferredRid").GetString());
                Assert.Equal("asciibetical", layers.GetProperty("priorityOrdering").GetString());
                Assert.Equal("asciibetical", layers.GetProperty("ridNotAvailable").GetString());
            }
            if (audio) Assert.Equal("audio", tracks[1].GetProperty("trackName").GetString());
            Assert.Equal(0, _f.Viewers.Count(attempt.StreamId));
            await hub.InvokeAsync("AnswerStream", watch.WatchId, "fake-viewer-answer");
            Assert.Equal(1, _f.Viewers.Count(attempt.StreamId));
            // Retrying the same answer is harmless and doesn't inflate the count.
            await hub.InvokeAsync("AnswerStream", watch.WatchId, "fake-viewer-answer");
            Assert.Equal(1, _f.Viewers.Count(attempt.StreamId));
            Assert.Equal(1, (await admin.GetFromJsonAsync<LiveStreamsResponse>(Path(competition)))!.Streams.Single().ViewerCount);
            var answer = _f.SfuRequests.Last(r => r.Url.EndsWith("/renegotiate"));
            Assert.Equal("PUT", answer.Method);
            Assert.Equal("answer", answer.Body.GetProperty("sessionDescription").GetProperty("type").GetString());
            await hub.InvokeAsync("StopWatching", attempt.StreamId);
            Assert.Equal(0, _f.Viewers.Count(attempt.StreamId));
            var close = _f.SfuRequests.Last();
            Assert.EndsWith("/tracks/close", close.Url);
            Assert.Equal(audio ? 2 : 1, close.Body.GetProperty("tracks").GetArrayLength());
            await hub.InvokeAsync("StopWatching", attempt.StreamId);
        }
    }

    [Fact]
    public async Task ForeignWatchIdAndInvalidAnswersAreRejected_ExpiredAnswersReleaseTheSlot()
    {
        using var f = new StreamingApiFactory();
        f.Settings["MaxViewerSessions"] = "1";
        var (_, competition, attempt) = await LiveAsync(f);
        await using var owner = await f.ConnectAsync();
        await using var foreign = await f.ConnectAsync();
        var watch = await owner.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await ErrorAsync("WATCH_EXPIRED", () => foreign.InvokeAsync("AnswerStream", watch.WatchId, "fake-answer"));
        await ErrorAsync("INVALID_REQUEST", () => owner.InvokeAsync("AnswerStream", watch.WatchId, new string('a', 20481)));
        await ErrorAsync("INVALID_REQUEST", () => owner.InvokeAsync("AnswerStream", watch.WatchId, " "));
        await ErrorAsync("STREAM_FULL", () => foreign.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId));
        f.Clock.Advance(TimeSpan.FromSeconds(20));
        await f.Viewers.TickAsync();
        await ErrorAsync("WATCH_EXPIRED", () => owner.InvokeAsync("AnswerStream", watch.WatchId, "fake-answer"));
        Assert.Contains(f.SfuRequests, r => r.Url.EndsWith("/tracks/close"));
        var fresh = await foreign.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await foreign.InvokeAsync("AnswerStream", fresh.WatchId, "fake-answer");
        Assert.Equal(1, f.Viewers.Count(attempt.StreamId));
    }

    [Fact]
    public async Task AnonymousViewersAreCappedPerIp_NotPerStreamOrPerConnection()
    {
        using var f = new StreamingApiFactory();
        f.Settings["MaxViewersPerIp"] = "2";
        var (_, competition, attempt) = await LiveAsync(f);
        await using var a = await f.ConnectAsync(ip: "198.51.100.1");
        await using var b = await f.ConnectAsync(ip: "198.51.100.1");
        await using var other = await f.ConnectAsync(ip: "198.51.100.2");

        await a.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await b.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        // Re-watching the same stream on a connection replaces its watch; it doesn't add one.
        await a.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await using var third = await f.ConnectAsync(ip: "198.51.100.1");
        await ErrorAsync("RATE_LIMITED", () => third.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId));
        // A different address is unaffected.
        await other.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        // Letting go frees the slot.
        await b.InvokeAsync("StopWatching", attempt.StreamId);
        await third.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
    }

    [Fact]
    public async Task AnonymousViewersWithAnUntrustedAddressAreNotCappedPerIp()
    {
        using var f = new StreamingApiFactory();
        f.Settings["MaxViewersPerIp"] = "1";
        var (_, competition, attempt) = await LiveAsync(f);
        // Direct hub connections carry no proxy key, so their shared address says nothing about the viewer.
        await using var a = await f.ConnectAsync(ip: "198.51.100.1", trustedIp: false);
        await using var b = await f.ConnectAsync(ip: "198.51.100.1", trustedIp: false);
        await a.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await b.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
    }

    [Fact]
    public async Task RegistryCapIgnoresViewersWithNoAddress_AndFreesSlotsOnDisconnect()
    {
        using var f = new StreamingApiFactory();
        f.Settings["MaxViewersPerIp"] = "1";
        var (_, competition, attempt) = await LiveAsync(f);

        await f.Viewers.WatchAsync("known-1", competition, attempt.StreamId, clientIp: "198.51.100.9");
        var full = await Assert.ThrowsAsync<HubException>(() => f.Viewers.WatchAsync("known-2", competition, attempt.StreamId, clientIp: "198.51.100.9"));
        Assert.Contains("RATE_LIMITED: ", full.Message);
        // No address (signed in, or unknown) means no per-address cap.
        await f.Viewers.WatchAsync("none-1", competition, attempt.StreamId);
        await f.Viewers.WatchAsync("none-2", competition, attempt.StreamId);
        await f.Viewers.DisconnectAsync("known-1");
        await f.Viewers.WatchAsync("known-2", competition, attempt.StreamId, clientIp: "198.51.100.9");
    }

    [Fact]
    public async Task StartingEndedMissingAndForeignStreamsCannotBeWatched()
    {
        using var admin = await _f.AdminAsync();
        var competition = await _f.SeedCompetitionAsync();
        var attempt = await _f.StartAsync(admin, competition);
        await using var hub = await _f.ConnectAsync();
        await ErrorAsync("STREAM_NOT_FOUND", () => hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId));
        await _f.ReadyAsync(admin, competition, attempt);
        await ErrorAsync("STREAM_NOT_FOUND", () => hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition + 10000, attempt.StreamId));
        await ErrorAsync("STREAM_NOT_FOUND", () => hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, int.MaxValue));
        await admin.PostAsync(Path(competition, attempt.StreamId, "/end"), null);
        await ErrorAsync("STREAM_NOT_FOUND", () => hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId));
    }

    [Fact]
    public async Task RewatchReplacesAndClosesPreviousSession_EvenAtTheCap_DisconnectClosesCurrent()
    {
        using var f = new StreamingApiFactory();
        f.Settings["MaxViewerSessions"] = "1";
        var (_, competition, attempt) = await LiveAsync(f);
        await using var hub = await f.ConnectAsync();
        var first = await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await hub.InvokeAsync("AnswerStream", first.WatchId, "fake-answer");
        var second = await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        Assert.NotEqual(first.WatchId, second.WatchId);
        Assert.Equal(0, f.Viewers.Count(attempt.StreamId));
        await ErrorAsync("WATCH_EXPIRED", () => hub.InvokeAsync("AnswerStream", first.WatchId, "fake-answer"));
        Assert.Single(f.SfuRequests, r => r.Url.EndsWith("/tracks/close"));
        await hub.InvokeAsync("AnswerStream", second.WatchId, "fake-answer");
        await hub.StopAsync();
        // The server closes the current session in its disconnect handler, after StopAsync has returned.
        Assert.True(await StreamingApiFactory.EventuallyAsync(() => f.SfuRequests.Count(r => r.Url.EndsWith("/tracks/close")) == 2));
        Assert.Equal(0, f.Viewers.Count(attempt.StreamId));
    }

    [Fact]
    public async Task PerConnectionLimitIsTenCallsPerMinute()
    {
        using var f = new StreamingApiFactory();
        var (_, competition, attempt) = await LiveAsync(f);
        await using var hub = await f.ConnectAsync();
        for (var i = 0; i < 10; i++) await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await ErrorAsync("RATE_LIMITED", () => hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId));
        f.Clock.Advance(TimeSpan.FromMinutes(1));
        var watch = await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        Assert.True(Guid.TryParse(watch.WatchId, out _));
    }

    [Fact]
    public async Task GlobalBucketHasBurst40AndRefillsAtConfiguredRate()
    {
        using var f = new StreamingApiFactory();
        f.Settings["ViewerSessionsPerSecond"] = "2";
        var (_, competition, attempt) = await LiveAsync(f);
        for (var i = 0; i < 40; i++) await f.Viewers.WatchAsync($"fake-connection-{i}", competition, attempt.StreamId);
        await using var hub = await f.ConnectAsync();
        await ErrorAsync("RATE_LIMITED", () => hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId));
        f.Clock.Advance(TimeSpan.FromMilliseconds(500));
        await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await ErrorAsync("RATE_LIMITED", () => hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId));
    }

    [Theory]
    [InlineData("/sessions/new", 502, "{}")]
    [InlineData("/tracks/new", 200, "{\"tracks\":[{\"errorCode\":\"FAILED\",\"mid\":\"0\"}]}")]
    [InlineData("/tracks/new", 200, "{\"sessionDescription\":{\"type\":\"offer\",\"sdp\":\"fake-offer\"},\"tracks\":[]}")]
    [InlineData("/renegotiate", 200, "{\"errorCode\":\"FAILED\"}")]
    [InlineData("/renegotiate", 502, "{}")]
    [InlineData("/turn/", 500, "{}")]
    public async Task UpstreamFailuresReleaseReservedSlots(string path, int status, string body)
    {
        using var f = new StreamingApiFactory();
        f.Settings["MaxViewerSessions"] = "1";
        f.Settings["Cloudflare:TurnKeyId"] = "fake-turn";
        f.Settings["Cloudflare:TurnKeyApiToken"] = "fake-token";
        var (_, competition, attempt) = await LiveAsync(f);
        await using var hub = await f.ConnectAsync();
        f.FailPath = path; f.FailureBody = body; f.FailureStatus = (HttpStatusCode)status;
        if (path == "/renegotiate")
        {
            var watch = await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
            await ErrorAsync("UPSTREAM_UNAVAILABLE", () => hub.InvokeAsync("AnswerStream", watch.WatchId, "fake-answer"));
        }
        else await ErrorAsync("UPSTREAM_UNAVAILABLE", () => hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId));
        Assert.Equal(0, f.Viewers.Count(attempt.StreamId));
        f.FailPath = null;
        var retry = await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        Assert.DoesNotContain(":53", JsonSerializer.Serialize(retry.IceServers));
        await hub.InvokeAsync("AnswerStream", retry.WatchId, "fake-answer");
        Assert.Equal(1, f.Viewers.Count(attempt.StreamId));
    }

    [Fact]
    public async Task ViewerCountsAreTrailingAndCoalesced_AndOnlySendChanges()
    {
        using var f = new StreamingApiFactory();
        var (_, competition, attempt) = await LiveAsync(f);
        await using var witness = await f.ConnectAsync(competition);
        var events = new List<JsonElement>();
        witness.On<JsonElement>("streamViewers", payload => events.Add(payload));
        var one = await f.Viewers.WatchAsync("one", competition, attempt.StreamId);
        var two = await f.Viewers.WatchAsync("two", competition, attempt.StreamId);
        await f.Viewers.AnswerAsync("one", one.WatchId, "fake-answer");
        await f.Viewers.AnswerAsync("two", two.WatchId, "fake-answer");
        f.Clock.Advance(TimeSpan.FromSeconds(4));
        await f.Viewers.TickAsync();
        Assert.Empty(events);
        var first = Next<JsonElement>(witness, "streamViewers");
        using (first.Subscription)
        {
            f.Clock.Advance(TimeSpan.FromSeconds(1));
            await f.Viewers.TickAsync();
            Assert.Equal(2, (await first.Task).GetProperty("count").GetInt32());
            Assert.Equal(attempt.StreamId, (await first.Task).GetProperty("streamId").GetInt32());
        }
        await f.Viewers.StopAsync("one", attempt.StreamId);
        var three = await f.Viewers.WatchAsync("three", competition, attempt.StreamId);
        await f.Viewers.AnswerAsync("three", three.WatchId, "fake-answer");
        f.Clock.Advance(TimeSpan.FromSeconds(5));
        await f.Viewers.TickAsync();
        // A later public event is a transport barrier, proving no unchanged count was sent.
        var barrier = Next<JsonElement>(witness, "announcement");
        using (barrier.Subscription)
        {
            await f.Services.GetRequiredService<ILiveBroadcaster>().Announcement(competition, new { test = true });
            await barrier.Task;
            Assert.Single(events);
        }
        var zero = Next<JsonElement>(witness, "streamViewers");
        using (zero.Subscription)
        {
            await f.Viewers.DisconnectAsync("two");
            await f.Viewers.DisconnectAsync("three");
            f.Clock.Advance(TimeSpan.FromSeconds(5));
            await f.Viewers.TickAsync();
            Assert.Equal(0, (await zero.Task).GetProperty("count").GetInt32());
            Assert.Equal(2, events.Count);
        }
    }

    [Fact]
    public async Task EndingAStreamClosesAnsweredAndPendingViewers()
    {
        var (admin, competition, attempt) = await LiveAsync(_f);
        using (admin)
        {
            var one = await _f.Viewers.WatchAsync("end-one", competition, attempt.StreamId);
            await _f.Viewers.AnswerAsync("end-one", one.WatchId, "fake-answer");
            await _f.Viewers.WatchAsync("end-two", competition, attempt.StreamId);
            await admin.PostAsync(Path(competition, attempt.StreamId, "/end"), null);
            Assert.Equal(0, _f.Viewers.Count(attempt.StreamId));
            await ErrorAsync("WATCH_EXPIRED", () => _f.Viewers.AnswerAsync("end-one", one.WatchId, "fake-answer"));
        }
    }

    [Fact]
    public async Task WatchStreamTier_SelectsRequestedSimulcastLayer()
    {
        var (admin, competition, attempt) = await LiveAsync(_f);
        using (admin)
        {
            await using var hub = await _f.ConnectAsync();
            var watchHalf = await hub.InvokeAsync<WatchStreamResponse>("WatchStreamTier", competition, attempt.StreamId, "h");
            Assert.False(string.IsNullOrEmpty(watchHalf.WatchId));
            await hub.InvokeAsync("AnswerStream", watchHalf.WatchId, "fake-answer");

            var watchQuarter = await hub.InvokeAsync<WatchStreamResponse>("WatchStreamTier", competition, attempt.StreamId, "q");
            Assert.False(string.IsNullOrEmpty(watchQuarter.WatchId));
        }
    }
}
