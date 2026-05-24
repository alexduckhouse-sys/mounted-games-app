namespace MountedGames.Api.Entities;

public class Result
{
    public int Id { get; set; }
    public int RaceId { get; set; }
    public Race? Race { get; set; }

    public int TeamId { get; set; }
    public Team? Team { get; set; }

    public int? Placing { get; set; }
    public bool Eliminated { get; set; }
    public int Points { get; set; }

    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
    public string? RecordedByUserId { get; set; }
}
