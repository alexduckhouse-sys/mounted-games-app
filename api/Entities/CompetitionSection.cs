namespace MountedGames.Api.Entities;

public class CompetitionSection
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }

    public SectionFormat Format { get; set; }
    public string AgeGroup { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>
    /// Name of the race used to break ties / decide a run-off for this section.
    /// Defaults to "2 Flag" for zone competitions.
    /// </summary>
    public string? RunoffRaceName { get; set; }

    /// <summary>How teams level on points are settled at a finals cut-off or on the podium.</summary>
    public TieBreakRule TieBreakRule { get; set; }

    /// <summary>
    /// How many teams go through to the final ("Top 6 make the final").
    /// Null = not set yet. Valid range 1-50.
    /// </summary>
    public int? FinalistCount { get; set; }

    /// <summary>
    /// When true, this section runs in "race-finals" format: each race in the
    /// list becomes a round of 3 heats (Q1, Q2, Final). Q1/Q2 score 1 (no elim)
    /// or 0 (elim); the Final scores on placing and adds to the qualifier total.
    /// </summary>
    public bool UsesRaceFinals { get; set; }

    // The three switches below are for the standard format only. Heat, heat, final (UsesRaceFinals) has no separate
    // final session, so they are stored but ignored there. See SectionScoring.

    /// <summary>The section ends with a finals session (A Final, B Final…). Off means it ends with its last heat session.</summary>
    public bool HasFinal { get; set; } = true;

    /// <summary>
    /// On: a finalist's points from the earlier sessions add to its final's points in the standings.
    /// Off: the final is scored on its own, so a finalist's standing is decided by its final alone.
    /// </summary>
    public bool CarryPointsIntoFinal { get; set; }

    /// <summary>Race points in a final count double. Applied by <c>ScoringService</c> when a final race is saved.</summary>
    public bool DoublePointsInFinal { get; set; }

    /// <summary>
    /// Cost (in minor units — pence / cents) to sign up a team for this section.
    /// Zero means free. Used by the pay-to-join signup flow.
    /// </summary>
    public int PriceMinor { get; set; }

    /// <summary>
    /// Optional cap on the number of active (Pending + Paid) signups this
    /// section accepts. Null = unlimited. The signup endpoint refuses with
    /// "Section is full" once the cap is reached.
    /// </summary>
    public int? MaxParticipants { get; set; }

    public ICollection<SectionSignup> Signups { get; set; } = new List<SectionSignup>();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Team> Teams { get; set; } = new List<Team>();
    public ICollection<Session> Sessions { get; set; } = new List<Session>();
}
