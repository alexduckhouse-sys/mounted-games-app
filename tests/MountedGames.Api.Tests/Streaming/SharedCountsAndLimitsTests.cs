using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Streaming;
using MountedGames.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.SignalR.Client;
using StackExchange.Redis;

namespace MountedGames.Api.Tests.Streaming;

/// <summary>State shared between API instances through Redis: viewer totals and rate limits.</summary>
public class SharedCountsAndLimitsTests
{
    private static RedisConnection Connect(string? url = null) => new(
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Redis:ConnectionString"] = url ?? RedisFactAttribute.Url }).Build(),
        NullLogger<RedisConnection>.Instance);

    private static SharedViewerCounts Counts(RedisConnection redis, TimeProvider time) => new(redis, time, NullLogger<SharedViewerCounts>.Instance);

    private static int NewStreamId() => Random.Shared.Next(1_000_000, int.MaxValue);

    [RedisFact]
    public async Task ViewerTotals_AddUpEveryInstance_AndDropStaleOnes()
    {
        using var redis = Connect();
        var clockA = new ManualTimeProvider();
        var clockB = new ManualTimeProvider();
        var a = Counts(redis, clockA);
        var b = Counts(redis, clockB);
        var stream = NewStreamId();

        Assert.True(a.Shared);
        Assert.Equal(2, await a.ReportAsync(stream, 2));
        Assert.Equal(5, await b.ReportAsync(stream, 3));
        Assert.Equal(2, await a.TotalAsync(stream, 2)); // A's own read is cached for 5 s
        clockA.Advance(TimeSpan.FromSeconds(6));
        Assert.Equal(5, await a.TotalAsync(stream, 2));

        clockA.Advance(TimeSpan.FromSeconds(40)); // B last reported 46 s ago by A's clock
        Assert.Equal(1, await a.ReportAsync(stream, 1));

        Assert.Equal(0, await a.ReportAsync(stream, 0));
        await redis.Available!.GetDatabase().KeyDeleteAsync($"mg:viewers:{stream}");
    }

    [RedisFact]
    public async Task ViewerTotals_AreCachedBriefly_AndIgnoreJunk()
    {
        using var redis = Connect();
        var clock = new ManualTimeProvider();
        var counts = Counts(redis, clock);
        var stream = NewStreamId();
        var db = redis.Available!.GetDatabase();
        await db.HashSetAsync($"mg:viewers:{stream}", [new("x", "garbled"), new("y", $"4:{clock.GetUtcNow().ToUnixTimeSeconds()}")]);

        Assert.Equal(4, await counts.TotalAsync(stream, 0));
        await db.HashSetAsync($"mg:viewers:{stream}", "z", $"10:{clock.GetUtcNow().ToUnixTimeSeconds()}");
        Assert.Equal(4, await counts.TotalAsync(stream, 0));
        clock.Advance(TimeSpan.FromSeconds(6));
        Assert.Equal(14, await counts.TotalAsync(stream, 0));
        await db.KeyDeleteAsync($"mg:viewers:{stream}");
    }

    [Fact]
    public async Task WithoutReachableRedis_EachInstanceCountsAlone()
    {
        using var unreachable = Connect("localhost:1,connectTimeout=200,abortConnect=false");
        using var none = new RedisConnection(new ConfigurationBuilder().Build(), NullLogger<RedisConnection>.Instance);

        foreach (var redis in new[] { unreachable, none })
        {
            var counts = Counts(redis, new ManualTimeProvider());
            Assert.False(counts.Shared);
            Assert.Equal(3, await counts.ReportAsync(1, 3));
            Assert.Equal(3, await counts.TotalAsync(1, 3));
        }
    }

    [RedisFact]
    public async Task SignInLimit_IsSharedByEveryInstance()
    {
        using var one = new RedisApiFactory(authPerMinute: 3);
        using var two = new RedisApiFactory(authPerMinute: 3);
        var ip = $"203.0.113.{Random.Shared.Next(1, 254)}";
        var statuses = new List<HttpStatusCode>();
        var address = $"nobody-{Guid.NewGuid():N}@example.test";
        for (var i = 0; i < 4; i++)
        {
            var client = (i % 2 == 0 ? one : two).CreateClient();
            client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, ip);
            var r = await client.PostAsJsonAsync("/api/auth/login", new { email = address, password = "wrong-password-1" });
            statuses.Add(r.StatusCode);
        }

        Assert.All(statuses.Take(3), s => Assert.NotEqual(HttpStatusCode.TooManyRequests, s));
        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[3]);
    }

    [RedisFact]
    public async Task SignInVenueCeiling_IsSharedEvenWhenAccountNamesRotate()
    {
        using var one = new RedisApiFactory(authPerIpPerMinute: 3);
        using var two = new RedisApiFactory(authPerIpPerMinute: 3);
        var ip = $"2001:db8::{Random.Shared.Next(1, 65535):x}";
        for (var i = 0; i < 4; i++)
        {
            using var client = (i % 2 == 0 ? one : two).CreateClient();
            client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, ip);
            var response = await client.PostAsJsonAsync("/api/auth/login", new { email = $"fake-{i}@example.invalid", password = "wrong" });
            Assert.Equal(i < 3 ? HttpStatusCode.Unauthorized : HttpStatusCode.TooManyRequests, response.StatusCode);
        }
    }

    [RedisFact]
    public async Task ViewerRegistry_ReSharesASteadyCount()
    {
        using var f = new StreamingApiFactory();
        f.AppSettings["Redis:ConnectionString"] = RedisFactAttribute.Url!;
        var registry = f.Services.GetRequiredService<ViewerRegistry>();
        var shared = f.Services.GetRequiredService<SharedViewerCounts>();
        Assert.True(shared.Shared);
        var (_, competition, attempt) = await StreamingHubTests.LiveAsync(f);
        await using var hub = await f.ConnectAsync();
        var watch = await hub.InvokeAsync<MountedGames.Api.Dtos.WatchStreamResponse>("WatchStream", competition, attempt.StreamId);
        await hub.InvokeAsync("AnswerStream", watch.WatchId, "fake-answer");

        f.Clock.Advance(TimeSpan.FromSeconds(6));
        await registry.TickAsync();
        Assert.Equal(1, await registry.TotalAsync(attempt.StreamId));
        var db = f.Services.GetRequiredService<RedisConnection>().Available!.GetDatabase();
        await db.HashDeleteAsync($"mg:viewers:{attempt.StreamId}", (await db.HashKeysAsync($"mg:viewers:{attempt.StreamId}")).Single());

        f.Clock.Advance(SharedViewerCounts.Refresh);
        await registry.TickAsync();
        Assert.Single(await db.HashKeysAsync($"mg:viewers:{attempt.StreamId}"));
        await db.KeyDeleteAsync($"mg:viewers:{attempt.StreamId}");
    }
}
