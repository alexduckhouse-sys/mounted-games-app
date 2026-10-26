namespace MountedGames.Api.Entities;

/// <summary>
/// A network address an account has signed in from, kept only as a keyed hash (<c>IpRetention.HashFor</c>), never the
/// address. It exists so that blocking an account can block the networks it used. At most
/// <see cref="MaxPerAccount"/> are kept per account, the most recent.
/// </summary>
public class AccountIp
{
    public const int MaxPerAccount = 20;
    public const int MaxHashLength = 40;

    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string IpHash { get; set; } = string.Empty;
    public DateTime FirstSeenAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
}

/// <summary>What an invited person becomes.</summary>
public enum InviteAccess
{
    /// <summary>An approved Trainer: creates and runs their own competitions.</summary>
    Organiser = 0,
    /// <summary>An Admin: every competition.</summary>
    SiteAdmin = 1,
}

/// <summary>
/// An invitation for someone to make an account as an organiser or site admin. The emailed link carries a random token;
/// only its SHA-256 is stored, so a database leak can't be used to accept an invitation. Resending issues a fresh token and
/// the old link stops working.
/// </summary>
public class AccountInvite
{
    public const int Days = 7;
    public const int MaxSends = 10;
    public static readonly TimeSpan MinResendGap = TimeSpan.FromMinutes(1);

    public int Id { get; set; }
    /// <summary>Lower-cased address the invitation was sent to.</summary>
    public string Email { get; set; } = string.Empty;
    public InviteAccess Access { get; set; }
    /// <summary>Lower-case hex SHA-256 of the token.</summary>
    public string TokenHash { get; set; } = string.Empty;
    public string? InvitedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? LastSentAt { get; set; }
    public EmailDeliveryStatus LastEmailStatus { get; set; }
    public int SendCount { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public string? AcceptedUserId { get; set; }
    public DateTime? CancelledAt { get; set; }
}
