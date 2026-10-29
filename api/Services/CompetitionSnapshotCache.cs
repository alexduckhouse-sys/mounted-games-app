using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// Short public snapshots fenced by database revisions. Every hit checks a committed version,
/// so separate instances and missed Redis messages cannot serve a previous revision. Fills own
/// their scope and timeout; cancelling one HTTP request does not cancel other readers' work.
/// Stored JSON is immutable and each caller receives its own object graph.
/// </summary>
public sealed class CompetitionSnapshotCache(IServiceScopeFactory scopes, IHostApplicationLifetime lifetime) : IDisposable
{
    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = 32 * 1024 * 1024 });
    private readonly ConcurrentDictionary<Key, Lazy<Task<byte[]>>> _fills = new();
    private sealed record Key(int CompetitionId, bool Detail, string Variant, long Revision, long SharedRevision);
    private sealed class Changed : Exception;

    internal static async Task<(long Local, long Shared)> VersionAsync(AppDbContext db, int competitionId, bool detail, CancellationToken ct)
    {
        var rows = await db.Set<CompetitionReadRevision>().AsNoTracking()
            .Where(r => r.CompetitionId == competitionId || (detail && r.CompetitionId == 0))
            .Select(r => new { r.CompetitionId, Version = detail ? r.Detail : r.Standings }).ToListAsync(ct);
        return (rows.FirstOrDefault(r => r.CompetitionId == competitionId)?.Version ?? 0,
            rows.FirstOrDefault(r => r.CompetitionId == 0)?.Version ?? 0);
    }

    public async Task<T> ReadAsync<T>(AppDbContext caller, int competitionId, bool detail, string variant,
        Func<AppDbContext, CancellationToken, Task<T>> load, CancellationToken ct,
        Func<T, DateTime?>? validUntil = null)
    {
        if (caller.Database.CurrentTransaction is not null || System.Transactions.Transaction.Current is not null)
            return await load(caller, ct);

        for (var attempt = 0; attempt < 3; attempt++)
        {
            var version = await VersionAsync(caller, competitionId, detail, ct);
            var key = new Key(competitionId, detail, variant, version.Local, version.Shared);
            if (_cache.TryGetValue<byte[]>(key, out var bytes) && bytes is not null)
                return JsonSerializer.Deserialize<T>(bytes)!;
            var lazy = _fills.GetOrAdd(key, _ => new Lazy<Task<byte[]>>(() => FillAsync(key, load, validUntil)));
            var task = lazy.Value;
            // Remove on completion even if every waiting request was cancelled.
            _ = task.ContinueWith(completed =>
            {
                // Observe faults even when all HTTP waiters have disconnected.
                if (completed.IsFaulted) _ = completed.Exception;
                _fills.TryRemove(new KeyValuePair<Key, Lazy<Task<byte[]>>>(key, lazy));
            },
                CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            try { return JsonSerializer.Deserialize<T>(await task.WaitAsync(ct))!; }
            catch (Changed) { /* A writer committed during the fill: use its new revision. */ }
        }
        // Continuous writes should not starve readers or publish a mixed snapshot to the cache.
        return await load(caller, ct);
    }

    private async Task<byte[]> FillAsync<T>(Key key, Func<AppDbContext, CancellationToken, Task<T>> load, Func<T, DateTime?>? validUntil)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.ApplicationStopping);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var expected = (key.Revision, key.SharedRevision);
        if (await VersionAsync(db, key.CompetitionId, key.Detail, timeout.Token) != expected) throw new Changed();
        var value = await load(db, timeout.Token);
        if (await VersionAsync(db, key.CompetitionId, key.Detail, timeout.Token) != expected) throw new Changed();
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        var expires = DateTime.UtcNow.AddSeconds(5);
        if (validUntil?.Invoke(value) is { } until && until < expires) expires = until;
        if (expires > DateTime.UtcNow && bytes.Length <= 4 * 1024 * 1024)
            _cache.Set(key, bytes, new MemoryCacheEntryOptions { AbsoluteExpiration = new DateTimeOffset(DateTime.SpecifyKind(expires, DateTimeKind.Utc)), Size = bytes.Length });
        return bytes;
    }

    public void Dispose() => _cache.Dispose();
}
