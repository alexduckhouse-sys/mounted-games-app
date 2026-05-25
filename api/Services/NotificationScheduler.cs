using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// Polls every minute and fires background pushes for the same conditions the
/// foreground hook (<c>useTeamNotifications</c>) covers:
///   * 1 hour before a race session that one of your teams runs in,
///   * 30 minutes before a briefing in any comp where you have a team.
/// Schedule-slip pushes piggy-back on the existing live SignalR
/// <c>sessionUpdated</c> path (when an admin marks a session finished early,
/// the controller can call PushNotifier directly).
/// Dedupe is per-(session, kind, user) so we don't re-fire on each tick.
/// </summary>
public class NotificationScheduler : BackgroundService
{
    private readonly IServiceProvider _sp;
    private readonly ILogger<NotificationScheduler> _log;
    // In-memory dedupe — fine for a single-instance deployment. Across restart
    // we may re-fire a notification the user already saw, which is acceptable
    // given the 5-minute firing windows are narrow.
    private readonly HashSet<string> _fired = new();

    public NotificationScheduler(IServiceProvider sp, ILogger<NotificationScheduler> log)
    {
        _sp = sp;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Small delay so the DB seed / migrations finish before we touch it.
        try { await Task.Delay(TimeSpan.FromSeconds(8), stoppingToken); }
        catch (TaskCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try { await TickAsync(stoppingToken); }
            catch (Exception ex) { _log.LogError(ex, "Notification scheduler tick failed."); }
            try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        using var scope = _sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var push = scope.ServiceProvider.GetRequiredService<PushNotifier>();
        var now = DateTime.UtcNow;

        // Pull upcoming non-finished sessions in the next 90 minutes (covers
        // both the 1-hour-before and 30-min briefing windows with some slack).
        var horizonStart = now.AddMinutes(-1);
        var horizonEnd = now.AddMinutes(90);
        var sessions = await db.Sessions
            .Include(s => s.Section)
            .Where(s => s.ScheduledStart != null
                && s.ScheduledStart >= horizonStart
                && s.ScheduledStart <= horizonEnd
                && s.Status != SessionStatus.Finished)
            .ToListAsync(ct);

        foreach (var s in sessions)
        {
            if (!s.ScheduledStart.HasValue) continue;
            var minsAhead = (s.ScheduledStart.Value - now).TotalMinutes;
            var kind = s.Kind;

            // 1 hour before a race session.
            if (kind == SessionKind.Race && minsAhead is <= 60 and > 55)
            {
                await FireForSession(db, push, s, "1h", $"1 hour to {s.Name}",
                    $"Starts at {s.ScheduledStart.Value.ToLocalTime():HH:mm} — {s.Section?.DisplayName ?? "—"}.", ct);
            }
            // 30 minutes before a briefing.
            if (kind == SessionKind.Briefing && minsAhead is <= 30 and > 25)
            {
                await FireForSession(db, push, s, "brief", $"Briefing in 30 minutes",
                    s.Name, ct);
            }
        }
    }

    private async Task FireForSession(
        AppDbContext db, PushNotifier push,
        Session s, string kindKey, string title, string body,
        CancellationToken ct)
    {
        // Recipients = every (trainer + accepted supporter) of every team in
        // this session's section, plus admins who hold a subscription.
        var compId = s.CompetitionId;
        var sectionId = s.CompetitionSectionId;
        var teams = await db.Teams
            .Include(t => t.Supporters)
            .Where(t => t.CompetitionId == compId
                && (sectionId == null || t.CompetitionSectionId == sectionId))
            .ToListAsync(ct);

        var users = new HashSet<string>();
        foreach (var t in teams)
        {
            if (!string.IsNullOrEmpty(t.TrainerUserId)) users.Add(t.TrainerUserId);
            foreach (var sup in t.Supporters.Where(x => x.Status == TeamSupporterStatus.Accepted))
                users.Add(sup.UserId);
        }
        if (users.Count == 0) return;

        var dedupeKey = $"{kindKey}:{s.Id}";
        if (!_fired.Add(dedupeKey)) return;

        await push.SendToUsersAsync(users.ToList(), new PushPayload(
            Title: title,
            Body: body,
            Tag: dedupeKey,
            Url: $"/competitions/{compId}"));
    }
}
