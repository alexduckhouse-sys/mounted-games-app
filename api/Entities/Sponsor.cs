namespace MountedGames.Api.Entities;

/// <summary>Where a sponsor can be shown. Flags on <see cref="Sponsor.ShowOn"/>; exposure counts use one value at a time.</summary>
[Flags]
public enum SponsorPlacement
{
    None = 0,
    Timetable = 1,
    Results = 2,
    Details = 4,
    /// <summary>A small logo drawn over the live video, at any time.</summary>
    Stream = 8,
    /// <summary>Sponsor cards (logo and name) drawn over the live video while the timetable is on a break or briefing.</summary>
    BreakStream = 16,
    /// <summary>The competition's own sponsor page.</summary>
    SponsorPage = 32,
}

public static class SponsorPlacements
{
    /// <summary>Every defined placement. Add a new <see cref="SponsorPlacement"/> value and this follows.</summary>
    public static readonly SponsorPlacement All = Enum.GetValues<SponsorPlacement>().Aggregate(SponsorPlacement.None, (all, p) => all | p);

    /// <summary>True for exactly one defined placement (what an exposure count refers to).</summary>
    public static bool IsSingle(SponsorPlacement p) => p != SponsorPlacement.None && (p & (p - 1)) == 0 && (p & ~All) == 0;
}

public enum SponsorTier { Headline = 0, Major = 1, Supporter = 2 }

/// <summary>
/// A sponsor of one competition: a name, an optional https link and logo, and where and when to show it.
/// The logo is a small image the organiser's browser has already resized; it is served by the API itself, so no
/// third-party host is involved.
/// </summary>
public class Sponsor
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public string Name { get; set; } = string.Empty;
    /// <summary>An https address, or null for a sponsor shown without a link.</summary>
    public string? LinkUrl { get; set; }
    public byte[]? LogoBytes { get; set; }
    /// <summary>image/png, image/jpeg or image/webp; null when there is no logo.</summary>
    public string? LogoContentType { get; set; }
    /// <summary>Bumped when the logo changes, so browsers fetch the new image.</summary>
    public int LogoVersion { get; set; }
    public SponsorTier Tier { get; set; }
    public int SortOrder { get; set; }
    public SponsorPlacement ShowOn { get; set; }
    public bool IsEnabled { get; set; } = true;
    public DateTime? StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// How often a sponsor was shown in one place on one day (UTC). Counters only: no address, account or device
/// is stored with them. Views is the number of times the sponsor came on screen; Seconds is time on screen
/// (used for the live video, where viewers keep watching).
/// </summary>
public class SponsorExposure
{
    public int SponsorId { get; set; }
    public Sponsor? Sponsor { get; set; }
    public DateTime Day { get; set; }
    public SponsorPlacement Placement { get; set; }
    public long Views { get; set; }
    public long Seconds { get; set; }
}
