namespace MountedGames.Api.Services.Streaming;

public sealed class StreamingOptions
{
    public CloudflareOptions Cloudflare { get; set; } = new();
    public int MaxLivePerCompetition { get; set; } = 9;
    public int MaxViewerSessions { get; set; } = 300;
    public double ViewerSessionsPerSecond { get; set; } = 10;
    public int HeartbeatTimeoutSeconds { get; set; } = 180;
    public int PendingAttemptSeconds { get; set; } = 30;
    public bool Enabled => !string.IsNullOrWhiteSpace(Cloudflare.AppId) && !string.IsNullOrWhiteSpace(Cloudflare.AppToken);
}

public sealed class CloudflareOptions
{
    public string AppId { get; set; } = "";
    public string AppToken { get; set; } = "";
    public string BaseUrl { get; set; } = "https://rtc.live.cloudflare.com/v1";
    public string? TurnKeyId { get; set; }
    public string? TurnKeyApiToken { get; set; }
}
