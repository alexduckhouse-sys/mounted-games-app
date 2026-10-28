using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// Picks the library race a section actually rides. Timetables keep the team name
/// ("Bending", "5 Flag"); a Pairs or Individual section reads that race's version for
/// its format when the library has one (<see cref="RaceLibraryVariants"/>), and the
/// race itself otherwise. Sponsored and short names (Zone and Area 2026) count as
/// their base race, so "Hollywood Bowl Boule & Bucket" in a pairs section reads
/// "Boule and Bucket (Pairs)".
/// </summary>
public static class RaceVariants
{
    /// <summary>Sponsored or short race names and the library race they are ridden as.</summary>
    public static readonly IReadOnlyDictionary<string, string> BaseOf =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Hollywood Bowl Boule & Bucket"] = "Boule and Bucket",
            ["Hollywood Bowl Old Sock"] = "Old Sock",
            ["Hollywood Bowl Bottle"] = "Bottle",
            ["Tally Ho Farm Ball & Socket"] = "Ball and Socket",
            ["PGSports UK Shopping Spree"] = "PG Sports Shopping Spree Race",
            ["EGUK Mug Changes"] = "Mug Changes",
            ["2 Flag"] = "Two Flag",
            ["5 Flag"] = "Five Flag",
            ["EGUK 5 Flag"] = "Five Flag",
            ["2 Mug"] = "Two Mug",
            ["5 Mug"] = "Five Mug – Pole Specific",
            ["PGUK Pyramid"] = "Pyramid – PGUK Version",
            ["Spell EGUK"] = "Spell E G U K",
        };

    private static readonly Dictionary<(string Base, SectionFormat Format), string> VariantByBase =
        RaceLibraryVariants.All.ToDictionary(
            v => (v.BaseName.ToLowerInvariant(), v.Format),
            v => v.Name);

    private static readonly Dictionary<string, RaceLibraryVariants.Variant> VariantByName =
        RaceLibraryVariants.All.ToDictionary(v => v.Name, StringComparer.OrdinalIgnoreCase);

    /// <summary>The library race a section of this format rides for a timetable race name.</summary>
    public static string Resolve(string name, SectionFormat? format)
    {
        var trimmed = BuiltInRaceMetadata.ResolveCanonicalName(name);
        if (format is not (SectionFormat.Pairs or SectionFormat.Individual)) return trimmed;
        if (VariantByName.ContainsKey(trimmed)) return trimmed;
        if (VariantByBase.TryGetValue((trimmed.ToLowerInvariant(), format.Value), out var own)) return own;
        return BaseOf.TryGetValue(trimmed, out var baseName)
            && VariantByBase.TryGetValue((baseName.ToLowerInvariant(), format.Value), out var viaBase)
            ? viaBase
            : trimmed;
    }

    /// <summary>
    /// For the race list: the race this one stands in for (a variant's team race, or a
    /// sponsored name's base race) and, for a variant, the section format it is for.
    /// </summary>
    public static (string? BaseName, SectionFormat? Format) Describe(string name)
    {
        if (VariantByName.TryGetValue(name, out var variant)) return (variant.BaseName, variant.Format);
        return BaseOf.TryGetValue(name, out var baseName) ? (baseName, null) : (null, null);
    }
}
