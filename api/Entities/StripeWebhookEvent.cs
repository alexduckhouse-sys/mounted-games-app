namespace MountedGames.Api.Entities;

/// <summary>
/// Tracks processed Stripe webhook events by <see cref="EventId"/> (<c>evt_...</c>) for idempotent replay protection.
/// </summary>
public class StripeWebhookEvent
{
    public string EventId { get; set; } = string.Empty;
    public string? AccountId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public DateTime ProcessedAtUtc { get; set; } = DateTime.UtcNow;
}
