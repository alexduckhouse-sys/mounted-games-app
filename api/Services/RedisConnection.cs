using StackExchange.Redis;

namespace MountedGames.Api.Services;

/// <summary>
/// One shared Redis connection for state that must agree across API instances (rate limits, viewer counts).
/// Null when Redis isn't configured; callers fall back to this instance's own memory when it's unavailable.
/// </summary>
public sealed class RedisConnection : IDisposable
{
    private readonly Lazy<IConnectionMultiplexer?> _connection;

    public RedisConnection(IConfiguration config, ILogger<RedisConnection> log)
    {
        var options = RedisBackplane.Options(config);
        _connection = new Lazy<IConnectionMultiplexer?>(() =>
        {
            if (options is null) return null;
            try { return ConnectionMultiplexer.Connect(options); }
            catch (Exception) { log.LogWarning("Redis is configured but could not be reached; using per-instance state."); return null; }
        });
    }

    /// <summary>The connection when Redis is configured and reachable right now.</summary>
    public IConnectionMultiplexer? Available => _connection.Value is { IsConnected: true } connection ? connection : null;

    public void Dispose()
    {
        if (_connection.IsValueCreated) _connection.Value?.Dispose();
    }
}
