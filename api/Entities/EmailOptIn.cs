namespace MountedGames.Api.Entities;

/// <summary>
/// One person's consent to be emailed when new competitions open. Created only when they tick the
/// (unticked by default) box on the sign-up form. Nothing is sent from this record yet: it keeps
/// the list and the proof of consent. Site admins can export the active rows as CSV.
/// </summary>
public class EmailOptIn
{
    public int Id { get; set; }

    /// <summary>Lower-cased, trimmed address the person gave on the form.</summary>
    public string Email { get; set; } = string.Empty;

    public DateTime ConsentedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Which wording sat next to the tick box (see <c>EmailOptInWording</c>).</summary>
    public string WordingVersion { get; set; } = string.Empty;

    /// <summary>Where the consent was given, e.g. <c>signup-form</c>.</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>SHA-256 (hex) of the random unsubscribe token. The token itself is never stored.</summary>
    public string UnsubscribeTokenHash { get; set; } = string.Empty;

    /// <summary>Set when the person unsubscribes; the row stays as the record of the consent and its withdrawal.</summary>
    public DateTime? UnsubscribedAt { get; set; }
}

public enum EmailDeliveryStatus
{
    /// <summary>No email address was given, so nothing was due.</summary>
    NotRequested = 0,
    Sent = 1,
    /// <summary>The provider refused the message or could not be reached. The sign-up itself was kept.</summary>
    Failed = 2,
    /// <summary>An address was given but sending is switched off or not configured on this server.</summary>
    NotSent = 3,
}
