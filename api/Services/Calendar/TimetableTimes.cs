using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Calendar;

/// <summary>When one heat is expected to start and how long it is expected to take.</summary>
public readonly record struct HeatTime(DateTime? Start, int DurationMinutes);

/// <summary>
/// The server's copy of the timetable arithmetic in <c>web/src/lib/time.ts</c> (<c>computeTimings</c>): a session
/// that started late or early shifts the sessions after it, and a pinned heat time resets the run of heats after it.
/// Keep the two in step, so a calendar shows the same times as the timetable on a phone.
/// </summary>
public static class TimetableTimes
{
    private const int DefaultHeatMinutes = 30;

    /// <summary>Expected times for every heat in the given sessions (sessions need their heats and races loaded).</summary>
    public static Dictionary<int, HeatTime> Compute(IEnumerable<Session> sessions)
    {
        var result = new Dictionary<int, HeatTime>();
        var ordered = sessions.OrderBy(s => s.OrderIndex).ToList();
        var hasArenas = ordered.Any(s => !string.IsNullOrWhiteSpace(s.ArenaName));
        var lanes = new Dictionary<string, Lane>();
        foreach (var session in ordered)
        {
            var key = hasArenas ? session.ArenaName?.Trim() ?? "" : "";
            Lane lane;
            if (hasArenas && key.Length == 0)
            {
                lane = new Lane
                {
                    Offset = TimeSpan.FromTicks(Math.Max(0, lanes.Values.Select(l => l.Offset.Ticks).DefaultIfEmpty(0).Max())),
                    LastEnd = lanes.Values.Select(l => l.LastEnd).Max(),
                };
            }
            else if (!lanes.TryGetValue(key, out lane!))
            {
                lane = new Lane();
                lanes[key] = lane;
            }
            var rawScheduled = Utc(session.ScheduledStart);
            var match = System.Text.RegularExpressions.Regex.Match(session.Notes ?? "", @"\[shift:([+-]?\d+)\]");
            var shift = match.Success && int.TryParse(match.Groups[1].Value, out var minutesShifted)
                ? TimeSpan.FromMinutes(minutesShifted) : TimeSpan.Zero;
            var scheduled = rawScheduled - shift;
            DateTime? effective = null;
            if (session.StartedAt is { } started)
            {
                effective = Utc(started);
                if (scheduled is { } sched) lane.Offset = effective!.Value - sched;
            }
            else if (scheduled is { } sched)
            {
                effective = shift != TimeSpan.Zero ? rawScheduled : sched + lane.Offset;
                if (shift != TimeSpan.Zero) lane.Offset = shift;
                if (lane.LastEnd is { } end && effective < end)
                {
                    effective = end;
                    lane.Offset = end - sched;
                }
            }
            else if (lane.LastEnd is { } end)
            {
                effective = end;
            }

            var cursor = effective;
            foreach (var heat in session.Heats.OrderBy(h => h.OrderIndex))
            {
                var minutes = HeatMinutes(heat, session);
                var rawPinned = Utc(heat.ScheduledStart);
                var pinned = rawPinned - (heat.FinishedAt.HasValue ? TimeSpan.Zero : shift);
                DateTime? start = null;
                if (heat.StartedAt is { } heatStarted) start = Utc(heatStarted);
                else if (pinned is { } pin)
                {
                    var delayed = shift != TimeSpan.Zero ? rawPinned!.Value : pin + lane.Offset;
                    start = cursor is { } previousEnd && previousEnd > delayed ? previousEnd : delayed;
                }
                else if (cursor is not null) start = cursor;
                result[heat.Id] = new HeatTime(start, minutes);
                cursor = start?.AddMinutes(minutes);
            }
            var isBreakLike = session.Kind is SessionKind.Break or SessionKind.Briefing or SessionKind.Custom;
            var effectiveEnd = !isBreakLike && session.Heats.Count > 0 && cursor is not null
                ? cursor : effective?.AddMinutes(SessionMinutes(session));
            if (effectiveEnd is not null) lane.LastEnd = effectiveEnd;
        }

        return result;
    }

    private sealed class Lane
    {
        public TimeSpan Offset { get; set; }
        public DateTime? LastEnd { get; set; }
    }

    private static int HeatMinutes(Heat heat, Session session)
    {
        if (heat.DurationMinutes is > 0) return heat.DurationMinutes.Value;
        if (session.MinutesPerHeat is > 0) return session.MinutesPerHeat.Value;
        return DefaultHeatMinutes;
    }

    private static int SessionMinutes(Session session)
    {
        if (session.Kind is SessionKind.Break or SessionKind.Briefing or SessionKind.Custom) return session.DurationMinutes ?? 0;
        if (session.Heats.Count == 0) return session.DurationMinutes ?? 0;
        return session.Heats.Sum(h => HeatMinutes(h, session));
    }

    private static DateTime? Utc(DateTime? value) => value is { } v ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : null;
}
