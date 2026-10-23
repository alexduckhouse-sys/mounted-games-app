namespace MountedGames.Api.Entities;

public class Session
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }

    public int? CompetitionSectionId { get; set; }
    public CompetitionSection? Section { get; set; }

    public string Name { get; set; } = string.Empty;
    public string? ArenaName { get; set; }
    public DateTime? ScheduledStart { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public SessionStatus Status { get; set; } = SessionStatus.Upcoming;
    public int OrderIndex { get; set; }
    public string? Notes { get; set; }

    public bool IsBreak { get; set; }
    public int? DurationMinutes { get; set; }

    public SessionKind Kind { get; set; } = SessionKind.Race;
    public string? Location { get; set; }

    public string? StreamUrl { get; set; }
    public int? LanesPerHeat { get; set; }
    public int? MinutesPerHeat { get; set; }
    public bool RaceOrderAlternating { get; set; }
    /// <summary>Lane change after each race. Defaults to moving up one, as every session did before this was a choice.</summary>
    public LaneRotationMode LaneRotationMode { get; set; } = LaneRotationMode.MoveUp;
    /// <summary>Heat-heat-final: how many teams go through from each qualifier to the final. Null means the default (3).</summary>
    public int? QualifiersPerHeat { get; set; }

    /// <summary>
    /// The races this session will run in each heat (a JSON array of names), chosen before any heat exists, for
    /// example in the competition creator. Null means not chosen yet. Generating heats can start from it; once
    /// heats exist their races are the truth.
    /// </summary>
    public string? PlannedRaces { get; set; }

    public ICollection<Heat> Heats { get; set; } = new List<Heat>();
}
