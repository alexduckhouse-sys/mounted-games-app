using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace MountedGames.Api.Hubs;

/// <summary>
/// A backstop for <see cref="LiveConnections"/>: once a minute, reads the accounts behind this instance's signed-in live
/// connections (one query, nothing at all when there are none) and closes any whose session has ended, been locked or
/// blocked, or whose account has gone. Ending a session closes connections at once through <see cref="LiveConnections"/>;
/// this catches the rare one that slipped past (an instance that missed the Redis message, say).
/// </summary>
public sealed class LiveSessionSweeper(IServiceScopeFactory scopes, LiveConnections connections, TimeProvider time,
    ILogger<LiveSessionSweeper> log) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(60);
    /// <summary>Accounts read per query; more than this many on one instance takes a second query.</summary>
    private const int Batch = 500;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var timer = new PeriodicTimer(Interval, time);
            while (await timer.WaitForNextTickAsync(stoppingToken)) await RunOnceAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    /// <returns>How many connections were closed.</returns>
    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        var userIds = connections.TrackedUserIds();
        if (userIds.Count == 0) return 0;
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var states = new Dictionary<string, LiveAccounts.TokenState>();
            foreach (var batch in userIds.Chunk(Batch))
                foreach (var state in await LiveAccounts.StatesQuery(db, batch).ToListAsync(ct))
                    states[state.Id] = state;
            var closed = connections.CloseRefused(userIds, states);
            if (closed > 0) log.LogInformation("Closed {Count} live connections whose sessions had ended.", closed);
            return closed;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            log.LogWarning("The live session sweep could not finish: {Reason}.", ex.GetType().Name);
            return 0;
        }
    }
}
