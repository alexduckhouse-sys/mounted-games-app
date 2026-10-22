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
/// Within a session, arena fixtures that stay put between races (poles,
/// cones, tables / stations) are reused: the session needs the MAX any single
/// race asks for, not the sum. Everything else (items such as mugs, batons or
/// buckets) is kit set out per race, so those counts still add up.
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

        // Per session, accumulate per-kind+bucket counts.
        var perSession = new List<Dictionary<(string Kind, string Bucket), int>>();
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
    /// past top), Side (named anchor not above), Other. `Reusable` marks fixtures
    /// that stay in the arena between races.
    /// </summary>
    private static IEnumerable<(string Kind, string Bucket, bool Reusable)> BucketEach(IEnumerable<JsonElement> elements)
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
            yield return (kind, bucket, IsReusable(type));

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
                    yield return (childKind, bucket, IsReusable(ctype)); // inherit parent's bucket
                }
            }
        }
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
