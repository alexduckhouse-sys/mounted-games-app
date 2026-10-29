namespace MountedGames.Api.Entities.Operations;

public class HeatCall
{
    public int HeatId { get; set; }
    public Heat? Heat { get; set; }
    public DateTime CalledAt { get; set; }
}

public class SubstitutionRequest
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public int DeclarationFormId { get; set; }
    public DeclarationForm? DeclarationForm { get; set; }
    public string RequestedByUserId { get; set; } = "";
    public int OutRiderEntryId { get; set; }
    public int InRiderEntryId { get; set; }
    public string? ReplacementRiderName { get; set; }
    public string? ReplacementHorseName { get; set; }
    public string Reason { get; set; } = "";
    public string DeclarationFingerprint { get; set; } = "";
    public string Status { get; set; } = "pending";
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DecidedAt { get; set; }
    public string? DecidedByUserId { get; set; }
}
