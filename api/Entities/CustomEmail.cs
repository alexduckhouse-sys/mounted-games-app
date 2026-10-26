namespace MountedGames.Api.Entities;

/// <summary>Who a custom email goes to.</summary>
public enum CustomEmailAudience
{
    /// <summary>People who ticked the box to hear about new competitions (<see cref="EmailOptIn"/>), still opted in.</summary>
    News = 0,
    /// <summary>Approved Trainers (organisers), by their confirmed account address.</summary>
    Trainers = 1,
    /// <summary>Organisers and site admins, by their confirmed account address.</summary>
    OrganisersAndAdmins = 2,
    /// <summary>Site admins only, by their confirmed account address.</summary>
    Admins = 3,
}

public enum CustomEmailStatus
{
    /// <summary>Recipients are being worked through, a batch at a time.</summary>
    Sending = 0,
    /// <summary>Nobody is left to try. Some may have failed (see <see cref="CustomEmail.Failed"/>).</summary>
    Done = 1,
    Cancelled = 2,
}

public enum CustomEmailRecipientStatus
{
    Pending = 0,
    /// <summary>Taken by a batch that is sending it now. A claim older than a couple of minutes is treated as abandoned.</summary>
    Claimed = 1,
    /// <summary>Delivered to the provider. The row is deleted straight away, so only the count is kept.</summary>
    Sent = 2,
    Failed = 3,
}

/// <summary>
/// One custom email an admin sent. It keeps what was sent (the frozen text and HTML, so what the admin previewed is what
/// everyone got, whatever happens to a competition after) and how it went, as counts. The API scales to zero and has no
/// queue, so sending is done a batch at a time by <c>send-batch</c> calls against the recipient rows in
/// <see cref="CustomEmailRecipient"/>, which hold only the people still to try or to retry.
/// </summary>
public class CustomEmail
{
    public const int MaxSubjectLength = 150;
    public const int MaxSendsPerDay = 10;

    public int Id { get; set; }
    public string Subject { get; set; } = string.Empty;
    public CustomEmailAudience Audience { get; set; }
    /// <summary>The blocks as the admin wrote them (JSON), so a sent email can be reused as a starting point.</summary>
    public string BlocksJson { get; set; } = "[]";
    /// <summary>The email as rendered, with a placeholder where each person's unsubscribe link goes. Never logged.</summary>
    public string HtmlBody { get; set; } = string.Empty;
    public string TextBody { get; set; } = string.Empty;
    public string? CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public CustomEmailStatus Status { get; set; }
    /// <summary>Recipients when the send began.</summary>
    public int Total { get; set; }
    public int Sent { get; set; }
    public int Failed { get; set; }
    /// <summary>Left out because they unsubscribed (or stopped being eligible) after the send began.</summary>
    public int Skipped { get; set; }
    public DateTime? CompletedAt { get; set; }

    public ICollection<CustomEmailRecipient> Recipients { get; set; } = new List<CustomEmailRecipient>();
}

/// <summary>
/// A person still to be emailed (or to be retried) for one custom email. Rows are deleted as soon as the email is delivered
/// to the provider, and when a send is cancelled, so the table holds addresses only while they are needed.
/// </summary>
public class CustomEmailRecipient
{
    public long Id { get; set; }
    public int CustomEmailId { get; set; }
    public CustomEmail? CustomEmail { get; set; }
    /// <summary>Lower-cased, valid address.</summary>
    public string Address { get; set; } = string.Empty;
    /// <summary>For the news audience: the consent row, which the unsubscribe link is made from.</summary>
    public int? OptInId { get; set; }
    public CustomEmailRecipientStatus Status { get; set; }
    public DateTime? ClaimedAt { get; set; }
    public Guid? ClaimToken { get; set; }
    public int Attempts { get; set; }
}

/// <summary>
/// A picture for a custom email. Stored in the row like a sponsor logo and served by the API (so the email links to our own
/// site, not a third party). The id is a random GUID: the picture is public to anyone with the link, which is what an email
/// client needs, and the link can't be guessed.
/// </summary>
public class CustomEmailImage
{
    public const int MaxBytes = 500 * 1024;

    public Guid Id { get; set; }
    public byte[] Bytes { get; set; } = [];
    /// <summary>image/png, image/jpeg or image/webp, judged by the bytes.</summary>
    public string ContentType { get; set; } = string.Empty;
    public string? UploadedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Set when a sent email uses it. Pictures never used by an email are tidied away after a couple of days.</summary>
    public int? UsedByEmailId { get; set; }
}
