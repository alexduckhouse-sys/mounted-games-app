using MountedGames.Api.Entities;
using MountedGames.Api.Services.Email;
using System.ComponentModel.DataAnnotations;

namespace MountedGames.Api.Dtos;

public record ClubDto(int Id, string Name, string? Region, string? BibColour);

public record CreateClubRequest(string Name, string? Region = null, string? BibColour = null);

public record CompetitionSummary(
    int Id, string Name, string? Location, DateTime StartDate, DateTime? EndDate,
    bool IsActive, bool IsArchived, int SectionCount, int TeamCount, int SessionCount);

public record PickerLiveHeat(string? SectionName, string HeatLabel, string? ArenaName);
public record CompetitionPickerItem(
    int Id, string Name, DateTime StartDate, DateTime? EndDate, string Icon,
    string? Location, int AgeGroupCount, PickerLiveHeat? Live, bool IsDemo = false);
public record CompetitionPickerPage(IReadOnlyList<CompetitionPickerItem> Items, bool HasMore);

public static class CompetitionTerms
{
    /// <summary>Plenty for a page or two of terms; stops the field being used as a file store.</summary>
    public const int MaxLength = 20000;
}

public static class CompetitionIcons
{
    public const string Pattern = "^(flag|world|trophy|gb|gb-eng|gb-sct|gb-wls|gb-nir|ie|fr|de|nl|be|es|pt|it|ch|at|se|no|dk|fi|pl|cz|us|ca|au|nz|za)\\z";
}

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
    bool SignupsLocked = false,
    string Icon = "flag",
    string? CreatedByUserId = null,
    bool StaffChatEnabled = true,
    bool IsDemo = false,
    string? TermsText = null);

public record CreateCompetitionRequest(
    string Name, string? Location, string? Description,
    double? Latitude, double? Longitude,
    string? What3Words, string? AppleMapsUrl,
    DateTime StartDate, DateTime? EndDate,
    string? Postcode = null,
    string? StreamUrl = null,
    string? OrganiserName = null,
    string? PaymentDestination = null,
    [RegularExpression(CompetitionIcons.Pattern)] string? Icon = null,
    [MaxLength(CompetitionTerms.MaxLength)] string? TermsText = null);

public record UpdateCompetitionRequest(
    string Name, string? Location, string? Description,
    double? Latitude, double? Longitude,
    string? What3Words, string? AppleMapsUrl,
    DateTime StartDate, DateTime? EndDate,
    bool IsActive, bool IsArchived,
    string? Postcode = null,
    string? StreamUrl = null,
    string? OrganiserName = null,
    string? PaymentDestination = null,
    [RegularExpression(CompetitionIcons.Pattern)] string? Icon = null,
    [MaxLength(CompetitionTerms.MaxLength)] string? TermsText = null);

public record SetSignupsLockedRequest(bool Locked);

public record FormTeamsFromSignupsRequest(int? RidersPerTeam, bool Preview, bool ReplaceExisting);

public record FormedTeamPreview(
    string ClubName,
    int ClubId,
    string Suffix,
    IReadOnlyList<int> SignupIds,
    IReadOnlyList<string> RiderNames,
    string? TeamName = null);

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
    string? RunoffRaceName, bool UsesRaceFinals, int PriceMinor,
    int? MaxParticipants = null, int? FinalistCount = null,
    int ActiveSignupsCount = 0);
public record CreateSectionRequest(SectionFormat Format, string AgeGroup, string? DisplayName,
    string? RunoffRaceName = null, bool UsesRaceFinals = false, int PriceMinor = 0,
    int? MaxParticipants = null, [Range(1, 50)] int? FinalistCount = null);
public record UpdateSectionRequest(string? RunoffRaceName, bool? UsesRaceFinals = null, int? PriceMinor = null,
    int? MaxParticipants = null, [Range(1, 50)] int? FinalistCount = null);

public record SectionSignupDto(
    int Id, int CompetitionSectionId, string SectionName,
    string FullName, string? PonyClubName, string? ContactInfo,
    int AmountMinor, SignupPaymentStatus Status, DateTime? PaidAt,
    int? TeamId, DateTime CreatedAt,
    bool UseInitialOnly = false, bool NoFilming = false,
    bool TermsAccepted = false, DateTime? TermsAcceptedAt = null, string? TermsWordingVersion = null,
    string? ContactEmail = null, EmailDeliveryStatus ConfirmationEmailStatus = EmailDeliveryStatus.NotRequested,
    DateTime? ConfirmationEmailAt = null,
    string? TeamName = null, bool IsWholeTeam = false);

/// <param name="ContactInfo">Phone number (free text).</param>
/// <param name="AcceptTerms">The one required tick (parental consent plus the event terms).</param>
/// <param name="ConsentVersion">The wording version the page showed; the server refuses a stale one.</param>
/// <param name="ContactEmail">Optional address of the adult signing up; the entry confirmation goes here.</param>
/// <param name="EmailOptIn">The unticked-by-default box for new-competition emails. Needs a <paramref name="ContactEmail"/>.</param>
/// <param name="EmailOptInVersion">The wording version the page showed beside the box.</param>
/// <param name="RequestId">Made by the form for one submit, so a retry doesn't create a second entry or a second email.</param>
public record CreateSectionSignupRequest(
    string FullName, string? PonyClubName, string? ContactInfo,
    string? TeamCode = null, bool UseInitialOnly = false, bool NoFilming = false,
    bool AcceptTerms = false, string? ConsentVersion = null,
    [MaxLength(EmailAddresses.MaxLength)] string? ContactEmail = null,
    bool EmailOptIn = false, string? EmailOptInVersion = null,
    [MaxLength(64)] string? RequestId = null,
    [StringLength(200)] string? TeamName = null, bool WholeTeam = false);

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
    string? SupporterJoinKey = null,
    /// <summary>Withdrawn or no-show. Public on purpose; the reason is organiser-only.</summary>
    bool IsWithdrawn = false,
    string? BibDescription = null,
    /// <summary>Set only on the my-teams list: the viewer looks after this team, its event hasn't finished, and it has no dec form yet.</summary>
    bool? NeedsDeclaration = null);

public record CreateTeamRequest(
    int CompetitionSectionId, int ClubId, string Suffix,
    string? BibColour, string? TrainerUserId,
    bool IsHorsConcours = false,
    [StringLength(200)] string? BibDescription = null);

/// <summary>Omitted (null) fields stay as they are. An empty <c>TrainerUserId</c> or <c>BibDescription</c> clears it.</summary>
public record UpdateTeamRequest(
    string? Suffix = null,
    bool? IsHorsConcours = null,
    string? TrainerUserId = null,
    [StringLength(200)] string? BibDescription = null);

/// <summary>A trainer who can be put in charge of a team.</summary>
public record ClubTrainerDto(string UserId, string FullName);

public record SessionDto(
    int Id, int CompetitionId, int? CompetitionSectionId, string? SectionName,
    string Name, string? ArenaName,
    DateTime? ScheduledStart, DateTime? StartedAt, DateTime? FinishedAt,
    SessionStatus Status, int OrderIndex, string? Notes,
    bool IsBreak, int? DurationMinutes,
    SessionKind Kind, string? Location,
    string? StreamUrl, int? LanesPerHeat,
    int? MinutesPerHeat, bool RaceOrderAlternating,
    IReadOnlyList<HeatDto> Heats,
    LaneRotationMode LaneRotationMode = LaneRotationMode.MoveUp,
    int? QualifiersPerHeat = null);

public record UpdateSessionSettingsRequest(int? MinutesPerHeat, bool? RaceOrderAlternating,
    LaneRotationMode? LaneRotationMode = null, [Range(1, 20)] int? QualifiersPerHeat = null);

public record HeatAssignmentEntry(string Label, IReadOnlyList<int> TeamIds);
public record UpdateHeatAssignmentsRequest(IReadOnlyList<HeatAssignmentEntry> Assignments);

public record CreateSessionRequest(
    int? CompetitionSectionId, string Name, string? ArenaName,
    DateTime? ScheduledStart, int OrderIndex, string? Notes,
    bool IsBreak, int? DurationMinutes,
    SessionKind? Kind, string? Location);

public record UpdateSessionStatusRequest(SessionStatus Status);

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

/// <summary>When the scorer tapped Start/Stop, so a slow connection doesn't shift the race time.</summary>
public record RaceClockRequest(DateTime? At);

public record HeatEntryDto(int Id, int TeamId, string TeamName, string? BibColour, int LaneIndex);

public record ResultDto(int Id, int TeamId, string TeamName, int? Placing, bool Eliminated, int Points, bool IsSitOut = false);

public record CreateHeatRequest(
    string? Label, int OrderIndex,
    IReadOnlyList<int> TeamIds,
    IReadOnlyList<string> RaceNames);

/// <param name="Expected">
/// The results the scorer saw before scoring (empty when none). When set, the
/// save is refused with 409 if the race has since been scored differently,
/// e.g. by another phone while this one was offline.
/// </param>
public record SubmitRaceResultsRequest(
    IReadOnlyList<FinishingPlaceDto> Places,
    IReadOnlyList<FinishingPlaceDto>? Expected = null,
    string? Reason = null);
public record FinishingPlaceDto(int TeamId, int Place, bool Eliminated);

/// <param name="FinalTier">
/// 0 for a team in the A Final, 1 for the B Final, and so on; null when it isn't in a lettered
/// final (including every team in a section that has none). Rows are ordered by tier first.
/// </param>
public record StandingRow(
    int TeamId, string TeamName, string ClubName, string? BibColour,
    int TotalPoints, int RacesRun, int Wins, int Eliminations, int? FinalTier = null,
    bool Withdrawn = false);

public record DeclarationFormDto(
    int Id, int TeamId, string TeamName, int CompetitionId, string CompetitionName,
    string? SubmittedByUserId, string? SubmittedByName, string? SubmittedByPhone,
    DateTime SubmittedAt,
    string? Notes, bool IsLocked,
    IReadOnlyList<RiderEntryDto> Riders,
    string? BibDescription = null,
    string? TrainerName = null,
    DateTime? TermsAcceptedAt = null);

public record RiderEntryDto(
    int Id, int? SavedRiderId, string FullName, DateTime? DateOfBirth,
    string? HorseName, string? BibColour, bool IsCaptain, bool IsReserve, int OrderIndex,
    bool UseInitialOnly = false, bool NoFilming = false, bool IsGuestRider = false,
    decimal? PonyHeightHands = null);

/// <param name="AcceptTerms">The submitter ticked "I agree to the terms and conditions". A dec form is refused without it.</param>
/// <param name="TrainerName">The coach's name as typed; it defaults to the submitter's account name.</param>
/// <param name="TeamName">A new name for the team, or null to keep its name.</param>
public record SubmitDeclarationFormRequest(
    int TeamId, string? Notes, IReadOnlyList<RiderEntryInput> Riders, bool SaveToRoster,
    string? TrainerPhone,
    [StringLength(200)] string? BibDescription = null,
    bool AcceptTerms = false,
    [StringLength(200)] string? TrainerName = null,
    [StringLength(150)] string? TeamName = null);

/// <param name="PonyHeightHands">Hands as a decimal (13.2 is 13 hands 2 inches), between 5 and 20.</param>
public record RiderEntryInput(
    int? SavedRiderId, string FullName, DateTime? DateOfBirth,
    string? HorseName, string? BibColour, bool IsCaptain, bool IsReserve, int OrderIndex,
    bool UseInitialOnly = false, bool NoFilming = false, bool IsGuestRider = false,
    decimal? PonyHeightHands = null);

public record SavedRiderDto(
    int Id, int ClubId, string FullName, DateTime? DateOfBirth, string? HorseName, string? Notes,
    bool UseInitialOnly = false, bool NoFilming = false, decimal? PonyHeightHands = null);

public record ChatMessageDto(
    int Id, int CompetitionId, string? UserId, string AuthorName,
    string Body, ChatMessageType Type, string? Tag, DateTime CreatedAt, bool AdminOnly,
    string? RecipientUserId = null);

public record PostChatMessageRequest([StringLength(2000)] string Body, string? ReplyToUserId = null);

public record AnnouncementRequest(string Body, string? Tag);

public record TrainerNoteDto(
    int Id, string UserId, string? Title, string Body, DateTime CreatedAt, DateTime? UpdatedAt);

public record SaveTrainerNoteRequest(string? Title, string Body);

public record IpBlockDto(int Id, string IpAddress, string? Reason, string? CreatedByUserId, DateTime CreatedAt);
public record CreateIpBlockRequest(string IpAddress, string? Reason);

public record TeamSupporterDto(
    int Id, int TeamId, string TeamName,
    string UserId, string UserName, string? UserEmail,
    TeamSupporterStatus Status, DateTime CreatedAt);
public record JoinTeamRequest(string Key);
public record GenerateJoinKeyResponse(string Key);
public record SetTeamCodeRequest(string Code);

public record VapidPublicKeyResponse(string PublicKey);
public record PushSubscribeRequest(string Endpoint, string P256dh, string Auth);
public record SendTestPushRequest(string? Title, string? Body);

public record LiveStreamDto(
    int Id, int CompetitionId, string ArenaName, string AngleName, LiveStreamStatus Status,
    string? Caption, bool AudioMuted, bool HasAudio, DateTime StartedAt, int ViewerCount, int Generation);
public record LiveStreamsResponse(bool Enabled, IReadOnlyList<LiveStreamDto> Streams);
public record PublishRequest(string SdpOffer, string VideoMid, string? AudioMid = null);
public record StartStreamRequest(string ArenaName, string AngleName, string SdpOffer, string VideoMid,
    string? AudioMid = null, bool TakeOver = false) : PublishRequest(SdpOffer, VideoMid, AudioMid);
public record PublishResponse(int StreamId, int Attempt, string SdpAnswer);
public record ReadyRequest(int Attempt);
// JsonElement distinguishes an omitted caption (Undefined) from an explicit null.
public record UpdateStreamRequest
{
    public LiveStreamStatus? Status { get; init; }
    public bool? AudioMuted { get; init; }
    public System.Text.Json.JsonElement Caption { get; init; }
}
public record StreamUrlRequest(string? StreamUrl);
public record IceServer(object Urls,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Username = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Credential = null);
public record IceServersResponse(IReadOnlyList<IceServer> IceServers);
public record WatchStreamResponse(string WatchId, string SdpOffer, int Generation, IReadOnlyList<IceServer> IceServers);

// ---- Stream overlays ----

/// <summary>Overlay settings every viewer of a competition's video receives. <c>Look</c> is the web's own JSON.</summary>
public record StreamOverlayDto(
    string? BannerText, OverlayBannerStyle BannerStyle, IReadOnlyList<string> BannerArenas,
    OverlayMode StripMode, OverlayMode ScoreCardMode, int ScoreCardDelaySeconds, int ScoreCardSeconds,
    System.Text.Json.JsonElement Look, int Revision, DateTime? UpdatedAt, OverlayMode SponsorMode = OverlayMode.Auto);

/// <summary>Replaces the overlay settings. Send the revision you last saw; a newer one on the server returns 409.</summary>
public record UpdateStreamOverlayRequest(
    [StringLength(140)] string? BannerText,
    OverlayBannerStyle BannerStyle,
    IReadOnlyList<string>? BannerArenas,
    OverlayMode StripMode,
    OverlayMode ScoreCardMode,
    [Range(0, 30)] int ScoreCardDelaySeconds,
    [Range(3, 60)] int ScoreCardSeconds,
    System.Text.Json.JsonElement? Look,
    int? ExpectedRevision,
    OverlayMode SponsorMode = OverlayMode.Auto);

/// <summary>A producer's instruction for one race's score card: show it now, skip it, or change how it looks.</summary>
public record ScoreCardControlRequest(
    int HeatId,
    int RaceId,
    string Action,
    IReadOnlyList<int>? HiddenTeamIds,
    IReadOnlyDictionary<int, string>? Names,
    [Range(3, 60)] int? Seconds);

/// <summary>Sent to every viewer as <c>scoreCardControl</c>. Display only: results never change.</summary>
public record ScoreCardControlDto(
    int HeatId, int RaceId, string Action, IReadOnlyList<int> HiddenTeamIds,
    IReadOnlyDictionary<int, string> Names, int? Seconds);

/// <summary>A saved overlay look an organiser can apply to any of their events.</summary>
public record OverlayLookDto(int Id, string Name, System.Text.Json.JsonElement Look, bool Mine, DateTime UpdatedAt);

public record SaveOverlayLookRequest([Required, StringLength(60, MinimumLength = 1)] string Name, System.Text.Json.JsonElement Look);


/// <summary>A heat that includes a rider who opted out of close-up filming. Staff only: it names the rider.</summary>
public record FilmingOptOutDto(
    int HeatId, int SessionId, string SessionName, string? ArenaName, string HeatLabel,
    int TeamId, string TeamName, int Lane, string RiderName, bool IsReserve, bool HeatFinished,
    int SessionOrder, int HeatOrder);
