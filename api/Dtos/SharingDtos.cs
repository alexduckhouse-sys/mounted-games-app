namespace MountedGames.Api.Dtos;

/// <summary>
/// What a shared competition link may show. Everything here is already public on the competition page;
/// nothing about riders, signups, payments or staff.
/// </summary>
public record ShareCompetitionDto(string Name, DateTime StartDate, DateTime? EndDate, string? Location, int TeamCount);

/// <summary>What a shared team profile link may show: the stable team's name and club, as on the public profile page.</summary>
public record ShareTeamProfileDto(string DisplayName, string ClubName, int EventCount);

public record CalendarFeedStatusDto(bool Enabled, DateTime? CreatedAt);

/// <summary>
/// Returned once, when a team's calendar feed link is created or regenerated. <c>Token</c> is not stored and can't be
/// shown again. <c>Path</c> is the feed's address on the API; the website adds its own host and, for
/// calendar apps, the <c>webcal</c> scheme.
/// </summary>
public record CalendarFeedCreatedDto(string Token, string Path, DateTime CreatedAt);
