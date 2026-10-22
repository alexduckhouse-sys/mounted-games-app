namespace MountedGames.Api.Entities;

/// <summary>
/// A named overlay look (colours, logo, size, which elements show) that an organiser saves once and reuses
/// across events, e.g. "EGUK Champs". Applying it copies it into an event; later edits don't change past events.
/// </summary>
public class OverlayLook
{
    public int Id { get; set; }
    public string OwnerUserId { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>The look as JSON written by the web app (same shape as <see cref="StreamOverlay.LookJson"/>).</summary>
    public string LookJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
