using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;
using static MountedGames.Api.Tests.Infrastructure.StreamingApiFactory;

namespace MountedGames.Api.Tests.Streaming;

public class StreamingRaceTests
{
    [Fact]
    public async Task ExpiringIntermediateTakeoverPreservesOriginalPredecessor()
    {
        using var f = new StreamingApiFactory();
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var original = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, original);
        var intermediate = await f.StartAsync(admin, competition, takeover: true);
        f.Clock.Advance(TimeSpan.FromSeconds(20));
        var replacement = await f.StartAsync(admin, competition, takeover: true);
        f.Clock.Advance(TimeSpan.FromSeconds(10));
        await f.Sweeper.SweepAsync(f.Clock.GetUtcNow().UtcDateTime);
        Assert.False(await f.WithDbAsync(db => db.LiveStreams.AnyAsync(s => s.Id == intermediate.StreamId)));
        await f.ReadyAsync(admin, competition, replacement);
        Assert.Equal(LiveStreamStatus.Ended, (await f.StreamAsync(original.StreamId)).Status);
        Assert.Equal(replacement.StreamId, (await admin.GetFromJsonAsync<LiveStreamsResponse>(Path(competition)))!.Streams.Single().Id);
    }

    [Fact]
    public async Task DeletingCompetitionEndsPublishersAndAllViewers()
    {
        using var f = new StreamingApiFactory();
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var attempt = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, attempt);
        await using var hub = await f.ConnectAsync(competition);
        var watch = await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await hub.InvokeAsync("AnswerStream", watch.WatchId, "fake-answer");
        var ended = Next<LiveStreamDto>(hub, "streamUpdated");
        using (ended.Subscription)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/competitions/{competition}")).StatusCode);
            Assert.Equal(LiveStreamStatus.Ended, (await ended.Task).Status);
        }
        Assert.Equal(0, f.Viewers.Count(attempt.StreamId));
        Assert.Equal(2, f.SfuRequests.Count(r => r.Url.EndsWith("/tracks/close")));
        Assert.False(await f.WithDbAsync(db => db.LiveStreams.AnyAsync()));
    }

    [Fact]
    public async Task AnswerWindowStartsAfterSetup_AndTimelyAnswerSurvivesSlowRenegotiation()
    {
        using var f = new StreamingApiFactory();
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var attempt = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, attempt);
        f.OnRequest = path =>
        {
            if (path.EndsWith("/tracks/new") || path.EndsWith("/sessions/new")) f.Clock.Advance(TimeSpan.FromSeconds(9));
            if (path.EndsWith("/renegotiate")) f.Clock.Advance(TimeSpan.FromSeconds(2));
        };
        await using var hub = await f.ConnectAsync();
        var watch = await hub.InvokeAsync<WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        f.Clock.Advance(TimeSpan.FromSeconds(19));
        await hub.InvokeAsync("AnswerStream", watch.WatchId, "fake-answer");
        await f.Viewers.TickAsync();
        Assert.Equal(1, f.Viewers.Count(attempt.StreamId));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ReservationIsAtomicDuringUpstreamCall_AndDisconnectReleasesIt(bool disconnect)
    {
        using var f = new StreamingApiFactory();
        f.Settings["MaxViewerSessions"] = "1";
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var attempt = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, attempt);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        f.OnRequest = path =>
        {
            if (!path.EndsWith("/tracks/new")) return;
            entered.TrySetResult();
            if (!release.Wait(TimeSpan.FromSeconds(15))) throw new TimeoutException("Test barrier was not released.");
        };
        var watching = Task.Run(() => f.Viewers.WatchAsync("first", competition, attempt.StreamId));
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(15));
            var full = await Assert.ThrowsAsync<HubException>(() => f.Viewers.WatchAsync("second", competition, attempt.StreamId));
            Assert.StartsWith("STREAM_FULL:", full.Message);
            if (disconnect) await f.Viewers.DisconnectAsync("first");
        }
        finally { release.Set(); }
        if (disconnect)
        {
            var expired = await Assert.ThrowsAsync<HubException>(() => watching);
            Assert.StartsWith("WATCH_EXPIRED:", expired.Message);
            Assert.Contains(f.SfuRequests, r => r.Url.EndsWith("/tracks/close"));
        }
        else
        {
            await watching;
            await f.Viewers.StopAsync("first", attempt.StreamId);
        }
        await f.Viewers.WatchAsync("second", competition, attempt.StreamId);
    }

    [Fact]
    public async Task PublisherEndedWhileWatchIsSettingUpReleasesTheReservation()
    {
        using var f = new StreamingApiFactory();
        f.Settings["MaxViewerSessions"] = "1";
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var attempt = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, attempt);
        f.OnRequest = path =>
        {
            if (path.EndsWith("/tracks/new"))
                f.WithDbAsync(async db =>
                {
                    var stream = await db.LiveStreams.FindAsync(attempt.StreamId);
                    stream!.Status = LiveStreamStatus.Ended;
                    await db.SaveChangesAsync();
                }).GetAwaiter().GetResult();
        };
        var error = await Assert.ThrowsAsync<HubException>(() => f.Viewers.WatchAsync("first", competition, attempt.StreamId));
        Assert.StartsWith("STREAM_NOT_FOUND:", error.Message);
        Assert.Equal(0, f.Viewers.Count(attempt.StreamId));
        Assert.Contains(f.SfuRequests, r => r.Url.EndsWith("/tracks/close"));
    }
}
