namespace MountedGames.Api.Entities.Operations;

/// <summary>
/// An organiser swapped a rider for a reserve on a declaration. Same idea as <see cref="RaceScoreEvent"/>:
/// before and after, who, when and why. Contains rider names, so it is organiser-only.
/// </summary>
public class RiderSwapEvent
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public int DeclarationFormId { get; set; }
    public DeclarationForm? DeclarationForm { get; set; }
    public int TeamId { get; set; }
    public int OutRiderEntryId { get; set; }
    public int InRiderEntryId { get; set; }
    public string BeforeJson { get; set; } = "[]";
    public string AfterJson { get; set; } = "[]";
    public string? ActorUserId { get; set; }
    public string Reason { get; set; } = string.Empty;
    /// <summary>The declaration was locked and the organiser overrode that on purpose.</summary>
    public bool OverrodeLock { get; set; }
    public string RequestId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
