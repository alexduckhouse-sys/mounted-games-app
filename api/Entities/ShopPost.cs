namespace MountedGames.Api.Entities;

/// <summary>
/// A public marketplace post. Anyone can read; logged-in users post; admins
/// delete. Soft-delete via <c>IsDeleted</c> so reported content can be
/// hidden but kept for audit.
/// </summary>
public class ShopPost
{
    public int Id { get; set; }
    public string? AuthorUserId { get; set; }
    public AppUser? Author { get; set; }

    /// <summary>Captured at post time; required even if AuthorUserId is set.</summary>
    public string AuthorName { get; set; } = string.Empty;
    public string? PonyClubName { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    /// <summary>Optional price in minor units (pence).</summary>
    public int? PriceMinor { get; set; }
    /// <summary>Free-text contact info (email / phone / "DM here").</summary>
    public string? ContactInfo { get; set; }
    /// <summary>Base64 data URL of the post image. Capped client-side.</summary>
    public string? ImageBase64 { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
    public string? DeletedByUserId { get; set; }

    public string? IpAddress { get; set; }

    public ICollection<ShopComment> Comments { get; set; } = new List<ShopComment>();
    public ICollection<ShopReport> Reports { get; set; } = new List<ShopReport>();
}

/// <summary>
/// A comment under a shop post. <c>IsPrivate</c> + <c>ToUserId</c> turns it
/// into a DM visible only to the post author and the commenter (and admins).
/// </summary>
public class ShopComment
{
    public int Id { get; set; }
    public int PostId { get; set; }
    public ShopPost? Post { get; set; }

    public string? AuthorUserId { get; set; }
    public AppUser? Author { get; set; }
    public string AuthorName { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;

    public bool IsPrivate { get; set; }
    /// <summary>When private, the second visible party (alongside the post author + admins).</summary>
    public string? ToUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
    public string? IpAddress { get; set; }
}

public class ShopReport
{
    public int Id { get; set; }
    public int PostId { get; set; }
    public ShopPost? Post { get; set; }
    public string? ReporterUserId { get; set; }
    public AppUser? Reporter { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsResolved { get; set; }
    public string? IpAddress { get; set; }
}
