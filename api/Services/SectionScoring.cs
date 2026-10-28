using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// How a section's final switches (<see cref="CompetitionSection.HasFinal"/>, <see cref="CompetitionSection.CarryPointsIntoFinal"/>
/// and <see cref="CompetitionSection.DoublePointsInFinal"/>) change scoring and standings. The standard format only:
/// heat, heat, final (<see cref="CompetitionSection.UsesRaceFinals"/>) has no separate final, so every rule here treats
/// it as before. Standings, the printed results and season publication all total a team through <see cref="Total"/>,
/// so they cannot disagree.
/// </summary>
public static class SectionScoring
{
    /// <summary>True when the switches mean anything: the standard format. A missing section (an old row) counts as standard with the old behaviour.</summary>
    public static bool Applies(CompetitionSection? section) => section is { UsesRaceFinals: false };

    /// <summary>The section may have a finals session. Always true outside the standard format.</summary>
    public static bool AllowsFinal(CompetitionSection? section) => !Applies(section) || section!.HasFinal;

    /// <summary>Earlier points add to a finalist's score. A missing section keeps the old behaviour: they do.</summary>
    public static bool CarriesIntoFinal(CompetitionSection? section) => section is null || !Applies(section) || section.CarryPointsIntoFinal;

    /// <summary>A heat that is a lettered final of the standard format ("A Final"), not one stage of a heat-heat-final round.</summary>
    public static bool IsFinalHeat(Heat heat) => heat.RaceRoundStage == RaceRoundStage.None && FinalsTiers.ParseLabel(heat.Label) is not null;

    /// <summary>
    /// A team's score for ranking. A finalist in a section that does not carry points scores its final alone (the tack check
    /// bonus belongs to the event as a whole, so it only counts when points carry); everyone else, and every finalist
    /// when points carry, scores all their points.
    /// </summary>
    /// <param name="inFinal">The team is in a lettered final.</param>
    /// <param name="earlier">Points from the sessions before the final.</param>
    /// <param name="final">Points from the team's final races.</param>
    public static double Total(CompetitionSection? section, bool inFinal, double earlier, double final, double bonus)
        => inFinal && !CarriesIntoFinal(section) ? final : earlier + final + bonus;
}
