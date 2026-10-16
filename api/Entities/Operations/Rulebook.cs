namespace MountedGames.Api.Entities.Operations;

public class Rulebook
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Edition { get; set; } = string.Empty;
    public string? SourceUrl { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string? UpdatedByUserId { get; set; }
}
