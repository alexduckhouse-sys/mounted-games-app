using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using MountedGames.Api.Data;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Streaming;
using MountedGames.Api.Tests.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Hubs;

/// <summary>
/// The backstops for live connections whose session ended without word reaching this instance: the check made again once a
/// connection is recorded, and the once-a-minute sweep. To stage "the session ended after the sign-in check", this host
/// skips the per-request account check, so only the hub's own checks stand in the way.
/// </summary>
public class LiveSessionSweepTests(LiveSessionSweepTests.Factory f) : IClassFixture<LiveSessionSweepTests.Factory>
{
    public sealed class Factory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services => services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme,
                options => options.Events.OnTokenValidated = _ => Task.CompletedTask));
        }
    }

    private LiveConnections Registry => f.Services.GetRequiredService<LiveConnections>();

    private LiveSessionSweeper Sweeper(TimeProvider? clock = null, IServiceScopeFactory? scopes = null, LiveConnections? registry = null)
        => new(scopes ?? f.Services.GetRequiredService<IServiceScopeFactory>(), registry ?? Registry, clock ?? TimeProvider.System,
            NullLogger<LiveSessionSweeper>.Instance);

    private Task EndSessionUnannouncedAsync(string userId) => f.WithDbAsync(db =>
        db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s.SetProperty(u => u.SessionVersion, u => u.SessionVersion + 1)));

    [Fact]
    public async Task AConnectionWhoseSessionEndedBeforeItWasRecorded_IsClosedOnConnect()
    {
        var (_, auth) = await f.SignupAsync("Member");
        await EndSessionUnannouncedAsync(auth.User.Id);
        f.CreateClient();
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => f.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                o.AccessTokenProvider = () => Task.FromResult<string?>(auth.Token);
            })
            .Build();
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.Closed += _ => { closed.TrySetResult(); return Task.CompletedTask; };

        try { await connection.StartAsync(); }
        catch (Exception) { closed.TrySetResult(); }

        await closed.Task.WaitAsync(LiveSessionEndTests.Timeout);
        await ResetSteps.EventuallyAsync(() => Registry.CountFor(auth.User.Id) == 0, "the refused connection to be forgotten");
        await connection.DisposeAsync();
    }

    [Fact]
    public async Task AConnectionWithACurrentSessionStaysOpen()
    {
        var (_, auth) = await f.SignupAsync("Member");
        await using var live = await LiveSessionEndTests.ConnectAsync(f, auth.Token);
        Assert.Equal(1, Registry.CountFor(auth.User.Id));
        await Sweeper().RunOnceAsync(CancellationToken.None);
        Assert.Equal(HubConnectionState.Connected, live.Connection.State);
        Assert.Equal(1, Registry.CountFor(auth.User.Id));
    }

    [Fact]
    public async Task TheSweepClosesConnectionsWhoseSessionEndedUnannounced_AndNobodyElses()
    {
        var (_, ended) = await f.SignupAsync("Member");
        var (_, current) = await f.SignupAsync("Member");
        var (_, blocked) = await f.SignupAsync("Member");
        await using var endedLive = await LiveSessionEndTests.ConnectAsync(f, ended.Token);
        await using var currentLive = await LiveSessionEndTests.ConnectAsync(f, current.Token);
        await using var blockedLive = await LiveSessionEndTests.ConnectAsync(f, blocked.Token);
        await using var spectator = await LiveSessionEndTests.ConnectAsync(f);
        await EndSessionUnannouncedAsync(ended.User.Id);
        await f.WithDbAsync(db => db.Users.Where(u => u.Id == blocked.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.BlockedAt, DateTime.UtcNow)));

        Assert.True(await Sweeper().RunOnceAsync(CancellationToken.None) >= 2);

        await endedLive.Closed.WaitAsync(LiveSessionEndTests.Timeout);
        await blockedLive.Closed.WaitAsync(LiveSessionEndTests.Timeout);
        Assert.Equal(HubConnectionState.Connected, currentLive.Connection.State);
        Assert.Equal(HubConnectionState.Connected, spectator.Connection.State);
    }

    [Fact]
    public async Task TheSweepRunsEveryMinute_AndStopsCleanly()
    {
        var clock = new ManualTimeProvider();
        var sweeper = Sweeper(clock);
        await sweeper.StartAsync(CancellationToken.None);
        var (_, auth) = await f.SignupAsync("Member");
        await using var live = await LiveSessionEndTests.ConnectAsync(f, auth.Token);
        await EndSessionUnannouncedAsync(auth.User.Id);

        clock.Advance(LiveSessionSweeper.Interval - TimeSpan.FromSeconds(1));
        Assert.Equal(HubConnectionState.Connected, live.Connection.State);
        clock.Advance(TimeSpan.FromSeconds(1));

        await live.Closed.WaitAsync(LiveSessionEndTests.Timeout);
        await sweeper.StopAsync(CancellationToken.None).WaitAsync(LiveSessionEndTests.Timeout);
        sweeper.Dispose();
    }

    [Fact]
    public async Task WithNoSignedInConnectionsTheSweepDoesNothing()
    {
        // A scope factory that fails shows no database work is even started.
        var empty = new LiveConnections(f.Services.GetRequiredService<RedisConnection>(), NullLogger<LiveConnections>.Instance);
        Assert.Equal(0, await Sweeper(scopes: new NoScopes(), registry: empty).RunOnceAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ASweepThatFailsClosesNothing_AndTriesAgainNextTime()
    {
        var (_, auth) = await f.SignupAsync("Member");
        await using var live = await LiveSessionEndTests.ConnectAsync(f, auth.Token);
        await EndSessionUnannouncedAsync(auth.User.Id);

        Assert.Equal(0, await Sweeper(scopes: new NoScopes()).RunOnceAsync(CancellationToken.None));
        Assert.Equal(HubConnectionState.Connected, live.Connection.State);

        Assert.True(await Sweeper().RunOnceAsync(CancellationToken.None) >= 1);
        await live.Closed.WaitAsync(LiveSessionEndTests.Timeout);
    }

    [Fact]
    public async Task AConnectionWhoseSessionCheckThrows_IsNotLeftRecorded()
    {
        var registry = new LiveConnections(f.Services.GetRequiredService<RedisConnection>(), NullLogger<LiveConnections>.Instance);
        AppDbContext gone;
        using (var scope = f.Services.CreateScope()) gone = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var hub = new LiveHub(f.Services.GetRequiredService<ViewerRegistry>(), registry, gone) { Context = new SignedInContext("someone") };

        await Assert.ThrowsAnyAsync<ObjectDisposedException>(hub.OnConnectedAsync);

        Assert.Equal(0, registry.CountFor("someone"));
    }

    [Fact]
    public void WithoutRedis_EverySweepReadsTheDatabase()
    {
        // Nothing arrives from other instances, so the sweep is the only way word of an ended session gets here.
        Assert.True(Registry.SweepNeeded());
        Assert.True(Registry.SweepNeeded());
    }

    [Fact]
    public void WithRedisSetButNotListening_TheSweepReadsTheDatabase()
    {
        // Configured, but this instance never subscribed (Redis was down when its connections opened). Building the
        // connection only reads the setting; nothing here talks to Redis.
        using var redis = new RedisConnection(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Redis:ConnectionString"] = "127.0.0.1:1" }).Build(),
            NullLogger<RedisConnection>.Instance);
        Assert.True(redis.Configured);
        var registry = new LiveConnections(redis, NullLogger<LiveConnections>.Instance);
        Assert.True(registry.SweepNeeded());
    }

    [RedisFact]
    public async Task WithRedisListening_TheSweepLeavesTheDatabaseAlone_UntilThisInstanceSeesRedisFail()
    {
        using var redisHost = new RedisFactory();
        var registry = redisHost.Services.GetRequiredService<LiveConnections>();
        var (_, auth) = await redisHost.SignupAsync("Member");
        await using var live = await LiveSessionEndTests.ConnectAsync(redisHost, auth.Token);
        await redisHost.WithDbAsync(db => db.Users.Where(u => u.Id == auth.User.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.SessionVersion, u => u.SessionVersion + 1)));
        var sweeper = new LiveSessionSweeper(redisHost.Services.GetRequiredService<IServiceScopeFactory>(), registry,
            TimeProvider.System, NullLogger<LiveSessionSweeper>.Instance);

        // Listening and nothing failed: every ended session was announced, so the tick is skipped (and a scope factory
        // that fails would show any database work).
        var idle = new LiveSessionSweeper(new NoScopes(), registry, TimeProvider.System, NullLogger<LiveSessionSweeper>.Instance);
        Assert.Equal(0, await idle.RunOnceAsync(CancellationToken.None));
        Assert.Equal(HubConnectionState.Connected, live.Connection.State);

        // A failed sweep or a Redis failure seen here means a message may have been missed: the next sweep reads.
        registry.MarkMissed();
        Assert.Equal(0, await idle.RunOnceAsync(CancellationToken.None));
        Assert.Equal(HubConnectionState.Connected, live.Connection.State);
        Assert.True(await sweeper.RunOnceAsync(CancellationToken.None) >= 1);
        await live.Closed.WaitAsync(LiveSessionEndTests.Timeout);
        Assert.False(registry.SweepNeeded());
    }

    /// <summary>The sweep tests' host (no per-request account check), pointed at the test Redis.</summary>
    private sealed class RedisFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Redis:ConnectionString", RedisFactAttribute.Url);
            builder.ConfigureServices(services => services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme,
                options => options.Events.OnTokenValidated = _ => Task.CompletedTask));
        }
    }

    /// <summary>A hub connection signed in as <paramref name="userId"/>, for calling the hub directly.</summary>
    private sealed class SignedInContext(string userId) : HubCallerContext
    {
        public override string ConnectionId { get; } = Guid.NewGuid().ToString("N");
        public override string? UserIdentifier => userId;
        public override ClaimsPrincipal? User { get; } = new(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId)], "test"));
        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
        public override IFeatureCollection Features { get; } = new FeatureCollection();
        public override CancellationToken ConnectionAborted => CancellationToken.None;
        public override void Abort() { }
    }

    private sealed class NoScopes : IServiceScopeFactory
    {
        public IServiceScope CreateScope() => throw new InvalidOperationException("No database here.");
    }
}
