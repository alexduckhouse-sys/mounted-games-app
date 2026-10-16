using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;
using static MountedGames.Api.Tests.Infrastructure.StreamingApiFactory;

namespace MountedGames.Api.Tests.Streaming;

public class StreamSweeperTests
{
    [Fact]
    public async Task StartupGraceProtectsStreams_ThenStaleLiveAndPausedEndButFreshSurvives()
    {
        using var f = new StreamingApiFactory();
        using var admin = await f.AdminAsync();
        var sweeper = f.Sweeper;
        var competition = await f.SeedCompetitionAsync();
        var live = await f.StartAsync(admin, competition, "Live");
        var paused = await f.StartAsync(admin, competition, "Paused");
        var fresh = await f.StartAsync(admin, competition, "Fresh");
        foreach (var stream in new[] { live, paused, fresh }) await f.ReadyAsync(admin, competition, stream);
        await admin.PatchAsJsonAsync(Path(competition, paused.StreamId), new { status = 1 });
        await f.WithDbAsync(async db =>
        {
            foreach (var stream in await db.LiveStreams.ToListAsync()) stream.LastHeartbeatAt = f.Clock.GetUtcNow().UtcDateTime.AddMinutes(-5);
            await db.SaveChangesAsync();
        });
        await sweeper.SweepAsync(f.Clock.GetUtcNow().UtcDateTime);
        Assert.Equal(LiveStreamStatus.Live, (await f.StreamAsync(live.StreamId)).Status);
        Assert.Equal(LiveStreamStatus.Paused, (await f.StreamAsync(paused.StreamId)).Status);
        f.Clock.Advance(TimeSpan.FromSeconds(180));
        await admin.PostAsync(Path(competition, fresh.StreamId, "/heartbeat"), null);
        await using var hub = await f.ConnectAsync(competition);
        var ended = Next<LiveStreamDto>(hub, "streamUpdated");
        using (ended.Subscription)
        {
            await sweeper.SweepAsync(f.Clock.GetUtcNow().UtcDateTime);
            Assert.Equal(LiveStreamStatus.Ended, (await ended.Task).Status);
        }
        Assert.Equal(LiveStreamStatus.Ended, (await f.StreamAsync(live.StreamId)).Status);
        Assert.Equal(LiveStreamStatus.Ended, (await f.StreamAsync(paused.StreamId)).Status);
        Assert.Equal(f.Clock.GetUtcNow().UtcDateTime, (await f.StreamAsync(live.StreamId)).EndedAt);
        Assert.Equal(LiveStreamStatus.Live, (await f.StreamAsync(fresh.StreamId)).Status);
        Assert.Equal(2, f.SfuRequests.Count(r => r.Url.EndsWith("/tracks/close")));
        await sweeper.SweepAsync(f.Clock.GetUtcNow().UtcDateTime);
        Assert.Equal(2, f.SfuRequests.Count(r => r.Url.EndsWith("/tracks/close")));
    }

    [Fact]
    public async Task AttemptNumbersNeverRepeat_SoALateReadyForAnExpiredAttemptIsRejected()
    {
        using var f = new StreamingApiFactory();
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var visible = await f.StartAsync(admin, competition, "Visible");
        await f.ReadyAsync(admin, competition, visible);
        var republish = Path(competition, visible.StreamId, "/republish");
        var expired = await (await admin.PostAsJsonAsync(republish, new PublishRequest(VideoOffer, "0"))).ReadAsync<PublishResponse>();
        f.Clock.Advance(TimeSpan.FromSeconds(30));
        await f.Sweeper.SweepAsync(f.Clock.GetUtcNow().UtcDateTime);
        var next = await (await admin.PostAsJsonAsync(republish, new PublishRequest(VideoOffer, "0"))).ReadAsync<PublishResponse>();
        Assert.True(next.Attempt > expired.Attempt);
        Assert.Equal(HttpStatusCode.Conflict,
            (await admin.PostAsJsonAsync(Path(competition, visible.StreamId, "/ready"), new ReadyRequest(expired.Attempt))).StatusCode);
        Assert.Equal(next.Attempt, (await f.ReadyAsync(admin, competition, next)).Generation);
    }

    [Fact]
    public async Task ExpiredStartingRowsAreDeleted_VisiblePendingAttemptsAreCleared_EvenDuringGrace()
    {
        using var f = new StreamingApiFactory();
        using var admin = await f.AdminAsync();
        var sweeper = f.Sweeper;
        var competition = await f.SeedCompetitionAsync();
        var starting = await f.StartAsync(admin, competition, "Starting");
        var visible = await f.StartAsync(admin, competition, "Visible");
        await f.ReadyAsync(admin, competition, visible);
        var old = await f.StreamAsync(visible.StreamId);
        var pending = await (await admin.PostAsJsonAsync(Path(competition, visible.StreamId, "/republish"), new PublishRequest(VideoOffer, "0"))).ReadAsync<PublishResponse>();
        f.Clock.Advance(TimeSpan.FromSeconds(29));
        await sweeper.SweepAsync(f.Clock.GetUtcNow().UtcDateTime);
        Assert.NotNull((await f.StreamAsync(visible.StreamId)).PendingAttempt);
        Assert.Equal(LiveStreamStatus.Starting, (await f.StreamAsync(starting.StreamId)).Status);
        f.Clock.Advance(TimeSpan.FromSeconds(1));
        await sweeper.SweepAsync(f.Clock.GetUtcNow().UtcDateTime);
        Assert.False(await f.WithDbAsync(db => db.LiveStreams.AnyAsync(s => s.Id == starting.StreamId)));
        var current = await f.StreamAsync(visible.StreamId);
        Assert.Equal(pending.Attempt, current.PendingAttempt);
        Assert.Null(current.PendingSince);
        Assert.Null(current.PendingSfuSessionId);
        Assert.Equal("[]", current.PendingTrackMids);
        Assert.Equal(old.Generation, current.Generation);
        Assert.Equal(old.SfuSessionId, current.SfuSessionId);
        Assert.Equal(LiveStreamStatus.Live, current.Status);
        Assert.Equal(2, f.SfuRequests.Count(r => r.Url.EndsWith("/tracks/close")));
    }

    [Fact]
    public async Task SqliteGuardAddsLiveStreamsToAnExistingDatabase_AndIsIdempotent()
    {
        using var f = new StreamingApiFactory();
        f.CreateClient();
        var competition = await f.SeedCompetitionAsync();
        await f.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("DROP TABLE LiveStreams"));
        await DbInitializer.SeedAsync(f.Services);
        await DbInitializer.SeedAsync(f.Services);
        using var admin = await f.AdminAsync();
        var attempt = await f.StartAsync(admin, competition);
        await f.ReadyAsync(admin, competition, attempt);
        var stored = await f.StreamAsync(attempt.StreamId);
        Assert.Equal("Arena", stored.ArenaName);
        Assert.Equal(1, stored.Generation);
        Assert.NotEmpty(JsonSerializer.Deserialize<string[]>(stored.SfuTrackMids)!);
        await f.WithDbAsync(async db =>
        {
            db.Competitions.Remove((await db.Competitions.FindAsync(competition))!);
            await db.SaveChangesAsync();
            Assert.False(await db.LiveStreams.AnyAsync(s => s.Id == attempt.StreamId));
        });
    }
}
