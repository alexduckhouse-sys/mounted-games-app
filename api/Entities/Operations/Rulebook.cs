namespace MountedGames.Api.Entities.Operations;

/// <summary>A rulebook shared by every competition; only admins edit it.</summary>
public class Rulebook
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Edition { get; set; } = string.Empty;
    public string? SourceUrl { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string? UpdatedByUserId { get; set; }
}
