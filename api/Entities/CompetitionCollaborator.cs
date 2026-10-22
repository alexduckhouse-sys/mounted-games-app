namespace MountedGames.Api.Entities;

/// <summary>
/// One role for now: a competition admin can do everything the owner can for that event. The column stays so
/// narrower roles could come back without a schema change.
/// </summary>
public enum CollaboratorRole { CompetitionAdmin = 0 }

/// <summary>
/// A competition admin: someone added to run one competition, without making them a global admin or a trainer. <see cref="Auth.CompetitionAccessAttribute"/> lets them in to that competition only.
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
