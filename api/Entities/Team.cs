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

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<DeclarationForm> DeclarationForms { get; set; } = new List<DeclarationForm>();
    public ICollection<HeatEntry> HeatEntries { get; set; } = new List<HeatEntry>();
    public ICollection<Result> Results { get; set; } = new List<Result>();
}
