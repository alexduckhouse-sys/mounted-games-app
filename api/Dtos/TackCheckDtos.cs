using System.ComponentModel.DataAnnotations;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

// ---- Tack check (staff) ----

/// <summary>Every section's tack check for the stewards: its set-up, its teams and what has been marked.</summary>
public record TackCheckBoardDto(int CompetitionId, IReadOnlyList<TackCheckSectionDto> Sections);

/// <summary><c>Configured</c> is false until the organiser saves a set-up; until then the sectors are the defaults.</summary>
public record TackCheckSectionDto(
    int SectionId, string SectionName, bool Configured, bool IsEnabled, TackCheckMode Mode, int MaxPoints,
    IReadOnlyList<TackCheckSectorDto> Sectors, IReadOnlyList<TackCheckTeamDto> Teams);

/// <summary>Id 0 means a default sector that has not been saved yet.</summary>
public record TackCheckSectorDto(int Id, string Name);

/// <summary><c>Total</c> is the points across sectors; <c>Passed</c>/<c>Failed</c> count the pass-or-fail marks.</summary>
public record TackCheckTeamDto(
    int TeamId, string TeamName, string ClubName, bool IsHorsConcours, bool Withdrawn,
    IReadOnlyList<TackCheckMarkDto> Marks, int Total, int Passed, int Failed,
    IReadOnlyList<string>? Riders = null);

public record TackCheckMarkDto(
    int SectorId, bool? Passed, [Range(0, 1000)] int? Points,
    IReadOnlyList<int?>? RiderPoints = null);

/// <summary>
/// Turns the section's tack check on or off and sets what it counts for. The sectors replace the list: a row
/// with an id keeps that sector (and its marks), a row without one is new, and a sector left out is removed.
/// </summary>
public record SaveTackCheckSettingsRequest(
    bool IsEnabled, TackCheckMode Mode, [Range(1, 100)] int MaxPoints,
    [MaxLength(12)] IReadOnlyList<SaveTackCheckSectorRow> Sectors);

public record SaveTackCheckSectorRow(int? Id, [Required, MaxLength(60)] string Name);

/// <summary>Replaces one team's marks in a section. A sector left out, or sent with nothing set, is cleared.</summary>
public record SaveTackCheckMarksRequest([MaxLength(12)] IReadOnlyList<TackCheckMarkDto> Marks);

// ---- Tack & Turnout table (public) ----

/// <summary>Only sections whose tack check is on and scored (a separate table or bonus points) appear.</summary>
public record TackLeaderboardDto(IReadOnlyList<TackLeaderboardSectionDto> Sections);

public record TackLeaderboardSectionDto(
    int SectionId, string SectionName, TackCheckMode Mode, int MaxPoints,
    IReadOnlyList<string> Sectors, IReadOnlyList<TackLeaderboardRowDto> Rows);

/// <summary>Rank is shared by teams level on points, and null for hors concours teams, which are listed last.</summary>
public record TackLeaderboardRowDto(
    int? Rank, int TeamId, string TeamName, string ClubName, IReadOnlyList<int?> Points, int Total, bool IsHorsConcours);

// ---- Printable tack check form (staff) ----

/// <summary>One form per section: each team with its declared riders and ponies, and a column per sector.</summary>
public record PrintableTackCheckDto(PrintableCompetitionDto Competition, IReadOnlyList<PrintableTackCheckSectionDto> Sections);

public record PrintableTackCheckSectionDto(
    int SectionId, string SectionName, bool IsEnabled, TackCheckMode Mode, int MaxPoints,
    IReadOnlyList<string> Sectors, IReadOnlyList<PrintableEntryTeamDto> Teams);

// ---- Passport check (staff) ----

/// <summary>When the competition has the passport check off, <c>Sections</c> is empty.</summary>
public record PassportCheckBoardDto(bool Enabled, int Checked, int Total, IReadOnlyList<PassportCheckSectionDto> Sections);

public record PassportCheckSectionDto(int SectionId, string SectionName, IReadOnlyList<PassportCheckTeamDto> Teams);

/// <summary><c>HasDeclaration</c> is false when the team has not sent its riders and ponies yet.</summary>
public record PassportCheckTeamDto(
    int TeamId, string TeamName, string ClubName, bool Withdrawn, bool IsHorsConcours, bool HasDeclaration,
    IReadOnlyList<PassportCheckPonyDto> Ponies);

/// <summary>A pony on the team's declaration, the riders on it, and when its passport was checked (null if not yet).</summary>
public record PassportCheckPonyDto(
    string PonyName,
    IReadOnlyList<string> Riders,
    DateTime? CheckedAt,
    string? CheckedByName,
    string? PassportCode = null,
    string? OwnerFullName = null,
    bool Certified = false,
    string Status = "Unchecked",
    string? LastFluVaccineDate = null,
    string? FluValidUntil = null,
    string? LastTetanusDate = null,
    string? TetanusValidUntil = null,
    string? InspectorRole = null,
    string? OfficialNotes = null);

public record SavePassportCheckSettingsRequest(bool Enabled);

public record SetPassportCheckRequest(
    [Required, MaxLength(100)] string PonyName,
    bool Checked,
    [MaxLength(80)] string? PassportCode = null,
    [MaxLength(160)] string? OwnerFullName = null,
    [MaxLength(16)] string? LastFluVaccineDate = null,
    [MaxLength(16)] string? FluValidUntil = null,
    [MaxLength(16)] string? LastTetanusDate = null,
    [MaxLength(16)] string? TetanusValidUntil = null,
    [MaxLength(40)] string? InspectorRole = null,
    [MaxLength(500)] string? OfficialNotes = null);

public record CertifiedHorseLookupDto(
    bool Found,
    bool Certified,
    string Status,
    string? PassportCode,
    string? HorseName,
    string? OwnerFullName,
    string? LastFluVaccineDate,
    string? FluValidUntil,
    string? LastTetanusDate,
    string? TetanusValidUntil,
    string? InspectorRole,
    string? InspectedByName,
    DateTime? InspectedAt,
    string? OfficialNotes);
