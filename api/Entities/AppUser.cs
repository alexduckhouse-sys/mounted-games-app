using Microsoft.AspNetCore.Identity;

namespace MountedGames.Api.Entities;

public class AppUser : IdentityUser
{
    public string FullName { get; set; } = string.Empty;
    public int? ClubId { get; set; }
    public Club? Club { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>When a confirmation email was last sent. With <see cref="ConfirmationsSentToday"/> it caps how often one account can be mailed.</summary>
    public DateTime? LastConfirmationSentAt { get; set; }
    /// <summary>Confirmation emails sent on the UTC day of <see cref="LastConfirmationSentAt"/>.</summary>
    public int ConfirmationsSentToday { get; set; }

    /// <summary>Set when a master admin locks an Admin or organiser account. A locked account can't sign in and its tokens stop working.</summary>
    public DateTime? LockedAt { get; set; }
    public string? LockedByUserId { get; set; }

    /// <summary>Set when an admin blocks the account: no sign-in, no entries, no chat. Its network addresses are blocked as well.</summary>
    public DateTime? BlockedAt { get; set; }
    public string? BlockedByUserId { get; set; }
    /// <summary>Why the account was blocked. For admins only: it is never in a DTO a non-admin can read, and never shown to the blocked person.</summary>
    public string? BlockReason { get; set; }

    /// <summary>True while an admin lock or block stops this account signing in.</summary>
    public bool IsAccessStopped => LockedAt is not null || BlockedAt is not null;

    public ICollection<TrainerNote> Notes { get; set; } = new List<TrainerNote>();
    public ICollection<Team> CoachedTeams { get; set; } = new List<Team>();
}
