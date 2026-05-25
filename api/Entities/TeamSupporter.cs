namespace MountedGames.Api.Entities;

public enum TeamSupporterStatus
{
    Pending = 0,
    Accepted = 1,
}

/// <summary>
/// A user who has been granted (or is requesting) read access to a team's
/// trainer page — dec forms, notes, notifications. The trainer of the team
/// (or an admin) approves pending rows.
/// </summary>
public class TeamSupporter
{
    public int Id { get; set; }
    public int TeamId { get; set; }
    public Team? Team { get; set; }
    public string UserId { get; set; } = string.Empty;
    public AppUser? User { get; set; }
    public TeamSupporterStatus Status { get; set; } = TeamSupporterStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
