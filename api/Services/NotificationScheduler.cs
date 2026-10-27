using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Calendar;

namespace MountedGames.Api.Services;

/// <summary>
/// Polls every minute and fires background pushes for the same conditions the
/// foreground hook (<c>useTeamNotifications</c>) covers:
///   * 1 hour before a heat that one of your teams runs in,
///   * 30 minutes before a briefing in any comp where you have a team.
/// Schedule-slip pushes piggy-back on the existing live SignalR
/// <c>sessionUpdated</c> path (when an admin marks a session finished early,
/// the controller can call PushNotifier directly).
/// The durable runner owns deduplication, retries and recoverable leases. An external trigger is still
/// required to wake a scale-to-zero deployment; this loop alone cannot do that.
/// </summary>
public class NotificationScheduler : BackgroundService
{
    private readonly IServiceProvider _sp;
    private readonly ILogger<NotificationScheduler> _log;
    private readonly TimeSpan _startupDelay;
    private readonly TimeSpan _interval;

    // The delays are parameters (with the production defaults) so tests can drive the loop without waiting.
    public NotificationScheduler(
        IServiceProvider sp, ILogger<NotificationScheduler> log,
        TimeSpan? startupDelay = null, TimeSpan? interval = null)
    {
        _sp = sp;
        _log = log;
        _startupDelay = startupDelay ?? TimeSpan.FromSeconds(8);
        _interval = interval ?? TimeSpan.FromMinutes(1);
    }

    private static readonly TimeZoneInfo UkZone = FindUkZone();

    private static TimeZoneInfo FindUkZone()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Europe/London"); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.Utc; }
    }

    /// <summary>
    /// Events run in the UK, but the API runs in UTC (Vercel cle1), so <c>ToLocalTime</c> would show
    /// 08:00 for a 09:00 start in summer. Times in notifications are UK time.
    /// </summary>
    internal static DateTime UkTime(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), UkZone);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Small delay so the DB seed / migrations finish before we touch it.
        try { await Task.Delay(_startupDelay, stoppingToken); }
        catch (TaskCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await TickAsync(stoppingToken); }
            catch (Exception ex) { _log.LogError(ex, "Notification scheduler tick failed."); }
            try { await DigestTickAsync(stoppingToken); }
            catch (Exception ex) { _log.LogError(ex, "Entries digest tick failed."); }
            try { await Task.Delay(_interval, stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    /// <summary>The daily "entries are open" email: continues an unfinished run and, in the UK evening, starts the day's. See <see cref="Email.EntriesDigestService"/>.</summary>
    internal async Task DigestTickAsync(CancellationToken ct)
    {
        using var scope = _sp.CreateScope();
        await scope.ServiceProvider.GetRequiredService<Email.EntriesDigestService>().TickAsync(allowBaseline: true, ct);
    }

    internal async Task TickAsync(CancellationToken ct)
    {
        using var scope = _sp.CreateScope();
        await scope.ServiceProvider.GetRequiredService<Notifications.ReminderRunner>().RunAsync(ct);
    }
}
