using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Calendar;

/// <summary>Score-to-score slots include changeovers and score-entry delay; they are not stopwatch race times.</summary>
public static class PaceLearning
{
    public record Sample(int HeatId, string Game, string AgeGroup, SectionFormat Format, string Arena,
        double Minutes, double PlannedMinutes);
    public static List<Sample> Samples(IEnumerable<Session> sessions)
    {
        var samples = new List<Sample>();
        foreach (var session in sessions)
        {
            if (session.Kind != SessionKind.Race || (session.Notes ?? "").Contains("[paused:")) continue;
            foreach (var heat in session.Heats)
            {
                var races = heat.Races.OrderBy(r => r.OrderIndex).ToList();
                DateTime? previousFinish = null;
                foreach (var race in races)
                {
                    var anchor = previousFinish ?? (race.StartIsExplicit ? race.StartedAt : null);
                    if (race.FinishedAt is { } finish)
                    {
                        if (anchor is { } start && !race.HasOpenProtest)
                        {
                            var minutes = (finish - start).TotalMinutes;
                            // Batch-entered results and very long interruptions are not representative slots.
                            if (minutes >= 0.6 && double.IsFinite(minutes))
                                samples.Add(new(heat.Id, race.Name.Trim().ToLowerInvariant(),
                                    session.Section?.AgeGroup.Trim().ToLowerInvariant() ?? "", session.Section?.Format ?? default,
                                    session.ArenaName?.Trim() ?? "", minutes,
                                    (heat.DurationMinutes ?? session.MinutesPerHeat ?? 30.0) / Math.Max(1, races.Count)));
                        }
                        previousFinish = finish;
                    }
                    else previousFinish = null; // Never bridge an unrecorded race.
                }
            }
        }
        return samples;
    }

    public static double Median(IEnumerable<double> source)
    {
        var sorted = source.Order().ToArray();
        return sorted.Length == 0 ? 0 : sorted.Length % 2 == 1 ? sorted[sorted.Length / 2]
            : (sorted[sorted.Length / 2 - 1] + sorted[sorted.Length / 2]) / 2;
    }

    public static List<Sample> Clean(IReadOnlyList<Sample> samples)
    {
        samples = samples.Where(s => s.Minutes <= 9).ToList();
        if (samples.Count < 5) return samples.ToList();
        var median = Median(samples.Select(s => s.Minutes));
        var scale = Math.Max(0.45, 1.4826 * Median(samples.Select(s => Math.Abs(s.Minutes - median))));
        return samples.Where(s => s.Minutes - median <= Math.Max(1.75, 2.8 * scale)).ToList();
    }
}
