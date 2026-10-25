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
    private static readonly Regex ShiftRegex = new(@"\[shift:([+-]?\d+)\]", RegexOptions.Compiled);

    private sealed class Lane
    {
        public TimeSpan Offset { get; set; } = TimeSpan.Zero;
        public DateTime? LastEnd { get; set; }
    }

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

                var startStamp = Utc(heat.StartedAt) ?? Utc(session.StartedAt) ?? firstRaceStart;
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
    public static Dictionary<int, HeatTime> Compute(IEnumerable<Session> sessions)
    {
        var ordered = sessions.OrderBy(s => s.OrderIndex).ToList();
        var result = new Dictionary<int, HeatTime>();
        var pace = PredictPace(ordered);
        var hasArenas = ordered.Any(s => !string.IsNullOrWhiteSpace(s.ArenaName));
        var lanes = new Dictionary<string, Lane>(StringComparer.OrdinalIgnoreCase);

        Lane LaneFor(string key)
        {
            if (!lanes.TryGetValue(key, out var lane))
            {
                lane = new Lane();
                lanes[key] = lane;
            }
            return lane;
        }

        foreach (var session in ordered)
        {
            var key = hasArenas ? (session.ArenaName?.Trim() ?? string.Empty) : string.Empty;
            Lane lane;
            if (key.Length == 0 && hasArenas)
            {
                var all = lanes.Values.ToList();
                lane = new Lane
                {
                    Offset = all.Select(l => l.Offset).Append(TimeSpan.Zero).Max(),
                    LastEnd = all.Where(l => l.LastEnd.HasValue).Select(l => l.LastEnd).Max(),
                };
            }
            else
            {
                lane = LaneFor(key);
            }

            var rawScheduled = Utc(session.ScheduledStart);
            var manualShift = ParseShift(session.Notes);
            var scheduled = rawScheduled.HasValue ? rawScheduled.Value - manualShift : (DateTime?)null;
            DateTime? effective = null;

            if (session.StartedAt is { } started)
            {
                effective = Utc(started);
                if (scheduled is { } sched) lane.Offset = effective!.Value - sched;
            }
            else if (scheduled is { } sched && rawScheduled is { } rawSched)
            {
                effective = manualShift != TimeSpan.Zero ? rawSched : sched + lane.Offset;
                if (manualShift != TimeSpan.Zero) lane.Offset = manualShift;
                // An early-shifted session doesn't start before the previous one has ended.
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

            var heats = session.Heats.OrderBy(h => h.OrderIndex).ToList();
            var cursor = effective;
            var scheduledCursor = scheduled;
            foreach (var heat in heats)
            {
                var minutes = HeatMinutes(heat, session);
                var rawPinned = Utc(heat.ScheduledStart);
                var pinned = rawPinned.HasValue
                    ? rawPinned.Value - (!heat.FinishedAt.HasValue ? manualShift : TimeSpan.Zero)
                    : (DateTime?)null;
                var hScheduled = pinned ?? scheduledCursor;
                var offsetBeforeHeat = lane.Offset;

                DateTime? start;
                if (heat.StartedAt is { } heatStarted)
                {
                    start = Utc(heatStarted);
                }
                else if (pinned is { } pin && rawPinned is { } rawPin)
                {
                    var delayed = manualShift != TimeSpan.Zero ? rawPin : pin + lane.Offset;
                    start = cursor.HasValue && cursor.Value > delayed ? cursor.Value : delayed;
                }
                else
                {
                    start = cursor;
                }

                var orderedRaces = (heat.Races ?? []).OrderBy(r => r.OrderIndex).ToList();
                var isSingleRaceFinishedHeat = orderedRaces.Count == 1
                    && heat.FinishedAt.HasValue
                    && !orderedRaces[0].StartedAt.HasValue
                    && session.StartedAt.HasValue
                    && Utc(session.StartedAt) < Utc(heat.FinishedAt);
                var r0Stamp = isSingleRaceFinishedHeat
                    ? null
                    : Utc(orderedRaces.FirstOrDefault()?.StartedAt ?? orderedRaces.FirstOrDefault()?.FinishedAt);
                if (hScheduled is { } hSched && r0Stamp is { } r0Time)
                {
                    var firstRaceTaken = r0Time - hSched;
                    if (firstRaceTaken > TimeSpan.FromMinutes(5))
                    {
                        var firstRaceDelay = firstRaceTaken - TimeSpan.FromMinutes(2);
                        var autoStamped = (session.StartedAt.HasValue && (Utc(session.StartedAt)!.Value - r0Time).Duration() <= TimeSpan.FromSeconds(5))
                            || (heat.StartedAt.HasValue && (Utc(heat.StartedAt)!.Value - r0Time).Duration() <= TimeSpan.FromSeconds(5));
                        if (autoStamped)
                        {
                            lane.Offset = firstRaceDelay;
                            start = hSched + firstRaceDelay;
                            if (ReferenceEquals(heat, heats[0])) effective = start;
                        }
                        else if (firstRaceDelay > lane.Offset)
                        {
                            lane.Offset = firstRaceDelay;
                        }
                    }
                }

                var halfIdx = (orderedRaces.Count / 2) - 1;
                var rHalfStamp = halfIdx >= 1 ? Utc(orderedRaces[halfIdx].FinishedAt ?? orderedRaces[halfIdx].StartedAt) : null;
                if (hScheduled is { } hSchedHalf && rHalfStamp is { } rHalfTime)
                {
                    var expectedHalfStart = hSchedHalf.AddMinutes(((double)halfIdx / orderedRaces.Count) * minutes);
                    var halfTaken = rHalfTime - expectedHalfStart;
                    if (halfTaken > TimeSpan.FromMinutes(5))
                    {
                        var halfDelay = halfTaken - TimeSpan.FromMinutes(2);
                        if (halfDelay > lane.Offset) lane.Offset = halfDelay;
                    }
                }

                var effectiveMinutes = !heat.FinishedAt.HasValue && Math.Abs(pace.Multiplier - 1.0) > 1e-6
                    ? (int)Math.Round(minutes * pace.Multiplier, MidpointRounding.AwayFromZero)
                    : minutes;
                result[heat.Id] = new HeatTime(start, effectiveMinutes);

                var offsetDelta = lane.Offset - offsetBeforeHeat;
                var advanceBase = pinned.HasValue
                    ? (start ?? pinned)
                    : (cursor.HasValue ? cursor.Value + offsetDelta : start);
                cursor = advanceBase?.AddMinutes(effectiveMinutes);
                scheduledCursor = (pinned ?? scheduledCursor)?.AddMinutes(minutes);
            }

            var isBreakLike = session.Kind is SessionKind.Break or SessionKind.Briefing or SessionKind.Custom;
            var effectiveEnd = !isBreakLike && heats.Count > 0 && cursor.HasValue
                ? cursor
                : effective?.AddMinutes(SessionMinutes(session));
            if (effectiveEnd.HasValue) lane.LastEnd = effectiveEnd;
        }
        return result;
    }

    private static TimeSpan ParseShift(string? notes)
    {
        if (string.IsNullOrEmpty(notes)) return TimeSpan.Zero;
        var match = ShiftRegex.Match(notes);
        return match.Success && int.TryParse(match.Groups[1].Value, out var minutes)
            ? TimeSpan.FromMinutes(minutes)
            : TimeSpan.Zero;
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
