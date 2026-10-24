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
/// Dedupe is per-(heat, team) for heat reminders and per-session for briefings so we don't re-fire on each tick.
/// </summary>
public class NotificationScheduler : BackgroundService
{
    private readonly IServiceProvider _sp;
    private readonly ILogger<NotificationScheduler> _log;
    // In-memory dedupe — fine for a single-instance deployment. Across restart
    // we may re-fire a notification the user already saw, which is acceptable
    // given the 5-minute firing windows are narrow.
    private readonly HashSet<string> _fired = new();

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
            try { await Task.Delay(_interval, stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    internal async Task TickAsync(CancellationToken ct)
    {
        using var scope = _sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var push = scope.ServiceProvider.GetRequiredService<PushNotifier>();
        var now = DateTime.UtcNow;

        // Include earlier sessions in each relevant competition so delays cascade to later heats.
        var horizonStart = now.AddDays(-2);
        var horizonEnd = now.AddMinutes(90);
        var competitionIds = db.Sessions.Where(s =>
            (s.ScheduledStart >= horizonStart && s.ScheduledStart <= horizonEnd)
                || (s.StartedAt >= horizonStart && s.StartedAt <= horizonEnd)
                || s.Status == SessionStatus.InArena
                || s.Heats.Any(h => h.ScheduledStart >= horizonStart && h.ScheduledStart <= horizonEnd))
            .Select(s => s.CompetitionId);
        var sessions = await db.Sessions
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Races)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Where(s => competitionIds.Contains(s.CompetitionId)).ToListAsync(ct);
        var timings = sessions.GroupBy(s => s.CompetitionId)
            .SelectMany(group => TimetableTimes.Compute(group)).ToDictionary(pair => pair.Key, pair => pair.Value);

        foreach (var s in sessions)
        {
            if (s.Status == SessionStatus.Finished) continue;
            var minsAhead = s.ScheduledStart.HasValue ? (double?)(s.ScheduledStart.Value - now).TotalMinutes : null;
            var kind = s.Kind;

            // 1 hour before a race session. A race session with no heats yet is only the provisional timetable's
            // estimate (made in the competition creator), so it says nothing to anyone until heats exist.
            if (kind == SessionKind.Race && s.Heats.Count > 0)
            {
                if (s.Heats.Any(h => h.Entries.Count > 0))
                {
                    await FireForSessionHeats(push, s, timings, now, ct);
                }
                else if (minsAhead is <= 60 and > 55 && s.ScheduledStart is { } scheduled)
                {
                    await FireForSession(db, push, s, "1h", $"1 hour to {s.Name}",
                        $"Starts at {UkTime(scheduled):HH:mm} — {s.Section?.DisplayName ?? "—"}.", ct);
                }
            }
            // 30 minutes before a briefing.
            if (kind == SessionKind.Briefing && minsAhead is <= 30 and > 25)
            {
                await FireForSession(db, push, s, "brief", $"Briefing in 30 minutes",
                    s.Name, ct);
            }
        }
    }

    private async Task FireForSessionHeats(
        PushNotifier push, Session s, IReadOnlyDictionary<int, HeatTime> timings, DateTime now, CancellationToken ct)
    {
        var messages = new List<(int TeamId, PushPayload Payload)>();
        foreach (var h in s.Heats.OrderBy(h => h.OrderIndex))
        {
            if (h.StartedAt.HasValue || h.FinishedAt.HasValue || (h.Races.Count > 0 && h.Races.All(r => r.IsComplete))) continue;
            var start = timings.GetValueOrDefault(h.Id).Start;
            if (!start.HasValue || (start.Value - now).TotalMinutes is not (<= 60 and > 55)) continue;
            var timeText = $"{UkTime(start.Value):HH:mm}";
            var heatLabel = !string.IsNullOrWhiteSpace(h.Label) ? h.Label! : $"Heat {h.OrderIndex}";
            foreach (var entry in h.Entries.OrderBy(e => e.LaneIndex))
            {
                var dedupeKey = $"1h:{s.Id}:h{h.Id}:t{entry.TeamId}";
                if (!_fired.Add(dedupeKey)) continue;
                var teamName = entry.Team?.DisplayName ?? $"Team {entry.TeamId}";
                messages.Add((entry.TeamId, new PushPayload(
                    Title: "60 minutes until your heat",
                    Body: $"{teamName} — {s.Name} ({heatLabel}, Lane {entry.LaneIndex}) starts around {timeText}.",
                    Tag: dedupeKey,
                    Url: $"/competitions/{s.CompetitionId}")));
            }
        }
        if (messages.Count > 0)
            await push.NotifyPerTeamAsync(messages, ct);
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
