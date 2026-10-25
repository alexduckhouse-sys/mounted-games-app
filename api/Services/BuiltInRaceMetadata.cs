using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Nodes;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

[ExcludeFromCodeCoverage]
public static class BuiltInRaceMetadata
{
    public static readonly string[] GoverningBodies = ["EGUK", "Pony Club", "MGA", "STRUK"];

    public record GoverningBodyRulebookDto(
        string Body,
        string Title,
        string Edition,
        string Equipment,
        string Setup,
        string HowToRide,
        string Penalties,
        string RulesText);

    public record RaceTemplateDetailDto(
        int Id,
        string Name,
        string? Summary,
        string? Rules,
        string? Category,
        string? DiagramJson,
        bool IsBuiltIn,
        IReadOnlyList<GoverningBodyRulebookDto> Rulebooks);

    public static readonly IReadOnlyDictionary<string, double> SlotCoords =
        new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
        {
            ["start"] = 0,
            ["gap0"] = 11,
            ["pole1"] = 22,
            ["gap1"] = 33,
            ["mid_1_2"] = 33,
            ["pole2"] = 44,
            ["gap2"] = 55,
            ["mid_2_3"] = 55,
            ["midline"] = 55,
            ["pole3"] = 66,
            ["gap3"] = 77,
            ["mid_3_4"] = 77,
            ["pole4"] = 88,
            ["gap4"] = 94,
            ["mid_4_top"] = 94,
            ["changeover"] = 100,
            ["gap5"] = 104,
            ["top"] = 108,
            ["pole5"] = 110,
            ["beyond"] = 116,
        };

    public static RaceTemplateDetailDto ToDetailDto(RaceTemplate row)
    {
        var diagram = NormaliseDiagramJson(row.DiagramJson) ?? row.DiagramJson;
        var rulebooks = BuildRulebooks(row.Name, row.Summary, row.Rules, row.Category, diagram);
        return new RaceTemplateDetailDto(
            row.Id,
            row.Name,
            row.Summary,
            row.Rules,
            row.Category,
            diagram,
            row.IsBuiltIn,
            rulebooks);
    }

    public static readonly IReadOnlyDictionary<string, string> RaceNameAliases =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Litter Lifter"] = "Litter",
            ["Bottle Shuttle"] = "Bottle",
            ["Mug Shuffle"] = "Two Mug",
            ["Pole Bending"] = "Bending",
        };

    public static string ResolveCanonicalName(string name)
    {
        var trimmed = (name ?? string.Empty).Trim();
        return RaceNameAliases.TryGetValue(trimmed, out var canonical) ? canonical : trimmed;
    }

    public static RaceTemplateDetailDto? FromBuiltInSeed(string name)
    {
        var trimmed = ResolveCanonicalName(name);
        var seed = RaceLibrarySeed.All.FirstOrDefault(
            s => string.Equals(s.Name, trimmed, StringComparison.OrdinalIgnoreCase));
        if (seed is null) return null;

        RaceLibraryUpdates.ByName.TryGetValue(seed.Name, out var update);
        var summary = update?.Summary ?? seed.Summary;
        var rules = update?.Rules ?? seed.Rules;
        var category = update?.Category ?? seed.Category;
        var rawDiagram = update?.DiagramJson ?? seed.DiagramJson;
        var diagram = NormaliseDiagramJson(rawDiagram) ?? rawDiagram;
        var rulebooks = BuildRulebooks(seed.Name, summary, rules, category, diagram);

        return new RaceTemplateDetailDto(
            0,
            seed.Name,
            summary,
            rules,
            category,
            diagram,
            true,
            rulebooks);
    }

    public static string? NormaliseDiagramJson(string? diagramJson)
    {
        if (string.IsNullOrWhiteSpace(diagramJson)) return diagramJson;
        try
        {
            var node = JsonNode.Parse(diagramJson);
            if (node is not JsonArray arr) return diagramJson;
            var hasMidline = arr.OfType<JsonObject>().Any(
                o => string.Equals(o["t"]?.GetValue<string>(), "midline", StringComparison.OrdinalIgnoreCase));

            foreach (var item in arr.OfType<JsonObject>())
            {
                var t = item["t"]?.GetValue<string>() ?? "";
                if (t is "lane" or "midline") continue;
                var anchor = item["anchor"]?.GetValue<string>()?.Trim().ToLowerInvariant();
                var rawX = item["x"]?.GetValue<double>();
                if (string.Equals(anchor, "pole3", StringComparison.OrdinalIgnoreCase)
                    && hasMidline && rawX is 50 or 55)
                {
                    item["x"] = 55;
                    continue;
                }
                if (!string.IsNullOrEmpty(anchor) && SlotCoords.TryGetValue(anchor, out var slotX))
                {
                    item["x"] = slotX;
                }
            }
            return arr.ToJsonString();
        }
        catch
        {
            return diagramJson;
        }
    }

    public static IReadOnlyList<GoverningBodyRulebookDto> BuildRulebooks(
        string name,
        string? summary,
        string? rules,
        string? category,
        string? diagramJson)
    {
        var baseSummary = string.IsNullOrWhiteSpace(summary)
            ? $"Official mounted games rules and arena setup for {name}."
            : summary.Trim();
        var baseRules = string.IsNullOrWhiteSpace(rules)
            ? baseSummary
            : rules.Trim();
        var (equipmentText, setupText) = ExtractEquipmentAndSetup(name, baseRules, diagramJson);

        return
        [
            new GoverningBodyRulebookDto(
                Body: "EGUK",
                Title: $"EGUK — {name}",
                Edition: "Equestrian Games UK Rulebook 2026",
                Equipment: equipmentText,
                Setup: $"{setupText} Poles P1–P5 are spaced 6 m apart (P1–P4 inside the 27 m Changeover line; P5 at 30 m and far-end props beyond the Changeover line).",
                HowToRide: baseRules,
                Penalties: "Knocked poles, cones or props must be replaced by the rider responsible before continuing from the point of the fault. Handovers must take place behind the Start/Finish or Changeover line with all four hooves across.",
                RulesText: $"[EGUK 2026 · {name}]\nSummary: {baseSummary}\n\nEquipment & Arena Setup:\n{equipmentText}\n{setupText}\n\nHow the Race is Ridden:\n{baseRules}"),

            new GoverningBodyRulebookDto(
                Body: "Pony Club",
                Title: $"Pony Club — {name}",
                Edition: "The Pony Club Mounted Games Rulebook 2026",
                Equipment: equipmentText,
                Setup: $"{setupText} First pole 14 m from the Start/Finish Line, poles 7–9 m apart, with the 5th pole and changeover-end containers/tables positioned 3 m beyond the Changeover Line.",
                HowToRide: baseRules,
                Penalties: "Ponies must be led by the near rein when dismounted. Any misplaced or dropped equipment must be corrected by the rider concerned from the point of error before the next rider crosses the line.",
                RulesText: $"[The Pony Club 2026 · {name}]\nSummary: {baseSummary}\n\nEquipment & Arena Setup:\n{equipmentText}\n{setupText}\n\nHow the Race is Ridden:\n{baseRules}"),

            new GoverningBodyRulebookDto(
                Body: "MGA",
                Title: $"MGA — {name}",
                Edition: "Mounted Games Association (IMGA) Rulebook 2026",
                Equipment: equipmentText,
                Setup: $"{setupText} Standard international arena layout: Start/Finish at 0 m, P1–P5 evenly spaced every 6 m (6 m, 12 m, 18 m, 24 m, 30 m), Changeover line at 27 m, and P5 / far-end equipment beyond the Changeover line.",
                HowToRide: baseRules,
                Penalties: "Under MGA/IMGA rules, all four hooves must cross the Start/Finish or Changeover line before handover or collection beyond the line. Deliberate interference or uncorrected faults result in elimination.",
                RulesText: $"[MGA / IMGA 2026 · {name}]\nSummary: {baseSummary}\n\nEquipment & Arena Setup:\n{equipmentText}\n{setupText}\n\nHow the Race is Ridden:\n{baseRules}"),

            new GoverningBodyRulebookDto(
                Body: "STRUK",
                Title: $"STRUK — {name}",
                Edition: "Sporting Track Riding UK Rulebook 2026",
                Equipment: equipmentText,
                Setup: $"{setupText} STRUK lane grid uses evenly spaced poles P1–P4 in the main lane with P5 and changeover-end equipment (bins, tables, cartons, flag cones) beyond the Changeover line.",
                HowToRide: baseRules,
                Penalties: "Riders must complete all equipment placements upright and in sequence before the incoming rider crosses the Start/Finish Line. Faults must be rectified immediately by the active rider.",
                RulesText: $"[STRUK 2026 · {name}]\nSummary: {baseSummary}\n\nEquipment & Arena Setup:\n{equipmentText}\n{setupText}\n\nHow the Race is Ridden:\n{baseRules}"),
        ];
    }

    private static (string Equipment, string Setup) ExtractEquipmentAndSetup(
        string name,
        string rules,
        string? diagramJson)
    {
        var sentences = rules
            .Split(['.', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(s => s.Length > 0)
            .ToList();
        var setupSentence = sentences.FirstOrDefault() ?? $"Standard arena lane setup for {name}";
        if (!setupSentence.EndsWith('.')) setupSentence += ".";

        if (string.IsNullOrWhiteSpace(diagramJson))
        {
            return (setupSentence, setupSentence);
        }

        try
        {
            using var doc = JsonDocument.Parse(diagramJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return (setupSentence, setupSentence);

            var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var beyondItems = new List<string>();

            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (!el.TryGetProperty("t", out var tProp)) continue;
                var t = tProp.GetString() ?? "";
                if (t is "lane" or "midline") continue;

                var anchor = el.TryGetProperty("anchor", out var aProp) ? aProp.GetString() ?? "" : "";
                var label = LabelOf(el, t);
                counts[label] = (counts.TryGetValue(label, out var c) ? c : 0) + 1;
                if (anchor is "pole5" or "top" or "beyond")
                {
                    beyondItems.Add(label);
                }

                if (el.TryGetProperty("on", out var onArr) && onArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var child in onArr.EnumerateArray())
                    {
                        if (!child.TryGetProperty("t", out var ctProp)) continue;
                        var ct = ctProp.GetString() ?? "";
                        var cLabel = LabelOf(child, ct);
                        counts[cLabel] = (counts.TryGetValue(cLabel, out var cc) ? cc : 0) + 1;
                    }
                }
            }

            var equipSummary = counts.Count > 0
                ? string.Join(", ", counts.Select(kv => $"{kv.Value} × {kv.Key}"))
                : setupSentence;
            var beyondSummary = beyondItems.Count > 0
                ? $" Beyond the Changeover line: {string.Join(", ", beyondItems.Distinct(StringComparer.OrdinalIgnoreCase))}."
                : "";
            return (equipSummary, setupSentence + beyondSummary);
        }
        catch
        {
            return (setupSentence, setupSentence);
        }
    }

    private static string LabelOf(JsonElement el, string t)
    {
        if (string.Equals(t, "pole", StringComparison.OrdinalIgnoreCase)) return "Bending pole";
        if (string.Equals(t, "in", StringComparison.OrdinalIgnoreCase)
            || string.Equals(t, "table", StringComparison.OrdinalIgnoreCase)) return "Table / station";
        if (el.TryGetProperty("label", out var lProp) && lProp.ValueKind == JsonValueKind.String)
        {
            var lbl = lProp.GetString()?.Trim();
            if (!string.IsNullOrWhiteSpace(lbl)) return lbl;
        }
        if (el.TryGetProperty("kind", out var kProp) && kProp.ValueKind == JsonValueKind.String)
        {
            var k = kProp.GetString()?.Trim();
            if (!string.IsNullOrWhiteSpace(k))
                return char.ToUpperInvariant(k[0]) + k[1..];
        }
        return char.ToUpperInvariant(t[0]) + t[1..];
    }
}
