using System.Text.Json;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Services;

/// <summary>Checks the Pairs and Individual race versions against the team races and the booklet.</summary>
public class RaceLibraryVariantsTests
{
    /// <summary>Every "(Pairs)" heading in the Pony Club 2026 booklet except Three Mug and Table (Pairs), which stays in the core list.</summary>
    private static readonly string[] BookletPairsHeadings =
    [
        "Ball and Bucket (Pairs)", "Ball and Cone (Pairs)", "Ball and Flag (Pairs)", "Ball and Racquet (Pairs)",
        "Ball and Socket (Pairs)", "Bending (Pairs)", "Bottle (Pairs)", "Bottle Collection (Pairs)",
        "Bowling Race (Pairs)", "Equipment Jumble (Pairs)", "Farmers' Market (Pairs)", "Fishing Race (Pairs)",
        "Five Flag (Pairs)", "Five Mug – Mug Specific (Pairs)", "Four Flag (Pairs)", "Grooms (Pairs)",
        "HI LO – Cone Specific (Pairs)", "Hurdles (Pairs)", "Litter (Pairs)", "Mug Changes (Pairs)",
        "Old Sock (Pairs)", "PGSPORTS Pole (Pairs)", "PG Sports Shopping Spree Race (Pairs)", "Post Box (Pairs)",
        "Pyramid (Pairs)", "Quoit and Bottle (Pairs)", "Quoits and Cone (Pairs)", "Recycling Race (Pairs)",
        "Rope (Pairs)", "Sharpshooters (Pairs)", "Small Sack (Pairs)", "Stepping Stones (Pairs)",
        "STRUK Pole (Pairs)", "Sword (Pairs)", "Tack Shop (Pairs)", "Tennis Ball Shuffle (Pairs)",
        "Three-Legged Sack (Pairs)", "Three Mug (Pairs)", "Tubular Flag Race (Pairs)", "Two Flag (Pairs)",
        "Two Mug (Pairs)", "Tyre (Pairs)",
    ];

    private static readonly HashSet<string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase)
        { "lane", "midline", "pole", "cone", "in", "item" };

    private static IEnumerable<RaceLibraryVariants.Variant> Pairs =>
        RaceLibraryVariants.All.Where(v => v.Format == SectionFormat.Pairs);

    private static IEnumerable<RaceLibraryVariants.Variant> Individuals =>
        RaceLibraryVariants.All.Where(v => v.Format == SectionFormat.Individual);

    /// <summary>Every kit element in a diagram, stacked children included (what the equipment list counts).</summary>
    private static List<JsonElement> Elements(string diagramJson)
    {
        var list = new List<JsonElement>();
        using var doc = JsonDocument.Parse(diagramJson);
        void Walk(JsonElement el)
        {
            var t = el.GetProperty("t").GetString()!;
            if (t is not ("lane" or "midline")) list.Add(el.Clone());
            if (el.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.Array)
                foreach (var child in on.EnumerateArray()) Walk(child);
        }
        foreach (var el in doc.RootElement.EnumerateArray()) Walk(el);
        return list;
    }

    private static int Count(string diagramJson) => Elements(diagramJson).Count;

    private static int Balls(string diagramJson) =>
        Elements(diagramJson).Count(e => e.TryGetProperty("kind", out var k) && k.GetString() == "ball"
            && e.GetProperty("t").GetString() == "item");

    [Fact]
    public void EveryBaseNameIsATeamRace()
    {
        var core = RaceLibrarySeed.Core.Select(c => c.Name).ToHashSet();
        Assert.All(RaceLibraryVariants.All, v => Assert.True(core.Contains(v.BaseName), $"{v.Name}: no team race called '{v.BaseName}'"));
    }

    [Fact]
    public void NamesAreUniqueAcrossTheWholeLibrary()
    {
        var dupes = RaceLibrarySeed.All.GroupBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        Assert.Empty(dupes);
    }

    [Fact]
    public void EachBaseRaceHasAtMostOneVariantPerFormat()
    {
        var dupes = RaceLibraryVariants.All.GroupBy(v => (v.BaseName.ToLowerInvariant(), v.Format))
            .Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        Assert.Empty(dupes);
    }

    [Fact]
    public void VariantNamesSayWhichFormatTheyAreFor()
    {
        Assert.All(Pairs, v => Assert.EndsWith(" (Pairs)", v.Name));
        Assert.All(Individuals, v => Assert.EndsWith(" (Individual)", v.Name));
    }

    [Fact]
    public void EveryDiagramIsAJsonArrayOfKnownElements()
    {
        Assert.All(RaceLibraryVariants.All, v =>
        {
            using var doc = JsonDocument.Parse(v.DiagramJson);
            Assert.Equal(JsonValueKind.Array, doc.RootElement.ValueKind);
            Assert.NotEmpty(doc.RootElement.EnumerateArray());
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                Assert.Equal(JsonValueKind.Object, el.ValueKind);
                Assert.True(el.TryGetProperty("t", out var t), $"{v.Name}: element without a type");
                Assert.Contains(t.GetString()!, AllowedTypes);
            }
        });
    }

    [Fact]
    public void EveryDiagramAnchorIsAKnownLandmark()
    {
        Assert.All(RaceLibraryVariants.All, v =>
        {
            foreach (var el in Elements(v.DiagramJson))
            {
                if (!el.TryGetProperty("anchor", out var a)) continue;
                Assert.True(BuiltInRaceMetadata.SlotCoords.ContainsKey(a.GetString()!), $"{v.Name}: unknown anchor {a}");
            }
        });
    }

    [Fact]
    public void EveryDiagramHasKitAndEveryVariantHasText()
    {
        Assert.All(RaceLibraryVariants.All, v =>
        {
            Assert.NotEmpty(Elements(v.DiagramJson));
            Assert.False(string.IsNullOrWhiteSpace(v.Summary), $"{v.Name}: no summary");
            Assert.False(string.IsNullOrWhiteSpace(v.Rules), $"{v.Name}: no rules");
        });
    }

    [Fact]
    public void EveryBookletPairsRaceHasAPairsVersion()
    {
        var names = Pairs.Select(v => v.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missing = BookletPairsHeadings.Where(h => !names.Contains(h)).ToList();
        Assert.Empty(missing);
    }

    [Fact]
    public void BouleAndBucketHasAPairsVersionButThreeMugAndTableDoesNot()
    {
        var names = Pairs.Select(v => v.Name).ToList();
        Assert.Contains("Boule and Bucket (Pairs)", names);
        Assert.DoesNotContain("Three Mug and Table (Pairs)", names);
        Assert.Contains(RaceLibrarySeed.Core, c => c.Name == "Three Mug and Table (Pairs)");
    }

    [Fact]
    public void EveryIndividualRulesTextOpensWithTheDisclaimer()
    {
        const string opening = "Individual version, adapted from the Pony Club pairs rules for one rider. Not an official Pony Club race.";
        Assert.NotEmpty(Individuals);
        Assert.All(Individuals, v => Assert.StartsWith(opening, v.Rules));
        Assert.All(Individuals, v => Assert.Contains("The winner is the first rider over the Start/Finish Line", v.Rules.Replace("\n", " ")));
    }

    [Fact]
    public void PairsRulesAreNotMarkedUnofficial()
    {
        Assert.All(Pairs, v => Assert.DoesNotContain("Not an official Pony Club race", v.Rules));
    }

    [Fact]
    public void EveryIndividualVersionAdaptsARaceThatHasAPairsVersion()
    {
        var pairsBases = Pairs.Select(v => v.BaseName).ToHashSet();
        Assert.All(Individuals, v => Assert.Contains(v.BaseName, pairsBases));
    }

    [Fact]
    public void AnIndividualNeverNeedsMoreKitThanAPair()
    {
        var pairs = Pairs.ToDictionary(v => v.BaseName);
        Assert.All(Individuals, v =>
            Assert.True(Count(v.DiagramJson) <= Count(pairs[v.BaseName].DiagramJson),
                $"{v.Name} lists more kit than {pairs[v.BaseName].Name}"));
    }

    [Fact]
    public void PairsBallAndBucketNeedsFewerBallsThanTheTeamRace()
    {
        var team = RaceLibrarySeed.Core.Single(c => c.Name == "Ball and Bucket");
        var pairs = Pairs.Single(v => v.BaseName == "Ball and Bucket");
        var individual = Individuals.Single(v => v.BaseName == "Ball and Bucket");

        Assert.Equal(3, Balls(pairs.DiagramJson));      // one carried, two in the circle
        Assert.Equal(2, Balls(individual.DiagramJson)); // one carried, one in the circle
        Assert.True(Balls(pairs.DiagramJson) < Balls(team.DiagramJson));
        Assert.Single(Elements(pairs.DiagramJson), e => e.TryGetProperty("kind", out var k) && k.GetString() == "bucket");
    }

    [Fact]
    public void BouleAndBucketKitIsBoulesNotTennisBalls()
    {
        var pairs = Pairs.Single(v => v.Name == "Boule and Bucket (Pairs)");
        Assert.All(Elements(pairs.DiagramJson).Where(e => e.TryGetProperty("kind", out var k) && k.GetString() == "ball"),
            e => Assert.Equal("Boule", e.GetProperty("label").GetString()));
        Assert.Contains("Boule", pairs.Rules);
    }

    [Fact]
    public void ThePairsKitForBowlingIsTwoBottlesAndEightBoules()
    {
        var pairs = Pairs.Single(v => v.BaseName == "Bowling");
        var elements = Elements(pairs.DiagramJson);
        Assert.Equal(2, elements.Count(e => e.TryGetProperty("kind", out var k) && k.GetString() == "bottle"));
        Assert.Equal(8, elements.Count(e => e.TryGetProperty("label", out var l) && l.GetString() == "Boule"));
    }

    [Fact]
    public void ResolveReadsTheVariantForItsFormat()
    {
        Assert.Equal("Ball and Bucket (Pairs)", RaceVariants.Resolve("Ball and Bucket", SectionFormat.Pairs));
        Assert.Equal("Ball and Bucket (Individual)", RaceVariants.Resolve("Ball and Bucket", SectionFormat.Individual));
        Assert.Equal("Ball and Bucket", RaceVariants.Resolve("Ball and Bucket", SectionFormat.Teams));
        // Bending has no Individual version, so an individual section keeps the team race.
        Assert.Equal("Bending", RaceVariants.Resolve("Bending", SectionFormat.Individual));
        Assert.Equal("Bending (Pairs)", RaceVariants.Resolve("Bending", SectionFormat.Pairs));
    }
}
