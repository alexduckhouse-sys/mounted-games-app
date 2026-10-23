namespace MountedGames.Api.Entities.Operations;

public enum DrawChangeKind
{
    /// <summary>A section draw applied through <c>CompetitionDrawService</c>.</summary>
    SectionDraw = 1,
    /// <summary>A re-draw of unscored heats after a withdrawal.</summary>
    Redraw = 2,
}

/// <summary>
/// A draw that was applied. Makes a re-draw retry-safe (<see cref="RequestId"/> is unique per competition) and
/// tells the organiser a withdrawal can no longer be reversed, because a draw now depends on it.
/// </summary>
public class DrawChange
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public int SectionId { get; set; }
    public DrawChangeKind Kind { get; set; }
    public string RequestId { get; set; } = string.Empty;
    public string Fingerprint { get; set; } = string.Empty;
    public string? ActorUserId { get; set; }
    /// <summary>What was applied, as the preview that the organiser confirmed.</summary>
    public string ResultJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
