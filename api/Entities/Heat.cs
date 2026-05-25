namespace MountedGames.Api.Entities;

public class Heat
{
    public int Id { get; set; }
    public int SessionId { get; set; }
    public Session? Session { get; set; }

    public string? Label { get; set; }
    public int OrderIndex { get; set; }
    public int? DurationMinutes { get; set; }
    /// <summary>
    /// Per-heat scheduled start. When set, overrides the cascade computed from
    /// session start + heat duration. Lets admins pin specific heat times.
    /// </summary>
    public DateTime? ScheduledStart { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }

    /// <summary>
    /// For sections in race-finals format: shared id linking the Q1/Q2/Final
    /// heats that race the same race. Null for normal heats.
    /// </summary>
    public int? RaceRoundId { get; set; }
    public RaceRoundStage RaceRoundStage { get; set; } = RaceRoundStage.None;

    public ICollection<HeatEntry> Entries { get; set; } = new List<HeatEntry>();
    public ICollection<Race> Races { get; set; } = new List<Race>();
}
