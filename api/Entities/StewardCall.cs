namespace MountedGames.Api.Entities;

/// <summary>
/// A call (currently "eliminated") raised by a volunteer steward watching
/// one lane of a heat. Calls are pending suggestions that an admin confirms
/// (or ignores) when entering the race results. All calls for a race are
/// purged when the admin submits results for that race.
/// </summary>
public class StewardCall
{
    public int Id { get; set; }
    public int RaceId { get; set; }
    public Race? Race { get; set; }
    public int TeamId { get; set; }
    public Team? Team { get; set; }
    /// <summary>The display lane the steward is watching (1-based).</summary>
    public int LaneIndex { get; set; }
    /// <summary>Free-text name the steward typed in — purely for accountability.</summary>
    public string? ReporterName { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
