using MountedGames.Api.Entities;
using MountedGames.Api.Services.Email;
using System.ComponentModel.DataAnnotations;

namespace MountedGames.Api.Dtos;

public record ClubDto(int Id, string Name, string? Region, string? BibColour);

public record CreateClubRequest(string Name, string? Region = null, string? BibColour = null);

public record CompetitionSummary(
    int Id, string Name, string? Location, DateTime StartDate, DateTime? EndDate,
    bool IsActive, bool IsArchived, int SectionCount, int TeamCount, int SessionCount,
    int HeatedSessionCount = 0);

public record PickerLiveHeat(string? SectionName, string HeatLabel, string? ArenaName);
public record CompetitionPickerItem(
    int Id, string Name, DateTime StartDate, DateTime? EndDate, string Icon,
    string? Location, int AgeGroupCount, PickerLiveHeat? Live, bool IsDemo = false, bool EntriesOpen = false);
public record CompetitionPickerPage(IReadOnlyList<CompetitionPickerItem> Items, bool HasMore, IReadOnlyList<int>? Years = null, IReadOnlyList<string>? Locations = null);

/// <summary>How far an event is from where we think the viewer is, in whole miles. Never the viewer's position itself.</summary>
public record PickerDistance(int Id, int Miles);
/// <summary>
/// The upcoming list ordered for one viewer (<c>GET /api/competitions/picker/near-you</c>). <see cref="LocationKnown"/> says whether we could
/// place them; <see cref="Sort"/> is the order actually used (<c>nearest</c> or <c>soonest</c>).
/// </summary>
public record CompetitionNearYouPage(
    IReadOnlyList<CompetitionPickerItem> Items, bool HasMore, bool LocationKnown, string Sort, IReadOnlyList<PickerDistance> Distances);

public static class CompetitionFields
{
    public const int PostcodeMax = 12;
    public const int CompetitionNumberMax = 40;
    public const int LorryWhat3WordsMax = 120;
    public const int LorryDirectionsNoteMax = 1000;
    public const int PaymentLinkUrlMax = 500;

    /// <summary>Trimmed and upper-cased; blank becomes null.</summary>
    public static string? Postcode(string? value)
    {
        var t = value?.Trim().ToUpperInvariant();
        return string.IsNullOrEmpty(t) ? null : t;
    }

    /// <summary>Trimmed; blank becomes null.</summary>
    public static string? Trimmed(string? value)
    {
        var t = value?.Trim();
        return string.IsNullOrEmpty(t) ? null : t;
    }

    /// <summary>Validates that a non-blank payment link is a valid https:// URL within 500 characters.</summary>
    public static bool TryNormalisePaymentLinkUrl(string? value, out string? url)
    {
        var t = Trimmed(value);
        if (t is null)
        {
            url = null;
            return true;
        }
        if (t.Length <= PaymentLinkUrlMax
            && Uri.TryCreate(t, UriKind.Absolute, out var uri)
            && string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(uri.Host))
        {
            url = t;
            return true;
        }
        url = null;
        return false;
    }

    /// <summary>Returns the configured https:// payment link, or extracts one from free-text payment instructions.</summary>
    public static string? ResolvePaymentLinkUrl(string? paymentLinkUrl, string? paymentDestination)
    {
        if (TryNormalisePaymentLinkUrl(paymentLinkUrl, out var direct) && direct is not null)
            return direct;
        if (string.IsNullOrWhiteSpace(paymentDestination))
            return null;
        var match = System.Text.RegularExpressions.Regex.Match(
            paymentDestination,
            @"https://[^\s<>""')]+",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!match.Success)
            return null;
        var candidate = match.Value.TrimEnd('.', ',', ';', ':', ')', ']', '!', '?');
        return TryNormalisePaymentLinkUrl(candidate, out var extracted) ? extracted : null;
    }
}

public static class CompetitionTerms
{
    /// <summary>Plenty for a page or two of terms; stops the field being used as a file store.</summary>
    public const int MaxLength = 20000;
}

/// <summary>Icon ids a competition may use: three symbols, the UK and its nations, and every country's ISO 3166-1 alpha-2 code (plus Kosovo, xk). Must match <c>web/src/competition/countries.ts</c>.</summary>
public static class CompetitionIcons
{
    public const string Pattern = "^(flag|world|trophy|gb|gb-eng|gb-sct|gb-wls|gb-nir|ad|ae|af|ag|ai|al|am|ao|aq|ar|as|at|au|aw|ax|az|ba|bb|bd|be|bf|bg|bh|bi|bj|bl|bm|bn|bo|bq|br|bs|bt|bv|bw|by|bz|ca|cc|cd|cf|cg|ch|ci|ck|cl|cm|cn|co|cr|cu|cv|cw|cx|cy|cz|de|dj|dk|dm|do|dz|ec|ee|eg|eh|er|es|et|fi|fj|fk|fm|fo|fr|ga|gd|ge|gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|im|in|io|iq|ir|is|it|je|jm|jo|jp|ke|kg|kh|ki|km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mf|mg|mh|mk|ml|mm|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|my|mz|na|nc|ne|nf|ng|ni|nl|no|np|nr|nu|nz|om|pa|pe|pf|pg|ph|pk|pl|pm|pn|pr|ps|pt|pw|py|qa|re|ro|rs|ru|rw|sa|sb|sc|sd|se|sg|sh|si|sj|sk|sl|sm|sn|so|sr|ss|st|sv|sx|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tr|tt|tv|tw|tz|ua|ug|um|us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|xk|ye|yt|za|zm|zw)\\z";
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
    string? TermsText = null,
    PayoutsToDto? PayoutsTo = null,
    IReadOnlyList<string>? LaneHatbands = null,
    bool UseRefereeCards = false,
    string? Postcode = null,
    string? CompetitionNumber = null,
    string? ContactEmail = null,
    string? LorryWhat3Words = null,
    double? LorryLatitude = null,
    double? LorryLongitude = null,
    string? LorryDirectionsNote = null,
    string? PaymentLinkUrl = null,
    int? MaxStables = null,
    int? MaxHookups = null,
    int? StablesRemaining = null,
    int? HookupsRemaining = null);

public record CreateCompetitionRequest(
    string Name, string? Location, string? Description,
    double? Latitude, double? Longitude,
    string? What3Words, [MaxLength(500)] string? AppleMapsUrl,
    DateTime StartDate, DateTime? EndDate,
    [MaxLength(CompetitionFields.PostcodeMax)] string? Postcode = null,
    string? StreamUrl = null,
    string? OrganiserName = null,
    string? PaymentDestination = null,
    [RegularExpression(CompetitionIcons.Pattern)] string? Icon = null,
    [MaxLength(CompetitionTerms.MaxLength)] string? TermsText = null,
    IReadOnlyList<string>? LaneHatbands = null,
    bool UseRefereeCards = false,
    [MaxLength(CompetitionFields.CompetitionNumberMax)] string? CompetitionNumber = null,
    [MaxLength(EmailAddresses.MaxLength)] string? ContactEmail = null,
    [MaxLength(CompetitionFields.LorryWhat3WordsMax)] string? LorryWhat3Words = null,
    [Range(-90, 90)] double? LorryLatitude = null,
    [Range(-180, 180)] double? LorryLongitude = null,
    [MaxLength(CompetitionFields.LorryDirectionsNoteMax)] string? LorryDirectionsNote = null,
    [MaxLength(CompetitionFields.PaymentLinkUrlMax)] string? PaymentLinkUrl = null,
    [Range(0, 2000)] int? MaxStables = null,
    [Range(0, 2000)] int? MaxHookups = null);

public record UpdateCompetitionRequest(
    string Name, string? Location, string? Description,
    double? Latitude, double? Longitude,
    string? What3Words, [MaxLength(500)] string? AppleMapsUrl,
    DateTime StartDate, DateTime? EndDate,
    bool IsActive, bool IsArchived,
    [MaxLength(CompetitionFields.PostcodeMax)] string? Postcode = null,
    string? StreamUrl = null,
    string? OrganiserName = null,
    string? PaymentDestination = null,
    [RegularExpression(CompetitionIcons.Pattern)] string? Icon = null,
    [MaxLength(CompetitionTerms.MaxLength)] string? TermsText = null,
    /// <summary>Null leaves the hatbands as they are; an empty list clears them.</summary>
    IReadOnlyList<string>? LaneHatbands = null,
    bool? UseRefereeCards = null,
    /// <summary>On an update, null leaves these fields as they are and a blank value clears them.</summary>
    [MaxLength(CompetitionFields.CompetitionNumberMax)] string? CompetitionNumber = null,
    [MaxLength(EmailAddresses.MaxLength)] string? ContactEmail = null,
    [MaxLength(CompetitionFields.LorryWhat3WordsMax)] string? LorryWhat3Words = null,
    [Range(-90, 90)] double? LorryLatitude = null,
    [Range(-180, 180)] double? LorryLongitude = null,
    [MaxLength(CompetitionFields.LorryDirectionsNoteMax)] string? LorryDirectionsNote = null,
    [MaxLength(CompetitionFields.PaymentLinkUrlMax)] string? PaymentLinkUrl = null,
    [Range(0, 2000)] int? MaxStables = null,
    [Range(0, 2000)] int? MaxHookups = null);

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

/// <param name="BaseName">The team race a Pairs or Individual version replaces, or the race a sponsored name is ridden as (<see cref="Services.RaceVariants"/>).</param>
/// <param name="Format">Set on a Pairs or Individual version: the section format it is for.</param>
public record RaceTemplateDto(
    int Id, string Name, string? Summary, string? Rules, string? Category,
    string? DiagramJson, bool IsBuiltIn, string? BaseName = null, SectionFormat? Format = null);
public record UpsertRaceTemplateRequest(
    string Name, string? Summary, string? Rules, string? Category, string? DiagramJson);

/// <param name="HasFinal">Standard format only: the section ends with a finals session. Heat, heat, final has no separate final.</param>
/// <param name="CarryPointsIntoFinal">Standard format only: earlier points add to a finalist's final score in the standings.</param>
/// <param name="DoublePointsInFinal">Standard format only: final race points count double.</param>
public record CompetitionSectionDto(
    int Id, int CompetitionId, SectionFormat Format, string AgeGroup, string DisplayName,
    string? RunoffRaceName, bool UsesRaceFinals, int PriceMinor,
    int? MaxParticipants = null, int? FinalistCount = null,
    int ActiveSignupsCount = 0, TieBreakRule TieBreakRule = TieBreakRule.Countback,
    bool HasFinal = true, bool CarryPointsIntoFinal = false, bool DoublePointsInFinal = false);
public record CreateSectionRequest(SectionFormat Format, string AgeGroup, string? DisplayName,
    string? RunoffRaceName = null, bool UsesRaceFinals = false, int PriceMinor = 0,
    int? MaxParticipants = null, [Range(1, 50)] int? FinalistCount = null,
    [EnumDataType(typeof(TieBreakRule))] TieBreakRule TieBreakRule = TieBreakRule.Countback,
    bool HasFinal = true, bool CarryPointsIntoFinal = true, bool DoublePointsInFinal = false);
/// <param name="TieBreakRule">Omitted leaves the rule as it is.</param>
/// <param name="HasFinal">Omitted leaves it as it is. Can't be turned off once the section has a final.</param>
/// <param name="CarryPointsIntoFinal">Omitted leaves it as it is. Can be changed at any time: it only changes how standings add up.</param>
/// <param name="DoublePointsInFinal">Omitted leaves it as it is. Can't be changed once a final race has been scored.</param>
public record UpdateSectionRequest(string? RunoffRaceName, bool? UsesRaceFinals = null, int? PriceMinor = null,
    int? MaxParticipants = null, [Range(1, 50)] int? FinalistCount = null,
    [EnumDataType(typeof(TieBreakRule))] TieBreakRule? TieBreakRule = null,
    bool? HasFinal = null, bool? CarryPointsIntoFinal = null, bool? DoublePointsInFinal = null);

/// <summary>Teams level on points, best first: every active team in the age group on that total.</summary>
public record SetTieOrderRequest(IReadOnlyList<int> TeamIds);

public record SectionSignupDto(
    int Id, int CompetitionSectionId, string SectionName,
    string FullName, string? PonyClubName, string? ContactInfo,
    int AmountMinor, SignupPaymentStatus Status, DateTime? PaidAt,
    int? TeamId, DateTime CreatedAt,
    bool UseInitialOnly = false,
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
    string? TeamCode = null, bool UseInitialOnly = false,
    bool AcceptTerms = false, string? ConsentVersion = null,
    [MaxLength(EmailAddresses.MaxLength)] string? ContactEmail = null,
    bool EmailOptIn = false, string? EmailOptInVersion = null,
    [MaxLength(64)] string? RequestId = null,
    string? TeamName = null, bool WholeTeam = false,
    IReadOnlyList<string>? TeamMembers = null,
    [Range(0, 100)] int StablesCount = 0, [StringLength(200)] string? StablingClubOrTeam = null,
    [StringLength(20)] string? PaymentMethod = null, bool IsWaitlist = false, [Range(1, 20)] int TeamsCount = 1,
    [StringLength(40)] string? VehicleRegistration = null, [StringLength(500)] string? ArrivalNotes = null,
    [Range(0, 100)] int HookupsCount = 0);

public record UpdateSignupStatusRequest(SignupPaymentStatus Status);

public record ShopPostDto(
    int Id, string AuthorName, string? PonyClubName,
    string? AuthorUserId,
    string Title, string Body, int? PriceMinor, string? ContactInfo,
    string? ImageBase64,
    DateTime CreatedAt, bool IsDeleted,
    int CommentCount, int ReportCount);

public record CreateShopPostRequest(
    string Title, string? Body, int? PriceMinor,
    string? ContactInfo, string AuthorName, string? PonyClubName,
    string? ImageBase64, string? Description = null);

public record UpdateShopPostRequest(
    string? Title = null, string? Body = null, int? PriceMinor = null,
    string? ContactInfo = null, string? AuthorName = null, string? PonyClubName = null,
    string? ImageBase64 = null, string? Description = null);

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
    bool? NeedsDeclaration = null,
    string? RefereeCard = null,
    string? Flag = null);

public record CreateTeamRequest(
    int CompetitionSectionId, int ClubId, string Suffix,
    string? BibColour, string? TrainerUserId,
    bool IsHorsConcours = false,
    [StringLength(200)] string? BibDescription = null,
    [StringLength(20), RegularExpression(MountedGames.Api.Services.ResultStatuses.FlagPattern)] string? Flag = null);

/// <summary>Omitted (null) fields stay as they are. An empty <c>TrainerUserId</c> or <c>BibDescription</c> clears it.</summary>
public record UpdateTeamRequest(
    string? Suffix = null,
    bool? IsHorsConcours = null,
    string? TrainerUserId = null,
    [StringLength(200)] string? BibDescription = null,
    [StringLength(20), RegularExpression(MountedGames.Api.Services.ResultStatuses.FlagPattern)] string? Flag = null);

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
    int? QualifiersPerHeat = null,
    IReadOnlyList<string>? PlannedRaces = null,
    IReadOnlyDictionary<string, IReadOnlyList<string>>? PlannedFinalRaces = null,
    DateTime? ProvisionalUntil = null,
    DateTime? OfficialConfirmedAt = null);

public record ConfirmSessionOfficialRequest(
    bool ReopenQueries = false,
    [Range(1, 120)] int? ProvisionalMinutes = 15);

public record UpdateSessionSettingsRequest(int? MinutesPerHeat, bool? RaceOrderAlternating,
    LaneRotationMode? LaneRotationMode = null, [Range(1, 20)] int? QualifiersPerHeat = null);

public record HeatAssignmentEntry(string Label, IReadOnlyList<int> TeamIds);
public record UpdateHeatAssignmentsRequest(IReadOnlyList<HeatAssignmentEntry> Assignments);

public record CreateSessionRequest(
    int? CompetitionSectionId, string Name, string? ArenaName,
    DateTime? ScheduledStart, int OrderIndex, string? Notes,
    bool IsBreak, int? DurationMinutes,
    SessionKind? Kind, string? Location,
    [Range(1, 20)] int? LanesPerHeat = null, [Range(1, 180)] int? MinutesPerHeat = null,
    IReadOnlyList<string>? PlannedRaces = null,
    IReadOnlyDictionary<string, IReadOnlyList<string>>? PlannedFinalRaces = null);

/// <summary>
/// Null leaves a field as it is; an empty arena name clears the arena. <c>PlannedRaces</c> replaces the planned list
/// (an empty list clears it). Heat size and the planned races are structure: they are refused once the session has
/// started or any race in it is scored. <c>PlannedFinalRaces</c> (keys B to Z) does the same for the B, C... finals' own lists.
/// </summary>
public record UpdateSessionRequest([StringLength(120)] string? Name = null, [StringLength(80)] string? ArenaName = null, DateTime? ScheduledStart = null,
    [Range(1, 20)] int? LanesPerHeat = null, [Range(1, 180)] int? MinutesPerHeat = null, [Range(1, 1440)] int? DurationMinutes = null,
    IReadOnlyList<string>? PlannedRaces = null,
    IReadOnlyDictionary<string, IReadOnlyList<string>>? PlannedFinalRaces = null);

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
    string? Name,
    bool? LowestFinalFirst = true,
    int? ExistingSessionId = null);

public record ScaffoldFinalsRequest(
    int? CompetitionSectionId,
    IReadOnlyList<string> RaceNames,
    int LanesPerHeat,
    int NumHeats,
    string? Name,
    int? MinutesPerHeat,
    DateTime? ScheduledStart,
    bool? LowestFinalFirst = true,
    int? ExistingSessionId = null);

public record AutoTimetableRequest(
    int? RacesPerHeat,
    int? SessionsPerSection,
    int? LanesPerHeat,
    int? MinutesPerHeat,
    int? MinutesBetweenSessions,
    bool ReplaceExisting,
    IReadOnlyList<int>? SectionIds);

/// <param name="UnderReview">An open protest covers at least one of its races. Only the flag: never the protest itself.</param>
public record HeatDto(
    int Id, int SessionId, string? Label,
    int OrderIndex,
    int? DurationMinutes,
    DateTime? ScheduledStart,
    DateTime? StartedAt, DateTime? FinishedAt,
    int? RaceRoundId,
    RaceRoundStage RaceRoundStage,
    IReadOnlyList<HeatEntryDto> Entries,
    IReadOnlyList<RaceDto> Races,
    bool UnderReview = false);

public record UpdateHeatScheduledStartRequest(DateTime? ScheduledStart);
public record PopulateRaceFinalRequest(int TopN);
public record GenerateRaceFinalsRequest(
    IReadOnlyList<int> TeamIds,
    IReadOnlyList<string> RaceNames,
    int? LanesPerHeat,
    bool ReplaceExisting);

/// <param name="UnderReview">An open protest covers this race. Only the flag: never the reason, names or decision.</param>
public record RaceDto(
    int Id, int HeatId, string Name,
    int OrderIndex, bool IsComplete,
    DateTime? StartedAt, DateTime? FinishedAt,
    IReadOnlyList<ResultDto> Results,
    bool UnderReview = false);

public record UpdateHeatDurationRequest(int? DurationMinutes);

/// <summary>When the scorer tapped Start/Stop, so a slow connection doesn't shift the race time.</summary>
public record RaceClockRequest(DateTime? At);

public record HeatEntryDto(int Id, int TeamId, string TeamName, string? BibColour, int LaneIndex,
    string? RefereeCard = null, string? Flag = null, string? BibDescription = null, string? BibColourOverride = null);

public record SetBibOverrideRequest(string? BibColourOverride);

/// <summary>A result as everyone sees it. Status says why a team that did not finish (Eliminated is true) did not. The referee note is never here.</summary>
public record ResultDto(int Id, int TeamId, string TeamName, int? Placing, bool Eliminated, double Points, bool IsSitOut = false,
    ResultStatus Status = ResultStatus.Finished, string? RefereeCard = null, bool UnderReview = false);

public record CallMissingTeamRequest(int TeamId);

public record SetTeamCardRequest(string? Card, int? RaceId = null);

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
/// <summary>Status null means Eliminated when Eliminated is set. RefereeNote is private to staff (500 characters at most).</summary>
/// <param name="Points">Optional points for a finisher, in whole or half points (a dead heat, say); left out, the place decides.</param>
public record FinishingPlaceDto(int TeamId, int Place, bool Eliminated, ResultStatus? Status = null, string? RefereeNote = null, double? Points = null);

/// <param name="FinalTier">
/// 0 for a team in the A Final, 1 for the B Final, and so on; null when it isn't in a lettered
/// final (including every team in a section that has none). Rows are ordered by tier first.
/// </param>
/// <param name="TotalPoints">
/// What the row is ranked on: all the team's points, except for a finalist in a section that scores its final on its
/// own, where it is the final's points alone.
/// </param>
/// <param name="FinalPoints">Points scored in the team's final(s); null when the team is in no lettered final.</param>
/// <param name="EarlierPoints">Points scored before the final; null when the team is in no lettered final.</param>
/// <param name="Place">Shared place in this table (1, 2, 2, 4), as the age group's tie-break and any organiser order settle it.</param>
/// <param name="Joint">True when nothing separates this team from a neighbour, so they share <paramref name="Place"/>.</param>
public record StandingRow(
    int TeamId, string TeamName, string ClubName, string? BibColour,
    double TotalPoints, int RacesRun, int Wins, int Eliminations, int? FinalTier = null,
    bool Withdrawn = false, int BonusPoints = 0, string? RefereeCard = null,
    string? Flag = null, string? BibDescription = null,
    double? FinalPoints = null, double? EarlierPoints = null,
    [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? TieBreakReason = null,
    int? Place = null, bool Joint = false);

public record DeclarationFormDto(
    int Id, int TeamId, string TeamName, int CompetitionId, string CompetitionName,
    string? SubmittedByUserId, string? SubmittedByName, string? SubmittedByPhone,
    DateTime SubmittedAt,
    string? Notes, bool IsLocked,
    IReadOnlyList<RiderEntryDto> Riders,
    string? BibDescription = null,
    string? TrainerName = null,
    DateTime? TermsAcceptedAt = null,
    // The team name the entrant gave when entering, from the entries that formed this team; public like the team's own name.
    string? EntryTeamName = null,
    // How many riders on the form were flagged for a broken rule. Staff and the submitter only; 0 for everyone else.
    int FlagCount = 0,
    // The coach's phone number for this team. Staff and the submitter only.
    string? TrainerPhone = null);

public record SavedTeamDeclarationDto(
    int FormId,
    int TeamId,
    string TeamName,
    int ClubId,
    string ClubName,
    int CompetitionId,
    string CompetitionName,
    DateTime CompetitionStartDate,
    int SectionId,
    string SectionName,
    SectionFormat Format,
    string AgeGroup,
    DateTime SubmittedAt,
    DeclarationFormDto Form,
    IReadOnlyList<RiderEntryDto> Riders,
    string? EntryTeamName = null,
    string? BibDescription = null,
    string? TrainerName = null,
    string? TrainerPhone = null);

public record RiderEntryDto(
    int Id, int? SavedRiderId, string FullName, DateTime? DateOfBirth,
    string? HorseName, string? BibColour, bool IsCaptain, bool IsReserve, int OrderIndex,
    bool UseInitialOnly = false, bool IsGuestRider = false,
    decimal? PonyHeightHands = null,
    // Adaptive dec form. Personal data: filled only for staff and the submitting trainer, never on a public form.
    int? BirthYear = null, string? AgeGroup = null, decimal? WeightKg = null, string? PonyPassportNumber = null,
    int? PonyAge = null, string? MembershipNumber = null, string? EmergencyContactName = null,
    string? EmergencyContactPhone = null, string? MedicalNotes = null,
    IReadOnlyDictionary<string, string?>? CustomValues = null, IReadOnlyList<string>? Flags = null,
    string? PonyOwnerFullName = null);

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
    bool UseInitialOnly = false, bool IsGuestRider = false,
    decimal? PonyHeightHands = null,
    int? BirthYear = null, [StringLength(30)] string? AgeGroup = null, [Range(1, 400)] decimal? WeightKg = null,
    [StringLength(80)] string? PonyPassportNumber = null, [Range(0, 60)] int? PonyAge = null,
    [StringLength(60)] string? MembershipNumber = null, [StringLength(120)] string? EmergencyContactName = null,
    [StringLength(40)] string? EmergencyContactPhone = null, [StringLength(1000)] string? MedicalNotes = null,
    Dictionary<string, string?>? CustomValues = null,
    [StringLength(160)] string? PonyOwnerFullName = null);

public record SavedRiderDto(
    int Id, int ClubId, string FullName, DateTime? DateOfBirth, string? HorseName, string? Notes,
    bool UseInitialOnly = false, decimal? PonyHeightHands = null,
    string? PonyPassportNumber = null, string? PonyOwnerFullName = null);

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

public record StreamTelemetryRequest(
    double? BatteryLevel = null,
    bool? BatteryCharging = null,
    double? Zoom = null,
    double? MaxZoom = null,
    int? Fps = null,
    int? BitrateKbps = null,
    [StringLength(24)] string? Signal = null,
    bool? AudioMuted = null,
    bool? WindFilter = null,
    [StringLength(16)] string? QualityPreset = null,
    [StringLength(16)] string? CaptureResolution = null);

public record StreamTelemetryDto(
    int StreamId,
    string ArenaName,
    double? BatteryLevel,
    bool? BatteryCharging,
    double? Zoom,
    double? MaxZoom,
    int? Fps,
    int? BitrateKbps,
    string? Signal,
    bool? AudioMuted,
    bool? WindFilter,
    string? QualityPreset,
    string? CaptureResolution,
    DateTime UpdatedAt);

public record StreamCommandRequest(
    [Required, StringLength(40, MinimumLength = 1)] string Command,
    [StringLength(120)] string? Value = null);

public record StreamCommandDto(
    int StreamId,
    string ArenaName,
    string Command,
    string? Value,
    DateTime IssuedAt);

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

/// <summary>One place given at a prize-giving: the team, where it finished and its points (from the toplist).</summary>
public record PrizeGivingPlaceRequest(int TeamId, [Range(1, 99)] int Place, [Range(0, 100000)] double Points);

/// <summary>
/// An organiser's step through a prize-giving: <c>show</c> with every place given so far, in the order given (the last
/// is the one just read out), or <c>clear</c> to take it off the stream. <c>Champions</c> plays the winners' moment.
/// </summary>
public record PrizeGivingControlRequest(string Action, int? SectionId, IReadOnlyList<PrizeGivingPlaceRequest>? Places, bool Champions = false);

public record PrizeGivingPlaceDto(int TeamId, int Place, string TeamName, string? ClubName, double Points);

/// <summary>Sent to every viewer as <c>prizeGiving</c>. Names come from the event's teams, never from the request.</summary>
public record PrizeGivingDto(string Action, int? SectionId, string? SectionName, IReadOnlyList<PrizeGivingPlaceDto> Places, bool Champions);

/// <summary>A saved overlay look an organiser can apply to any of their events.</summary>
public record OverlayLookDto(int Id, string Name, System.Text.Json.JsonElement Look, bool Mine, DateTime UpdatedAt);

public record SaveOverlayLookRequest([Required, StringLength(60, MinimumLength = 1)] string Name, System.Text.Json.JsonElement Look);

