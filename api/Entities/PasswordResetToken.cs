namespace MountedGames.Api.Entities;

/// <summary>
/// One emailed "choose a new password" link. The link carries 32 random bytes; only their SHA-256 is stored, so a database
/// leak can't be used to reset anyone's password. A link works once, for <see cref="Lifetime"/>. Asking for a new link
/// ends the account's earlier unused ones that are at least five minutes old (their <see cref="ExpiresAt"/> is brought forward to that moment), and
/// so does a successful reset.
/// </summary>
/// <remarks>
/// Identity's own reset tokens are not used: they rely on ASP.NET Data Protection keys, which the API's scale-to-zero
/// instances neither persist nor share, so a link made on one instance would fail on another.
/// </remarks>
public class PasswordResetToken
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);
    public const int TokenHashLength = 64;

    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    /// <summary>Lower-case hex SHA-256 of the token.</summary>
    public string TokenHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
    /// <summary>The network that asked for the link, as a keyed hash (<c>IpRetention.HashFor</c>), never the address.</summary>
    public string? RequestedIpHash { get; set; }
}
