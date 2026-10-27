namespace MountedGames.Api.Entities;

/// <summary>Durable identity and current timetable version; never stores notification text or credentials.</summary>
public class ScheduledNotification
{
    public int Id { get; set; }
    public string ReminderKey { get; set; } = "";
    public int CompetitionId { get; set; }
    public DateTime DueAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public string TimetableVersion { get; set; } = "";
}

public enum NotificationDeliveryStatus { Pending, Claimed, Accepted, Failed, Expired, Cancelled }

public class NotificationDelivery
{
    public int Id { get; set; }
    public int ScheduledNotificationId { get; set; }
    public ScheduledNotification Notification { get; set; } = null!;
    public int PushSubscriptionId { get; set; }
    public PushSubscription Subscription { get; set; } = null!;
    public NotificationDeliveryStatus Status { get; set; }
    public string TimetableVersion { get; set; } = "";
    public int Attempts { get; set; }
    public int RecoveredLeases { get; set; }
    public DateTime NextAttemptAt { get; set; }
    public DateTime? ClaimedUntil { get; set; }
    public string? ClaimToken { get; set; }
    public string? LastError { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
