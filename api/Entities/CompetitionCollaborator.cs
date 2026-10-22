namespace MountedGames.Api.Entities;

/// <summary>The job a helper does at an event; a label for the team list. Every helper can run that event.</summary>
public enum CollaboratorRole { CoOrganiser = 0, RingScorer = 1, LineJudge = 2, Commentator = 3, StreamProducer = 4 }

/// <summary>
/// Someone the owner (or an admin) has added to run one competition, without making them a global admin
/// or a trainer. <see cref="Auth.CompetitionAccessAttribute"/> lets them in to that competition only.
/// </summary>
public class CompetitionCollaborator
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public string UserId { get; set; } = "";
    public AppUser? User { get; set; }
    public CollaboratorRole Role { get; set; }
    public string AddedByUserId { get; set; } = "";
    public DateTime AddedAt { get; set; }
}
