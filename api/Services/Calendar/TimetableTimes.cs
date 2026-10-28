using System.Text.RegularExpressions;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Calendar;

/// <summary>When one heat is expected to start and how long it is expected to take.</summary>
public readonly record struct HeatTime(DateTime? Start, int DurationMinutes);

/// <summary>Learned pace summary from completed heats in a competition.</summary>
public readonly record struct PacePrediction(
    double? AvgMinutesPerRace,
    int? RecommendedMinutesPer5RaceHeat,
    double Multiplier,
    int SampleHeats,
    int SampleRaces);

/// <summary>
/// The server's copy of the timetable arithmetic in <c>web/src/lib/time.ts</c> (<c>computeTimings</c>): a session
/// that started late or early shifts the sessions after it, and a pinned heat time resets the run of heats after it.
/// Keep the two in step, so a calendar shows the same times as the timetable on a phone.
/// </summary>
public static class TimetableTimes
{
    private const int DefaultHeatMinutes = 30;

    /// <summary>Computes the learned minutes-per-race pace and duration multiplier from completed heats.</summary>
    public static PacePrediction PredictPace(IEnumerable<Session> sessions, double? historicalAvgMinutesPerRace = null)
    {
        double actualTotalMinutes = 0;
        double plannedTotalMinutes = 0;
        var sampleRaces = 0;
        var sampleHeats = 0;

        foreach (var session in sessions)
        {
            if (session.Kind is SessionKind.Break or SessionKind.Briefing or SessionKind.Custom) continue;
            foreach (var heat in session.Heats)
            {
                var races = heat.Races ?? [];
                var completedRaces = races.Where(r => r.IsComplete || r.FinishedAt.HasValue).ToList();
                var isFinished = heat.FinishedAt.HasValue || (races.Count > 0 && races.All(r => r.IsComplete || r.FinishedAt.HasValue));
                var raceCount = heat.FinishedAt.HasValue ? races.Count : completedRaces.Count;
                if (!isFinished || raceCount == 0) continue;

                var firstRaceStart = races
                    .Where(r => r.StartedAt.HasValue)
                    .Select(r => Utc(r.StartedAt)!.Value)
                    .OrderBy(t => t)
                    .Cast<DateTime?>()
                    .FirstOrDefault();
                var lastRaceEnd = races
                    .Where(r => r.FinishedAt.HasValue)
                    .Select(r => Utc(r.FinishedAt)!.Value)
                    .OrderBy(t => t)
                    .Cast<DateTime?>()
                    .LastOrDefault();

                var startStamp = Utc(heat.StartedAt) ?? firstRaceStart ?? (session.Heats.All(h => h.OrderIndex >= heat.OrderIndex) ? Utc(session.StartedAt) : null);
                var endStamp = Utc(heat.FinishedAt) ?? lastRaceEnd;
                if (!startStamp.HasValue || !endStamp.HasValue) continue;

                var actualMinutes = (endStamp.Value - startStamp.Value).TotalMinutes;
                var minutesPerRace = actualMinutes / raceCount;
                if (minutesPerRace is < 0.5 or > 15) continue;

                actualTotalMinutes += actualMinutes;
                plannedTotalMinutes += HeatMinutes(heat, session);
                sampleRaces += raceCount;
                sampleHeats += 1;
            }
        }

        if ((sampleHeats >= 2 || sampleRaces >= 5) && plannedTotalMinutes > 0)
        {
            var multiplier = Math.Clamp(actualTotalMinutes / plannedTotalMinutes, 0.75, 1.5);
            var avg = Math.Round(actualTotalMinutes / sampleRaces, 1, MidpointRounding.AwayFromZero);
            var rec5 = (int)Math.Round((actualTotalMinutes / sampleRaces) * 5, MidpointRounding.AwayFromZero);
            return new PacePrediction(avg, rec5, multiplier, sampleHeats, sampleRaces);
        }

        if (historicalAvgMinutesPerRace is >= 0.5 and <= 15)
        {
            var multiplier = Math.Clamp(historicalAvgMinutesPerRace.Value / 6.0, 0.75, 1.5);
            var avg = Math.Round(historicalAvgMinutesPerRace.Value, 1, MidpointRounding.AwayFromZero);
            var rec5 = (int)Math.Round(historicalAvgMinutesPerRace.Value * 5, MidpointRounding.AwayFromZero);
            return new PacePrediction(avg, rec5, multiplier, sampleHeats, sampleRaces);
        }

        return new PacePrediction(null, null, 1.0, sampleHeats, sampleRaces);
    }

    /// <summary>Expected times for every heat in the given sessions (sessions need their heats and races loaded).</summary>
    public static Dictionary<int, HeatTime> Compute(IEnumerable<Session> sessions, DateTime? nowUtc = null, IDictionary<int, DateTime?>? sessionStarts = null)
    {
        var result = new Dictionary<int, HeatTime>();
        var ordered = sessions.OrderBy(s => s.OrderIndex).ToList();
        var pace = PredictPace(ordered);
        var now = Utc(nowUtc) ?? DateTime.UtcNow;
        var hasArenas = ordered.Any(s => !string.IsNullOrWhiteSpace(s.ArenaName));
        var lanes = new Dictionary<string, Lane>();
        var lastDayByArena = new Dictionary<string, string>();
        var lastDayKey = "";
        foreach (var session in ordered)
        {
            var key = hasArenas ? session.ArenaName?.Trim() ?? "" : "";
            var rawScheduled = Utc(session.ScheduledStart);
            var match = System.Text.RegularExpressions.Regex.Match(session.Notes ?? "", @"\[shift:([+-]?\d+)\]");
            var shift = match.Success && int.TryParse(match.Groups[1].Value, out var minutesShifted)
                ? TimeSpan.FromMinutes(minutesShifted) : TimeSpan.Zero;
            var scheduled = rawScheduled - shift;
            var dayKey = scheduled.HasValue
                ? UkTime.DateKey(scheduled.Value)
                : (lastDayByArena.TryGetValue(key, out var prevDay) ? prevDay : lastDayKey);
            if (scheduled.HasValue)
            {
                lastDayByArena[key] = dayKey;
                lastDayKey = dayKey;
            }

            Lane lane;
            if (hasArenas && key.Length == 0)
            {
                var dayPrefix = dayKey + "::";
                var dayLanes = lanes.Where(kv => kv.Key.StartsWith(dayPrefix, StringComparison.Ordinal)).Select(kv => kv.Value).ToList();
                lane = new Lane
                {
                    Offset = TimeSpan.FromTicks(Math.Max(0, dayLanes.Select(l => (l.Offset + l.PauseOffset).Ticks).DefaultIfEmpty(0).Max()))
                        - dayLanes.Select(l => l.PauseOffset).DefaultIfEmpty(TimeSpan.Zero).Max(),
                    PauseOffset = dayLanes.Select(l => l.PauseOffset).DefaultIfEmpty(TimeSpan.Zero).Max(),
                    LastEnd = dayLanes.Select(l => l.LastEnd).Max(),
                };
            }
            else if (!lanes.TryGetValue($"{dayKey}::{key}", out lane!))
            {
                lane = new Lane();
                lanes[$"{dayKey}::{key}"] = lane;
            }
            var previousPause = lane.PauseOffset;
            var pause = TimeSpan.Zero;
            if (session.Status != SessionStatus.Finished)
            {
                var pauseMatch = Regex.Match(session.Notes ?? "", @"\[paused:(\d+)\]");
                if (pauseMatch.Success && long.TryParse(pauseMatch.Groups[1].Value, out var pausedMs)
                    && pausedMs >= 0 && pausedMs <= DateTimeOffset.MaxValue.ToUnixTimeMilliseconds())
                    pause = TimeSpan.FromMilliseconds(Math.Max(0, new DateTimeOffset(now).ToUnixTimeMilliseconds() - pausedMs));
            }
            if (hasArenas && key.Length == 0 && previousPause > pause) pause = previousPause;
            lane.PauseOffset = pause;
            DateTime? effective = null;
            if (session.StartedAt is { } started)
            {
                effective = Utc(started);
                if (scheduled is { } sched) lane.Offset = effective!.Value - sched;
            }
            else if (scheduled is { } sched)
            {
                if (shift != TimeSpan.Zero) lane.Offset = shift;
                effective = sched + lane.Offset + pause;
                if (lane.LastEnd is { } end && effective < end)
                {
                    effective = end;
                    lane.Offset = end - sched - pause;
                }
            }
            else if (lane.LastEnd is { } end)
            {
                effective = end + (pause > previousPause ? pause - previousPause : TimeSpan.Zero);
            }

            var cursor = effective;
            var scheduledCursor = scheduled;
            var heats = session.Heats.OrderBy(h => h.OrderIndex).ToList();
            var pauseApplied = !session.StartedAt.HasValue;
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
                    var delayed = (shift != TimeSpan.Zero ? rawPinned!.Value : pin + lane.Offset) + (heat.FinishedAt.HasValue ? TimeSpan.Zero : pause);
                    start = cursor is { } previousEnd && previousEnd > delayed ? previousEnd : delayed;
                    if (!heat.FinishedAt.HasValue) pauseApplied = true;
                }
                else if (cursor is not null)
                {
                    start = cursor + (!heat.FinishedAt.HasValue && !pauseApplied ? pause : TimeSpan.Zero);
                    if (!heat.FinishedAt.HasValue) pauseApplied = true;
                }
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
                var effectiveMinutes = !heat.FinishedAt.HasValue ? (int)Math.Round(minutes * pace.Multiplier, MidpointRounding.AwayFromZero) : minutes;
                result[heat.Id] = new HeatTime(start, effectiveMinutes);
                var nextStart = start;
                if (start is { } actual && heatScheduled is { } planned && planned + lane.Offset > actual)
                    nextStart = planned + lane.Offset;
                if (heat.StartedAt.HasValue && !heat.FinishedAt.HasValue && !pauseApplied)
                {
                    nextStart += pause;
                    pauseApplied = true;
                }
                cursor = nextStart?.AddMinutes(effectiveMinutes);
                scheduledCursor = (pinned ?? scheduledCursor)?.AddMinutes(minutes);
            }
            var isBreakLike = session.Kind is SessionKind.Break or SessionKind.Briefing or SessionKind.Custom;
            var effectiveEnd = !isBreakLike && session.Heats.Count > 0 && cursor is not null
                ? cursor : effective?.AddMinutes(SessionMinutes(session)) + (session.StartedAt.HasValue ? pause : TimeSpan.Zero);
            if (effectiveEnd is not null) lane.LastEnd = effectiveEnd;
            if (sessionStarts is not null) sessionStarts[session.Id] = effective;
        }

        return result;
    }

    private sealed class Lane
    {
        public TimeSpan Offset { get; set; }
        public TimeSpan PauseOffset { get; set; }
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
