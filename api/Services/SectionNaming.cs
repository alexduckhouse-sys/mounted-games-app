using System.Text.RegularExpressions;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// The one rule for an age group's name: for Pairs and Individuals, the age group first (a plural word such as
/// "Juniors" made singular), then the format in the plural ("Junior Individuals", "Novice Pairs"); for Teams,
/// just the age group ("Juniors", "Seniors", "Under 12", "Open"), or "Teams" when no age group is given.
/// <c>web/src/lib/section.ts</c> (<c>sectionDisplayName</c>) mirrors this: change both together.
/// </summary>
public static partial class SectionNaming
{
    public static string FormatPlural(SectionFormat format) => format switch
    {
        SectionFormat.Pairs => "Pairs",
        SectionFormat.Individual => "Individuals",
        _ => "Teams",
    };

    /// <summary>"Juniors" becomes "Junior"; anything else, such as "Under 12" or "Open", is kept as typed.</summary>
    public static string SingularAgeGroup(string ageGroup)
    {
        var text = (ageGroup ?? string.Empty).Trim();
        return PluralWord().IsMatch(text) ? text[..^1] : text;
    }

    private static string TeamAgeGroup(string ageGroup)
    {
        var stripped = StripTeams().Replace((ageGroup ?? string.Empty).Trim(), string.Empty).Trim();
        if (stripped.Length == 0 || stripped.Equals("Teams", StringComparison.OrdinalIgnoreCase) || stripped.Equals("Team", StringComparison.OrdinalIgnoreCase))
            return "Teams";
        return SingularTeamAge().IsMatch(stripped) ? $"{stripped}s" : stripped;
    }

    public static string DisplayName(SectionFormat format, string ageGroup)
    {
        var plural = FormatPlural(format);
        if (plural == "Teams") return TeamAgeGroup(ageGroup);
        var raw = (ageGroup ?? string.Empty).Trim();
        if (raw.Length == 0 || raw.Equals(plural, StringComparison.OrdinalIgnoreCase)) return plural;
        // Someone who typed "Senior Pairs" as the age group doesn't get "Senior Pairs Pairs".
        if (raw.EndsWith(" " + plural, StringComparison.OrdinalIgnoreCase)) return raw;
        return $"{SingularAgeGroup(raw)} {plural}";
    }

    /// <summary>
    /// The name to show for a section. A section with no known format or age group (older or test data)
    /// keeps the name it was saved with, so existing competitions read as the rule says without a data migration.
    /// </summary>
    public static string Of(CompetitionSection? section)
    {
        if (section is null) return string.Empty;
        return section.Format is SectionFormat.Pairs or SectionFormat.Teams or SectionFormat.Individual
            && !string.IsNullOrWhiteSpace(section.AgeGroup)
            ? DisplayName(section.Format, section.AgeGroup)
            : section.DisplayName;
    }

    // A last word of four or more letters ending in a single "s": Juniors, Seniors, Novices.
    [GeneratedRegex(@"(?:^|\s)[A-Za-z]{2,}[^s\W]s$", RegexOptions.IgnoreCase)]
    private static partial Regex PluralWord();

    [GeneratedRegex(@"^teams?\s+|\s+teams?$", RegexOptions.IgnoreCase)]
    private static partial Regex StripTeams();

    [GeneratedRegex(@"\b(Junior|Senior|Novice)$", RegexOptions.IgnoreCase)]
    private static partial Regex SingularTeamAge();
}
