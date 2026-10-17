namespace MountedGames.Api.Entities.Operations;

public class RaceScoreState
{
    public int Id { get; set; }
    public int RaceId { get; set; }
    public Race? Race { get; set; }
    public int Revision { get; set; }
    public bool IsSignedOff { get; set; }
    public DateTime? SignedOffAt { get; set; }
    public string? SignedOffByUserId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
