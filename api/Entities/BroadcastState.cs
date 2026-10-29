namespace MountedGames.Api.Entities;

/// <summary>Only public, immutable graphics payloads. Short retention permits a delayed source to rejoin safely.</summary>
public sealed class BroadcastSnapshot
{
    public long Id { get; set; }
    public int CompetitionId { get; set; }
    public string Arena { get; set; } = "";
    public int SectionKey { get; set; }
    public DateTime ObservedAt { get; set; }
    public string PayloadJson { get; set; } = "{}";
}

public sealed class BroadcastCue
{
    public long Id { get; set; }
    public Guid CommandId { get; set; } = Guid.NewGuid();
    public int CompetitionId { get; set; }
    public string Arena { get; set; } = "";
    public int? SectionId { get; set; }
    public string Kind { get; set; } = "";
    public string Action { get; set; } = "";
    public DateTime StartsAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public string PayloadJson { get; set; } = "{}";
}

public sealed class BroadcastOutput
{
    public int CompetitionId { get; set; }
    public string Arena { get; set; } = "";
    public bool Hidden { get; set; }
    public long SponsorOffset { get; set; }
    public DateTime DiscardBefore { get; set; }
    public int Revision { get; set; }
}
