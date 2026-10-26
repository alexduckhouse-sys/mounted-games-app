using StackExchange.Redis;

namespace MountedGames.Api.Services;

/// <summary>
/// One shared Redis connection for state that must agree across API instances (rate limits, viewer counts).
/// Null when Redis isn't configured; callers fall back to this instance's own memory when it's unavailable.
/// </summary>
public sealed class RedisConnection : IDisposable
{
    private static readonly TimeSpan RetryCooldown = TimeSpan.FromSeconds(30);

    private readonly ConfigurationOptions? _options;
    private readonly ILogger<RedisConnection> _log;
    private readonly TimeProvider _time;
    private readonly object _gate = new();
    private IConnectionMultiplexer? _connection;
    private DateTimeOffset? _lastFailureAt;
    private bool _disposed;

    public RedisConnection(IConfiguration config, ILogger<RedisConnection> log, TimeProvider? time = null)
    {
        _options = RedisBackplane.Options(config);
        _log = log;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>The connection when Redis is configured and reachable right now.</summary>
    public IConnectionMultiplexer? Available
    {
        get
        {
            if (_options is null || _disposed) return null;
            var current = Volatile.Read(ref _connection);
            if (current is not null)
                return current.IsConnected ? current : null;

            lock (_gate)
            {
                if (_disposed) return null;
                if (_connection is not null)
                    return _connection.IsConnected ? _connection : null;

                var now = _time.GetUtcNow();
                if (_lastFailureAt is { } failedAt && now - failedAt < RetryCooldown)
                    return null;

                try
                {
                    _connection = ConnectionMultiplexer.Connect(_options);
                    _lastFailureAt = null;
                    return _connection.IsConnected ? _connection : null;
                }
                catch (Exception)
                {
                    _lastFailureAt = now;
                    _log.LogWarning("Redis is configured but could not be reached; using per-instance state.");
                    return null;
                }
            }
        }
    }

    public void Dispose()
    {
        IConnectionMultiplexer? toDispose;
        lock (_gate)
        {
            _disposed = true;
            toDispose = _connection;
            _connection = null;
        }
        toDispose?.Dispose();
    }
}
