using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using MountedGames.Api.Data;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Services;

public class CompetitionSnapshotCacheTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private CompetitionSnapshotCache NewCache() => new(factory.Services.GetRequiredService<IServiceScopeFactory>(),
        factory.Services.GetRequiredService<IHostApplicationLifetime>());

    [Fact]
    public async Task ConcurrentReadersShareOneFill_OwnScopeSurvivesCancelledCaller_AndGraphsAreIndependent()
    {
        var id = await factory.SeedCompetitionAsync();
        using var cache = NewCache();
        using var first = factory.Services.CreateScope();
        using var second = factory.Services.CreateScope();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var fills = 0;
        async Task<List<string>> Load(AppDbContext db, CancellationToken ct)
        {
            Interlocked.Increment(ref fills);
            Assert.NotSame(first.ServiceProvider.GetRequiredService<AppDbContext>(), db);
            entered.SetResult();
            await release.Task.WaitAsync(ct);
            return [await db.Competitions.Where(c => c.Id == id).Select(c => c.Name).SingleAsync(ct)];
        }
        using var cancel = new CancellationTokenSource();
        var abandoned = cache.ReadAsync(first.ServiceProvider.GetRequiredService<AppDbContext>(), id, false, "scope", Load, cancel.Token);
        await entered.Task;
        var survivor = cache.ReadAsync(second.ServiceProvider.GetRequiredService<AppDbContext>(), id, false, "scope", Load, default);
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => abandoned);
        first.Dispose();
        release.SetResult();
        var value = await survivor;
        value.Clear();
        var cached = await cache.ReadAsync(second.ServiceProvider.GetRequiredService<AppDbContext>(), id, false, "scope", Load, default);
        Assert.Single(cached);
        Assert.Equal(1, fills);
    }

    [Fact]
    public async Task FailedAndExpiredFillsAreRetried_AndTransactionsBypassCommittedSnapshots()
    {
        var id = await factory.SeedCompetitionAsync(name: "Before");
        using var cache = NewCache();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var calls = 0;
        Task<string> Read(AppDbContext fresh, CancellationToken ct)
        {
            calls++;
            return fresh.Competitions.Where(c => c.Id == id).Select(c => c.Name).SingleAsync(ct);
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => cache.ReadAsync<string>(db, id, false, "failure",
            (_, _) => throw new InvalidOperationException("Synthetic failure"), default));
        Assert.Equal("Before", await cache.ReadAsync(db, id, false, "failure", Read, default));
        for (var i = 0; i < 2; i++) await cache.ReadAsync(db, id, false, "expired", Read, default, _ => DateTime.UtcNow.AddSeconds(-1));
        Assert.Equal(3, calls);
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            await db.Competitions.Where(c => c.Id == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.Name, "Uncommitted"));
            Assert.Equal("Uncommitted", await cache.ReadAsync(db, id, false, "failure", Read, default));
            await tx.RollbackAsync();
        }
        Assert.Equal("Before", await cache.ReadAsync(db, id, false, "failure", Read, default));
        Assert.Equal(4, calls);
    }

    [Fact]
    public async Task CommitDuringFillRetries_AndIndependentInstanceCannotReuseOldRevision()
    {
        var id = await factory.SeedCompetitionAsync(name: "Before");
        using var first = NewCache();
        using var second = NewCache();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var filled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        async Task<string> Load(AppDbContext fresh, CancellationToken ct)
        {
            var name = await fresh.Competitions.Where(c => c.Id == id).Select(c => c.Name).SingleAsync(ct);
            if (Interlocked.Increment(ref calls) == 1) { filled.SetResult(); await release.Task.WaitAsync(ct); }
            return name;
        }
        async Task<string> Read(AppDbContext fresh, CancellationToken ct)
            => await fresh.Competitions.Where(c => c.Id == id).Select(c => c.Name).SingleAsync(ct);
        Assert.Equal("Before", await second.ReadAsync(db, id, true, "detail", Read, default));
        var filling = first.ReadAsync(db, id, true, "detail", Load, default);
        await filled.Task;
        await factory.InDbAsync(d => d.Competitions.Where(c => c.Id == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.Name, "Committed")));
        release.SetResult();
        Assert.Equal("Committed", await filling);
        Assert.Equal(2, calls);
        Assert.Equal("Committed", await second.ReadAsync(db, id, true, "detail", Read, default));
    }

    [Fact]
    public async Task ConstantWritesFallBackWithoutPublishingMixedSnapshot_AndOversizedPayloadIsNotRetained()
    {
        var id = await factory.SeedCompetitionAsync();
        using var cache = NewCache();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var calls = 0;
        async Task<int> Changed(AppDbContext fresh, CancellationToken ct)
        {
            calls++;
            await fresh.Competitions.Where(c => c.Id == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.Name, "Write" + calls), ct);
            return calls;
        }
        Assert.Equal(4, await cache.ReadAsync(db, id, false, "busy", Changed, default));
        var largeCalls = 0;
        Task<string> Large(AppDbContext _, CancellationToken ct) { largeCalls++; return Task.FromResult(new string('x', 4 * 1024 * 1024)); }
        await cache.ReadAsync(db, id, false, "large", Large, default);
        await cache.ReadAsync(db, id, false, "large", Large, default);
        Assert.Equal(2, largeCalls);
    }
}
