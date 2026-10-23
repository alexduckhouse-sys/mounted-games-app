namespace MountedGames.Api.Entities;

public enum OverlayBannerStyle { Ticker = 0, LowerBar = 1, Alert = 2 }

/// <summary>Auto follows the timetable or results; On forces an overlay on, Off hides it.</summary>
public enum OverlayMode { Auto = 0, On = 1, Off = 2 }

/// <summary>
/// What viewers see drawn over a competition's live video. One row per competition, made on the first save.
/// Overlays are drawn by each viewer's app, never burned into the video.
/// </summary>
public class StreamOverlay
{
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    /// <summary>A producer's banner; null when none is up.</summary>
    public string? BannerText { get; set; }
    public OverlayBannerStyle BannerStyle { get; set; }
    /// <summary>JSON array of arena names the banner shows in; empty means every arena.</summary>
    public string BannerArenas { get; set; } = "[]";
    public OverlayMode StripMode { get; set; }
    public OverlayMode ScoreCardMode { get; set; }
    /// <summary>Auto shows sponsor cards during breaks and briefings; On shows them whatever is running; Off hides them.</summary>
    public OverlayMode SponsorMode { get; set; }
    public int ScoreCardDelaySeconds { get; set; } = 4;
    public int ScoreCardSeconds { get; set; } = 10;
    /// <summary>The event's look (colours, logo, size, which elements show), as JSON written by the web app.</summary>
    public string LookJson { get; set; } = "{}";
    /// <summary>Bumped on every save, so two producers can't silently overwrite each other.</summary>
    public int Revision { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string? UpdatedByUserId { get; set; }
}
