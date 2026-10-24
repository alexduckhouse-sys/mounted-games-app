using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

public record SeasonPointsRule(int Place, int Points);

/// <summary>The suffix may be empty. A club can be given by <c>ClubName</c> (matched ignoring case, or created) instead of <c>ClubId</c>.</summary>
public record CreateTeamProfileRequest(int ClubId, string Suffix, string DisplayName, string? ClubName = null);
public record UpdateTeamProfileRequest(int ClubId, string Suffix, string DisplayName, string? ClubName = null);
public record LinkEventTeamRequest(Guid TeamProfileId, int TeamId);

public record TeamProfileDto(
    Guid Id, int ClubId, string ClubName, string Suffix, string DisplayName,
    DateTime CreatedAt, DateTime UpdatedAt, bool CanManage = false);

public record EventTeamProfileLinkDto(
    int Id, Guid TeamProfileId, int CompetitionId, string CompetitionName,
    int TeamId, string TeamName, DateTime LinkedAt);

public record TeamProfileHistoryResultDto(
    Guid SeasonId, string SeasonTitle, int SeasonYear,
    Guid RoundId, int RoundOrder, string CompetitionName, DateTime CompetitionDate,
    int PublicationVersion, DateTime PublishedAt,
    int EventRank, double EventPoints, int SeasonPoints);

public record TeamProfileHistoryDto(
    TeamProfileDto Profile,
    IReadOnlyList<EventTeamProfileLinkDto> EventTeams,
    IReadOnlyList<TeamProfileHistoryResultDto> PublishedResults);

public record CreateSeasonRequest(
    string Title, int Year, SectionFormat Format, string AgeGroup,
    int? BestResultsToCount, IReadOnlyList<SeasonPointsRule> PlacePoints);

public record UpdateSeasonRequest(
    string Title, int Year, SectionFormat Format, string AgeGroup,
    int? BestResultsToCount, IReadOnlyList<SeasonPointsRule> PlacePoints);

public record AddSeasonRoundRequest(int CompetitionSectionId, int? OrderIndex = null);
public record SetSeasonRoundIncludedRequest(bool IsIncluded);

public record SeasonLinkDto(Guid Id, string Title, int Year);
public record SeasonRoundDto(
    Guid Id, int CompetitionId, string CompetitionName, DateTime CompetitionDate,
    int CompetitionSectionId, string SectionName, int OrderIndex, bool IsIncluded,
    int? PublishedVersion, DateTime? PublishedAt, bool PublicationIsCurrent);

public record SeasonDto(
    Guid Id, string Title, int Year, SectionFormat Format, string AgeGroup,
    int? BestResultsToCount, IReadOnlyList<SeasonPointsRule> PlacePoints,
    IReadOnlyList<SeasonRoundDto> Rounds, DateTime CreatedAt, DateTime UpdatedAt,
    bool CanManage = false);

public record SeasonPublicationPreviewRow(
    Guid TeamProfileId, int EventTeamId, string TeamName, string ClubName,
    int EventRank, double EventPoints, int SeasonPoints);

public record SeasonPublicationPreviewDto(
    Guid SeasonId, Guid RoundId, int CompetitionId, int CompetitionSectionId,
    string SourceFingerprint, int NextVersion, string RankingBasis,
    IReadOnlyList<SeasonPublicationPreviewRow> Results);

public record PublishSeasonRoundRequest(string SourceFingerprint, int ExpectedVersion);

public record SeasonRoundPublicationDto(
    Guid Id, Guid RoundId, int Version, string SourceFingerprint,
    DateTime PublishedAt, string RankingBasis, IReadOnlyList<SeasonPublicationPreviewRow> Results);

public record SeasonStandingRoundDto(
    Guid RoundId, string CompetitionName, DateTime CompetitionDate,
    int EventRank, int SeasonPoints, bool Counted);

public record SeasonStandingDto(
    int Rank, Guid TeamProfileId, string TeamName, string ClubName,
    long TotalPoints, IReadOnlyList<SeasonStandingRoundDto> Rounds);

public record SeasonStandingsDto(
    Guid SeasonId, string Title, int Year, SectionFormat Format, string AgeGroup,
    int? BestResultsToCount, IReadOnlyList<SeasonStandingDto> Standings);
