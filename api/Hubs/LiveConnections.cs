using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using MountedGames.Api.Auth;
using MountedGames.Api.Services;
using StackExchange.Redis;

namespace MountedGames.Api.Hubs;

/// <summary>
/// The live-hub connections signed in as each account, so they can be closed the moment the account's sessions end (a
/// password reset or change, a lock, a block, deletion). A connection opened with a token keeps the identity it had at the
/// start for as long as it stays open, so without this it would carry on receiving that account's messages.
/// Only connections that authenticated as the account are kept: anonymous ones (spectators, most phones) are never touched.
/// The API runs as several instances, so "sessions ended for this account" is published through Redis and every instance
/// closes its own connections; without Redis only this instance's are closed, the same fallback as the rest of the app.
/// </summary>
public sealed class LiveConnections(RedisConnection redis, ILogger<LiveConnections> log)
{
    public static readonly RedisChannel Channel = RedisChannel.Literal("mg-live:sessions-ended");

    private readonly string _instance = Guid.NewGuid().ToString("N");
    // By connection id. Sessions end rarely, so closing one account's connections walks the lot rather than keep a second index.
    private readonly ConcurrentDictionary<string, Entry> _connections = new();
    private readonly object _gate = new();
    private IConnectionMultiplexer? _subscribedTo;

    private sealed record Entry(string UserId, HubCallerContext Context, int SessionVersion);

    /// <summary>This instance's name in published messages, so it can ignore its own.</summary>
    internal string InstanceId => _instance;

    /// <summary>Called when a connection opens. Anonymous connections are ignored.</summary>
    public void Add(HubCallerContext context)
    {
        if (context.User?.Identity?.IsAuthenticated != true || context.UserIdentifier is not { } userId) return;
        _connections[context.ConnectionId] = new Entry(userId, context, LiveAccounts.SessionVersionOf(context.User));
        EnsureSubscribed(redis.Available);
    }

    public void Remove(HubCallerContext context) => _connections.TryRemove(context.ConnectionId, out _);

    /// <summary>The accounts with a signed-in connection open on this instance.</summary>
    public IReadOnlyCollection<string> TrackedUserIds() => _connections.Values.Select(entry => entry.UserId).Distinct().ToList();

    /// <summary>
    /// Closes the connections of <paramref name="userIds"/> whose account no longer accepts the token they opened with (or no
    /// longer exists). Connections of other accounts, including ones added since the ids were read, are left alone.
    /// </summary>
    public int CloseRefused(IReadOnlyCollection<string> userIds, IReadOnlyDictionary<string, LiveAccounts.TokenState> states)
    {
        var checkedIds = userIds as ISet<string> ?? userIds.ToHashSet();
        var closed = 0;
        foreach (var entry in _connections.Values)
        {
            if (!checkedIds.Contains(entry.UserId)) continue;
            if (states.TryGetValue(entry.UserId, out var state) && state.Accepts(entry.SessionVersion)) continue;
            entry.Context.Abort();
            closed++;
        }
        return closed;
    }

    /// <summary>How many open connections on this instance are signed in as the account.</summary>
    public int CountFor(string userId) => _connections.Values.Count(entry => entry.UserId == userId);

    /// <summary>
    /// Closes the account's live connections here and, through Redis, on every other instance. With
    /// <paramref name="validFromVersion"/>, connections opened with a token issued under that session version or later are
    /// kept (the device that changed its own password); without it, every one closes.
    /// </summary>
    public async Task EndSessionsAsync(string userId, int? validFromVersion = null)
    {
        CloseHere(userId, validFromVersion);
        var connection = redis.Available;
        if (connection is null) return;
        EnsureSubscribed(connection);
        try
        {
            await connection.GetSubscriber().PublishAsync(Channel, $"{_instance}|{validFromVersion}|{userId}");
        }
        catch (Exception ex)
        {
            log.LogWarning("Could not tell other instances that an account's sessions ended: {Reason}.", ex.GetType().Name);
        }
    }

    /// <summary>A message from another instance: <c>instance|validFromVersion|userId</c>.</summary>
    internal void OnMessage(string? message)
    {
        if (message?.Split('|', 3) is not [var from, var version, var userId] || from == _instance || userId.Length == 0) return;
        CloseHere(userId, int.TryParse(version, out var validFrom) ? validFrom : null);
    }

    private void CloseHere(string userId, int? validFromVersion)
    {
        foreach (var entry in _connections.Values)
            if (entry.UserId == userId && (validFromVersion is null || entry.SessionVersion < validFromVersion))
                entry.Context.Abort();
    }

    // Subscribes once per Redis connection. Connections only need it once one of theirs is signed in, so this runs when one
    // is added (and before publishing); StackExchange.Redis keeps the subscription through reconnects of that connection.
    private void EnsureSubscribed(IConnectionMultiplexer? connection)
    {
        if (connection is null || ReferenceEquals(Volatile.Read(ref _subscribedTo), connection)) return;
        lock (_gate)
        {
            if (ReferenceEquals(_subscribedTo, connection)) return;
            try
            {
                connection.GetSubscriber().Subscribe(Channel, (_, message) => OnMessage(message));
                Volatile.Write(ref _subscribedTo, connection);
            }
            catch (Exception ex)
            {
                log.LogWarning("Could not listen for ended sessions from other instances: {Reason}.", ex.GetType().Name);
            }
        }
    }
}
