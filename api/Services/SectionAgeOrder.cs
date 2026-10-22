using System.Text.RegularExpressions;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// Orders age groups oldest to youngest for the generated timetable:
/// Open / Senior, U18 / U17, U15 / Intermediate, U14, U12 / Junior, U10 / Novice, Lead Rein.
/// The age comes from the section's age group, falling back to its display name.
/// </summary>
public static partial class SectionAgeOrder
{
    /// <summary>Rank for a section the order can't place: it goes after every classified one.</summary>
    public const int Unclassified = 100;

    public static int Rank(CompetitionSection section)
    {
        var fromAgeGroup = Rank(section.AgeGroup);
        return fromAgeGroup != Unclassified ? fromAgeGroup : Rank(section.DisplayName);
    }

    public static int Rank(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return Unclassified;
        var t = text.ToLowerInvariant();

        if (LeadRein().IsMatch(t)) return 6;
        var under = Under().Match(t);
        if (under.Success && int.TryParse(under.Groups[1].Value, out var age))
        {
            return age switch
            {
                >= 16 => 1,
                15 => 2,
                13 or 14 => 3,
                11 or 12 => 4,
                _ => 5,
            };
        }
        if (Open().IsMatch(t) || t.Contains("senior")) return 0;
        if (t.Contains("intermediate")) return 2;
        if (t.Contains("junior")) return 4;
        if (t.Contains("novice")) return 5;
        return Unclassified;
    }

    [GeneratedRegex(@"lead[\s\-]*rein")]
    private static partial Regex LeadRein();

    [GeneratedRegex(@"\b(?:under|u)[\s\-]*(\d{1,2})\b")]
    private static partial Regex Under();

    [GeneratedRegex(@"\bopen\b")]
    private static partial Regex Open();
}
