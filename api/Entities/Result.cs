namespace MountedGames.Api.Entities;

public class Result
{
    public int Id { get; set; }
    public int RaceId { get; set; }
    public Race? Race { get; set; }

    public int TeamId { get; set; }
    public Team? Team { get; set; }

    public int? Placing { get; set; }
    /// <summary>
    /// True when the team did not finish the race for any reason (eliminated, did not start, did not finish,
    /// retired). Those results have no place and score 0; <see cref="Status"/> says which.
    /// </summary>
    public bool Eliminated { get; set; }
    /// <summary>
    /// Why the team did not finish. 0 on rows saved before the choice existed: with <see cref="Eliminated"/> set
    /// that means Eliminated, which is what every such row was. Read it through <c>ResultStatuses.Of</c>.
    /// </summary>
    public ResultStatus Status { get; set; }
    /// <summary>A referee's or organiser's private note on this result. Staff only: never in a public DTO.</summary>
    public string? RefereeNote { get; set; }
    /// <summary>The team had no lane this race (more teams than lanes) and sat it out: no place, no points, not an elimination.</summary>
    public bool IsSitOut { get; set; }
    public double Points { get; set; }

    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
    public string? RecordedByUserId { get; set; }
}
