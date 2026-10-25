using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services;

/// <summary>
/// Walks a competition's sessions, looks up the diagram for each race in each
/// heat, counts equipment elements, multiplies by the largest heat size in
/// the session, takes the MAX across sequential sessions within the same
/// arena, and SUMS across distinct concurrent arenas.
///
/// Within a session, arena fixtures that stay put between races (poles,
/// cones, tables / stations) are reused: the session needs the MAX any single
/// race asks for, not the sum. Everything else (items such as mugs, batons or
/// buckets) is kit set out per race, so those counts still add up.
///
/// Output is bucketed into Lane / Start / Top / Mid / Other by the
/// element's anchor + position so an organiser can read the printable
/// equipment list per arena zone.
/// </summary>
public class EquipmentCalculator
{
    private static readonly Regex PositionalLabelPattern = new(
        @"^(?:p?\d+|pole\s*\d+|cone\s*\d+|\d+(?:st|nd|rd|th)(?:\s*(?:pole|cone))?)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

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
        // Race names are free text, so match templates case-insensitively. The
        // unique index on RaceTemplate.Name is case-sensitive, so "Bending" and
        // "bending" can both exist; prefer an exact-case match, then the oldest.
        var loweredNames = raceNames.Select(n => n.ToLower()).ToList();
        var candidates = await _db.RaceTemplates
            .Where(t => loweredNames.Contains(t.Name.ToLower()))
            .OrderBy(t => t.Id)
            .ToListAsync();
        var templates = raceNames
            .Select(n => (Name: n, Template: candidates.FirstOrDefault(t => t.Name == n)
                ?? candidates.FirstOrDefault(t => string.Equals(t.Name, n, StringComparison.OrdinalIgnoreCase))))
            .Where(x => x.Template is not null)
            .ToDictionary(x => x.Name, x => x.Template!, StringComparer.OrdinalIgnoreCase);

        // Per arena, take the MAX across that arena's sequential sessions;
        // across distinct arenas, SUM the arena peaks because arenas run in parallel.
        var perArenaMax = new Dictionary<string, Dictionary<(string Kind, string Bucket), int>>(StringComparer.OrdinalIgnoreCase);
        var racesCounted = 0;
        foreach (var session in sessions)
        {
            // Kit that is set out per race adds up; fixtures that stay in the
            // arena only need the biggest single-race requirement. They're
            // tracked apart because a cone "Flag" and an item "Flag" share a key.
            var consumed = new Dictionary<(string Kind, string Bucket), int>();
            var reusableMax = new Dictionary<(string Kind, string Bucket), int>();
            // Find the largest heat (by entry count) so equipment is sized for
            // the busiest run of the session.
            var largest = session.Heats.Select(h => h.Entries.Count).DefaultIfEmpty(0).Max();
            if (largest == 0) continue;
            foreach (var race in session.Heats.SelectMany(h => h.Races).GroupBy(r => r.Name, StringComparer.OrdinalIgnoreCase).Select(g => g.First()))
            {
                if (!templates.TryGetValue(race.Name, out var template)) continue;
                racesCounted++;
                var elements = ParseElements(template.DiagramJson);
                var raceReusable = new Dictionary<(string Kind, string Bucket), int>();
                foreach (var (kind, bucket, reusable) in BucketEach(elements))
                {
                    var key = (kind, bucket);
                    var target = reusable ? raceReusable : consumed;
                    target[key] = (target.TryGetValue(key, out var cur) ? cur : 0) + largest;
                }
                foreach (var (key, v) in raceReusable)
                {
                    if (!reusableMax.TryGetValue(key, out var cur) || v > cur) reusableMax[key] = v;
                }
            }
            var sessionMax = new Dictionary<(string Kind, string Bucket), int>(consumed);
            foreach (var (key, v) in reusableMax)
            {
                sessionMax[key] = (sessionMax.TryGetValue(key, out var cur) ? cur : 0) + v;
            }

            var arenaKey = string.IsNullOrWhiteSpace(session.ArenaName) ? "Main Arena" : session.ArenaName.Trim();
            if (!perArenaMax.TryGetValue(arenaKey, out var arenaTotals))
            {
                arenaTotals = new Dictionary<(string Kind, string Bucket), int>();
                perArenaMax[arenaKey] = arenaTotals;
            }
            foreach (var (k, v) in sessionMax)
            {
                if (!arenaTotals.TryGetValue(k, out var cur) || v > cur) arenaTotals[k] = v;
            }
        }

        // Sum peak quantities across distinct arenas.
        var total = new Dictionary<(string Kind, string Bucket), int>();
        foreach (var arenaTotals in perArenaMax.Values)
        foreach (var (k, v) in arenaTotals)
        {
            total[k] = (total.TryGetValue(k, out var cur) ? cur : 0) + v;
        }

        var lines = total
            .Select(kv => new EquipmentLine(kv.Key.Kind, kv.Key.Bucket, kv.Value))
            .OrderBy(l => l.Bucket).ThenBy(l => l.Kind)
            .ToList();
        return new CalculatorResult(lines, sessions.Count, racesCounted);
    }

    /// <summary>
    /// Pulls (kind, bucket) for each non-midline/non-lane element and any
    /// stacked `on` children at arbitrary depth.
    /// </summary>
    private static IEnumerable<(string Kind, string Bucket, bool Reusable)> BucketEach(IEnumerable<JsonElement> elements)
    {
        foreach (var root in elements)
        {
            if (!root.TryGetProperty("t", out var rt)) continue;
            var rootType = rt.GetString() ?? "";
            if (IsIgnoredType(rootType)) continue;

            var bucket = ClassifyBucket(root, rootType);
            var queue = new Queue<JsonElement>();
            queue.Enqueue(root);

            while (queue.Count > 0)
            {
                var cur = queue.Dequeue();
                if (!cur.TryGetProperty("t", out var ct)) continue;
                var ctype = ct.GetString() ?? "";
                if (IsIgnoredType(ctype)) continue;

                yield return (ElementDisplayName(cur, ctype), bucket, IsReusable(ctype));

                if (cur.TryGetProperty("on", out var onArr) && onArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var child in onArr.EnumerateArray())
                    {
                        queue.Enqueue(child);
                    }
                }
            }
        }
    }

    private static bool IsIgnoredType(string type)
        => string.Equals(type, "midline", StringComparison.OrdinalIgnoreCase)
        || string.Equals(type, "lane", StringComparison.OrdinalIgnoreCase);

    private static string ElementDisplayName(JsonElement el, string type)
    {
        if (string.Equals(type, "pole", StringComparison.OrdinalIgnoreCase)) return "Pole";
        if (string.Equals(type, "in", StringComparison.OrdinalIgnoreCase)
            || string.Equals(type, "table", StringComparison.OrdinalIgnoreCase))
        {
            return "In / station";
        }

        var hasKind = el.TryGetProperty("kind", out var k);
        var kindStr = hasKind ? k.GetString() : null;
        if (string.IsNullOrWhiteSpace(kindStr)
            && el.TryGetProperty("label", out var lbl)
            && lbl.ValueKind == JsonValueKind.String)
        {
            var labelText = lbl.GetString()?.Trim();
            if (!string.IsNullOrWhiteSpace(labelText) && !PositionalLabelPattern.IsMatch(labelText))
            {
                return Capitalise(labelText);
            }
        }

        return hasKind ? Capitalise(kindStr ?? type) : Capitalise(type);
    }

    /// <summary>
    /// Poles, cones and tables / stations are arena fixtures that stay put
    /// between races. Items (mugs, batons, buckets, ...) are set out per race.
    /// </summary>
    private static bool IsReusable(string type) => type is "pole" or "cone" or "in" or "table";

    private static string ClassifyBucket(JsonElement el, string type)
    {
        if (type == "pole") return "Lane";
        var anchor = el.TryGetProperty("anchor", out var a) ? a.GetString() : null;
        if (!string.IsNullOrEmpty(anchor))
        {
            if (anchor.StartsWith("pole", StringComparison.OrdinalIgnoreCase)) return "Lane";
            if (anchor.StartsWith("gap", StringComparison.OrdinalIgnoreCase))
            {
                if (el.TryGetProperty("x", out var gx) && gx.ValueKind == JsonValueKind.Number)
                {
                    var gv = gx.GetDouble();
                    if (gv < 24) return "Start";
                    if (gv >= 88) return "Top";
                    return "Lane";
                }
                return string.Equals(anchor, "gap0", StringComparison.OrdinalIgnoreCase) ? "Start" : "Lane";
            }
            return anchor.ToLowerInvariant() switch
            {
                "start" => "Start",
                "top" or "finish" or "changeover" or "beyond" => "Top",
                "midline" => "Mid",
                _ => "Other",
            };
        }
        if (el.TryGetProperty("x", out var x) && x.ValueKind == JsonValueKind.Number)
        {
            var v = x.GetDouble();
            if (v < 24) return "Start";
            if (v >= 80) return "Top";
            if (v >= 45 && v <= 55) return "Mid";
            return "Lane";
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
