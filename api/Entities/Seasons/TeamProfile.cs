namespace MountedGames.Api.Entities.Seasons;

public class TeamProfile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string OwnerUserId { get; set; } = string.Empty;
    public int ClubId { get; set; }
    public string Suffix { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public AppUser? Owner { get; set; }
    public Club? Club { get; set; }
    public ICollection<EventTeamProfileLink> EventTeams { get; set; } = new List<EventTeamProfileLink>();
}

public class EventTeamProfileLink
{
    public int Id { get; set; }
    public Guid TeamProfileId { get; set; }
    public int CompetitionId { get; set; }
    public int TeamId { get; set; }
    public string LinkedByUserId { get; set; } = string.Empty;
    public DateTime LinkedAt { get; set; } = DateTime.UtcNow;

    public TeamProfile? TeamProfile { get; set; }
    public Competition? Competition { get; set; }
    public Team? Team { get; set; }
    public AppUser? LinkedBy { get; set; }
}
