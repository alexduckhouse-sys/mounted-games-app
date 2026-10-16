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

public record ScorePlaceDto(int TeamId, int Place, bool Eliminated, int Points);
public record UpdateRaceScoreRequest(
    IReadOnlyList<FinishingPlaceDto>? Places, int ExpectedRevision,
    string RequestId, string? Reason);
public record ScoreActionRequest(int ExpectedRevision, string RequestId, string? Reason);
public record RaceScoreDto(int RaceId, int Revision, bool IsSignedOff,
    DateTime? SignedOffAt, string? SignedOffByUserId, IReadOnlyList<ScorePlaceDto> Results,
    bool IdempotentReplay = false);
public record RaceScoreHistoryDto(int Revision, RaceScoreEventKind Kind,
    IReadOnlyList<ScorePlaceDto> Before, IReadOnlyList<ScorePlaceDto> After,
    string? ActorUserId, string Reason, DateTime CreatedAt);

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
    IReadOnlyList<EquipmentReadinessIssueDto> EquipmentIssues);
public record UpdateEquipmentAcknowledgementsRequest(
    IReadOnlyList<string> AcknowledgedKeys, string ExpectedFingerprint);

public record RulebookDto(int Id, int CompetitionId, string Title, string Edition,
    string? SourceUrl, string Text, DateTime UpdatedAt);
public record UpsertRulebookRequest(string Title, string Edition, string? SourceUrl, string Text);
