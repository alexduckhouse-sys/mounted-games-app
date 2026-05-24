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

    public ICollection<Heat> Heats { get; set; } = new List<Heat>();
}
