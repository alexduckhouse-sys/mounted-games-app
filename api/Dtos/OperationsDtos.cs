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
public record DrawUndoStatusDto(
    bool Available,
    int? UndoId,
    string? Kind,
    string? Label,
    int? SectionId,
    int? SessionId,
    DateTime? CreatedAt,
    DateTime? ExpiresAt,
    int AffectedHeats,
    int AffectedSessions);
public record DrawUndoResultDto(
    bool Restored,
    string Label,
    int RestoredSessions,
    int RestoredHeats,
    DrawUndoStatusDto UndoStatus);
public record DrawPreviewDto(int SectionId, int Seed, string Fingerprint,
    IReadOnlyList<DrawSessionDto> Sessions, DrawFairnessDto Fairness,
    DrawUndoStatusDto? DrawUndo = null);

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
    IReadOnlyList<RaceListToChooseDto> RaceListsToChoose,
    DrawUndoStatusDto? DrawUndo = null);

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
    IReadOnlyList<VolunteerClaimDto> Claims,
    string DutyCategory = "General",
    int? AssignedTeamId = null,
    string? AssignedTeamName = null,
    string? AssignedClubName = null,
    int? LaneNumber = null,
    string AttendanceStatus = "Assigned",
    DateTime? CheckedInAt = null,
    string? CheckedInByName = null,
    bool CheckedInByStaffOverride = false,
    bool CanViewerCheckIn = false);

public record CreateVolunteerShiftRequest(
    [Required, StringLength(80, MinimumLength = 1)] string Role,
    int? SessionId = null,
    [StringLength(80)] string? ArenaName = null,
    [StringLength(80)] string? StartTimeLabel = null,
    [StringLength(500)] string? Notes = null,
    [Range(1, 50)] int RequiredCount = 1,
    [StringLength(40)] string? DutyCategory = null,
    int? AssignedTeamId = null,
    [StringLength(150)] string? AssignedClubName = null,
    [Range(1, 20)] int? LaneNumber = null);

public record UpdateVolunteerShiftRequest(
    [Required, StringLength(80, MinimumLength = 1)] string Role,
    int? SessionId = null,
    [StringLength(80)] string? ArenaName = null,
    [StringLength(80)] string? StartTimeLabel = null,
    [StringLength(500)] string? Notes = null,
    [Range(1, 50)] int RequiredCount = 1,
    [StringLength(40)] string? DutyCategory = null,
    int? AssignedTeamId = null,
    [StringLength(150)] string? AssignedClubName = null,
    [Range(1, 20)] int? LaneNumber = null);

public record ClaimVolunteerShiftRequest(
    [StringLength(160)] string? VolunteerName = null,
    [StringLength(150)] string? ClubName = null,
    [StringLength(40)] string? ContactPhone = null);

public record SessionDutyRoleAssignmentInput(
    [Required, StringLength(80, MinimumLength = 1)] string Role,
    [StringLength(40)] string DutyCategory = "ArenaCrew",
    int? AssignedTeamId = null,
    [StringLength(150)] string? AssignedClubName = null,
    [Range(1, 20)] int? LaneNumber = null,
    [Range(1, 50)] int RequiredCount = 1,
    [StringLength(80)] string? StartTimeLabel = null,
    [StringLength(500)] string? Notes = null);

public record AssignSessionDutiesRequest(
    IReadOnlyList<SessionDutyRoleAssignmentInput>? Duties = null,
    bool AutoAssignNonRidingTeams = false,
    bool IncludeChangeoverLineStewards = false,
    bool ReplaceExistingSessionDuties = true);

public record CheckInVolunteerShiftRequest(
    [StringLength(160)] string? CheckedInByName = null);

public record UpdateVolunteerAttendanceRequest(
    [Required, StringLength(24)] string Status,
    [StringLength(160)] string? CheckedInByName = null);

public record CallMissingStewardRequest(
    [StringLength(400)] string? CustomMessage = null);

public record CallMissingStewardResultDto(
    VolunteerShiftDto Shift,
    ChatMessageDto Announcement);

// ---- Arena Crew & Line Steward Phone Prop Sheet (#4) ----

public record ArenaCrewZonePropsDto(
    string ZoneKey,
    string ZoneLabel,
    IReadOnlyList<string> Items,
    string SummaryText);

public record ArenaCrewRaceCardDto(
    int? RaceId,
    string RaceName,
    int OrderIndex,
    int BendingPolesPerLane,
    string? Summary,
    IReadOnlyList<ArenaCrewZonePropsDto> Zones);

public record ArenaCrewTransitionDiffDto(
    IReadOnlyList<string> BringIn,
    IReadOnlyList<string> ClearOut,
    IReadOnlyList<string> KeepInRing,
    string SummaryText);

public record ArenaCrewPropSheetDto(
    int CompetitionId,
    int? SessionId,
    string? SessionName,
    string? ArenaName,
    int? HeatId,
    string? HeatLabel,
    int LanesPerHeat,
    ArenaCrewRaceCardDto? CurrentRace,
    ArenaCrewRaceCardDto? NextRace,
    ArenaCrewTransitionDiffDto? Transition,
    IReadOnlyList<ArenaCrewRaceCardDto> AllHeatRaces);

// ---- Live Commentator Briefing Engine (#11) ----

public record CommentatorLaneSquadDto(
    int LaneIndex,
    int TeamId,
    string TeamName,
    string ClubName,
    string? BibColour,
    string? BibDescription,
    string? Flag,
    int? CurrentRank,
    double TotalPoints,
    IReadOnlyList<string> RidersAndPonies,
    string? StakesHeadline,
    string? GameSpecialistNote);

public record CommentatorBriefingDto(
    int CompetitionId,
    int SessionId,
    string SessionName,
    int HeatId,
    string HeatLabel,
    int? CurrentRaceId,
    string? CurrentRaceName,
    IReadOnlyList<string> TalkingPoints,
    string? BiggestMoverHeadline,
    IReadOnlyList<CommentatorLaneSquadDto> Lanes);

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
/// <summary>A team named on a protest.</summary>
public record ProtestTeamDto(int TeamId, string TeamName);
/// <summary>
/// A protest as staff see it. Staff-only: never put any of this on a public DTO or broadcast to
/// <c>comp:{id}</c>; the public sees only <c>RaceDto.UnderReview</c>. <c>RaceSignedOff</c> says the race
/// (or, for a heat-wide protest, any race in the heat) was already signed off when it was read.
/// </summary>
public record ProtestDto(int Id, int CompetitionId, int SessionId, string SessionName,
    int HeatId, string? HeatLabel, int HeatOrder, int? RaceId, string? RaceName,
    ProtestTeamDto? RaisedByTeam, IReadOnlyList<ProtestTeamDto> Concerns, string? RaisedByName,
    string Reason, ProtestStatus Status, string? Decision,
    string? CreatedByUserId, DateTime CreatedAt, string? DecidedByUserId, DateTime? DecidedAt,
    bool RaceSignedOff);
/// <param name="HeatId">The heat; may be left out when <paramref name="RaceId"/> is given.</param>
/// <param name="RaceId">The race; null protests the whole heat.</param>
public record CreateProtestRequest(int? HeatId, int? RaceId, int? RaisedByTeamId,
    IReadOnlyList<int>? ConcernsTeamIds, string? RaisedByName, string? Reason, string? RequestId);
/// <param name="Outcome">Upheld or Dismissed.</param>
public record DecideProtestRequest(ProtestStatus Outcome, string? Decision);
public record WithdrawProtestRequest(string? Note);
