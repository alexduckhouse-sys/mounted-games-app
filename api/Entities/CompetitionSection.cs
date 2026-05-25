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

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Team> Teams { get; set; } = new List<Team>();
    public ICollection<Session> Sessions { get; set; } = new List<Session>();
}
