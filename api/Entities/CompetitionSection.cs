namespace MountedGames.Api.Entities;

public class CompetitionSection
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }

    public SectionFormat Format { get; set; }
    public string AgeGroup { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Team> Teams { get; set; } = new List<Team>();
    public ICollection<Session> Sessions { get; set; } = new List<Session>();
}
