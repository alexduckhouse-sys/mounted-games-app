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

    /// <summary>
    /// When true, this section runs in "race-finals" format: each race in the
    /// list becomes a round of 3 heats (Q1, Q2, Final). Q1/Q2 score 1 (no elim)
    /// or 0 (elim); the Final scores on placing and adds to the qualifier total.
    /// </summary>
    public bool UsesRaceFinals { get; set; }

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
