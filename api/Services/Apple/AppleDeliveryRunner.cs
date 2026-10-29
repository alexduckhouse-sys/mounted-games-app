using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Apple;
namespace MountedGames.Api.Services.Apple;

public sealed class AppleDeliveryRunner(AppDbContext db, AppleOptions options, AppleSecrets secrets, IApplePushProvider provider,
    AppleProgressReader progress, ArrivalBookingService bookings, TimeProvider clock)
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;
    public Task InvalidateCompetitionAsync(int competitionId, CancellationToken ct = default) => db.Set<LiveActivityRegistration>()
        .Where(x => x.CompetitionId == competitionId && !x.Ended).ExecuteUpdateAsync(s => s.SetProperty(x => x.NextAttemptAt, Now).SetProperty(x => x.Version, x => x.Version + 1), ct);

    public async Task<int> RunAsync(CancellationToken ct)
    {
        if (!options.LiveReady && !options.WalletReady) return 0;
        using var bound = CancellationTokenSource.CreateLinkedTokenSource(ct); bound.CancelAfter(TimeSpan.FromSeconds(40)); ct = bound.Token;
        var accepted = 0;
        if (options.LiveReady)
        {
            await db.Set<LiveActivityRegistration>().Where(x => x.ExpiresAt <= Now).ExecuteUpdateAsync(s => s.SetProperty(x => x.Ended, true), ct);
            var ids = await db.Set<LiveActivityRegistration>().Where(x => !x.Ended && x.NextAttemptAt <= Now && (x.LeaseUntil == null || x.LeaseUntil <= Now))
                .OrderBy(x => x.NextAttemptAt).Select(x => x.Id).Take(30).ToListAsync(ct);
            foreach (var id in ids)
            {
                var lease = Guid.NewGuid().ToString("N"); var until = Now.AddMinutes(1);
                if (await db.Set<LiveActivityRegistration>().Where(x => x.Id == id && !x.Ended && (x.LeaseUntil == null || x.LeaseUntil <= Now))
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.LeaseToken, lease).SetProperty(x => x.LeaseUntil, until), ct) == 0) continue;
                var row = await db.Set<LiveActivityRegistration>().AsNoTracking().SingleAsync(x => x.Id == id, ct);
                var snapshot = await progress.ReadAsync(row.CompetitionId, row.TeamId, ct);
                if (snapshot == null) { await db.Set<LiveActivityRegistration>().Where(x => x.Id == id).ExecuteDeleteAsync(ct); continue; }
                var end = row.EndRequested || snapshot.Progress.Status is TeamProgressStatus.Finished or TeamProgressStatus.Withdrawn;
                var stamp = Math.Max(clock.GetUtcNow().ToUnixTimeSeconds(), row.LastTimestamp + 1);
                // Fence token rotation, unregister and invalidation immediately before provider I/O.
                if (await db.Set<LiveActivityRegistration>().Where(x => x.Id == id && x.LeaseToken == lease && x.Version == row.Version && !x.Ended)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.LastTimestamp, stamp), ct) == 0)
                { await ReleaseLive(id, lease, ct); continue; }
                var outcome = await provider.LiveAsync(secrets.Unprotect(row.ProtectedPushToken, "activity-push"), row.Sandbox,
                    ApplePushProvider.LivePayload(snapshot, stamp, end), row.ExpiresAt, ct);
                var ok = outcome == ApplePushResult.Accepted; if (ok) accepted++;
                var next = Now.AddMinutes(ok ? 2 : Math.Min(30, Math.Pow(2, Math.Min(row.Attempts, 5))));
                await db.Set<LiveActivityRegistration>().Where(x => x.Id == id && x.LeaseToken == lease && x.Version == row.Version)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.Ended, outcome == ApplePushResult.Gone || (ok && end))
                        .SetProperty(x => x.LastTimestamp, stamp).SetProperty(x => x.Attempts, ok ? 0 : row.Attempts + 1)
                        .SetProperty(x => x.NextAttemptAt, next).SetProperty(x => x.LeaseToken, (string?)null).SetProperty(x => x.LeaseUntil, (DateTime?)null), ct);
                await ReleaseLive(id, lease, ct);
            }
        }
        if (options.WalletReady)
        {
            // Bounded refresh of issued passes; the wake-up resumes at the oldest checked booking next time.
            var bookingIds = await db.Set<WalletPass>().OrderBy(x => x.LastCheckedAt).Select(x => x.ArrivalBookingId).Take(50).ToListAsync(ct);
            foreach (var id in bookingIds)
            {
                await bookings.ExecuteAsync(async () => {
                var booking = await db.Set<ArrivalBooking>().Include(x => x.Sources).ThenInclude(x => x.Allocations).SingleOrDefaultAsync(x => x.Id == id, ct);
                if (booking != null) await bookings.RefreshPassAsync(booking, false, ct);
                return true;
                }, ct);
            }
            var ids = await db.Set<WalletDeviceRegistration>().Where(x => x.PendingCursor > x.DeliveredCursor && x.NextAttemptAt <= Now && (x.LeaseUntil == null || x.LeaseUntil <= Now))
                .OrderBy(x => x.NextAttemptAt).Select(x => x.Id).Take(30).ToListAsync(ct);
            foreach (var id in ids)
            {
                var lease = Guid.NewGuid().ToString("N"); var until = Now.AddMinutes(1);
                if (await db.Set<WalletDeviceRegistration>().Where(x => x.Id == id && (x.LeaseUntil == null || x.LeaseUntil <= Now))
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.LeaseToken, lease).SetProperty(x => x.LeaseUntil, until), ct) == 0) continue;
                var row = await db.Set<WalletDeviceRegistration>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.LeaseToken == lease, ct); if (row == null) continue;
                // Unregistration deletes this row. Re-check at the send boundary.
                if (!await db.Set<WalletDeviceRegistration>().AnyAsync(x => x.Id == id && x.LeaseToken == lease, ct)) continue;
                var outcome = await provider.WalletAsync(secrets.Unprotect(row.ProtectedPushToken, "wallet-push"), ct);
                if (outcome == ApplePushResult.Gone) { await db.Set<WalletDeviceRegistration>().Where(x => x.Id == id && x.LeaseToken == lease).ExecuteDeleteAsync(ct); continue; }
                var ok = outcome == ApplePushResult.Accepted; if (ok) accepted++;
                await db.Set<WalletDeviceRegistration>().Where(x => x.Id == id && x.LeaseToken == lease)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.DeliveredCursor, ok ? row.PendingCursor : row.DeliveredCursor)
                        .SetProperty(x => x.NextAttemptAt, Now.AddMinutes(Math.Min(30, Math.Pow(2, Math.Min(row.Attempts, 5)))))
                        .SetProperty(x => x.Attempts, ok ? 0 : row.Attempts + 1).SetProperty(x => x.LeaseToken, (string?)null).SetProperty(x => x.LeaseUntil, (DateTime?)null), ct);
            }
        }
        await db.Set<LiveActivityRegistration>().Where(x => x.Ended && x.ExpiresAt < Now.AddDays(-1)).ExecuteDeleteAsync(ct);
        await db.Set<NativeInstallation>().Where(x => x.LastSeenAt < Now.AddDays(-30) && !db.Set<LiveActivityRegistration>().Any(a => a.InstallationId == x.Id)).ExecuteDeleteAsync(ct);
        return accepted;
    }
    private Task ReleaseLive(Guid id, string lease, CancellationToken ct) => db.Set<LiveActivityRegistration>().Where(x => x.Id == id && x.LeaseToken == lease)
        .ExecuteUpdateAsync(s => s.SetProperty(x => x.LeaseToken, (string?)null).SetProperty(x => x.LeaseUntil, (DateTime?)null), ct);
}
