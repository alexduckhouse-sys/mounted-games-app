namespace MountedGames.Api.Entities.Operations;

/// <summary>
/// One change to a team's entry status (withdrawn, no-show, reinstated). Organiser-only: the reason is
/// never shown publicly. <see cref="RemovedEntriesJson"/> remembers which unscored heat lanes the team left,
/// so reinstating before a draw is applied can put it back.
/// </summary>
public class TeamStatusEvent
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public int TeamId { get; set; }
    public Team? Team { get; set; }
    public TeamEntryStatus Status { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string? ActorUserId { get; set; }
    public string RemovedEntriesJson { get; set; } = "[]";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
