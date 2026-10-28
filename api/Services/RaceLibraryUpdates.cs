namespace MountedGames.Api.Services;

/// <summary>
/// Rule text, summaries, categories and setup diagrams applied to built-in
/// <c>RaceTemplate</c> rows on every API startup, so existing databases pick up
/// corrections without manual admin work.
///
/// Every entry comes straight from <see cref="RaceLibrarySeed.All"/>, the one place
/// the text lives (source: <c>docs/pc-mounted-games-race-rules-2026.md</c>, the Pony
/// Club Mounted Games Race Rules 2026). Add an override below only for something
/// that must differ from the seed. Fields set to <c>null</c> keep the existing
/// value in the DB; only non-null fields apply.
/// </summary>
internal static class RaceLibraryUpdates
{
    public record Entry(string? Summary = null, string? Rules = null,
                        string? DiagramJson = null, string? Category = null);

    public static readonly Dictionary<string, Entry> ByName = BuildByName();

    private static Dictionary<string, Entry> BuildByName()
    {
        var map = new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase);

        foreach (var seed in RaceLibrarySeed.All)
        {
            map[seed.Name] = new Entry(
                Summary: seed.Summary,
                Rules: seed.Rules,
                DiagramJson: seed.DiagramJson,
                Category: seed.Category);
        }

        return map;
    }
}
