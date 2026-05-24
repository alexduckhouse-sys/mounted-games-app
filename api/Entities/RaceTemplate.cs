namespace MountedGames.Api.Entities;

public class RaceTemplate
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Summary { get; set; }
    public string? Rules { get; set; }
    public string? Category { get; set; }
    /// <summary>
    /// JSON array of diagram elements. Each element has at minimum a "t" (type) field.
    /// Types: "pole", "cone", "item", "table", "midline". A start line and finish line
    /// are always rendered automatically.
    /// </summary>
    public string? DiagramJson { get; set; }
    public bool IsBuiltIn { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
