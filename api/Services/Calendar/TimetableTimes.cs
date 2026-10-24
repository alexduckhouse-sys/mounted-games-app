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
        var offset = TimeSpan.Zero;
        DateTime? lastEnd = null;

        foreach (var session in sessions.OrderBy(s => s.OrderIndex))
        {
            var scheduled = Utc(session.ScheduledStart);
            DateTime? effective = null;
            if (session.StartedAt is { } started)
            {
                effective = Utc(started);
                if (scheduled is { } sched) offset = effective!.Value - sched;
            }
            else if (scheduled is { } sched)
            {
                effective = sched + offset;
                // An early-shifted session doesn't start before the previous one has ended.
                if (lastEnd is { } end && effective < end)
                {
                    effective = end;
                    offset = end - sched;
                }
            }
            else if (lastEnd is { } end)
            {
                effective = end;
            }

            var cursor = effective;
            foreach (var heat in session.Heats.OrderBy(h => h.OrderIndex))
            {
                var minutes = HeatMinutes(heat, session);
                var pinned = Utc(heat.ScheduledStart);
                var start = heat.StartedAt is { } heatStarted ? Utc(heatStarted) : pinned ?? cursor;
                result[heat.Id] = new HeatTime(start, minutes);
                cursor = (pinned ?? cursor)?.AddMinutes(minutes);
            }

            if (effective is { } sessionStart) lastEnd = sessionStart.AddMinutes(SessionMinutes(session));
        }
        return result;
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
