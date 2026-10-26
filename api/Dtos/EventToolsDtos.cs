using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

public record CsvTeamImportRequest(string Csv);
public record ApplyCsvTeamImportRequest(string Csv, string Fingerprint, int PreviewVersion);

public record CsvTeamImportRowDto(
    int RowNumber, int? ClubId, string Club, string Suffix,
    int? CompetitionSectionId, string Section, string TeamName,
    IReadOnlyList<string> Errors);

public record CsvTeamImportPreviewDto(
    int PreviewVersion, string Fingerprint, int TotalRows, int ValidRows,
    IReadOnlyList<CsvTeamImportRowDto> Rows);

public record CsvTeamImportResultDto(
    int CreatedCount, IReadOnlyList<int> TeamIds);

public record CloneCompetitionRequest(string Name, DateTime StartDate, DateTime? EndDate);
public record CloneCompetitionResultDto(int CompetitionId, string Name, int Sections, int Teams, int Sessions, int Heats, int Races);

public record PrintableCompetitionDto(int Id, string Name, string? Location, DateTime StartDate, DateTime? EndDate);
public record PrintableTeamDto(int TeamId, string TeamName, string ClubName, string Suffix, int Lane);
public record PrintableRaceDto(int RaceId, string Name, int OrderIndex);
public record PrintableHeatDto(
    int HeatId, string Label, DateTime? ScheduledStart,
    IReadOnlyList<PrintableTeamDto> Teams, IReadOnlyList<PrintableRaceDto> Races);
public record PrintableSessionDto(
    int SessionId, string SectionName, string SessionName, string? ArenaName,
    int OrderIndex, IReadOnlyList<PrintableHeatDto> Heats);
public record PrintableDrawDto(PrintableCompetitionDto Competition, IReadOnlyList<PrintableSessionDto> Sessions);

/// <summary><c>Lane</c> is the team's drawn lane in the heat; <c>Bib</c> is what its bibs look like, if known.</summary>
public record PrintableScoreCellDto(int TeamId, string TeamName, int? Placing, bool Eliminated, double? Points,
    int Lane = 0, string? Bib = null, bool IsSitOut = false, ResultStatus Status = ResultStatus.Finished);
public record PrintableScoreRaceDto(int RaceId, string Name, IReadOnlyList<PrintableScoreCellDto> Teams);
public record PrintableScoreHeatDto(
    int HeatId, string Label, string SectionName, string SessionName,
    DateTime? ScheduledStart, IReadOnlyList<PrintableScoreRaceDto> Races,
    int SessionId = 0);
public record PrintableScoreSheetsDto(PrintableCompetitionDto Competition, IReadOnlyList<PrintableScoreHeatDto> Heats);

public record PrintableSessionSummaryDto(
    int SessionId, string SessionName, string SectionName, int OrderIndex,
    int TotalHeats, int CompletedHeats, bool IsCompleted);

/// <summary><c>BonusPoints</c> (tack check bonus) is already inside <c>TotalPoints</c>.</summary>
public record PrintableResultRowDto(
    int Rank, int TeamId, string TeamName, string ClubName,
    double TotalPoints, int RacesRun, int Wins, int Eliminations, int BonusPoints = 0);
public record PrintableSectionResultsDto(
    int CompetitionSectionId, string SectionName, IReadOnlyList<PrintableResultRowDto> Results);
public record PrintableResultsDto(
    PrintableCompetitionDto Competition, bool IsProvisional,
    IReadOnlyList<PrintableSectionResultsDto> Sections,
    IReadOnlyList<PrintableScoreHeatDto>? Heats = null,
    IReadOnlyList<PrintableSessionSummaryDto>? Sessions = null);

/// <summary>A saved starting point. <c>OwnerName</c> is filled for admins only, who see everyone's.</summary>
public record StartingPointDto(
    int Id, string Name, string? SourceName, int Sections, int Sessions, DateTime CreatedAt, DateTime UpdatedAt,
    bool IsMine, string? OwnerName);
public record SaveStartingPointRequest(string Name);
public record RenameStartingPointRequest(string Name);
public record CreateFromStartingPointRequest(string Name, DateTime StartDate, DateTime? EndDate);
