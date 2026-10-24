using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

/// <summary>What a statistics profile is about. Travels as a number like every enum.</summary>
public enum StatsSubjectKind
{
    Rider = 0,
    Pony = 1,
    Team = 2,
    Club = 3,
}

/// <summary>Search results, a few of each kind. <c>Key</c> is what the profile endpoint takes as <c>name</c>.</summary>
public record StatsSearchDto(
    string Query,
    IReadOnlyList<StatsHitDto> Riders, IReadOnlyList<StatsHitDto> Ponies,
    IReadOnlyList<StatsHitDto> Teams, IReadOnlyList<StatsHitDto> Clubs);

/// <summary>One page of the browse list for a kind. <c>Total</c> counts every subject matching <c>Query</c>.</summary>
public record StatsBrowseDto(StatsSubjectKind Kind, string Query, int Page, int PageSize, int Total, IReadOnlyList<StatsHitDto> Items);

/// <param name="Competitions">Finished competitions that count towards the profile.</param>
public record StatsHitDto(StatsSubjectKind Kind, string Name, string Key, int Competitions);

/// <summary>
/// A cross-competition profile. Everyone gets <c>Summary</c>; the lists are filled only for a signed-in viewer
/// (<c>Detailed</c>) and are null otherwise. <c>RaceFiguresAllFormats</c> is false for riders and ponies, whose
/// race and game figures come from individual and pairs competitions only.
/// </summary>
public record StatsProfileDto(
    StatsSubjectKind Kind, string Name, string Key, bool Detailed, bool RaceFiguresAllFormats,
    StatsSummaryDto Summary,
    IReadOnlyList<StatsGameDto>? Games,
    IReadOnlyList<string>? BestGames, IReadOnlyList<string>? WorstGames,
    IReadOnlyList<StatsEntryDto>? Entries,
    IReadOnlyList<StatsPartnershipDto>? Partnerships,
    IReadOnlyList<StatsClubDto>? Clubs = null,
    IReadOnlyList<StatsSeasonStandingDto>? Seasons = null);

/// <param name="Entries">Age-group entries (one team in one section) in finished competitions.</param>
/// <param name="PlacedEntries">Entries with a final place: hors concours teams are left out, as in the standings.</param>
/// <param name="EntriesWithFinals">Placed entries in an age group that ran lettered finals (A Final, B Final...).</param>
/// <param name="AFinalPercent">A Finals as a share of <paramref name="EntriesWithFinals"/>; null when there were none.</param>
/// <param name="PointQuotaPercent">Points won as a share of the most they could have won in the same races.</param>
public record StatsSummaryDto(
    int Competitions, int Entries, int PlacedEntries,
    int Firsts, int Seconds, int Thirds, double? AveragePlace,
    int EntriesWithFinals, int FinalsReached, int AFinals, double? AFinalPercent,
    int Races, int Wins, double? WinPercent,
    double Points, double MaxPoints, double? PointQuotaPercent,
    int BFinals = 0, int CFinals = 0);

public record StatsClubDto(string ClubName, int Entries, int Competitions, string? FirstDate, string? LastDate);
public record StatsSeasonStandingDto(Guid SeasonId, string SeasonName, int Year, int? Rank, long Points, int EventsEntered, Guid TeamProfileId, string TeamName);

/// <summary>One game (race name) across every counted race. <c>NonFinishes</c> covers E, DNS, DNF and R.</summary>
public record StatsGameDto(
    string Name, int Races, int Wins, double? WinPercent, int NonFinishes,
    double Points, double MaxPoints, double? PointQuotaPercent,
    double? AveragePoints = null, double? AveragePlace = null);

/// <param name="Place">Place in the age group's final standings; null for hors concours.</param>
/// <param name="FinalTier">0 for the A Final, 1 for the B Final and so on; null when not in a lettered final.</param>
public record StatsEntryDto(
    int CompetitionId, string CompetitionName, DateTime StartDate,
    int SectionId, string SectionName, SectionFormat Format,
    int TeamId, string TeamName, string ClubName, bool IsHorsConcours,
    string? RiderName, string? PonyName,
    int? Place, int TeamsPlaced, int? FinalTier,
    int Races, double Points, double MaxPoints, double? PointQuotaPercent,
    IReadOnlyList<StatsSessionDto> Sessions);

/// <param name="Rank">Place on session points among the session's teams (hors concours left out); null for hors concours.</param>
public record StatsSessionDto(int SessionId, string Name, double Points, double MaxPoints, int? Rank, int Teams);

/// <summary>A rider and pony who were declared together, and how often.</summary>
public record StatsPartnershipDto(string RiderName, string PonyName, int Entries, int Competitions);
