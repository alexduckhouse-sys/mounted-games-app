using System.Collections.Concurrent;
using StackExchange.Redis;

namespace MountedGames.Api.Services.Streaming;

/// <summary>
/// Viewer totals across API instances. Each instance records its own count for a stream in a Redis hash,
/// and the total is the sum of reports from the last 45 seconds, so an instance that goes away drops out.
/// Without Redis, this instance's own count is the total, as before.
/// </summary>
public sealed class SharedViewerCounts(RedisConnection redis, TimeProvider time, ILogger<SharedViewerCounts> log)
{
    /// <summary>Re-record an unchanged count this often, so it isn't taken for stale.</summary>
    public static readonly TimeSpan Refresh = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan Stale = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(5);

    private readonly string _instance = Guid.NewGuid().ToString("N");
    private readonly ConcurrentDictionary<int, (int Total, DateTimeOffset At)> _totals = new();

    /// <summary>Whether counts are shared with other instances right now.</summary>
    public bool Shared => redis.Available is not null;

    private static RedisKey Key(int streamId) => $"mg:viewers:{streamId}";

    /// <summary>Records this instance's count for a stream and returns the total across instances.</summary>
    public async Task<int> ReportAsync(int streamId, int local)
    {
        var db = redis.Available?.GetDatabase();
        if (db is null) return local;
        var now = time.GetUtcNow();
        try
        {
            if (local > 0) await db.HashSetAsync(Key(streamId), _instance, $"{local}:{now.ToUnixTimeSeconds()}");
            else await db.HashDeleteAsync(Key(streamId), _instance);
            await db.KeyExpireAsync(Key(streamId), TimeSpan.FromMinutes(2));
            return await ReadAsync(db, streamId, now);
        }
        catch (Exception)
        {
            log.LogWarning("Could not share the viewer count for stream {StreamId}.", streamId);
            return local;
        }
    }

    /// <summary>The latest total across instances (cached for a few seconds), or <paramref name="local"/> without Redis.</summary>
    public async Task<int> TotalAsync(int streamId, int local)
    {
        var db = redis.Available?.GetDatabase();
        if (db is null) return local;
        var now = time.GetUtcNow();
        if (_totals.TryGetValue(streamId, out var cached) && now - cached.At < CacheFor) return cached.Total;
        try { return await ReadAsync(db, streamId, now); }
        catch (Exception) { return local; }
    }

    private async Task<int> ReadAsync(IDatabase db, int streamId, DateTimeOffset now)
    {
        var total = 0;
        foreach (var entry in await db.HashGetAllAsync(Key(streamId)))
        {
            var parts = ((string?)entry.Value)?.Split(':');
            if (parts is [var count, var at] && int.TryParse(count, out var n) && long.TryParse(at, out var seconds)
                && now.ToUnixTimeSeconds() - seconds <= Stale.TotalSeconds)
                total += n;
        }
        _totals[streamId] = (total, now);
        return total;
    }
}
