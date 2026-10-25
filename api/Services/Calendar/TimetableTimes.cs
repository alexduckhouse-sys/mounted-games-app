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
            var scheduledCursor = scheduled;
            var heats = session.Heats.OrderBy(h => h.OrderIndex).ToList();
            foreach (var heat in heats)
            {
                var minutes = HeatMinutes(heat, session);
                var rawPinned = Utc(heat.ScheduledStart);
                var pinned = rawPinned - (heat.FinishedAt.HasValue ? TimeSpan.Zero : shift);
                var heatScheduled = pinned ?? scheduledCursor;
                DateTime? start = null;
                if (heat.StartedAt is { } heatStarted) start = Utc(heatStarted);
                else if (pinned is { } pin)
                {
                    var delayed = shift != TimeSpan.Zero ? rawPinned!.Value : pin + lane.Offset;
                    start = cursor is { } previousEnd && previousEnd > delayed ? previousEnd : delayed;
                }
                else if (cursor is not null) start = cursor;
                // Keep the first-race and halfway checkpoints identical to computeTimings in time.ts.
                var races = heat.Races.OrderBy(r => r.OrderIndex).ToList();
                var singleFinished = races.Count == 1 && heat.FinishedAt.HasValue && !races[0].StartedAt.HasValue
                    && session.StartedAt.HasValue && session.StartedAt < heat.FinishedAt;
                var firstStamp = singleFinished ? null : Utc(races.FirstOrDefault()?.StartedAt ?? races.FirstOrDefault()?.FinishedAt);
                if (heatScheduled is { } firstScheduled && firstStamp is { } firstTime)
                {
                    var taken = firstTime - firstScheduled;
                    if (taken > TimeSpan.FromMinutes(5))
                    {
                        var delay = taken - TimeSpan.FromMinutes(2);
                        var autoStamped = (Utc(session.StartedAt) is { } sessionStart && Math.Abs((sessionStart - firstTime).TotalSeconds) <= 5)
                            || (Utc(heat.StartedAt) is { } heatStart && Math.Abs((heatStart - firstTime).TotalSeconds) <= 5);
                        if (autoStamped)
                        {
                            lane.Offset = delay;
                            start = firstScheduled + delay;
                            if (heat == heats[0]) effective = start;
                        }
                        else if (delay > lane.Offset) lane.Offset = delay;
                    }
                }
                var halfIndex = races.Count / 2 - 1;
                var halfwayStamp = halfIndex >= 1 ? Utc(races[halfIndex].FinishedAt ?? races[halfIndex].StartedAt) : null;
                if (heatScheduled is { } halfwayScheduled && halfwayStamp is { } halfwayTime)
                {
                    var expected = halfwayScheduled.AddMinutes((double)halfIndex / races.Count * minutes);
                    var taken = halfwayTime - expected;
                    if (taken > TimeSpan.FromMinutes(5) && taken - TimeSpan.FromMinutes(2) > lane.Offset)
                        lane.Offset = taken - TimeSpan.FromMinutes(2);
                }
                result[heat.Id] = new HeatTime(start, minutes);
                var nextStart = start;
                if (start is { } actual && heatScheduled is { } planned && planned + lane.Offset > actual)
                    nextStart = planned + lane.Offset;
                cursor = nextStart?.AddMinutes(minutes);
                scheduledCursor = (pinned ?? scheduledCursor)?.AddMinutes(minutes);
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
