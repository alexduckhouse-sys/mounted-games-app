namespace MountedGames.Api.Entities;

public class IpBlock
{
    public int Id { get; set; }
    public string IpAddress { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string? CreatedByUserId { get; set; }

    /// <summary>
    /// Set when the address was added because an account was blocked (a keyed hash, not the address itself). These rows are
    /// managed with the account: they stay out of the IP block list and go when it is unblocked.
    /// </summary>
    public string? BlockedAccountUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
