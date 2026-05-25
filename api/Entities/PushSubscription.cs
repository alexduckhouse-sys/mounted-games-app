namespace MountedGames.Api.Entities;

/// <summary>
/// A browser push subscription belonging to a logged-in user. Stored so the
/// backend can send notifications when the user's tab is closed.
/// </summary>
public class PushSubscription
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public AppUser? User { get; set; }

    /// <summary>The browser push endpoint URL (FCM / Apple Push / Mozilla).</summary>
    public string Endpoint { get; set; } = string.Empty;
    /// <summary>P-256 public key from the browser (base64url).</summary>
    public string P256dh { get; set; } = string.Empty;
    /// <summary>Auth secret from the browser (base64url).</summary>
    public string Auth { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
}
