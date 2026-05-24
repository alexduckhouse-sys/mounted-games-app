namespace MountedGames.Api.Entities;

public class Heat
{
    public int Id { get; set; }
    public int SessionId { get; set; }
    public Session? Session { get; set; }

    public string? Label { get; set; }
    public int OrderIndex { get; set; }
    public int? DurationMinutes { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }

    public ICollection<HeatEntry> Entries { get; set; } = new List<HeatEntry>();
    public ICollection<Race> Races { get; set; } = new List<Race>();
}
