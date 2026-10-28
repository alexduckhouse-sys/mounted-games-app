using System.Text.Json;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Services;

/// <summary>Checks the Junior Version (JV) races against the Pony Club 2026 booklet.</summary>
public class RaceLibraryJuniorVersionsTests
{
    private static readonly HashSet<string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase)
        { "lane", "midline", "pole", "cone", "in", "item" };

    /// <summary>Every Junior Version heading in the booklet contents, mapped to the library entry that holds it.</summary>
    private static readonly (string Heading, string Entry)[] BookletJuniorHeadings =
    [
        ("Bean Bag and Table (JV)", "Bean Bag and Table (JV)"),
        ("Big Sack (Junior Version)", "Big Sack (Junior Version)"),
        ("Bottle (JV)", "Bottle (JV)"),
        ("Bottle Collection – Junior Version", "Bottle Collection – Junior Version"),
        ("Bowling (Junior Version)", "Bowling (Junior Version)"),
        ("Equipment Jumble (Junior Version)", "Equipment Jumble (Junior Version)"),
        ("Farmers' Market (Junior Version)", "Farmers' Market (Junior Version)"),
        ("Fishing Race (Junior Version)", "Fishing Race (Junior Version)"),
        ("Five Mug Pole Specific (JV) (2010)", "Five Mug Pole Specific (JV) (2010)"),
        ("Four Ball Cone (2002) (JV) (also known as Tennis Ball Shuffle)", "Four Ball Cone (2002) (JV)"),
        ("One Mug Race (Junior)", "One Mug Race (Junior)"),
        ("Old Sock (JV)", "Old Sock (JV)"),
        ("PGSPORTS Pole – Junior Version", "PGSPORTS Pole – Junior Version"),
        ("Pyramid – PGUK Version (Junior Version – 4 Riders)", "PGUK Pyramid (junior version)"),
        ("Pyramid – PGUK Version (Junior Version) (Race requires 5 members)", "Pyramid – PGUK Version (Junior Version)"),
        ("Quoit and Bottle (Junior Version)", "Quoit and Bottle (Junior Version)"),
        ("Quoits and Cone (Junior Version)", "Quoits and Cone (Junior Version)"),
        ("Recycling Race (Junior Version)", "Recycling Race (Junior Version)"),
        ("Rosette Row (Junior Version) (Race requires 5 members)", "Rosette Row (Junior Version)"),
        ("Sharpshooters (JV)", "Sharpshooters (JV)"),
        ("Small Sack Junior Version 1", "Small Sack Junior Version 1"),
        ("Small Sack Junior Version 2", "Small Sack Junior Version 2"),
        ("Spell E G U K (Juniors)", "Spell E G U K (Juniors)"),
        ("Spell EQUI TREK (JV)", "Spell EQUI TREK (JV)"),
        ("Spell PONY (Juniors)", "Spell PONY (Juniors)"),
        ("Spell PONY PREP (JV)", "Spell PONY PREP (JV)"),
        ("Stepping Stones (JV)", "Stepping Stones (JV)"),
        ("STRUK Pole (Junior version) (Race requires 5 members)", "STRUK Pole (JV)"),
        ("Two Bean Bag Race (Junior)", "Two Bean Bag Race (Junior)"),
    ];

    public static IEnumerable<object[]> Headings => BookletJuniorHeadings.Select(h => new object[] { h.Heading, h.Entry });

    [Theory]
    [MemberData(nameof(Headings))]
    public void Every_booklet_junior_heading_is_in_the_library(string heading, string entryName)
    {
        var entry = RaceLibrarySeed.All.SingleOrDefault(e => e.Name == entryName);
        Assert.True(entry is not null, $"Booklet heading '{heading}' has no library entry '{entryName}'.");
        Assert.False(string.IsNullOrWhiteSpace(entry!.Rules));
        Assert.False(string.IsNullOrWhiteSpace(entry.Summary));
    }

    [Fact]
    public void Library_names_are_unique()
    {
        var dupes = RaceLibrarySeed.All.GroupBy(e => e.Name).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        Assert.Empty(dupes);
    }

    [Theory]
    [MemberData(nameof(Headings))]
    public void Junior_diagrams_are_valid_and_hold_one_teams_kit(string heading, string entryName)
    {
        _ = heading;
        var entry = RaceLibrarySeed.All.Single(e => e.Name == entryName);
        using var doc = JsonDocument.Parse(entry.DiagramJson);
        var parts = doc.RootElement.EnumerateArray().ToList();
        Assert.Single(parts, p => p.GetProperty("t").GetString() == "lane");
        Assert.All(parts, p => Assert.Contains(p.GetProperty("t").GetString()!, AllowedTypes));
        // One team's kit: a single lane, and at most Bowling's bucket of twelve boules and four bottles.
        Assert.True(CountItems(doc.RootElement) <= 20, $"{entryName} draws more than one team's kit.");
    }

    private static int CountItems(JsonElement node)
    {
        var count = 0;
        if (node.ValueKind == JsonValueKind.Array)
            foreach (var child in node.EnumerateArray()) count += CountItems(child);
        else if (node.ValueKind == JsonValueKind.Object)
        {
            if (node.TryGetProperty("t", out var t) && t.GetString() == "item") count++;
            if (node.TryGetProperty("on", out var on)) count += CountItems(on);
        }
        return count;
    }
}
