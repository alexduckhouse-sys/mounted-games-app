using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Notifications;

public sealed record ReminderRunResult(int Claimed, int Accepted, int Recovered);

/// <summary>At-least-once delivery. A provider acceptance followed by a crash can still produce a repeat.</summary>
public sealed class ReminderRunner(AppDbContext db, PushNotifier push, TimeProvider clock)
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;
    private static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);
    private const int BatchSize = 50;

    public async Task<ReminderRunResult> RunAsync(CancellationToken ct)
    {
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(ct);
        bounded.CancelAfter(TimeSpan.FromSeconds(45));
        ct = bounded.Token;
        var now = Now;
        await ReconcileAsync(now, ct);
        await db.NotificationDeliveries.Where(d => d.Notification.ExpiresAt <= now
                && (d.Status == NotificationDeliveryStatus.Pending || (d.Status == NotificationDeliveryStatus.Claimed && d.ClaimedUntil <= now)))
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.Status, NotificationDeliveryStatus.Expired)
                .SetProperty(d => d.ClaimToken, (string?)null).SetProperty(d => d.ClaimedUntil, (DateTime?)null)
                .SetProperty(d => d.UpdatedAt, now), ct);
        var claimed = 0;
        var accepted = 0;
        var recovered = 0;
        while (true)
        {
            var ids = await Eligible(Now).OrderBy(d => d.NextAttemptAt).ThenBy(d => d.Id).Select(d => d.Id).Take(BatchSize).ToListAsync(ct);
            if (ids.Count == 0) break;
            foreach (var id in ids)
            {
                ct.ThrowIfCancellationRequested();
                var previousRecoveries = await db.NotificationDeliveries.Where(d => d.Id == id).Select(d => (int?)d.RecoveredLeases).SingleOrDefaultAsync(ct);
                var token = await ClaimAsync(id, ct);
                if (token is null) continue;
                claimed++;
                var delivery = await db.NotificationDeliveries.AsNoTracking().Include(d => d.Notification).Include(d => d.Subscription)
                    .SingleOrDefaultAsync(d => d.Id == id && d.ClaimToken == token, ct);
                if (delivery is null) continue; // Unsubscription/deletion can remove it during a claim.
                if (delivery.RecoveredLeases > previousRecoveries) recovered++;
                // Re-read the real schedule AND current recipients after claiming. No payload saved in the queue.
                var plan = (await ReminderPlan.LoadAsync(db, Now, ct, delivery.Notification.CompetitionId))
                    .SingleOrDefault(p => p.Key == delivery.Notification.ReminderKey);
                if (delivery.Notification.ExpiresAt <= Now)
                {
                    await CompleteAsync(id, token, NotificationDeliveryStatus.Expired, null, ct);
                    continue;
                }
                if (plan is null || !plan.Users.Contains(delivery.Subscription.UserId))
                {
                    await CompleteAsync(id, token, NotificationDeliveryStatus.Cancelled, "no-longer-eligible", ct);
                    continue;
                }
                if (plan.Version != delivery.Notification.TimetableVersion || plan.DueAt > Now)
                {
                    await SavePlanAsync(plan, ct);
                    await CompleteAsync(id, token, NotificationDeliveryStatus.Pending, null, ct, plan.DueAt);
                    continue;
                }
                if (plan.ExpiresAt <= Now)
                {
                    await CompleteAsync(id, token, NotificationDeliveryStatus.Expired, null, ct);
                    continue;
                }
                // Fence before I/O too. There remains an unavoidable timetable-update/provider-send race.
                if (!await db.NotificationDeliveries.AnyAsync(d => d.Id == id && d.ClaimToken == token
                        && d.Status == NotificationDeliveryStatus.Claimed && d.ClaimedUntil > Now, ct)) continue;
                var outcome = await push.SendDestinationAsync(delivery.Subscription, plan.Payload, plan.Key, plan.ExpiresAt, Now, ct);
                var status = outcome switch
                {
                    PushSendOutcome.Accepted => NotificationDeliveryStatus.Accepted,
                    PushSendOutcome.Expired => NotificationDeliveryStatus.Expired,
                    PushSendOutcome.PermanentFailure => NotificationDeliveryStatus.Failed,
                    _ when delivery.Attempts >= 4 => NotificationDeliveryStatus.Failed,
                    _ => NotificationDeliveryStatus.Pending,
                };
                var error = outcome is PushSendOutcome.Accepted or PushSendOutcome.Expired ? null : outcome == PushSendOutcome.PermanentFailure ? "destination-unavailable" : "provider-failure";
                var retry = Now.AddMinutes(delivery.Attempts switch { 1 => 1, 2 => 2, _ => 5 });
                if (await CompleteAsync(id, token, status, error, ct, retry) && status == NotificationDeliveryStatus.Accepted) accepted++;
            }
        }
        return new(claimed, accepted, recovered);
    }

    private IQueryable<NotificationDelivery> Eligible(DateTime now) => db.NotificationDeliveries.Where(d =>
        d.Notification.DueAt <= now && d.Notification.ExpiresAt > now && d.NextAttemptAt <= now
        && (d.Status == NotificationDeliveryStatus.Pending || (d.Status == NotificationDeliveryStatus.Claimed && d.ClaimedUntil <= now)));

    internal async Task<string?> ClaimAsync(int id, CancellationToken ct)
    {
        var now = Now;
        var token = Guid.NewGuid().ToString("N");
        var count = await Eligible(now).Where(d => d.Id == id).ExecuteUpdateAsync(s =>
            s.SetProperty(d => d.RecoveredLeases, d => d.RecoveredLeases + (d.Status == NotificationDeliveryStatus.Claimed ? 1 : 0))
                .SetProperty(d => d.Status, NotificationDeliveryStatus.Claimed).SetProperty(d => d.ClaimToken, token)
                .SetProperty(d => d.ClaimedUntil, now + Lease).SetProperty(d => d.Attempts, d => d.Attempts + 1)
                .SetProperty(d => d.UpdatedAt, now), ct);
        return count == 1 ? token : null;
    }

    internal async Task<bool> CompleteAsync(int id, string token, NotificationDeliveryStatus status, string? error,
        CancellationToken ct, DateTime? nextAttempt = null)
    {
        var now = Now;
        return await db.NotificationDeliveries.Where(d => d.Id == id && d.ClaimToken == token
                && d.Status == NotificationDeliveryStatus.Claimed && d.ClaimedUntil > now)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.Status, status).SetProperty(d => d.LastError, error)
                .SetProperty(d => d.AcceptedAt, status == NotificationDeliveryStatus.Accepted ? now : (DateTime?)null)
                .SetProperty(d => d.NextAttemptAt, nextAttempt ?? now).SetProperty(d => d.ClaimToken, (string?)null)
                .SetProperty(d => d.ClaimedUntil, (DateTime?)null).SetProperty(d => d.UpdatedAt, now), ct) == 1;
    }

    internal async Task ReconcileAsync(DateTime now, CancellationToken ct)
    {
        var plans = await ReminderPlan.LoadAsync(db, now, ct);
        var users = plans.SelectMany(p => p.Users).Distinct().ToArray();
        var subscriptions = await db.PushSubscriptions.AsNoTracking().Where(s => users.Contains(s.UserId))
            .Select(s => new { s.Id, s.UserId }).ToListAsync(ct);
        foreach (var plan in plans)
        {
            var reminder = await SavePlanAsync(plan, ct);
            foreach (var subscription in subscriptions.Where(s => plan.Users.Contains(s.UserId)))
            {
                // ON CONFLICT is supported by both providers. Concurrent reconcilers never create duplicate work.
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO "NotificationDeliveries" ("ScheduledNotificationId", "PushSubscriptionId", "Status", "TimetableVersion", "Attempts", "RecoveredLeases", "NextAttemptAt", "UpdatedAt")
                    VALUES ({reminder}, {subscription.Id}, {0}, {plan.Version}, {0}, {0}, {plan.DueAt}, {now})
                    ON CONFLICT ("ScheduledNotificationId", "PushSubscriptionId") DO NOTHING
                    """, ct);
                // A new timetable revives unsent work and resets old backoff; accepted destinations stay accepted.
                // Never steal an unexpired lease from an in-flight worker.
                await db.NotificationDeliveries.Where(d => d.ScheduledNotificationId == reminder && d.PushSubscriptionId == subscription.Id
                        && d.Status != NotificationDeliveryStatus.Accepted
                        && (d.Status != NotificationDeliveryStatus.Claimed || d.ClaimedUntil <= now)
                        && (d.TimetableVersion != plan.Version || d.Status == NotificationDeliveryStatus.Cancelled))
                    .ExecuteUpdateAsync(s => s.SetProperty(d => d.Status, NotificationDeliveryStatus.Pending)
                        .SetProperty(d => d.TimetableVersion, plan.Version).SetProperty(d => d.NextAttemptAt, plan.DueAt)
                        .SetProperty(d => d.Attempts, 0).SetProperty(d => d.LastError, (string?)null)
                        .SetProperty(d => d.ClaimToken, (string?)null).SetProperty(d => d.ClaimedUntil, (DateTime?)null)
                        .SetProperty(d => d.UpdatedAt, now), ct);
            }
        }
    }

    private async Task<int> SavePlanAsync(PlannedReminder plan, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "ScheduledNotifications" ("ReminderKey", "CompetitionId", "DueAt", "ExpiresAt", "TimetableVersion")
            VALUES ({plan.Key}, {plan.CompetitionId}, {plan.DueAt}, {plan.ExpiresAt}, {plan.Version})
            ON CONFLICT ("ReminderKey") DO UPDATE SET "DueAt" = excluded."DueAt", "ExpiresAt" = excluded."ExpiresAt", "TimetableVersion" = excluded."TimetableVersion"
            """, ct);
        return await db.ScheduledNotifications.Where(n => n.ReminderKey == plan.Key).Select(n => n.Id).SingleAsync(ct);
    }
}
