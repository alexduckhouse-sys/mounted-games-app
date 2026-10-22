using System.Globalization;

namespace MountedGames.Api.Services;

/// <summary>Name rules for riders who asked to be shown by surname initial only on public pages.</summary>
public static class RiderNames
{
    /// <summary>
    /// "Oliver Smith" becomes "Oliver S.". The initial is that of the last word, so "Mary van der Berg" becomes
    /// "Mary van der B.". A single name is left as it is (there is no surname to shorten), extra whitespace is
    /// collapsed, and an existing initial ("Oliver S." or "Oliver S") is not doubled up. Null gives an empty string.
    /// </summary>
    public static string ShortenSurname(string? fullName)
    {
        var words = (fullName ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0) return string.Empty;
        if (words.Length == 1) return words[0];

        var initial = StringInfo.GetNextTextElement(words[^1]);
        words[^1] = initial.ToUpperInvariant() + ".";
        return string.Join(' ', words);
    }

    /// <summary>The name to show: the full name, or the shortened one when the rider asked for that and the viewer is not staff.</summary>
    public static string Display(string? fullName, bool useInitialOnly, bool viewerSeesFullNames)
        => useInitialOnly && !viewerSeesFullNames
            ? ShortenSurname(fullName)
            : string.Join(' ', (fullName ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
