using System.ComponentModel.DataAnnotations;

namespace MountedGames.Api.Dtos;

/// <summary>
/// The post-event results book. The public version holds only what the public results pages show;
/// <c>IncludesPrivate</c> is true only for the organiser's copy, which adds the referee's notes.
/// </summary>
public record ResultsBookDto(
    PrintableCompetitionDto Competition, bool IsProvisional, bool IncludesPrivate, DateTime GeneratedAt,
    IReadOnlyList<ResultsBookSectionDto> Sections, IReadOnlyList<SpecialAwardDto> EventAwards,
    IReadOnlyList<ResultsBookNoteDto> RefereeNotes);

public record ResultsBookSectionDto(
    int SectionId, string SectionName, int Format,
    IReadOnlyList<ResultsBookStandingDto> Standings, IReadOnlyList<ResultsBookFinalDto> Finals,
    IReadOnlyList<SpecialAwardDto> Awards);

/// <summary>One row of the final standings. <c>BonusPoints</c> (tack check bonus) is already inside <c>TotalPoints</c>.</summary>
public record ResultsBookStandingDto(
    int Rank, int TeamId, string TeamName, string ClubName, string? FinalLabel,
    int TotalPoints, int BonusPoints, int RacesRun, int Wins, int Eliminations, bool Withdrawn);

/// <summary>One final (A Final, B Final, or a race final): each team's points in every race of it. A cell is the points, or E, DNS, DNF, R or S.</summary>
public record ResultsBookFinalDto(
    string Label, string SessionName, IReadOnlyList<string> RaceNames, IReadOnlyList<ResultsBookFinalRowDto> Rows);

public record ResultsBookFinalRowDto(
    int Rank, int TeamId, string TeamName, string ClubName, int Points, IReadOnlyList<string> RaceCells);

public record ResultsBookNoteDto(
    string SectionName, string HeatLabel, string RaceName, string TeamName, string? StatusLetter, string Note);

public record SpecialAwardDto(int Id, int? CompetitionSectionId, string Title, string Recipient, string? Note);

/// <summary>The awards replace the whole list. Rows with an id keep it; the rest are new.</summary>
public record SaveSpecialAwardsRequest([MaxLength(50)] IReadOnlyList<SaveSpecialAwardRow> Awards);

public record SaveSpecialAwardRow(
    int? CompetitionSectionId,
    [Required, MaxLength(100)] string Title,
    [Required, MaxLength(200)] string Recipient,
    [MaxLength(300)] string? Note);

/// <summary>Staff-only entry list: every team with its riders and ponies, for the pre-event pack.</summary>
public record PrintableEntriesDto(PrintableCompetitionDto Competition, IReadOnlyList<PrintableEntriesSectionDto> Sections);
public record PrintableEntriesSectionDto(int SectionId, string SectionName, IReadOnlyList<PrintableEntryTeamDto> Teams);
public record PrintableEntryTeamDto(
    int TeamId, string TeamName, string ClubName, string? Bib, bool Withdrawn, bool IsHorsConcours,
    IReadOnlyList<PrintableEntryRiderDto> Riders);
public record PrintableEntryRiderDto(string Name, string? Pony, bool IsCaptain, bool IsReserve, bool IsGuest);
