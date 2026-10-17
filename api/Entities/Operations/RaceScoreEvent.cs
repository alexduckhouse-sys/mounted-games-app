namespace MountedGames.Api.Entities.Operations;

public enum RaceScoreEventKind
{
    ResultsRecorded = 1,
    ResultsCorrected = 2,
    SignedOff = 3,
    Reopened = 4,
}

public class RaceScoreEvent
{
    public int Id { get; set; }
    public int RaceId { get; set; }
    public Race? Race { get; set; }
    public int Revision { get; set; }
    public RaceScoreEventKind Kind { get; set; }
    public string BeforeJson { get; set; } = "[]";
    public string AfterJson { get; set; } = "[]";
    public string? ActorUserId { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string RequestId { get; set; } = string.Empty;
    public string PayloadFingerprint { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
