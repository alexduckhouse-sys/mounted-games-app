namespace MountedGames.Api.Entities.Operations;

/// <summary>Where a protest stands. Only <see cref="Open"/> blocks signing off the race (or the whole heat).</summary>
public enum ProtestStatus
{
    Open = 0,
    Upheld = 1,
    Dismissed = 2,
    Withdrawn = 3,
}

/// <summary>
/// A protest or referee decision logged on the day, against one race or a whole heat (<see cref="RaceId"/> null).
/// Staff-only: the reason, names and decision never reach a public DTO; the public sees only "under review"
/// through <see cref="Race.HasOpenProtest"/>. A decision that changes a score still goes through
/// <c>ScoringService</c> as a correction with a reason; this row never touches results.
/// </summary>
public class Protest
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }

    public int HeatId { get; set; }
    public Heat? Heat { get; set; }
    /// <summary>The race protested; null means the whole heat.</summary>
    public int? RaceId { get; set; }
    public Race? Race { get; set; }

    /// <summary>The team that raised it, if any (the referee may log one themselves).</summary>
    public int? RaisedByTeamId { get; set; }
    public Team? RaisedByTeam { get; set; }
    /// <summary>The teams it is about, as a JSON array of team ids in this competition.</summary>
    public string ConcernsTeamIdsJson { get; set; } = "[]";
    /// <summary>Free text naming the adult who raised it (a trainer, say). Never a rider's personal details.</summary>
    public string? RaisedByName { get; set; }
    public string Reason { get; set; } = string.Empty;

    public ProtestStatus Status { get; set; } = ProtestStatus.Open;
    /// <summary>The decision and its reasoning, required to uphold or dismiss; an optional note on withdrawal.</summary>
    public string? Decision { get; set; }
    public string? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }

    public string? CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>The client's id for the create request, so a retry on poor signal returns the first protest.</summary>
    public string RequestId { get; set; } = string.Empty;
}
