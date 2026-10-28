using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// Pairs and Individual versions of library races. A race keeps its team name in
/// the timetable ("Bending"); a Pairs or Individual section reads the version
/// listed here for its format instead (see <see cref="RaceVariants"/>), so the
/// rules sheet, diagram, ring-crew view and equipment list match how it is ridden.
///
/// Pairs text follows the Pony Club Mounted Games Race Rules 2026
/// (<c>docs/pc-mounted-games-race-rules-2026.md</c>). The Pony Club has no
/// individual rules, so Individual versions adapt the pairs race for one rider and
/// say so. A race whose course doesn't change for one rider (Bending) has no
/// Individual version and falls back to the team race.
/// </summary>
internal static class RaceLibraryVariants
{
    /// <param name="BaseName">The team race this replaces, exactly as named in <see cref="RaceLibrarySeed.Core"/>.</param>
    public record Variant(string Name, string BaseName, SectionFormat Format, string Summary, string Rules, string DiagramJson);

    public static readonly Variant[] All =
    [
        .. RaceLibraryPairs.All,
        .. RaceLibraryIndividuals.All,
    ];
}
