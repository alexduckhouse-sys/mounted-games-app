namespace MountedGames.Api.Services.Stats;

/// <summary>
/// How the statistics hub matches names across competitions. There is no rider, pony or team identity shared
/// between events, so two entries are the same subject when their names normalise to the same text: trimmed,
/// whitespace collapsed to single spaces, lower case. Punctuation is kept, so "Oliver S." and "Oliver S" differ.
/// </summary>
public static class StatsNames
{
    public const int MinQueryLength = 2;
    public const int MaxQueryLength = 80;

    public static string Normalise(string? text)
        => string.Join(' ', (text ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();

    /// <summary>The name as shown: trimmed, whitespace collapsed, case kept.</summary>
    public static string Tidy(string? text)
        => string.Join(' ', (text ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    /// <summary>True for a normalised query the hub will run.</summary>
    public static bool IsValidQuery(string normalised)
        => normalised.Length is >= MinQueryLength and <= MaxQueryLength && Tokens(normalised).Count > 0;

    /// <summary>
    /// The words of a normalised query with dots trimmed (so "s." still finds "smith"), for a loose database
    /// filter. The exact check runs afterwards on the name the viewer is allowed to see. At most five words.
    /// </summary>
    public static IReadOnlyList<string> Tokens(string normalised)
        => normalised.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => word.Trim('.'))
            .Where(word => word.Length > 0)
            .Distinct()
            .Take(5)
            .ToList();

    /// <summary>A percentage to one decimal place, or null when there is nothing to divide by.</summary>
    public static double? Percent(double part, double whole)
        => whole <= 0 ? null : Math.Round(100.0 * part / whole, 1, MidpointRounding.AwayFromZero);
}
