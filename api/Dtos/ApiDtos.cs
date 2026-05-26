using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

public record ClubDto(int Id, string Name, string? Region, string? BibColour);

public record CreateClubRequest(string Name, string? Region = null, string? BibColour = null);

public record CompetitionSummary(
    int Id, string Name, string? Location, DateTime StartDate, DateTime? EndDate,
    bool IsActive, bool IsArchived, int SectionCount, int TeamCount, int SessionCount);

public record CompetitionDetail(
    int Id, string Name, string? Location, string? Description,
    double? Latitude, double? Longitude,
    string? What3Words, string? AppleMapsUrl,
    DateTime StartDate, DateTime? EndDate,
    bool IsActive, bool IsArchived,
    IReadOnlyList<CompetitionSectionDto> Sections,
    IReadOnlyList<TeamDto> Teams,
    IReadOnlyList<SessionDto> Sessions,
    string? StreamUrl = null,
    string? OrganiserName = null,
    string? PaymentDestination = null,
    bool SignupsLocked = false);

public record CreateCompetitionRequest(
    string Name, string? Location, string? Description,
    double? Latitude, double? Longitude,
    string? What3Words, string? AppleMapsUrl,
    DateTime StartDate, DateTime? EndDate,
    string? Postcode = null,
    string? StreamUrl = null,
    string? OrganiserName = null,
    string? PaymentDestination = null);

public record UpdateCompetitionRequest(
    string Name, string? Location, string? Description,
    double? Latitude, double? Longitude,
    string? What3Words, string? AppleMapsUrl,
    DateTime StartDate, DateTime? EndDate,
    bool IsActive, bool IsArchived,
    string? Postcode = null,
    string? StreamUrl = null,
    string? OrganiserName = null,
    string? PaymentDestination = null);

public record SetSignupsLockedRequest(bool Locked);

public record FormTeamsFromSignupsRequest(int? RidersPerTeam, bool Preview, bool ReplaceExisting);

public record FormedTeamPreview(
    string ClubName,
    int ClubId,
    string Suffix,
    IReadOnlyList<int> SignupIds,
    IReadOnlyList<string> RiderNames);

public record FormTeamsResult(
    bool Preview,
    int RidersPerTeam,
    int PaidSignups,
    IReadOnlyList<FormedTeamPreview> Teams,
    IReadOnlyList<TeamDto> Created);

public record MySignupDto(
    int Id, int CompetitionId, string CompetitionName,
    DateTime CompetitionStart,
    int CompetitionSectionId, string SectionName,
    string FullName, string? PonyClubName, string? ContactInfo,
    int AmountMinor, SignupPaymentStatus Status, DateTime? PaidAt,
    int? TeamId, string? TeamName, DateTime CreatedAt);

public record GeocodeResult(double? Latitude, double? Longitude, string? Source);

public record BlockAuthorRequest(string? Reason = null);

public record RaceTemplateDto(
    int Id, string Name, string? Summary, string? Rules, string? Category,
    string? DiagramJson, bool IsBuiltIn);
public record UpsertRaceTemplateRequest(
    string Name, string? Summary, string? Rules, string? Category, string? DiagramJson);

public record CompetitionSectionDto(
    int Id, int CompetitionId, SectionFormat Format, string AgeGroup, string DisplayName,
    string? RunoffRaceName, bool UsesRaceFinals, int PriceMinor);
public record CreateSectionRequest(SectionFormat Format, string AgeGroup, string? DisplayName,
    string? RunoffRaceName = null, bool UsesRaceFinals = false, int PriceMinor = 0);
public record UpdateSectionRequest(string? RunoffRaceName, bool? UsesRaceFinals = null, int? PriceMinor = null);

public record SectionSignupDto(
    int Id, int CompetitionSectionId, string SectionName,
    string FullName, string? PonyClubName, string? ContactInfo,
    int AmountMinor, SignupPaymentStatus Status, DateTime? PaidAt,
    int? TeamId, DateTime CreatedAt);

public record CreateSectionSignupRequest(
    string FullName, string? PonyClubName, string? ContactInfo);

public record UpdateSignupStatusRequest(SignupPaymentStatus Status);

public record ShopPostDto(
    int Id, string AuthorName, string? PonyClubName,
    string? AuthorUserId,
    string Title, string Body, int? PriceMinor, string? ContactInfo,
    string? ImageBase64,
    DateTime CreatedAt, bool IsDeleted,
    int CommentCount, int ReportCount);

public record CreateShopPostRequest(
    string Title, string Body, int? PriceMinor,
    string? ContactInfo, string AuthorName, string? PonyClubName,
    string? ImageBase64);

public record ShopCommentDto(
    int Id, int PostId, string? AuthorUserId, string AuthorName,
    string Body, bool IsPrivate, string? ToUserId, DateTime CreatedAt);

public record CreateShopCommentRequest(
    string Body, string AuthorName, bool IsPrivate, string? ToUserId);

public record CreateShopReportRequest(string? Reason);

public record TeamDto(
    int Id, int CompetitionId, int CompetitionSectionId, string SectionName,
    int ClubId, string ClubName, string Suffix, string DisplayName,
    string? BibColour, string? TrainerUserId, string? TrainerName,
    bool IsHorsConcours,
    /// <summary>"trainer" if the viewer owns this team, "supporter" if they're an
    /// accepted supporter, null otherwise. Set by the my-teams endpoint.</summary>
    string? Relationship = null,
    /// <summary>Join key — exposed only to the trainer; null for everyone else.</summary>
    string? SupporterJoinKey = null);

public record CreateTeamRequest(
    int CompetitionSectionId, int ClubId, string Suffix,
    string? BibColour, string? TrainerUserId,
    bool IsHorsConcours = false);

public record UpdateTeamRequest(
    string? Suffix = null,
    bool? IsHorsConcours = null);

public record SessionDto(
    int Id, int CompetitionId, int? CompetitionSectionId, string? SectionName,
    string Name, string? ArenaName,
    DateTime? ScheduledStart, DateTime? StartedAt, DateTime? FinishedAt,
    SessionStatus Status, int OrderIndex, string? Notes,
    bool IsBreak, int? DurationMinutes,
    SessionKind Kind, string? Location,
    string? StreamUrl, int? LanesPerHeat,
    int? MinutesPerHeat, bool RaceOrderAlternating,
    IReadOnlyList<HeatDto> Heats);

public record UpdateSessionSettingsRequest(int? MinutesPerHeat, bool? RaceOrderAlternating);

public record HeatAssignmentEntry(string Label, IReadOnlyList<int> TeamIds);
public record UpdateHeatAssignmentsRequest(IReadOnlyList<HeatAssignmentEntry> Assignments);

public record CreateSessionRequest(
    int? CompetitionSectionId, string Name, string? ArenaName,
    DateTime? ScheduledStart, int OrderIndex, string? Notes,
    bool IsBreak, int? DurationMinutes,
    SessionKind? Kind, string? Location);

public record UpdateSessionStatusRequest(SessionStatus Status);

public record UpdateSessionStreamRequest(string? StreamUrl);
public record UpdateSessionLanesRequest(int? LanesPerHeat);
public record GenerateHeatsRequest(
    IReadOnlyList<int> TeamIds,
    IReadOnlyList<string> RaceNames,
    int? LanesPerHeat,
    bool ReplaceExisting);
public record CreateFinalsRequest(
    int? CompetitionSectionId,
    int TopN,
    IReadOnlyList<string> RaceNames,
    int? LanesPerHeat,
    string? Name);

public record ScaffoldFinalsRequest(
    int? CompetitionSectionId,
    IReadOnlyList<string> RaceNames,
    int LanesPerHeat,
    int NumHeats,
    string? Name,
    int? MinutesPerHeat,
    DateTime? ScheduledStart);

public record AutoTimetableRequest(
    int? RacesPerHeat,
    int? SessionsPerSection,
    int? LanesPerHeat,
    int? MinutesPerHeat,
    int? MinutesBetweenSessions,
    bool ReplaceExisting,
    IReadOnlyList<int>? SectionIds);

public record HeatDto(
    int Id, int SessionId, string? Label,
    int OrderIndex,
    int? DurationMinutes,
    DateTime? ScheduledStart,
    DateTime? StartedAt, DateTime? FinishedAt,
    int? RaceRoundId,
    RaceRoundStage RaceRoundStage,
    IReadOnlyList<HeatEntryDto> Entries,
    IReadOnlyList<RaceDto> Races);

public record UpdateHeatScheduledStartRequest(DateTime? ScheduledStart);
public record PopulateRaceFinalRequest(int TopN);
public record GenerateRaceFinalsRequest(
    IReadOnlyList<int> TeamIds,
    IReadOnlyList<string> RaceNames,
    int? LanesPerHeat,
    bool ReplaceExisting);

public record RaceDto(
    int Id, int HeatId, string Name,
    int OrderIndex, bool IsComplete,
    DateTime? StartedAt, DateTime? FinishedAt,
    IReadOnlyList<ResultDto> Results);

public record UpdateHeatDurationRequest(int? DurationMinutes);

public record HeatEntryDto(int Id, int TeamId, string TeamName, string? BibColour, int LaneIndex);

public record ResultDto(int Id, int TeamId, string TeamName, int? Placing, bool Eliminated, int Points);

public record CreateHeatRequest(
    string? Label, int OrderIndex,
    IReadOnlyList<int> TeamIds,
    IReadOnlyList<string> RaceNames);

public record SubmitRaceResultsRequest(IReadOnlyList<FinishingPlaceDto> Places);
public record FinishingPlaceDto(int TeamId, int Place, bool Eliminated);

public record StandingRow(
    int TeamId, string TeamName, string ClubName, string? BibColour,
    int TotalPoints, int RacesRun, int Wins, int Eliminations);

public record DeclarationFormDto(
    int Id, int TeamId, string TeamName, int CompetitionId, string CompetitionName,
    string? SubmittedByUserId, string? SubmittedByName, string? SubmittedByPhone,
    DateTime SubmittedAt,
    string? Notes, bool IsLocked,
    IReadOnlyList<RiderEntryDto> Riders);

public record RiderEntryDto(
    int Id, int? SavedRiderId, string FullName, DateTime? DateOfBirth,
    string? HorseName, string? BibColour, bool IsCaptain, bool IsReserve, int OrderIndex);

public record SubmitDeclarationFormRequest(
    int TeamId, string? Notes, IReadOnlyList<RiderEntryInput> Riders, bool SaveToRoster,
    string? TrainerPhone);

public record RiderEntryInput(
    int? SavedRiderId, string FullName, DateTime? DateOfBirth,
    string? HorseName, string? BibColour, bool IsCaptain, bool IsReserve, int OrderIndex);

public record SavedRiderDto(
    int Id, int ClubId, string FullName, DateTime? DateOfBirth, string? HorseName, string? Notes);

public record ChatMessageDto(
    int Id, int CompetitionId, string? UserId, string AuthorName,
    string Body, ChatMessageType Type, string? Tag, DateTime CreatedAt);

public record PostChatMessageRequest(string Body, string? AuthorName);

public record AnnouncementRequest(string Body, string? Tag);

public record TrainerNoteDto(
    int Id, string UserId, string? Title, string Body, DateTime CreatedAt, DateTime? UpdatedAt);

public record SaveTrainerNoteRequest(string? Title, string Body);

public record IpBlockDto(int Id, string IpAddress, string? Reason, string? CreatedByUserId, DateTime CreatedAt);
public record CreateIpBlockRequest(string IpAddress, string? Reason);

public record StewardCallDto(
    int Id, int RaceId, int HeatId, int CompetitionId,
    int TeamId, string TeamName, string? TeamBibColour,
    int LaneIndex, string? ReporterName, DateTime CreatedAt);
public record CreateStewardCallRequest(int TeamId, int LaneIndex, string? ReporterName);

public record TeamSupporterDto(
    int Id, int TeamId, string TeamName,
    string UserId, string UserName, string? UserEmail,
    TeamSupporterStatus Status, DateTime CreatedAt);
public record JoinTeamRequest(string Key);
public record GenerateJoinKeyResponse(string Key);

public record VapidPublicKeyResponse(string PublicKey);
public record PushSubscribeRequest(string Endpoint, string P256dh, string Auth);
public record SendTestPushRequest(string? Title, string? Body);
