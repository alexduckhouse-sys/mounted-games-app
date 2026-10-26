using System.ComponentModel.DataAnnotations;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

/// <summary>
/// A sponsor as every viewer sees it: only what is on show right now (enabled and inside its dates).
/// <c>LogoUrl</c> is a path on this API, ending in the logo's version so a new logo is fetched.
/// </summary>
public record SponsorDto(int Id, string Name, string? LinkUrl, string? LogoUrl, SponsorTier Tier, int SortOrder, SponsorPlacement ShowOn);

/// <summary>A sponsor as the organisers see it, with the dates, the switch and how often it has been shown.</summary>
public record SponsorAdminDto(
    int Id, string Name, string? LinkUrl, string? LogoUrl, SponsorTier Tier, int SortOrder, SponsorPlacement ShowOn,
    bool IsEnabled, DateTime? StartsAt, DateTime? EndsAt, long Views, long Seconds);

/// <summary>Adds or replaces a sponsor's details. The logo has its own request.</summary>
public record SponsorRequest(
    [Required, StringLength(80, MinimumLength = 1)] string Name,
    [StringLength(300)] string? LinkUrl,
    SponsorTier Tier,
    SponsorPlacement ShowOn,
    bool IsEnabled,
    DateTime? StartsAt,
    DateTime? EndsAt);

/// <summary>The competition's sponsor ids in their new order. Must name every sponsor exactly once.</summary>
public record SponsorOrderRequest([Required] IReadOnlyList<int> Ids);

/// <summary>How often sponsors were on screen since the last batch. Counters only; nothing identifies the viewer.</summary>
public record SponsorExposureBatch([Required, MaxLength(40)] IReadOnlyList<SponsorExposureItem> Items);

/// <summary>One sponsor in one place: the number of times it appeared and the seconds it stayed (video only).</summary>
public record SponsorExposureItem(
    int SponsorId,
    SponsorPlacement Placement,
    [Range(0, 500)] int Views,
    [Range(0, 3600)] int Seconds);

/// <summary>A producer's instruction to the sponsor cards on the live video, sent to every viewer as <c>sponsorControl</c>.</summary>
public record SponsorControlDto(string Action);

/// <summary>Impressions and on-screen time for one human-friendly placement category.</summary>
public record SponsorPlacementStatDto(
    string Key,
    string Label,
    long Views,
    long Seconds,
    string FormattedOnScreenTime);

/// <summary>Proof-of-value summary for one sponsor across all placements.</summary>
public record SponsorValueReportItemDto(
    int SponsorId,
    string SponsorName,
    string? LinkUrl,
    string? LogoUrl,
    SponsorTier Tier,
    string TierLabel,
    SponsorPlacement ShowOn,
    IReadOnlyList<string> PlacementLabels,
    bool IsEnabled,
    long TotalViews,
    long TotalSeconds,
    string FormattedOnScreenTime,
    IReadOnlyList<SponsorPlacementStatDto> Placements);

/// <summary>Competition-wide sponsor proof-of-value report with per-sponsor and per-placement views and on-screen time.</summary>
public record SponsorValueReportDto(
    int CompetitionId,
    long TotalViews,
    long TotalSeconds,
    string FormattedTotalOnScreenTime,
    IReadOnlyList<SponsorValueReportItemDto> Sponsors);
