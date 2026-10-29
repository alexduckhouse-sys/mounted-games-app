namespace MountedGames.Api.Entities;

/// <summary>Pinned event rules; a section override has its own row. Zero is the whole event.</summary>
public class WindRulesSelection
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public int SectionId { get; set; }
    public string ProfileId { get; set; } = "unverified";
    public int Revision { get; set; }
    public string EventLevel { get; set; } = "";
    public string PublishedSpare { get; set; } = "";
    public string PermittedRacesJson { get; set; } = "[]";
    public string VenueNotes { get; set; } = "";
    public double ReviewMph { get; set; } = 25;
    public double OfficialReviewMph { get; set; } = 35;
    public double? VenueLimitMph { get; set; }
    public bool AdoptionConfirmed { get; set; }
}
public class WindRaceDecision
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public int SessionId { get; set; }
    public string RequestId { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public string ProfileId { get; set; } = "";
    public string BeforeJson { get; set; } = "";
    public string AfterJson { get; set; } = "";
    public string Authority { get; set; } = "";
    public string Decision { get; set; } = "";
    public string? ActorUserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? PublishedAt { get; set; }
}

public class WindAcknowledgement
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public string Arena { get; set; } = "";
    public long StartsAt { get; set; }
    public long EndsAt { get; set; }
    public double PeakMph { get; set; }
    public int Severity { get; set; }
    public DateTime AcknowledgedAt { get; set; }
}
