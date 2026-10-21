namespace MountedGames.Api.Services.Streaming;

/// <summary>Bounded, process-local locks shared by publisher writes and the sweeper.</summary>
public sealed class CompetitionStreamLocks : IDisposable
{
    private readonly SemaphoreSlim[] _locks = Enumerable.Range(0, 128).Select(_ => new SemaphoreSlim(1, 1)).ToArray();

    public async Task<IDisposable> AcquireAsync(int competitionId, CancellationToken ct = default)
    {
        var semaphore = _locks[(uint)competitionId % (uint)_locks.Length];
        await semaphore.WaitAsync(ct);
        return new Lease(semaphore);
    }

    private sealed class Lease(SemaphoreSlim semaphore) : IDisposable
    {
        public void Dispose() => semaphore.Release();
    }

    public void Dispose()
    {
        foreach (var semaphore in _locks) semaphore.Dispose();
    }
}
