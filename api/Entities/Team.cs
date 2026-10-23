namespace MountedGames.Api.Entities;

public class Team
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }

    public int CompetitionSectionId { get; set; }
    public CompetitionSection? Section { get; set; }

    public int ClubId { get; set; }
    public Club? Club { get; set; }

    public string Suffix { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? BibColour { get; set; }

    public string? TrainerUserId { get; set; }
    public AppUser? Trainer { get; set; }

    /// <summary>Hors Concours — team competes but is excluded from scoring + standings.</summary>
    public bool IsHorsConcours { get; set; }

    /// <summary>
    /// Withdrawn or no-show teams are out of the unscored heats and the draw. Scored results stay.
    /// The reason lives in <c>TeamStatusEvent</c>, never on this row, so it can't leak through a team DTO.
    /// </summary>
    public TeamEntryStatus EntryStatus { get; set; } = TeamEntryStatus.Active;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Random short string the trainer shares with supporters so they can
    /// request read access to this team's profile. Null when no key is set.
    /// </summary>
    public string? SupporterJoinKey { get; set; }

    /// <summary>
    /// SHA-256 (hex) of the token in this team's calendar feed link. The token itself is shown once, when the
    /// trainer creates or regenerates the link, and is never stored. Null while the feed is off.
    /// </summary>
    public string? CalendarFeedTokenHash { get; set; }
    public DateTime? CalendarFeedTokenCreatedAt { get; set; }

    public ICollection<DeclarationForm> DeclarationForms { get; set; } = new List<DeclarationForm>();
    public ICollection<HeatEntry> HeatEntries { get; set; } = new List<HeatEntry>();
    public ICollection<Result> Results { get; set; } = new List<Result>();
    public ICollection<TeamSupporter> Supporters { get; set; } = new List<TeamSupporter>();
}
