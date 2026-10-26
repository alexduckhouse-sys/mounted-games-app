using System.ComponentModel.DataAnnotations;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Dtos;

public record DrawRequest(int Seed);
public record ApplyDrawRequest(int Seed, string Fingerprint);
public record DrawTeamAssignmentDto(int TeamId, string TeamName, int LaneIndex);
public record DrawHeatDto(int HeatId, string? Label, int OrderIndex, IReadOnlyList<DrawTeamAssignmentDto> Teams);
public record DrawSessionDto(int SessionId, string Name, IReadOnlyList<DrawHeatDto> Heats);
public record DrawFairnessDto(
    int TeamCount, int SessionCount, int HeatSizeSpread,
    int MaximumOpponentMeetings, int RepeatedOpponentPairs,
    int MaximumLaneUseSpread, bool EveryTeamAppearsOncePerSession,
    IReadOnlyList<string> Warnings);
public record DrawPreviewDto(int SectionId, int Seed, string Fingerprint,
    IReadOnlyList<DrawSessionDto> Sessions, DrawFairnessDto Fairness);

/// <summary>A result as staff see it: ResultDto plus the referee's private note.</summary>
public record ScorePlaceDto(int TeamId, int Place, bool Eliminated, double Points, bool IsSitOut = false,
    ResultStatus Status = ResultStatus.Finished, string? RefereeNote = null);
public record UpdateRaceScoreRequest(
    IReadOnlyList<FinishingPlaceDto>? Places, int ExpectedRevision,
    string RequestId, string? Reason);
public record ScoreActionRequest(int ExpectedRevision, string RequestId, string? Reason);
public record RaceScoreDto(int RaceId, int Revision, bool IsSignedOff,
    DateTime? SignedOffAt, string? SignedOffByUserId, IReadOnlyList<ScorePlaceDto> Results,
    bool IdempotentReplay = false);
public record RaceScoreHistoryDto(int Revision, RaceScoreEventKind Kind,
    IReadOnlyList<ScorePlaceDto> Before, IReadOnlyList<ScorePlaceDto> After,
    string? ActorUserId, string Reason, DateTime CreatedAt, string? ActorLabel = null);

public record MissingDeclarationDto(int TeamId, string TeamName, int SectionId, string SectionName);
public record UnpaidSignupDto(int SignupId, int SectionId, string SectionName, int AmountMinor);
public record IncompleteTeamDto(int TeamId, string TeamName, int SectionId, string SectionName,
    int DeclaredRiders, int MinimumRiders);
public record SessionOverlapDto(int FirstSessionId, string FirstSessionName,
    int SecondSessionId, string SecondSessionName, string Arena,
    DateTime StartsAt, DateTime EndsAt);
public record EquipmentChecklistItemDto(string Key, string Kind, string Bucket, int Count,
    bool Acknowledged, DateTime? AcknowledgedAt);
public record EquipmentReadinessIssueDto(string RaceName, string Message);
public record CompetitionReadinessDto(int CompetitionId, bool IsReady, string EquipmentFingerprint,
    IReadOnlyList<MissingDeclarationDto> MissingDeclarations,
    IReadOnlyList<UnpaidSignupDto> UnpaidSignups,
    IReadOnlyList<IncompleteTeamDto> IncompleteTeams,
    IReadOnlyList<SessionOverlapDto> SessionOverlaps,
    IReadOnlyList<EquipmentChecklistItemDto> EquipmentChecklist,
    IReadOnlyList<EquipmentReadinessIssueDto> EquipmentIssues,
    IReadOnlyList<FlaggedDecFormDto> FlaggedDecForms,
    IReadOnlyList<RaceListToChooseDto> RaceListsToChoose);
/// <summary>A team whose latest dec form has riders with flags (an answer outside the organiser's limits). Counts only: no rider details.</summary>
public record FlaggedDecFormDto(int TeamId, string TeamName, int SectionId, string SectionName, int FlaggedRiders);
/// <summary>
/// A race session with no races chosen yet. <c>SessionId</c> is null when the age group has no race session at all.
/// </summary>
public record RaceListToChooseDto(int? SessionId, string SessionName, int SectionId, string SectionName);
public record UpdateEquipmentAcknowledgementsRequest(
    IReadOnlyList<string> AcknowledgedKeys, string ExpectedFingerprint);

/// <summary>The list entry: no text, so the list stays small. The text comes from the single-rulebook endpoint.</summary>
public record RulebookSummaryDto(int Id, string Title, string Edition, string? SourceUrl, DateTime UpdatedAt);
public record RulebookDto(int Id, string Title, string Edition,
    string? SourceUrl, string Text, DateTime UpdatedAt);
public record UpsertRulebookRequest(string Title, string Edition, string? SourceUrl, string Text);

// ---- Volunteer shifts and claims (#16) ----

public record VolunteerClaimDto(
    int Id,
    int ShiftId,
    string UserId,
    string VolunteerName,
    string? ClubName,
    string? ContactPhone,
    DateTime ClaimedAt,
    bool IsMine = false);

public record VolunteerShiftDto(
    int Id,
    int CompetitionId,
    int? SessionId,
    string? SessionName,
    string? ArenaName,
    string Role,
    string? StartTimeLabel,
    string? Notes,
    int RequiredCount,
    int ClaimedCount,
    int RemainingCount,
    bool IsFilled,
    IReadOnlyList<VolunteerClaimDto> Claims);

public record CreateVolunteerShiftRequest(
    [Required, StringLength(80, MinimumLength = 1)] string Role,
    int? SessionId = null,
    [StringLength(80)] string? ArenaName = null,
    [StringLength(80)] string? StartTimeLabel = null,
    [StringLength(500)] string? Notes = null,
    [Range(1, 50)] int RequiredCount = 1);

public record UpdateVolunteerShiftRequest(
    [Required, StringLength(80, MinimumLength = 1)] string Role,
    int? SessionId = null,
    [StringLength(80)] string? ArenaName = null,
    [StringLength(80)] string? StartTimeLabel = null,
    [StringLength(500)] string? Notes = null,
    [Range(1, 50)] int RequiredCount = 1);

public record ClaimVolunteerShiftRequest(
    [StringLength(160)] string? VolunteerName = null,
    [StringLength(150)] string? ClubName = null,
    [StringLength(40)] string? ContactPhone = null);

// ---- Emergency contact quick search (#151, staff only) ----

public record EmergencyContactLookupDto(
    int RiderEntryId,
    string RiderName,
    string? PonyName,
    int TeamId,
    string TeamName,
    int SectionId,
    string SectionName,
    string ClubName,
    string? BibColour,
    string? BibDescription,
    bool IsReserve,
    string? EmergencyContactName,
    string? EmergencyContactPhone,
    string? MedicalNotes,
    string? TrainerName,
    string? TrainerPhone);
