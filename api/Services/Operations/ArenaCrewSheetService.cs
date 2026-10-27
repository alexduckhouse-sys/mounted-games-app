using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Operations;

public class ArenaCrewSheetService(AppDbContext db)
{
    public async Task<ArenaCrewPropSheetDto> GetAsync(
        int competitionId,
        int? sessionId = null,
        int? heatId = null,
        CancellationToken ct = default)
    {
        var exists = await db.Competitions.AsNoTracking().AnyAsync(c => c.Id == competitionId, ct);
        if (!exists)
            throw new KeyNotFoundException("Competition not found.");

        var sessions = await db.Sessions
            .AsNoTracking()
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races)
            .Where(s => s.CompetitionId == competitionId && !s.IsBreak && s.Kind == SessionKind.Race)
            .OrderBy(s => s.OrderIndex)
            .ThenBy(s => s.Id)
            .ToListAsync(ct);

        Session? session = null;
        if (sessionId.HasValue)
        {
            session = sessions.FirstOrDefault(s => s.Id == sessionId.Value);
        }
        session ??= sessions.FirstOrDefault(s => s.Status == SessionStatus.InArena)
            ?? sessions.FirstOrDefault(s => s.Status == SessionStatus.Upcoming && s.Heats.Count > 0)
            ?? sessions.FirstOrDefault();

        if (session is null)
        {
            return new ArenaCrewPropSheetDto(
                CompetitionId: competitionId,
                SessionId: null,
                SessionName: null,
                ArenaName: null,
                HeatId: null,
                HeatLabel: null,
                LanesPerHeat: 5,
                CurrentRace: null,
                NextRace: null,
                Transition: null,
                AllHeatRaces: []);
        }

        var orderedHeats = session.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id).ToList();
        Heat? heat = null;
        if (heatId.HasValue)
        {
            heat = orderedHeats.FirstOrDefault(h => h.Id == heatId.Value);
        }
        heat ??= orderedHeats.FirstOrDefault(h => h.Races.Any(r => !r.IsComplete))
            ?? orderedHeats.FirstOrDefault();

        var lanesPerHeat = Math.Clamp(
            Math.Max(heat?.Entries.Count ?? 0, session.LanesPerHeat ?? 5),
            1,
            12);

        var raceList = heat is not null && heat.Races.Count > 0
            ? heat.Races.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id)
                .Select(r => (RaceId: (int?)r.Id, r.Name, r.OrderIndex, r.IsComplete))
                .ToList()
            : (PlannedRaceList.Read(session.PlannedRaces) ?? [])
                .Select((name, idx) => (RaceId: (int?)null, Name: name, OrderIndex: idx + 1, IsComplete: false))
                .ToList();

        var distinctNames = raceList.Select(r => r.Name).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var lowered = distinctNames.Select(n => n.ToLowerInvariant()).ToList();
        var dbTemplates = lowered.Count == 0
            ? []
            : await db.RaceTemplates.AsNoTracking()
                .Where(t => lowered.Contains(t.Name.ToLower()))
                .OrderBy(t => t.Id)
                .ToListAsync(ct);

        var cards = new List<ArenaCrewRaceCardDto>();
        var cardPropCounts = new List<Dictionary<string, int>>();

        foreach (var item in raceList)
        {
            var canonical = BuiltInRaceMetadata.ResolveCanonicalName(item.Name);
            var dbTemplate = dbTemplates.FirstOrDefault(t => string.Equals(t.Name, item.Name, StringComparison.OrdinalIgnoreCase))
                ?? dbTemplates.FirstOrDefault(t => string.Equals(t.Name, canonical, StringComparison.OrdinalIgnoreCase));
            var seedDetail = BuiltInRaceMetadata.FromBuiltInSeed(item.Name);

            var diagramJson = BuiltInRaceMetadata.NormaliseDiagramJson(dbTemplate?.DiagramJson ?? seedDetail?.DiagramJson)
                ?? dbTemplate?.DiagramJson
                ?? seedDetail?.DiagramJson;
            var summary = dbTemplate?.Summary ?? seedDetail?.Summary;

            var (card, propCounts) = BuildRaceCard(item.RaceId, item.Name, item.OrderIndex, summary, diagramJson);
            cards.Add(card);
            cardPropCounts.Add(propCounts);
        }

        var currentIndex = raceList.FindIndex(r => !r.IsComplete);
        if (currentIndex < 0 && cards.Count > 0)
            currentIndex = cards.Count - 1;

        var currentRace = currentIndex >= 0 && currentIndex < cards.Count ? cards[currentIndex] : null;
        var nextRace = currentIndex >= 0 && currentIndex + 1 < cards.Count ? cards[currentIndex + 1] : null;
        var transition = currentRace is not null && nextRace is not null
            ? BuildTransitionDiff(cardPropCounts[currentIndex], cardPropCounts[currentIndex + 1])
            : null;

        var heatLabel = heat is null
            ? null
            : !string.IsNullOrWhiteSpace(heat.Label) ? heat.Label!.Trim() : $"Heat {heat.OrderIndex}";

        return new ArenaCrewPropSheetDto(
            CompetitionId: competitionId,
            SessionId: session.Id,
            SessionName: session.Name,
            ArenaName: session.ArenaName,
            HeatId: heat?.Id,
            HeatLabel: heatLabel,
            LanesPerHeat: lanesPerHeat,
            CurrentRace: currentRace,
            NextRace: nextRace,
            Transition: transition,
            AllHeatRaces: cards);
    }

    public static (ArenaCrewRaceCardDto Card, Dictionary<string, int> PropCounts) BuildRaceCard(
        int? raceId,
        string raceName,
        int orderIndex,
        string? summary,
        string? diagramJson)
    {
        var startCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var centreCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var topCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var overallCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var bendingPoles = 0;

        if (!string.IsNullOrWhiteSpace(diagramJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(diagramJson);
                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var el in doc.RootElement.EnumerateArray())
                    {
                        if (!el.TryGetProperty("t", out var tProp)) continue;
                        var t = tProp.GetString() ?? "";
                        if (string.Equals(t, "lane", StringComparison.OrdinalIgnoreCase)
                            || string.Equals(t, "midline", StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        var zone = ClassifyZone(el);
                        var targetZone = zone switch
                        {
                            "start" => startCounts,
                            "top" => topCounts,
                            _ => centreCounts,
                        };

                        if (string.Equals(t, "pole", StringComparison.OrdinalIgnoreCase) && zone == "centre")
                            bendingPoles++;

                        AccumulateElementAndChildren(el, targetZone, overallCounts);
                    }
                }
            }
            catch
            {
                // Ignore malformed diagram JSON and return empty zone lists.
            }
        }

        var zones = new List<ArenaCrewZonePropsDto>
        {
            BuildZoneDto("start", "Start / Finish Line", startCounts),
            BuildZoneDto("centre", "Centre Line (Poles 1–4)", centreCounts),
            BuildZoneDto("top", "Changeover / Top Line", topCounts),
        };

        var card = new ArenaCrewRaceCardDto(
            RaceId: raceId,
            RaceName: raceName,
            OrderIndex: orderIndex,
            BendingPolesPerLane: bendingPoles,
            Summary: summary,
            Zones: zones);

        return (card, overallCounts);
    }

    private static void AccumulateElementAndChildren(
        JsonElement el,
        Dictionary<string, int> zoneCounts,
        Dictionary<string, int> overallCounts)
    {
        if (!el.TryGetProperty("t", out var tProp)) return;
        var t = tProp.GetString() ?? "";
        if (t is "lane" or "midline") return;

        var label = ElementLabel(el, t);
        zoneCounts[label] = zoneCounts.GetValueOrDefault(label, 0) + 1;
        overallCounts[label] = overallCounts.GetValueOrDefault(label, 0) + 1;

        if (el.TryGetProperty("on", out var onArr) && onArr.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in onArr.EnumerateArray())
                AccumulateElementAndChildren(child, zoneCounts, overallCounts);
        }
    }

    private static string ClassifyZone(JsonElement el)
    {
        var anchor = el.TryGetProperty("anchor", out var aProp) && aProp.ValueKind == JsonValueKind.String
            ? aProp.GetString()?.Trim().ToLowerInvariant()
            : null;

        if (!string.IsNullOrEmpty(anchor))
        {
            if (anchor is "start" or "gap0") return "start";
            if (anchor is "gap4" or "mid_4_top" or "changeover" or "gap5" or "top" or "pole5" or "beyond")
                return "top";
            if (anchor.StartsWith("pole", StringComparison.OrdinalIgnoreCase)
                || anchor.StartsWith("gap", StringComparison.OrdinalIgnoreCase)
                || anchor.StartsWith("mid", StringComparison.OrdinalIgnoreCase))
                return "centre";
        }

        if (el.TryGetProperty("x", out var xProp) && xProp.ValueKind == JsonValueKind.Number)
        {
            var x = xProp.GetDouble();
            if (x < 18) return "start";
            if (x >= 92) return "top";
        }

        return "centre";
    }

    private static string ElementLabel(JsonElement el, string t)
    {
        if (string.Equals(t, "pole", StringComparison.OrdinalIgnoreCase))
            return "Bending pole";
        if (string.Equals(t, "in", StringComparison.OrdinalIgnoreCase)
            || string.Equals(t, "table", StringComparison.OrdinalIgnoreCase))
            return "Table / stand";

        if (el.TryGetProperty("label", out var lblProp) && lblProp.ValueKind == JsonValueKind.String)
        {
            var lbl = lblProp.GetString()?.Trim();
            if (!string.IsNullOrWhiteSpace(lbl) && !RegexIsPositionalOnly(lbl))
                return lbl;
        }

        if (el.TryGetProperty("kind", out var kProp) && kProp.ValueKind == JsonValueKind.String)
        {
            var k = kProp.GetString()?.Trim();
            if (!string.IsNullOrWhiteSpace(k))
            {
                if (string.Equals(t, "cone", StringComparison.OrdinalIgnoreCase))
                    return $"{Capitalise(k)} cone";
                return Capitalise(k);
            }
        }

        return Capitalise(t);
    }

    private static bool RegexIsPositionalOnly(string text)
        => System.Text.RegularExpressions.Regex.IsMatch(
            text,
            @"^(?:p?\d+|pole\s*\d+|cone\s*\d+|\d+(?:st|nd|rd|th)(?:\s*(?:pole|cone))?)$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    private static string Capitalise(string s)
        => string.IsNullOrEmpty(s) ? s : char.ToUpperInvariant(s[0]) + s[1..];

    private static ArenaCrewZonePropsDto BuildZoneDto(
        string zoneKey,
        string zoneLabel,
        Dictionary<string, int> counts)
    {
        var items = counts
            .OrderByDescending(kv => string.Equals(kv.Key, "Bending pole", StringComparison.OrdinalIgnoreCase))
            .ThenBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
            .Select(kv => $"{kv.Value} × {kv.Key} per lane")
            .ToList();

        var summary = items.Count == 0 ? "Clear" : string.Join(", ", items);
        return new ArenaCrewZonePropsDto(zoneKey, zoneLabel, items, summary);
    }

    public static ArenaCrewTransitionDiffDto BuildTransitionDiff(
        Dictionary<string, int> currentCounts,
        Dictionary<string, int> nextCounts)
    {
        var allKeys = currentCounts.Keys
            .Union(nextCounts.Keys, StringComparer.OrdinalIgnoreCase)
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var bringIn = new List<string>();
        var clearOut = new List<string>();
        var keep = new List<string>();

        foreach (var key in allKeys)
        {
            var cur = currentCounts.GetValueOrDefault(key, 0);
            var nxt = nextCounts.GetValueOrDefault(key, 0);
            var shared = Math.Min(cur, nxt);
            if (shared > 0)
                keep.Add($"{shared} × {key} per lane");
            if (nxt > cur)
                bringIn.Add($"{nxt - cur} × {key} per lane");
            if (cur > nxt)
                clearOut.Add($"{cur - nxt} × {key} per lane");
        }

        var parts = new List<string>();
        if (bringIn.Count > 0) parts.Add($"Bring in: {string.Join(", ", bringIn)}");
        if (clearOut.Count > 0) parts.Add($"Clear: {string.Join(", ", clearOut)}");
        if (keep.Count > 0) parts.Add($"Keep: {string.Join(", ", keep)}");
        var summary = parts.Count == 0 ? "No prop changes needed." : string.Join(" · ", parts);

        return new ArenaCrewTransitionDiffDto(bringIn, clearOut, keep, summary);
    }
}
