using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services;

/// <summary>
/// Walks a competition's sessions, looks up the diagram for each race in each
/// heat, counts equipment elements, multiplies by the largest heat size in
/// the session, then DEDUPLICATES per kind across sessions by taking the
/// MAX — so if Session A needs 10 litter cones and Session B needs 12, the
/// total order is 12, not 22.
///
/// Output is bucketed into Lane / Start / Top / Side / Other by the
/// element's anchor + position so an organiser can read the printable
/// equipment list per arena zone.
/// </summary>
public class EquipmentCalculator
{
    private readonly AppDbContext _db;
    public EquipmentCalculator(AppDbContext db) => _db = db;

    public record EquipmentLine(string Kind, string Bucket, int Count);
    public record CalculatorResult(IReadOnlyList<EquipmentLine> Lines, int Sessions, int RacesCounted);

    public async Task<CalculatorResult> ComputeAsync(int competitionId)
    {
        var sessions = await _db.Sessions
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races)
            .Where(s => s.CompetitionId == competitionId && s.Kind == Entities.SessionKind.Race)
            .ToListAsync();

        var raceNames = sessions
            .SelectMany(s => s.Heats)
            .SelectMany(h => h.Races)
            .Select(r => r.Name)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var templates = await _db.RaceTemplates
            .Where(t => raceNames.Contains(t.Name))
            .ToDictionaryAsync(t => t.Name, t => t, StringComparer.OrdinalIgnoreCase);

        // Per session, accumulate per-kind+bucket counts.
        var perSession = new List<Dictionary<(string Kind, string Bucket), int>>();
        var racesCounted = 0;
        foreach (var session in sessions)
        {
            var sessionMax = new Dictionary<(string Kind, string Bucket), int>();
            // Find the largest heat (by entry count) so equipment is sized for
            // the busiest run of the session.
            var largest = session.Heats.Select(h => h.Entries.Count).DefaultIfEmpty(0).Max();
            if (largest == 0) continue;
            foreach (var race in session.Heats.SelectMany(h => h.Races).GroupBy(r => r.Name).Select(g => g.First()))
            {
                if (!templates.TryGetValue(race.Name, out var template)) continue;
                racesCounted++;
                var elements = ParseElements(template.DiagramJson);
                foreach (var (kind, bucket) in BucketEach(elements))
                {
                    var key = (kind, bucket);
                    sessionMax[key] = (sessionMax.TryGetValue(key, out var cur) ? cur : 0) + largest;
                }
            }
            perSession.Add(sessionMax);
        }

        // Dedupe across sessions by taking the MAX per (kind, bucket).
        var total = new Dictionary<(string Kind, string Bucket), int>();
        foreach (var s in perSession)
        foreach (var (k, v) in s)
        {
            if (!total.TryGetValue(k, out var cur) || v > cur) total[k] = v;
        }

        var lines = total
            .Select(kv => new EquipmentLine(kv.Key.Kind, kv.Key.Bucket, kv.Value))
            .OrderBy(l => l.Bucket).ThenBy(l => l.Kind)
            .ToList();
        return new CalculatorResult(lines, sessions.Count, racesCounted);
    }

    /// <summary>
    /// Pulls (kind, bucket) for each non-midline element. `kind` is the
    /// `kind` field for items/cones or the type name for poles/ins. `bucket`
    /// is one of: Lane (poles, anything on poleN), Start, Top (changeover or
    /// past top), Side (named anchor not above), Other.
    /// </summary>
    private static IEnumerable<(string Kind, string Bucket)> BucketEach(IEnumerable<JsonElement> elements)
    {
        foreach (var el in elements)
        {
            if (!el.TryGetProperty("t", out var t)) continue;
            var type = t.GetString() ?? "";
            if (type == "midline") continue;

            var kind = type switch
            {
                "pole" => "Pole",
                "in" or "table" => "In / station",
                _ => el.TryGetProperty("kind", out var k)
                    ? Capitalise(k.GetString() ?? type)
                    : Capitalise(type),
            };
            var bucket = ClassifyBucket(el, type);
            yield return (kind, bucket);

            // Recurse into stacked equipment (on:[…]).
            if (el.TryGetProperty("on", out var onArr) && onArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var child in onArr.EnumerateArray())
                {
                    if (!child.TryGetProperty("t", out var ct)) continue;
                    var ctype = ct.GetString() ?? "";
                    if (ctype == "midline") continue;
                    var childKind = ctype switch
                    {
                        "pole" => "Pole",
                        "in" or "table" => "In / station",
                        _ => child.TryGetProperty("kind", out var k2)
                            ? Capitalise(k2.GetString() ?? ctype)
                            : Capitalise(ctype),
                    };
                    yield return (childKind, bucket); // inherit parent's bucket
                }
            }
        }
    }

    private static string ClassifyBucket(JsonElement el, string type)
    {
        if (type == "pole") return "Lane";
        var anchor = el.TryGetProperty("anchor", out var a) ? a.GetString() : null;
        if (!string.IsNullOrEmpty(anchor))
        {
            if (anchor.StartsWith("pole", StringComparison.OrdinalIgnoreCase)) return "Lane";
            return anchor switch
            {
                "start" => "Start",
                "top" or "finish" or "changeover" => "Top",
                "midline" => "Mid",
                _ => "Other",
            };
        }
        if (el.TryGetProperty("x", out var x) && x.ValueKind == JsonValueKind.Number)
        {
            var v = x.GetDouble();
            if (v < 10) return "Start";
            if (v > 80) return "Top";
            return "Mid";
        }
        return "Other";
    }

    private static string Capitalise(string s) => string.IsNullOrEmpty(s) ? s : char.ToUpper(s[0]) + s[1..];

    private static List<JsonElement> ParseElements(string? json)
    {
        var list = new List<JsonElement>();
        if (string.IsNullOrWhiteSpace(json)) return list;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
            foreach (var el in doc.RootElement.EnumerateArray()) list.Add(el.Clone());
        }
        catch { /* malformed diagrams are ignored */ }
        return list;
    }
}
