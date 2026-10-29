using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;

namespace MountedGames.Api.Services;

/// <summary>Recoverable invalidations. Duplicate publication is harmless: clients reload current state.</summary>
public sealed class WindDecisionDelivery(IServiceScopeFactory scopes, ILogger<WindDecisionDelivery> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await DeliverAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { log.LogWarning(ex, "Wind programme invalidation will retry."); }
        }
    }
    public async Task DeliverAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var live = scope.ServiceProvider.GetRequiredService<ILiveBroadcaster>();
        var pending = await db.Set<WindRaceDecision>().Where(d => d.PublishedAt == null).OrderBy(d => d.Id).Take(20).ToListAsync(ct);
        foreach (var decision in pending)
        {
            var session = await db.Sessions.AsNoTracking().Include(s => s.Section)
                .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
                .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(r => r.Team)
                .SingleOrDefaultAsync(s => s.Id == decision.SessionId && s.CompetitionId == decision.CompetitionId, ct);
            if (session != null) await live.SessionUpdated(decision.CompetitionId, session.ToDto());
            decision.PublishedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
        }
    }
}
