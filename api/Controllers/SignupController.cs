using MountedGames.Api.Services.Accounts;
using System.ComponentModel.DataAnnotations;
using System.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Security;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Controllers;

public record CreateSectionSignupInput(
    string FullName,
    [StringLength(150)] string? PonyClubName,
    string? ContactInfo,
    string? TeamCode = null,
    bool UseInitialOnly = false,
    bool NoFilming = false,
    bool AcceptTerms = false,
    string? ConsentVersion = null,
    [MaxLength(EmailAddresses.MaxLength)] string? ContactEmail = null,
    bool EmailOptIn = false,
    string? EmailOptInVersion = null,
    [MaxLength(64)] string? RequestId = null,
    [StringLength(200)] string? TeamName = null,
    bool WholeTeam = false,
    bool LookingForPair = false,
    bool LookingForGuestRiders = false,
    bool WaitingForGuestSpot = false,
    IReadOnlyList<string>? TeamMembers = null,
    [Range(0, 100)] int StablesCount = 0,
    [StringLength(200)] string? StablingClubOrTeam = null,
    [StringLength(20)] string? PaymentMethod = null,
    bool IsWaitlist = false,
    [Range(1, 20)] int TeamsCount = 1,
    [Range(0, 100_000_000)] int StableFeeMinor = 0,
    [Range(1, 30)] int? StablingNights = null,
    [StringLength(120)] string? RiderName = null,
    [StringLength(32)] string? RiderDateOfBirth = null,
    [StringLength(120)] string? PonyName = null,
    [StringLength(40)] string? VehicleRegistration = null,
    [StringLength(500)] string? ArrivalNotes = null,
    [Range(0, 100)] int HookupsCount = 0,
    [StringLength(40)] string? ArrivalWindow = null
);

public record SectionSignupExtendedDto(
    int Id, int CompetitionSectionId, string SectionName,
    string FullName, string? PonyClubName, string? ContactInfo,
    int AmountMinor, SignupPaymentStatus Status, DateTime? PaidAt,
    int? TeamId, DateTime CreatedAt,
    bool UseInitialOnly = false, bool NoFilming = false,
    bool TermsAccepted = false, DateTime? TermsAcceptedAt = null, string? TermsWordingVersion = null,
    string? ContactEmail = null, EmailDeliveryStatus ConfirmationEmailStatus = EmailDeliveryStatus.NotRequested,
    DateTime? ConfirmationEmailAt = null,
    string? TeamName = null, bool IsWholeTeam = false,
    bool LookingForPair = false, bool LookingForGuestRiders = false, bool WaitingForGuestSpot = false,
    int? PairRequestFromSignupId = null, int? PairRequestToSignupId = null, string? PairRequestStatus = null,
    int StablesCount = 0, string? StablingClubOrTeam = null,
    string? PaymentMethod = null,
    bool IsWaitlist = false, bool IsWithdrawn = false, bool RefundPending = false,
    int TeamsCount = 1,
    string? StableAssignment = null, string? HookupAssignment = null,
    string? VehicleRegistration = null, string? ArrivalNotes = null,
    int HookupsCount = 0,
    DateTime? LastReminderSentAt = null,
    string? ArrivalWindow = null,
    string FeeDisposition = "None",
    int? RefundedAmountMinor = null,
    string? DispositionNote = null,
    DateTime? DispositionUpdatedAt = null,
    DateTime? WaitlistOfferedAt = null,
    DateTime? WaitlistOfferExpiresAt = null
) : SectionSignupDto(
    Id, CompetitionSectionId, SectionName, FullName, PonyClubName, ContactInfo,
    AmountMinor, Status, PaidAt, TeamId, CreatedAt,
    UseInitialOnly, NoFilming, TermsAccepted, TermsAcceptedAt, TermsWordingVersion,
    ContactEmail, ConfirmationEmailStatus, ConfirmationEmailAt, TeamName, IsWholeTeam
);

public record SignupLinkedTeamDto(int Id, string Name);

public record MySignupExtendedDto(
    int Id, int CompetitionId, string CompetitionName,
    DateTime CompetitionStart,
    int CompetitionSectionId, string SectionName,
    string FullName, string? PonyClubName, string? ContactInfo,
    int AmountMinor, SignupPaymentStatus Status, DateTime? PaidAt,
    int? TeamId, string? TeamName, DateTime CreatedAt,
    bool LookingForPair = false, bool LookingForGuestRiders = false, bool WaitingForGuestSpot = false,
    int? PairRequestFromSignupId = null, string? PairRequestFromName = null, string? PairRequestFromClub = null,
    int? PairRequestToSignupId = null, string? PairRequestToName = null,
    string? PairRequestStatus = null, bool DeclarationAccessGranted = false,
    int StablesCount = 0, string? StablingClubOrTeam = null,
    string? PaymentMethod = null,
    bool IsWaitlist = false, bool IsWithdrawn = false, bool RefundPending = false,
    int TeamsCount = 1, bool DrawComplete = false, IReadOnlyList<SignupLinkedTeamDto>? LinkedTeams = null,
    string? StableAssignment = null, string? HookupAssignment = null,
    string? VehicleRegistration = null, string? ArrivalNotes = null,
    string? PaymentDestination = null, string? PaymentLinkUrl = null,
    DateTime? CompetitionEnd = null, string? CompetitionLocation = null,
    string? CompetitionPostcode = null, string? CompetitionWhat3Words = null,
    int HookupsCount = 0,
    string? ArrivalWindow = null,
    string FeeDisposition = "None",
    int? RefundedAmountMinor = null,
    string? DispositionNote = null,
    DateTime? DispositionUpdatedAt = null,
    DateTime? WaitlistOfferedAt = null,
    DateTime? WaitlistOfferExpiresAt = null
) : MySignupDto(
    Id, CompetitionId, CompetitionName, CompetitionStart, CompetitionSectionId, SectionName,
    FullName, PonyClubName, ContactInfo, AmountMinor, Status, PaidAt, TeamId, TeamName, CreatedAt
);

public record CompetitionEntrySettingsDto(
    int CompetitionId,
    DateTime? EntriesCloseAt,
    bool EntriesClosed,
    int? MaxStables = null,
    int? MaxHookups = null,
    int StablesBooked = 0,
    int HookupsBooked = 0,
    int? StablesRemaining = null,
    int? HookupsRemaining = null
);

public record UpdateEntrySettingsInput(
    DateTime? EntriesCloseAt = null,
    [Range(0, 2000)] int? MaxStables = null,
    [Range(0, 2000)] int? MaxHookups = null,
    bool ClearMaxStables = false,
    bool ClearMaxHookups = false
);

public record UpdateSignupStablingInput(
    [StringLength(120)] string? StableAssignment = null,
    [StringLength(120)] string? HookupAssignment = null,
    [StringLength(40)] string? VehicleRegistration = null,
    [StringLength(500)] string? ArrivalNotes = null
);

public record StablingBookingDto(
    int SignupId,
    int SectionId,
    string SectionName,
    string FullName,
    string PonyClubOrTeam,
    int StablesCount,
    SignupPaymentStatus Status,
    string? StableAssignment = null,
    string? HookupAssignment = null,
    string? VehicleRegistration = null,
    string? ArrivalNotes = null,
    int HookupsCount = 0,
    string? ArrivalWindow = null
);

public record StablingSummaryDto(
    int TotalStables,
    IReadOnlyList<StablingBookingDto> Bookings,
    int TotalHookups = 0,
    int? MaxStables = null,
    int? MaxHookups = null,
    int? StablesRemaining = null,
    int? HookupsRemaining = null
);

public record SendUnpaidRemindersInput(
    IReadOnlyList<int>? SignupIds,
    [StringLength(500)] string? CustomNote = null
);

public record SendUnpaidRemindersResultDto(
    int SentCount,
    int FailedCount,
    int SkippedCount,
    DateTime SentAt,
    IReadOnlyList<SectionSignupExtendedDto> Signups
);

public record UpdateSignupArrivalInput(
    [StringLength(40)] string? ArrivalWindow = null,
    [StringLength(40)] string? VehicleRegistration = null
);

public record ArrivalManifestEntryDto(
    int SignupId,
    int CompetitionSectionId,
    string SectionName,
    string FullName,
    string? PonyClubName,
    string? TeamName,
    int TeamsCount,
    int StablesCount,
    string? StablingClubOrTeam,
    string ArrivalWindow,
    string? VehicleRegistration,
    SignupPaymentStatus Status
);

public record ArrivalManifestDto(
    IReadOnlyList<ArrivalManifestEntryDto> FridayEvening,
    IReadOnlyList<ArrivalManifestEntryDto> SaturdayMorning,
    IReadOnlyList<ArrivalManifestEntryDto> Other
);

public record UpdateSignupDispositionInput(
    string FeeDisposition,
    [Range(0, 10_000_000)] int? RefundedAmountMinor = null,
    [StringLength(500)] string? DispositionNote = null
);

public record FeeDispositionLedgerSummaryDto(
    int TotalRetainedMinor,
    int TotalRefundedMinor,
    int RefundsPendingMinor,
    int CreditsRolledOverMinor,
    IReadOnlyList<SectionSignupExtendedDto> Rows
);

public record MarkClubPaidInput(
    [StringLength(150)] string? PonyClubName = null,
    IReadOnlyList<int>? SignupIds = null
);

public record MarkClubPaidResultDto(
    string PonyClubName,
    string ClubBacsReference,
    int MarkedPaidCount,
    int TotalAmountMinor,
    IReadOnlyList<SectionSignupExtendedDto> Signups
);

public record ClubInvoiceGroupDto(
    string ClubName,
    string ClubSlug,
    string ClubBacsReference,
    int SignupsCount,
    int TeamsCount,
    int StablesCount,
    int TotalAmountMinor,
    int TotalDueMinor,
    int TotalPaidMinor,
    IReadOnlyList<SectionSignupExtendedDto> Signups
);

public record MatchmakingEntryDto(
    int SignupId,
    int CompetitionSectionId,
    string SectionName,
    string FullName,
    string? PonyClubName,
    string? TeamName,
    bool LookingForPair,
    bool LookingForGuestRiders,
    bool WaitingForGuestSpot,
    int? TeamId,
    int? PairRequestFromSignupId,
    int? PairRequestToSignupId,
    string? PairRequestStatus,
    string? UserId
);

public record PairUpRequestInput(int TargetSignupId);
public record PairUpRespondInput(bool Accept);

[ApiController]
public class SignupController : ControllerBase
{
    private readonly AppDbContext _db;
    public SignupController(AppDbContext db) => _db = db;

    public static long CalculateStablingFeeMinor(int stablesCount, int feePerStableMinor, int? stablingNights = null)
    {
        if (stablesCount <= 0 || feePerStableMinor <= 0) return 0L;
        var nights = stablingNights is > 0 ? stablingNights.Value : 1;
        return (long)stablesCount * feePerStableMinor * nights;
    }

    private Task<Dictionary<int, SignupMatchmaking>> LoadMatchmakingMapAsync(IEnumerable<int> signupIds)
    {
        var ids = signupIds.Distinct().ToArray();
        return _db.Set<SignupMatchmaking>().Where(x => ids.Contains(x.SignupId)).ToDictionaryAsync(x => x.SignupId);
    }

    private Task<Dictionary<int, SignupExtras>> LoadExtrasMapAsync(IEnumerable<int> signupIds)
    {
        var ids = signupIds.Distinct().ToArray();
        return _db.Set<SignupExtras>().Where(x => ids.Contains(x.SignupId)).ToDictionaryAsync(x => x.SignupId);
    }

    private Task<DateTime?> GetEntriesCloseAtAsync(int competitionId) => _db.Set<CompetitionEntrySettings>()
        .Where(x => x.CompetitionId == competitionId).Select(x => x.EntriesCloseAt).SingleOrDefaultAsync();

    private async Task UpdateEntrySettingsRowAsync(int competitionId, UpdateEntrySettingsInput req)
    {
        var settings = await _db.Set<CompetitionEntrySettings>().FindAsync(competitionId);
        if (settings is null) { settings = new() { CompetitionId = competitionId }; _db.Add(settings); }
        var hasCapacityFields = req.MaxStables.HasValue || req.MaxHookups.HasValue || req.ClearMaxStables || req.ClearMaxHookups;
        if (req.EntriesCloseAt.HasValue || !hasCapacityFields)
        {
            settings.EntriesCloseAt = req.EntriesCloseAt is { Kind: DateTimeKind.Unspecified } value
                ? DateTime.SpecifyKind(value, DateTimeKind.Utc) : req.EntriesCloseAt?.ToUniversalTime();
        }
        if (req.MaxStables.HasValue || req.ClearMaxStables)
        {
            settings.MaxStables = req.ClearMaxStables || req.MaxStables <= 0 ? null : req.MaxStables;
        }
        if (req.MaxHookups.HasValue || req.ClearMaxHookups)
        {
            settings.MaxHookups = req.ClearMaxHookups || req.MaxHookups <= 0 ? null : req.MaxHookups;
        }
        await _db.SaveChangesAsync();
    }

    private Task<int> ActivePlacesAsync(int sectionId, int? exceptSignupId = null) => _db.SectionSignups
        .Where(s => s.CompetitionSectionId == sectionId && s.Id != exceptSignupId
            && (s.Status == SignupPaymentStatus.Paid || s.Status == SignupPaymentStatus.Pending)
            && !_db.Set<SignupMatchmaking>().Any(m => m.SignupId == s.Id && m.WaitingForGuestSpot)
            && !_db.Set<SignupExtras>().Any(x => x.SignupId == s.Id && (x.IsWithdrawn || x.IsWaitlist)))
        .SumAsync(s => _db.Set<SignupExtras>().Where(x => x.SignupId == s.Id).Select(x => (int?)x.TeamsCount).FirstOrDefault() ?? 1);

    private Task<T> InEntryTransactionAsync<T>(Func<Task<T>> action) =>
        _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            _db.ChangeTracker.Clear();
            await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var result = await action();
            await transaction.CommitAsync();
            return result;
        });

    private async Task SetMatchmakingAsync(int signupId, bool lookingForPair, bool lookingForGuestRiders, bool waitingForGuestSpot, int? fromId = null, int? toId = null, string? status = null)
    {
        var row = await _db.Set<SignupMatchmaking>().FindAsync(signupId);
        if (row is null)
        {
            row = new SignupMatchmaking { SignupId = signupId };
            _db.Add(row);
        }
        row.LookingForPair = lookingForPair;
        row.LookingForGuestRiders = lookingForGuestRiders;
        row.WaitingForGuestSpot = waitingForGuestSpot;
        row.PairRequestFromSignupId = fromId;
        row.PairRequestToSignupId = toId;
        row.PairRequestStatus = status;
    }

    private async Task ReleasePendingPairAsync(int signupId)
    {
        var requests = await _db.Set<SignupMatchmaking>()
            .Where(m => m.PairRequestStatus == "Pending"
                && (m.SignupId == signupId || m.PairRequestFromSignupId == signupId || m.PairRequestToSignupId == signupId))
            .ToListAsync();
        foreach (var request in requests)
        {
            request.PairRequestFromSignupId = null;
            request.PairRequestToSignupId = null;
            request.PairRequestStatus = null;
        }
    }

    private async Task GrantDeclarationAccessAsync(int signupId)
    {
        var meta = await _db.Set<SignupMatchmaking>().FindAsync(signupId);
        if (meta is null)
        {
            meta = new SignupMatchmaking { SignupId = signupId };
            _db.Add(meta);
        }
        meta.DeclarationAccessGranted = true;
    }

    private static readonly HashSet<string> ValidArrivalWindows = new(StringComparer.Ordinal)
    {
        "FridayEvening", "SaturdayMorning", "Other",
    };

    private static readonly HashSet<string> ValidFeeDispositions = new(StringComparer.Ordinal)
    {
        "None", "RefundPending", "Refunded", "Retained", "CreditRollover",
    };

    private static bool TryNormaliseArrivalWindow(string? raw, out string? arrivalWindow)
    {
        arrivalWindow = null;
        if (string.IsNullOrWhiteSpace(raw)) return true;
        var trimmed = raw.Trim();
        if (!ValidArrivalWindows.Contains(trimmed)) return false;
        arrivalWindow = trimmed;
        return true;
    }

    private static bool TryNormaliseVehicleReg(string? raw, out string? vehicleRegistration)
    {
        vehicleRegistration = null;
        if (string.IsNullOrWhiteSpace(raw)) return true;
        var trimmed = raw.Trim().ToUpperInvariant();
        if (trimmed.Length > 40) return false;
        vehicleRegistration = trimmed;
        return true;
    }

    public static string BuildClubSlug(string? ponyClubName)
    {
        var raw = (ponyClubName ?? string.Empty).Trim().ToUpperInvariant();
        var sb = new System.Text.StringBuilder();
        var lastHyphen = false;
        foreach (var ch in raw)
        {
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(ch);
                lastHyphen = false;
            }
            else if (sb.Length > 0 && !lastHyphen)
            {
                sb.Append('-');
                lastHyphen = true;
            }
        }
        var slug = sb.ToString().Trim('-');
        if (slug.Length > 16) slug = slug[..16].TrimEnd('-');
        return string.IsNullOrEmpty(slug) ? "CLUB" : slug;
    }

    public static string BuildClubBacsReference(int competitionId, string? ponyClubName)
        => $"MGC-{competitionId}-{BuildClubSlug(ponyClubName)}";

    private static string EffectiveDisposition(SignupExtras? ex, SignupPaymentStatus status)
    {
        if (ex is not null && !string.IsNullOrWhiteSpace(ex.FeeDisposition) && ex.FeeDisposition != "None")
            return ex.FeeDisposition;
        if (status == SignupPaymentStatus.Refunded) return "Refunded";
        if (ex?.RefundPending == true) return "RefundPending";
        return "None";
    }

    private static SectionSignupExtendedDto ToExtendedDto(SectionSignup s, SignupMatchmaking? m, SignupExtras? ex = null)
    {
        var b = s.ToDto();
        var disposition = EffectiveDisposition(ex, b.Status);
        return new SectionSignupExtendedDto(
            b.Id, b.CompetitionSectionId, b.SectionName, b.FullName, b.PonyClubName, b.ContactInfo,
            b.AmountMinor, b.Status, b.PaidAt, b.TeamId, b.CreatedAt,
            b.UseInitialOnly, b.NoFilming, b.TermsAccepted, b.TermsAcceptedAt, b.TermsWordingVersion,
            b.ContactEmail, b.ConfirmationEmailStatus, b.ConfirmationEmailAt,
            b.TeamName, b.IsWholeTeam,
            m?.LookingForPair == true, m?.LookingForGuestRiders == true, m?.WaitingForGuestSpot == true,
            m?.PairRequestFromSignupId, m?.PairRequestToSignupId, m?.PairRequestStatus,
            ex?.StablesCount ?? 0, ex?.StablingClubOrTeam,
            ex?.PaymentMethod,
            ex?.IsWaitlist == true, ex?.IsWithdrawn == true, ex?.RefundPending == true,
            ex?.TeamsCount > 0 ? ex.TeamsCount : 1,
            ex?.StableAssignment, ex?.HookupAssignment,
            ex?.VehicleRegistration, ex?.ArrivalNotes,
            ex?.HookupsCount ?? 0,
            ex?.LastReminderSentAt,
            ex?.ArrivalWindow,
            disposition,
            ex?.RefundedAmountMinor,
            ex?.DispositionNote,
            ex?.DispositionUpdatedAt,
            ex?.WaitlistOfferedAt,
            ex?.WaitlistOfferExpiresAt
        );
    }

    [HttpGet("api/competitions/{competitionId:int}/entry-settings")]
    [AllowAnonymous]
    public async Task<ActionResult<CompetitionEntrySettingsDto>> GetEntrySettings(int competitionId, [FromServices] TimeProvider clock)
    {
        var comp = await _db.Competitions.AsNoTracking().FirstOrDefaultAsync(c => c.Id == competitionId);
        if (comp is null) return NotFound();
        var closeAt = await GetEntriesCloseAtAsync(competitionId);
        var capacity = await VenueCapacity.GetCapacityAsync(_db, competitionId);
        var now = clock.GetUtcNow().UtcDateTime;
        var closed = comp.SignupsLocked || (closeAt.HasValue && closeAt.Value <= now);
        return new CompetitionEntrySettingsDto(
            competitionId,
            closeAt,
            closed,
            capacity.MaxStables,
            capacity.MaxHookups,
            capacity.StablesBooked,
            capacity.HookupsBooked,
            capacity.StablesRemaining,
            capacity.HookupsRemaining);
    }

    [HttpPut("api/competitions/{competitionId:int}/entry-settings")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<CompetitionEntrySettingsDto>> UpdateEntrySettings(
        int competitionId, UpdateEntrySettingsInput req, [FromServices] TimeProvider clock)
    {
        var comp = await _db.Competitions.AsNoTracking().FirstOrDefaultAsync(c => c.Id == competitionId);
        if (comp is null) return NotFound();
        await UpdateEntrySettingsRowAsync(competitionId, req);
        var closeAt = await GetEntriesCloseAtAsync(competitionId);
        var capacity = await VenueCapacity.GetCapacityAsync(_db, competitionId);
        var now = clock.GetUtcNow().UtcDateTime;
        var closed = comp.SignupsLocked || (closeAt.HasValue && closeAt.Value <= now);
        return new CompetitionEntrySettingsDto(
            competitionId,
            closeAt,
            closed,
            capacity.MaxStables,
            capacity.MaxHookups,
            capacity.StablesBooked,
            capacity.HookupsBooked,
            capacity.StablesRemaining,
            capacity.HookupsRemaining);
    }

    [HttpGet("api/competitions/{competitionId:int}/stabling")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<StablingSummaryDto>> GetStablingList(int competitionId)
    {
        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId
                && s.Status != SignupPaymentStatus.Cancelled
                && s.Status != SignupPaymentStatus.Refunded)
            .OrderBy(s => s.CreatedAt)
            .ToListAsync();
        var extras = await LoadExtrasMapAsync(rows.Select(r => r.Id));
        var bookings = new List<StablingBookingDto>();
        foreach (var r in rows)
        {
            if (!extras.TryGetValue(r.Id, out var ex) || ex.IsWithdrawn || ex.IsWaitlist) continue;
            if (ex.StablesCount <= 0
                && ex.HookupsCount <= 0
                && string.IsNullOrWhiteSpace(ex.StableAssignment)
                && string.IsNullOrWhiteSpace(ex.HookupAssignment)) continue;
            var clubOrTeam = (ex.StablingClubOrTeam ?? r.PonyClubName ?? r.TeamName ?? "Unaffiliated").Trim();
            if (string.IsNullOrEmpty(clubOrTeam)) clubOrTeam = "Unaffiliated";
            bookings.Add(new StablingBookingDto(
                r.Id,
                r.CompetitionSectionId,
                r.Section?.DisplayName ?? string.Empty,
                r.FullName,
                clubOrTeam,
                ex.StablesCount,
                r.Status,
                ex.StableAssignment,
                ex.HookupAssignment,
                ex.VehicleRegistration,
                ex.ArrivalNotes,
                ex.HookupsCount,
                ex.ArrivalWindow
            ));
        }
        var capacity = await VenueCapacity.GetCapacityAsync(_db, competitionId);
        return new StablingSummaryDto(
            bookings.Sum(b => b.StablesCount),
            bookings,
            bookings.Sum(b => b.HookupsCount),
            capacity.MaxStables,
            capacity.MaxHookups,
            capacity.StablesRemaining,
            capacity.HookupsRemaining);
    }

    [HttpPut("api/competitions/{competitionId:int}/signups/{signupId:int}/stabling")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SectionSignupExtendedDto>> UpdateSignupStabling(
        int competitionId, int signupId, UpdateSignupStablingInput req)
    {
        var signup = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstOrDefaultAsync(s => s.Id == signupId && s.Section!.CompetitionId == competitionId);
        if (signup is null) return NotFound();

        var ex = await _db.Set<SignupExtras>().FindAsync(signup.Id);
        if (ex is null)
        {
            ex = new SignupExtras { SignupId = signup.Id };
            _db.Add(ex);
        }

        if (req.StableAssignment is not null) ex.StableAssignment = CompetitionFields.Trimmed(req.StableAssignment);
        if (req.HookupAssignment is not null) ex.HookupAssignment = CompetitionFields.Trimmed(req.HookupAssignment);
        if (req.VehicleRegistration is not null) ex.VehicleRegistration = CompetitionFields.Postcode(req.VehicleRegistration);
        if (req.ArrivalNotes is not null) ex.ArrivalNotes = CompetitionFields.Trimmed(req.ArrivalNotes);

        await _db.SaveChangesAsync();
        var meta = await _db.Set<SignupMatchmaking>().FindAsync(signup.Id);
        return ToExtendedDto(signup, meta, ex);
    }

    /// <summary>
    /// Sign up to a comp section. The amount is captured from the section's
    /// price at signup time so it can't drift if the organiser later edits it.
    /// Payment integration is deferred — Status starts at Pending and an
    /// organiser flips it to Paid once funds land in their PaymentDestination.
    /// Entrants must be signed in; the public can't enter. Admins can enter too (for testing and for real club use).
    /// </summary>
    [EnableRateLimiting(RequestLimits.SignupPolicy)]
    [HttpPost("api/competitions/{competitionId:int}/sections/{sectionId:int}/signups")]
    [Authorize]
    public Task<ActionResult<SectionSignupExtendedDto>> Create(int competitionId, int sectionId, CreateSectionSignupInput req,
        [FromServices] SignupConfirmationService confirmation, [FromServices] EmailOptInService optIns, [FromServices] TimeProvider clock)
    {
        // Keep retries within this HTTP request idempotent even when the client did not supply a key.
        if (string.IsNullOrWhiteSpace(req.RequestId)) req = req with { RequestId = Guid.NewGuid().ToString("N") };
        return _db.Database.CreateExecutionStrategy().ExecuteAsync(() => CreateOnceAsync(competitionId, sectionId, req, confirmation, optIns, clock));
    }

    private async Task<ActionResult<SectionSignupExtendedDto>> CreateOnceAsync(int competitionId, int sectionId, CreateSectionSignupInput req,
        SignupConfirmationService confirmation, EmailOptInService optIns, TimeProvider clock)
    {
        _db.ChangeTracker.Clear();
        await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var section = await _db.CompetitionSections
            .Include(s => s.Competition)
            .Include(s => s.Signups)
            .FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == competitionId);
        if (section is null) return NotFound();

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var requestId = req.RequestId?.Trim();
        if (string.IsNullOrEmpty(requestId)) requestId = null;
        // A retry of the same submit gets the original entry back: no second entry and no second email.
        if (requestId is not null)
        {
            var replay = await FindReplayAsync(sectionId, userId, requestId);
            if (replay is not null)
            {
                var replayMeta = await LoadMatchmakingMapAsync(new[] { replay.Id });
                var replayExtras = await LoadExtrasMapAsync(new[] { replay.Id });
                return ToExtendedDto(replay, replayMeta.GetValueOrDefault(replay.Id), replayExtras.GetValueOrDefault(replay.Id));
            }
        }

        var isCompetitionOrganiser = User.IsInRole(Roles.Admin) || await _db.CanManageAsync(User, competitionId);
        var closeAt = await GetEntriesCloseAtAsync(competitionId);
        var nowUtc = clock.GetUtcNow().UtcDateTime;
        var entriesClosed = section.Competition?.SignupsLocked == true || (closeAt.HasValue && closeAt.Value <= nowUtc);
        if (entriesClosed && !isCompetitionOrganiser)
            return StatusCode(403, new { message = "Signups are closed for this competition." });

        var name = req.FullName?.Trim();
        if (string.IsNullOrEmpty(name)) return BadRequest(new { message = "Full name required." });
        if (name.Length > 120)
            return BadRequest(new { message = "Full name must be 120 characters or fewer." });
        if (req.PonyClubName?.Trim().Length > 150)
            return BadRequest(new { message = "Pony Club name must be 150 characters or fewer." });
        if (req.ContactInfo?.Trim().Length > 200)
            return BadRequest(new { message = "Contact info must be 200 characters or fewer." });
        if (req.TeamName?.Trim().Length > 120)
            return BadRequest(new { message = "Team name must be 120 characters or fewer." });
        if (req.TeamMembers is { Count: > 20 } || req.TeamMembers?.Any(m => m?.Trim().Length > 120) == true)
            return BadRequest(new { message = "Invalid team members." });
        if (!req.AcceptTerms)
            return BadRequest(new { message = "Please tick the box to confirm parental consent and that you accept the event terms." });
        if (req.ConsentVersion != SignupTerms.WordingVersion)
            return BadRequest(new { message = "The wording next to the tick box has changed. Please reload the page and read it again." });

        string? contactEmail = null;
        if (!string.IsNullOrWhiteSpace(req.ContactEmail))
        {
            if (!EmailAddresses.TryNormalise(req.ContactEmail, out var normalised))
                return BadRequest(new { message = "That email address doesn't look right. Please check it, or leave it blank." });
            contactEmail = normalised;
        }
        if (req.EmailOptIn && contactEmail is null)
            return BadRequest(new { message = "Add your email address if you'd like emails when new competitions open." });
        if (req.EmailOptIn && req.EmailOptInVersion != EmailOptInWording.Version)
            return BadRequest(new { message = "The wording next to the email box has changed. Please reload the page and read it again." });

        if (!TryNormaliseArrivalWindow(req.ArrivalWindow, out var arrivalWindow))
            return BadRequest(new { message = "Arrival window must be FridayEvening, SaturdayMorning, or Other." });
        if (!TryNormaliseVehicleReg(req.VehicleRegistration, out var vehicleRegistration))
            return BadRequest(new { message = "Vehicle registration must be 40 characters or fewer." });

        var teamsCount = req.WholeTeam ? req.TeamsCount : 1;
        var teamName = req.TeamName?.Trim();
        if (string.IsNullOrEmpty(teamName)) teamName = null;
        if (req.WholeTeam)
        {
            // A whole team is entered by someone who runs a team (Manager, Trainer, Admin, or Competition Organiser), in a team section.
            if (section.Format != SectionFormat.Teams)
                return BadRequest(new { message = "Only team sections take a whole-team entry." });
            var canWholeTeam = User.IsInRole(Roles.Manager)
                || User.IsInRole(Roles.Trainer)
                || User.IsInRole(Roles.Admin)
                || isCompetitionOrganiser;
            if (!canWholeTeam)
                return StatusCode(403, new { message = "Only a team manager or trainer can enter a whole team." });
            if (teamsCount > 1 && teamName is null)
            {
                var clubFallback = req.PonyClubName?.Trim();
                if (!string.IsNullOrEmpty(clubFallback)) teamName = clubFallback;
            }
            if (teamName is null)
                return BadRequest(new { message = "Give the team a name." });
        }

        if (req.LookingForPair && section.Format != SectionFormat.Pairs)
            return BadRequest(new { message = "Looking for a pair is only available in Pairs sections." });

        if (req.WaitingForGuestSpot && section.Format != SectionFormat.Teams)
            return BadRequest(new { message = "Waiting for a guest ride spot is only available in Teams sections." });

        if (req.WaitingForGuestSpot && (req.WholeTeam || req.LookingForGuestRiders || !string.IsNullOrWhiteSpace(req.TeamCode)))
            return BadRequest(new { message = "A guest waiting entry cannot also enter or join a team." });
        if (req.LookingForGuestRiders && !req.WholeTeam)
            return BadRequest(new { message = "Enter a whole team before looking for guest riders." });

        if (!req.WaitingForGuestSpot && !req.IsWaitlist && section.MaxParticipants.HasValue
            && (long)await ActivePlacesAsync(sectionId) + teamsCount > section.MaxParticipants.Value)
            return StatusCode(403, new { message = $"Section is full ({section.MaxParticipants} max)." });

        if (!req.WaitingForGuestSpot && !req.IsWaitlist && (req.StablesCount > 0 || req.HookupsCount > 0))
        {
            var capacity = await VenueCapacity.GetCapacityAsync(_db, competitionId);
            var capErr = VenueCapacity.CheckCapacityError(capacity, req.StablesCount, req.HookupsCount);
            if (capErr is not null)
                return Conflict(new { message = capErr });
        }

        if (await _db.IsIpBlockedAsync(HttpContext))
            return StatusCode(403, new { message = "Signups from this network are blocked." });

        // Optional team-code join: if the entrant supplies a code that matches
        // a team in this comp (case-insensitive), link the signup directly.
        int? teamId = null;
        var teamCode = req.TeamCode?.Trim();
        if (!string.IsNullOrEmpty(teamCode))
        {
            var lowered = teamCode.ToLower();
            var team = await _db.Teams
                .Where(t => t.CompetitionId == competitionId && t.CompetitionSectionId == sectionId
                    && t.SupporterJoinKey != null
                    && t.SupporterJoinKey.ToLower() == lowered)
                .Select(t => new { t.Id })
                .FirstOrDefaultAsync();
            if (team is not null) teamId = team.Id;
        }

        // Free entries (including "Wait for a Guest Ride Spot") are complete immediately.
        // Waitlist entries start at 0 amount and Pending until promoted.
        // "Looking for a Pair" pays 50% of the section price; standard entries pay 100% upfront (multiplied by teamsCount).
        var stablingFee = (req.WaitingForGuestSpot || req.IsWaitlist)
            ? 0L
            : CalculateStablingFeeMinor(req.StablesCount, req.StableFeeMinor, req.StablingNights);
        var amount = (req.WaitingForGuestSpot || req.IsWaitlist)
            ? 0L
            : (req.LookingForPair
                ? section.PriceMinor / 2
                : (long)section.PriceMinor * teamsCount) + stablingFee;
        if (amount > int.MaxValue) return BadRequest(new { message = "The total entry fee is too large." });
        var amountMinor = (int)amount;
        var isFree = amountMinor == 0 && !req.IsWaitlist;
        var signup = new SectionSignup
        {
            CompetitionSectionId = sectionId,
            UserId = userId,
            FullName = name.Length > 200 ? name[..200] : name,
            PonyClubName = req.PonyClubName?.Trim(),
            TeamName = teamName,
            IsWholeTeam = req.WholeTeam,
            ContactInfo = req.ContactInfo?.Trim(),
            ContactEmail = contactEmail,
            ClientRequestId = requestId,
            UseInitialOnly = req.UseInitialOnly,
            NoFilming = req.NoFilming,
            TermsAccepted = true,
            TermsAcceptedAt = DateTime.UtcNow,
            TermsAcceptedByUserId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
            TermsAcceptedByName = name.Length > 200 ? name[..200] : name,
            TermsWordingVersion = SignupTerms.VersionFor(section.Competition!),
            AmountMinor = amountMinor,
            TeamId = teamId,
            Status = isFree ? SignupPaymentStatus.Paid : SignupPaymentStatus.Pending,
            PaidAt = isFree ? DateTime.UtcNow : null,
        };
        _db.SectionSignups.Add(signup);
        if (req.LookingForPair || req.LookingForGuestRiders || req.WaitingForGuestSpot)
            _db.Add(new SignupMatchmaking
            {
                Signup = signup, LookingForPair = req.LookingForPair,
                LookingForGuestRiders = req.WholeTeam && req.LookingForGuestRiders,
                WaitingForGuestSpot = req.WaitingForGuestSpot,
            });

        // Consent is stored in the same save as the entry, so there is never an entry without its record or the reverse.
        var optIn = OptInOutcome.NotAsked;
        string? unsubscribeToken = null;
        if (req.EmailOptIn && contactEmail is not null)
        {
            var result = await optIns.AddAsync(contactEmail, EmailOptInWording.Version, EmailOptInWording.SignupSource);
            optIn = result.Joined ? OptInOutcome.Joined : OptInOutcome.AlreadyOnList;
            unsubscribeToken = result.UnsubscribeToken;
        }

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (requestId is not null)
        {
            // Two copies of the same submit arrived together; the other one won. Return its entry.
            await transaction.RollbackAsync();
            _db.ChangeTracker.Clear();
            var winner = await FindReplayAsync(sectionId, userId, requestId);
            if (winner is not null)
            {
                var winnerMeta = await LoadMatchmakingMapAsync(new[] { winner.Id });
                var winnerExtras = await LoadExtrasMapAsync(new[] { winner.Id });
                return ToExtendedDto(winner, winnerMeta.GetValueOrDefault(winner.Id), winnerExtras.GetValueOrDefault(winner.Id));
            }
            throw;
        }

        var stablingClub = req.StablingClubOrTeam?.Trim();
        _db.Add(new SignupExtras
        {
            SignupId = signup.Id,
            StablesCount = req.StablesCount,
            HookupsCount = req.HookupsCount,
            StablingClubOrTeam = string.IsNullOrEmpty(stablingClub) && (req.StablesCount > 0 || req.HookupsCount > 0)
                ? req.PonyClubName?.Trim() ?? teamName : stablingClub,
            PaymentMethod = req.PaymentMethod?.Trim(), IsWaitlist = req.IsWaitlist, TeamsCount = teamsCount,
            ArrivalWindow = arrivalWindow,
            VehicleRegistration = vehicleRegistration,
            ArrivalNotes = CompetitionFields.Trimmed(req.ArrivalNotes),
        });
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        // One confirmation, sent here and now (the API can be asleep a moment later). Whatever happens, the entry stays.
        if (contactEmail is not null)
        {
            var status = await confirmation.SendAsync(signup, section.Competition!, section, optIn, unsubscribeToken);
            try
            {
                signup.ConfirmationEmailStatus = status;
                signup.ConfirmationEmailAt = clock.GetUtcNow().UtcDateTime;
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // The entry is already saved; only the note about the email is lost.
            }
        }

        var loaded = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstAsync(s => s.Id == signup.Id);
        var meta = await LoadMatchmakingMapAsync(new[] { loaded.Id });
        var extras = await LoadExtrasMapAsync(new[] { loaded.Id });
        return ToExtendedDto(loaded, meta.GetValueOrDefault(loaded.Id), extras.GetValueOrDefault(loaded.Id));
    }

    private Task<SectionSignup?> FindReplayAsync(int sectionId, string? userId, string requestId)
        => _db.SectionSignups.Include(s => s.Section).AsNoTracking()
            .FirstOrDefaultAsync(s => s.CompetitionSectionId == sectionId && s.UserId == userId && s.ClientRequestId == requestId);

    /// <summary>Contact and payment details are restricted to the competition organiser.</summary>
    [HttpGet("api/competitions/{competitionId:int}/signups")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IEnumerable<SectionSignupExtendedDto>> List(int competitionId)
    {
        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
        var ids = rows.Select(r => r.Id).ToList();
        var meta = await LoadMatchmakingMapAsync(ids);
        var extras = await LoadExtrasMapAsync(ids);
        return rows.Select(r => ToExtendedDto(r, meta.GetValueOrDefault(r.Id), extras.GetValueOrDefault(r.Id)));
    }

    /// <summary>Organiser/admin marks a signup as paid (e.g. after receiving a BACS bank transfer) and triggers FormTeams.</summary>
    [HttpPost("api/competitions/{competitionId:int}/signups/{signupId:int}/mark-paid")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<SectionSignupExtendedDto>> MarkPaid(int competitionId, int signupId) =>
        InEntryTransactionAsync(() => MarkPaidOnceAsync(competitionId, signupId));

    private async Task<ActionResult<SectionSignupExtendedDto>> MarkPaidOnceAsync(int competitionId, int signupId)
    {
        var signup = await _db.SectionSignups.Include(s => s.Section)
            .FirstOrDefaultAsync(s => s.Id == signupId && s.Section!.CompetitionId == competitionId);
        if (signup is null) return NotFound();
        if (await _db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == competitionId && x.IsDemo)
            || await _db.Set<TestPaymentRecord>().AnyAsync(x => x.Target == TestPaymentTarget.SectionSignup && x.TargetId == signupId))
            return Conflict(new { message = "Demo entry payments can only be changed through the labelled test checkout." });
        var ex = await _db.Set<SignupExtras>().FindAsync(signup.Id);
        var meta = await _db.Set<SignupMatchmaking>().FindAsync(signup.Id);
        if (signup.Status is SignupPaymentStatus.Cancelled or SignupPaymentStatus.Refunded || ex?.IsWithdrawn == true)
            return Conflict(new { message = "A cancelled or withdrawn entry cannot be marked paid. Create a new entry instead." });
        if (ex?.IsWaitlist == true)
        {
            if (signup.Section!.MaxParticipants is int cap && meta?.WaitingForGuestSpot != true
                && (long)await ActivePlacesAsync(signup.CompetitionSectionId, signup.Id) + ex.TeamsCount > cap)
                return Conflict(new { message = "There is no space to promote this waitlist entry yet." });
            if (meta?.WaitingForGuestSpot != true && (ex.StablesCount > 0 || ex.HookupsCount > 0))
            {
                var capacity = await VenueCapacity.GetCapacityAsync(_db, competitionId, excludeSignupId: signup.Id);
                var capErr = VenueCapacity.CheckCapacityError(capacity, ex.StablesCount, ex.HookupsCount);
                if (capErr is not null)
                    return Conflict(new { message = capErr });
            }
            var amount = meta?.WaitingForGuestSpot == true ? 0L : meta?.LookingForPair == true
                ? signup.Section!.PriceMinor / 2 : (long)signup.Section!.PriceMinor * ex.TeamsCount;
            if (amount > int.MaxValue) return BadRequest(new { message = "The total entry fee is too large." });
            signup.AmountMinor = (int)amount;
            ex.IsWaitlist = false;
        }
        if (signup.Status != SignupPaymentStatus.Paid)
        {
            signup.Status = SignupPaymentStatus.Paid;
            signup.PaidAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        // Payment only forms this entrant's team. Pair seekers keep their explicit mutual-selection flow.
        if (meta?.LookingForPair != true && meta?.WaitingForGuestSpot != true)
            await FormTeamsCoreAsync(competitionId, signup.CompetitionSectionId,
                new FormTeamsFromSignupsRequest(null, Preview: false, ReplaceExisting: false), signup.Id);
        return ToExtendedDto(signup, await _db.Set<SignupMatchmaking>().FindAsync(signup.Id), ex);
    }

    /// <summary>Public matchmaking listings for a competition: solo riders looking for a pair, whole teams looking for guest riders, and riders waiting for a guest ride spot.</summary>
    [HttpGet("api/competitions/{competitionId:int}/matchmaking")]
    [AllowAnonymous]
    public async Task<ActionResult<IEnumerable<MatchmakingEntryDto>>> Matchmaking(int competitionId)
    {
        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId
                && (s.Status == SignupPaymentStatus.Paid || s.Status == SignupPaymentStatus.Pending)
                && !_db.Set<SignupExtras>().Any(x => x.SignupId == s.Id && (x.IsWithdrawn || x.IsWaitlist)))
            .OrderBy(s => s.CreatedAt)
            .ToListAsync();
        var meta = await LoadMatchmakingMapAsync(rows.Select(r => r.Id));
        var list = new List<MatchmakingEntryDto>();
        foreach (var r in rows)
        {
            if (!meta.TryGetValue(r.Id, out var m)) continue;
            if (m.LookingForPair != true && m.LookingForGuestRiders != true && m.WaitingForGuestSpot != true) continue;
            list.Add(new MatchmakingEntryDto(
                r.Id,
                r.CompetitionSectionId,
                r.Section?.DisplayName ?? string.Empty,
                RiderNames.Display(r.FullName, r.UseInitialOnly, false),
                r.PonyClubName,
                r.TeamName,
                m.LookingForPair == true,
                m.LookingForGuestRiders == true,
                m.WaitingForGuestSpot == true,
                r.TeamId,
                m.PairRequestFromSignupId,
                m.PairRequestToSignupId,
                m.PairRequestStatus,
                null
            ));
        }
        return list;
    }

    /// <summary>Organiser (trainer or admin) marks a signup paid / refunded / cancelled.</summary>
    [HttpPut("api/signups/{id:int}/status")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id", CompetitionResource.Signup)]
    public Task<ActionResult<SectionSignupDto>> UpdateStatus(int id, UpdateSignupStatusRequest req) =>
        InEntryTransactionAsync(() => UpdateStatusOnceAsync(id, req));

    private async Task<ActionResult<SectionSignupDto>> UpdateStatusOnceAsync(int id, UpdateSignupStatusRequest req)
    {
        var signup = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (signup is null) return NotFound();
        var isDemo = await _db.Set<EventCommerceSettings>()
            .AnyAsync(x => x.CompetitionId == signup.Section!.CompetitionId && x.IsDemo);
        var hasTestPayment = await _db.Set<TestPaymentRecord>()
            .AnyAsync(x => x.Target == TestPaymentTarget.SectionSignup && x.TargetId == id);
        if (isDemo || hasTestPayment)
            return Conflict(new { message = "Demo entry payments can only be changed through the labelled test checkout." });
        if (!Enum.IsDefined(req.Status)) return BadRequest(new { message = "Invalid payment status." });
        var extras = await _db.Set<SignupExtras>().FindAsync(signup.Id);
        if (req.Status is SignupPaymentStatus.Paid or SignupPaymentStatus.Pending
            && extras?.IsWithdrawn == true)
            return Conflict(new { message = "A cancelled or withdrawn entry cannot be reopened. Create a new entry instead." });
        if (req.Status == SignupPaymentStatus.Paid && extras?.IsWaitlist == true)
            return Conflict(new { message = "Use Mark paid to promote a waitlist entry when space is available." });
        if (req.Status is SignupPaymentStatus.Paid or SignupPaymentStatus.Pending
        if (req.Status is SignupPaymentStatus.Paid or SignupPaymentStatus.Pending
            && signup.Status is SignupPaymentStatus.Cancelled or SignupPaymentStatus.Refunded)
        {
            var isGuestWait = await _db.Set<SignupMatchmaking>().AnyAsync(m => m.SignupId == signup.Id && m.WaitingForGuestSpot);
            if (signup.Section!.MaxParticipants is int cap
                && !isGuestWait
                && (long)await ActivePlacesAsync(signup.CompetitionSectionId, signup.Id) + (extras?.TeamsCount ?? 1) > cap)
                return Conflict(new { message = "There is no space to reopen this entry yet." });
            if (!isGuestWait && extras is { IsWaitlist: false } && (extras.StablesCount > 0 || extras.HookupsCount > 0))
            {
                var capacity = await VenueCapacity.GetCapacityAsync(_db, signup.Section!.CompetitionId, excludeSignupId: signup.Id);
                var capErr = VenueCapacity.CheckCapacityError(capacity, extras.StablesCount, extras.HookupsCount);
                if (capErr is not null)
                    return Conflict(new { message = capErr });
            }
        }
        if (req.Status == SignupPaymentStatus.Refunded && extras is not null)
        {
            extras.RefundPending = false;
            extras.FeeDisposition = "Refunded";
            extras.RefundedAmountMinor ??= signup.AmountMinor;
            extras.DispositionUpdatedAt = DateTime.UtcNow;
        }
        signup.Status = req.Status;
        if (req.Status is SignupPaymentStatus.Cancelled or SignupPaymentStatus.Refunded)
            await ReleasePendingPairAsync(signup.Id);
        signup.PaidAt = req.Status == SignupPaymentStatus.Paid ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync();
        return signup.ToDto();
    }

    [HttpDelete("api/signups/{id:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id", CompetitionResource.Signup)]
    public async Task<IActionResult> Delete(int id)
    {
        var signup = await _db.SectionSignups.FindAsync(id);
        if (signup is null) return NotFound();
        var hasTestPayment = await _db.Set<TestPaymentRecord>()
            .AnyAsync(x => x.Target == TestPaymentTarget.SectionSignup && x.TargetId == id);
        if (hasTestPayment || (signup.AmountMinor > 0 &&
                signup.Status is SignupPaymentStatus.Paid or SignupPaymentStatus.Refunded))
            return Conflict(new { message = "This signup has payment history and must be kept for the audit record." });
        await ReleasePendingPairAsync(signup.Id);
        if (signup.AmountMinor > 0)
        {
            signup.Status = SignupPaymentStatus.Cancelled;
            signup.PaidAt = null;
            await _db.SaveChangesAsync();
            return NoContent();
        }
        _db.SectionSignups.Remove(signup);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Returns the calling user's own signups across every competition.
    /// Powers the /me/signups page so a logged-in person can see "what
    /// have I signed up to and have I paid yet".
    /// </summary>
    [HttpGet("api/me/signups")]
    [Authorize]
    public async Task<ActionResult<IEnumerable<MySignupExtendedDto>>> MySignups()
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        var rows = await _db.SectionSignups
            .Include(s => s.Section).ThenInclude(sec => sec!.Competition)
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
        return await BuildMySignupDtosAsync(rows);
    }

    private async Task<List<MySignupExtendedDto>> BuildMySignupDtosAsync(List<SectionSignup> rows)
    {
        var signupIds = rows.Select(r => r.Id).ToArray();
        var links = await _db.Set<SignupTeamLink>().Where(x => signupIds.Contains(x.SignupId)).ToListAsync();
        var teamIds = rows.Where(r => r.TeamId.HasValue).Select(r => r.TeamId!.Value).Concat(links.Select(x => x.TeamId)).Distinct().ToList();
        var teams = teamIds.Count == 0
            ? new Dictionary<int, Team>()
            : await _db.Teams.Where(t => teamIds.Contains(t.Id))
                .ToDictionaryAsync(t => t.Id, t => t);
        var ids = rows.Select(r => r.Id).ToList();
        var meta = await LoadMatchmakingMapAsync(ids);
        var extras = await LoadExtrasMapAsync(ids);
        var compIds = rows.Select(r => r.Section?.CompetitionId ?? 0).Where(id => id > 0).Distinct().ToList();
        var drawnSections = await _db.Heats.AsNoTracking()
            .Where(h => compIds.Contains(h.Session!.CompetitionId) && h.Entries.Count > 0)
            .Select(h => new { h.Session!.CompetitionId, h.Session.CompetitionSectionId }).Distinct().ToListAsync();

        var otherSignupIds = meta.Values
            .SelectMany(m => new[] { m.PairRequestFromSignupId, m.PairRequestToSignupId })
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();
        var otherSignups = otherSignupIds.Count == 0
            ? new Dictionary<int, SectionSignup>()
            : await _db.SectionSignups.AsNoTracking()
                .Where(s => otherSignupIds.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id, s => s);

        return rows.Select(r =>
        {
            var baseDto = r.ToMyDto(r.TeamId.HasValue && teams.TryGetValue(r.TeamId.Value, out var t) ? t : null);
            meta.TryGetValue(r.Id, out var m);
            extras.TryGetValue(r.Id, out var ex);
            SectionSignup? fromSignup = m?.PairRequestFromSignupId is { } fid && otherSignups.TryGetValue(fid, out var fs) ? fs : null;
            SectionSignup? toSignup = m?.PairRequestToSignupId is { } tid && otherSignups.TryGetValue(tid, out var ts) ? ts : null;
            return new MySignupExtendedDto(
                baseDto.Id, baseDto.CompetitionId, baseDto.CompetitionName, baseDto.CompetitionStart,
                baseDto.CompetitionSectionId, baseDto.SectionName,
                baseDto.FullName, baseDto.PonyClubName, baseDto.ContactInfo,
                baseDto.AmountMinor, baseDto.Status, baseDto.PaidAt,
                baseDto.TeamId, baseDto.TeamName, baseDto.CreatedAt,
                m?.LookingForPair == true, m?.LookingForGuestRiders == true, m?.WaitingForGuestSpot == true,
                m?.PairRequestFromSignupId, fromSignup is null ? null : RiderNames.Display(fromSignup.FullName, fromSignup.UseInitialOnly, false), fromSignup?.PonyClubName,
                m?.PairRequestToSignupId, toSignup is null ? null : RiderNames.Display(toSignup.FullName, toSignup.UseInitialOnly, false),
                m?.PairRequestStatus, m?.DeclarationAccessGranted == true,
                ex?.StablesCount ?? 0, ex?.StablingClubOrTeam,
                ex?.PaymentMethod,
                ex?.IsWaitlist == true, ex?.IsWithdrawn == true, ex?.RefundPending == true,
                ex?.TeamsCount > 0 ? ex.TeamsCount : 1,
                drawnSections.Any(x => x.CompetitionId == baseDto.CompetitionId
                    && (x.CompetitionSectionId == null || x.CompetitionSectionId == r.CompetitionSectionId)),
                links.Where(x => x.SignupId == r.Id).Select(x => x.TeamId)
                    .Concat(r.TeamId is int primary ? new[] { primary } : Array.Empty<int>()).Distinct()
                    .Where(id => teams.TryGetValue(id, out var linked) && linked.CompetitionSectionId == r.CompetitionSectionId)
                    .Select(id => new SignupLinkedTeamDto(id, teams[id].DisplayName)).ToList(),
                ex?.StableAssignment, ex?.HookupAssignment,
                ex?.VehicleRegistration, ex?.ArrivalNotes,
                r.Section?.Competition?.PaymentDestination,
                CompetitionFields.ResolvePaymentLinkUrl(r.Section?.Competition?.PaymentLinkUrl, r.Section?.Competition?.PaymentDestination),
                r.Section?.Competition?.EndDate, r.Section?.Competition?.Location,
                r.Section?.Competition?.Postcode, r.Section?.Competition?.What3Words,
                ex?.HookupsCount ?? 0,
                ex?.ArrivalWindow,
                EffectiveDisposition(ex, baseDto.Status),
                ex?.RefundedAmountMinor,
                ex?.DispositionNote,
                ex?.DispositionUpdatedAt,
                ex?.WaitlistOfferedAt,
                ex?.WaitlistOfferExpiresAt
            );
        }).ToList();
    }

    /// <summary>The 409 for a withdrawal after the draw. The web matches on <c>code</c>, so keep it as it is.</summary>
    internal static readonly object DrawHappened = new { code = "draw-happened", message = "You can’t withdraw once the draw has happened." };

    /// <summary>
    /// Allows an entrant to withdraw their own signup before the draw is made, freeing up their spot in
    /// MaxParticipants, detaching/removing any un-drawn team, and flagging the signup as "Withdrawn — refund pending".
    /// </summary>
    [HttpPost("api/my/signups/{signupId:int}/withdraw")]
    [Authorize]
    public Task<ActionResult<MySignupExtendedDto>> WithdrawMySignup(int signupId) =>
        InEntryTransactionAsync(() => WithdrawMySignupOnceAsync(signupId));

    private async Task<ActionResult<MySignupExtendedDto>> WithdrawMySignupOnceAsync(int signupId)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var mySignup = await _db.SectionSignups
            .Include(s => s.Section).ThenInclude(sec => sec!.Competition)
            .FirstOrDefaultAsync(s => s.Id == signupId);
        if (mySignup is null) return NotFound();
        if (mySignup.UserId != userId && !User.IsInRole(Roles.Admin)) return Forbid();

        var compId = mySignup.Section?.CompetitionId ?? 0;
        var drawAlreadyMade = await _db.Heats.AnyAsync(h =>
            h.Session!.CompetitionId == compId
            && (h.Session.CompetitionSectionId == null || h.Session.CompetitionSectionId == mySignup.CompetitionSectionId)
            && h.Entries.Count > 0);
        if (drawAlreadyMade)
            return Conflict(DrawHappened);

        var ex = await _db.Set<SignupExtras>().FindAsync(mySignup.Id);
        if (ex?.IsWithdrawn == true)
            return (await BuildMySignupDtosAsync(new List<SectionSignup> { mySignup })).Single();
        if (mySignup.Status is SignupPaymentStatus.Cancelled or SignupPaymentStatus.Refunded)
            return Conflict(new { message = "This entry is no longer active." });
        var links = await _db.Set<SignupTeamLink>().Where(x => x.SignupId == mySignup.Id).ToListAsync();
        var meta = await _db.Set<SignupMatchmaking>().FindAsync(mySignup.Id);
        // A public supporter code only associates an entry; it does not confer control of that team.
        var teamIds = meta?.DeclarationAccessGranted == true
            ? links.Select(x => x.TeamId).Concat(mySignup.TeamId is int primary ? new[] { primary } : Array.Empty<int>()).Distinct().ToArray()
            : Array.Empty<int>();
        var teams = await _db.Teams.Include(t => t.HeatEntries).Include(t => t.DeclarationForms)
            .Where(t => teamIds.Contains(t.Id) && t.CompetitionSectionId == mySignup.CompetitionSectionId).ToListAsync();
        if (teams.Any(t => t.HeatEntries.Count > 0))
            return Conflict(DrawHappened);
        var needsRefund = mySignup.Status == SignupPaymentStatus.Paid && mySignup.AmountMinor > 0;
        mySignup.TeamId = null;
        _db.RemoveRange(links);
        foreach (var team in teams)
        {
            var shared = await _db.SectionSignups.AnyAsync(s => s.Id != mySignup.Id
                && (s.Status == SignupPaymentStatus.Pending || s.Status == SignupPaymentStatus.Paid)
                && (s.TeamId == team.Id || _db.Set<SignupTeamLink>().Any(l => l.SignupId == s.Id && l.TeamId == team.Id)));
            if (shared) continue;
            if (team.DeclarationForms.Count == 0) _db.Teams.Remove(team);
            else
            {
                team.EntryStatus = TeamEntryStatus.Withdrawn;
                _db.Add(new TeamStatusEvent
                {
                    CompetitionId = compId, TeamId = team.Id, Status = TeamEntryStatus.Withdrawn,
                    ActorUserId = userId, Reason = "Entry withdrawn by the entrant before the draw.",
                });
            }
        }
        await ReleasePendingPairAsync(mySignup.Id);
        if (meta is not null)
        {
            meta.LookingForPair = meta.LookingForGuestRiders = meta.WaitingForGuestSpot = false;
            meta.DeclarationAccessGranted = false;
        }
        mySignup.Status = SignupPaymentStatus.Cancelled;
        if (ex is null) { ex = new SignupExtras { SignupId = mySignup.Id }; _db.Add(ex); }
        ex.IsWaitlist = false;
        ex.IsWithdrawn = true;
        ex.RefundPending = needsRefund;
        if (needsRefund && (string.IsNullOrWhiteSpace(ex.FeeDisposition) || ex.FeeDisposition == "None"))
        {
            ex.FeeDisposition = "RefundPending";
            ex.DispositionUpdatedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();

        return (await BuildMySignupDtosAsync(new List<SectionSignup> { mySignup })).Single();
    }

    [HttpPost("api/my/signups/{signupId:int}/pair-request")]
    [Authorize]
    public Task<ActionResult<MySignupExtendedDto>> RequestPairUp(int signupId, PairUpRequestInput req) =>
        _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            _db.ChangeTracker.Clear();
            await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var response = await RequestPairUpOnceAsync(signupId, req);
            await transaction.CommitAsync();
            return response;
        });

    private async Task<ActionResult<MySignupExtendedDto>> RequestPairUpOnceAsync(int signupId, PairUpRequestInput req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var mySignup = await _db.SectionSignups
            .Include(s => s.Section).ThenInclude(sec => sec!.Competition)
            .FirstOrDefaultAsync(s => s.Id == signupId);
        if (mySignup is null) return NotFound();
        if (mySignup.UserId != userId && !User.IsInRole(Roles.Admin)) return Forbid();
        if (mySignup.Status is not (SignupPaymentStatus.Pending or SignupPaymentStatus.Paid)
            || await _db.Set<SignupExtras>().AnyAsync(x => x.SignupId == mySignup.Id && (x.IsWithdrawn || x.IsWaitlist)))
            return BadRequest(new { message = "This entry is no longer active." });
        if (mySignup.Section?.Format != SectionFormat.Pairs)
            return BadRequest(new { message = "Pair requests are only available in Pairs sections." });
        if (mySignup.TeamId != null)
            return BadRequest(new { message = "This entry is already paired up on a team." });

        var target = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstOrDefaultAsync(s => s.Id == req.TargetSignupId && s.CompetitionSectionId == mySignup.CompetitionSectionId);
        if (target is null || target.Id == mySignup.Id)
            return BadRequest(new { message = "Target pair rider not found in this section." });
        if (target.Status is not (SignupPaymentStatus.Pending or SignupPaymentStatus.Paid)
            || await _db.Set<SignupExtras>().AnyAsync(x => x.SignupId == target.Id && (x.IsWithdrawn || x.IsWaitlist)))
            return BadRequest(new { message = "That entry is no longer active." });
        if (target.TeamId != null)
            return BadRequest(new { message = "That rider has already paired up." });

        var meta = await LoadMatchmakingMapAsync(new[] { mySignup.Id, target.Id });
        if (!meta.TryGetValue(mySignup.Id, out var ownMeta) || !ownMeta.LookingForPair)
            return BadRequest(new { message = "This entry is not currently looking for a pair." });
        if (!meta.TryGetValue(target.Id, out var targetMeta) || targetMeta.LookingForPair != true)
            return BadRequest(new { message = "That rider is not currently looking for a pair." });

        if (meta.Values.Any(x => x.PairRequestStatus == "Pending"
            && !((x.SignupId == mySignup.Id && x.PairRequestToSignupId == target.Id)
                || (x.SignupId == target.Id && x.PairRequestFromSignupId == mySignup.Id))))
            return Conflict(new { message = "One of these entries already has a pending pair request." });

        await SetMatchmakingAsync(mySignup.Id, true, false, false, fromId: null, toId: target.Id, status: "Pending");
        await SetMatchmakingAsync(target.Id, true, false, false, fromId: mySignup.Id, toId: null, status: "Pending");

        await _db.SaveChangesAsync();
        return (await BuildMySignupDtosAsync(new List<SectionSignup> { mySignup })).Single();
    }

    [HttpPost("api/my/signups/{signupId:int}/pair-respond")]
    [Authorize]
    public Task<ActionResult<MySignupExtendedDto>> RespondPairUp(int signupId, PairUpRespondInput req) =>
        _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            _db.ChangeTracker.Clear();
            await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var response = await RespondPairUpOnceAsync(signupId, req);
            await transaction.CommitAsync();
            return response;
        });

    private async Task<ActionResult<MySignupExtendedDto>> RespondPairUpOnceAsync(int signupId, PairUpRespondInput req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var mySignup = await _db.SectionSignups
            .Include(s => s.Section).ThenInclude(sec => sec!.Competition)
            .FirstOrDefaultAsync(s => s.Id == signupId);
        if (mySignup is null) return NotFound();
        if (mySignup.UserId != userId && !User.IsInRole(Roles.Admin)) return Forbid();
        if (mySignup.Status is not (SignupPaymentStatus.Pending or SignupPaymentStatus.Paid)
            || await _db.Set<SignupExtras>().AnyAsync(x => x.SignupId == mySignup.Id && (x.IsWithdrawn || x.IsWaitlist)))
            return BadRequest(new { message = "This entry is no longer active." });

        var meta = await LoadMatchmakingMapAsync(new[] { mySignup.Id });
        if (!meta.TryGetValue(mySignup.Id, out var myMeta) || myMeta.PairRequestFromSignupId is null)
            return BadRequest(new { message = "No pending pair request to respond to." });

        var requester = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstOrDefaultAsync(s => s.Id == myMeta.PairRequestFromSignupId.Value);
        if (mySignup.TeamId != null || myMeta.PairRequestStatus != "Pending")
            return BadRequest(new { message = "This pair request has already been answered." });
        if (requester is null)
            return BadRequest(new { message = "Requesting rider entry no longer exists." });

        var requesterMeta = await _db.Set<SignupMatchmaking>().FindAsync(requester.Id);
        if (requester.CompetitionSectionId != mySignup.CompetitionSectionId || requester.TeamId != null
            || requester.Status is not (SignupPaymentStatus.Pending or SignupPaymentStatus.Paid)
            || requesterMeta?.PairRequestToSignupId != mySignup.Id || requesterMeta.PairRequestStatus != "Pending"
            || await _db.Set<SignupExtras>().AnyAsync(x => x.SignupId == requester.Id && (x.IsWithdrawn || x.IsWaitlist)))
            return Conflict(new { message = "This pair request is no longer available." });

        if (!req.Accept)
        {
            await SetMatchmakingAsync(mySignup.Id, true, false, false, null, null, null);
            await SetMatchmakingAsync(requester.Id, true, false, false, null, null, null);
            await _db.SaveChangesAsync();
            return (await BuildMySignupDtosAsync(new List<SectionSignup> { mySignup })).Single();
        }

        // Mutual accept: form their Pair team immediately ("Rider 1 & Rider 2", no "A" suffix) and link both signups!
        var clubName = (requester.PonyClubName ?? mySignup.PonyClubName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(clubName)) clubName = "Unaffiliated";
        var club = await _db.Clubs.FirstOrDefaultAsync(c => c.Name.ToLower() == clubName.ToLower());
        if (club is null)
        {
            club = new Club { Name = clubName };
            _db.Clubs.Add(club);
            await _db.SaveChangesAsync();
        }

        var pairDisplayName = $"{RiderNames.Display(requester.FullName, requester.UseInitialOnly, false)} & {RiderNames.Display(mySignup.FullName, mySignup.UseInitialOnly, false)}";
        var pairTeam = new Team
        {
            CompetitionId = mySignup.Section!.CompetitionId,
            CompetitionSectionId = mySignup.CompetitionSectionId,
            ClubId = club.Id,
            Suffix = string.Empty,
            DisplayName = pairDisplayName,
            BibColour = club.BibColour,
        };
        _db.Teams.Add(pairTeam);
        await _db.SaveChangesAsync();

        requester.TeamId = pairTeam.Id;
        requester.TeamName = pairDisplayName;
        mySignup.TeamId = pairTeam.Id;
        mySignup.TeamName = pairDisplayName;
        await _db.SaveChangesAsync();

        await SetMatchmakingAsync(mySignup.Id, false, false, false, requester.Id, null, "Accepted");
        await SetMatchmakingAsync(requester.Id, false, false, false, null, mySignup.Id, "Accepted");
        await GrantDeclarationAccessAsync(mySignup.Id);
        await GrantDeclarationAccessAsync(requester.Id);

        await _db.SaveChangesAsync();
        return (await BuildMySignupDtosAsync(new List<SectionSignup> { mySignup })).Single();
    }

    /// <summary>
    /// Auto-form teams from paid signups in a section. With Preview=true returns
    /// what the bin would look like (grouped by pony club, suffixed A/B/C…) without
    /// touching the DB. With Preview=false creates the Team rows and updates
    /// each signup's TeamId. Unpaid signups are ignored entirely.
    ///
    /// Team-size rule: <c>RidersPerTeam</c> (defaults to 4 for Teams, 2 for Pairs,
    /// 1 for Individual). Signups from the same Pony Club are grouped together;
    /// if a club has more signups than fit one team, the extras spill into a
    /// second team (suffix B), and so on. Clubs with fewer signups than a full
    /// team still get their own (short) team — the organiser can merge or move
    /// people manually via the Teams tab later.
    /// </summary>
    [HttpPost("api/competitions/{competitionId:int}/sections/{sectionId:int}/form-teams")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<FormTeamsResult>> FormTeams(int competitionId, int sectionId, FormTeamsFromSignupsRequest req) =>
        InEntryTransactionAsync(() => FormTeamsOnceAsync(competitionId, sectionId, req));

    private async Task<ActionResult<FormTeamsResult>> FormTeamsOnceAsync(int competitionId, int sectionId, FormTeamsFromSignupsRequest req)
    {
        var sectionExists = await _db.CompetitionSections
            .AnyAsync(s => s.Id == sectionId && s.CompetitionId == competitionId);
        if (!sectionExists) return NotFound();

        var result = await FormTeamsCoreAsync(competitionId, sectionId, req);
        if (result is null)
            return BadRequest(new { message = "No paid signups to form teams from." });
        return result;
    }

    private async Task<FormTeamsResult?> FormTeamsCoreAsync(int competitionId, int sectionId, FormTeamsFromSignupsRequest req, int? onlySignupId = null)
    {
        var section = await _db.CompetitionSections
            .Include(s => s.Competition)
            .FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == competitionId);
        if (section is null) return null;

        var defaultSize = section.Format switch
        {
            SectionFormat.Pairs => 2,
            SectionFormat.Individual => 1,
            _ => 4,
        };
        var ridersPerTeam = Math.Clamp(req.RidersPerTeam ?? defaultSize, 1, 12);

        // Teams that may be replaced (unused: no heats, no declarations) free their signups to be re-formed.
        // Signups already on a team that stays are left where they are, so nobody lands on two teams.
        var sectionTeams = await _db.Teams
            .Include(t => t.HeatEntries)
            .Include(t => t.DeclarationForms)
            .Where(t => t.CompetitionSectionId == sectionId)
            .ToListAsync();
        var sectionSignups = await _db.SectionSignups.Where(s => s.CompetitionSectionId == sectionId).ToListAsync();
        var sectionSignupIds = sectionSignups.Select(s => s.Id).ToArray();
        var sectionLinks = await _db.Set<SignupTeamLink>().Where(l => sectionSignupIds.Contains(l.SignupId)).ToListAsync();
        var linkedIds = sectionSignups.ToDictionary(s => s.Id, s => sectionLinks.Where(l => l.SignupId == s.Id)
            .Select(l => l.TeamId).Concat(s.TeamId is int id ? new[] { id } : Array.Empty<int>()).ToHashSet());
        var replaceableIds = req.ReplaceExisting
            ? sectionTeams.Where(t => t.HeatEntries.Count == 0 && t.DeclarationForms.Count == 0).Select(t => t.Id).ToHashSet()
            : new HashSet<int>();
        // A multi-team entry is indivisible: preserving one used team also preserves its unused siblings.
        bool changed;
        do
        {
            changed = false;
            foreach (var ids in linkedIds.Values.Where(ids => ids.Any(id => !replaceableIds.Contains(id))))
                foreach (var id in ids) changed |= replaceableIds.Remove(id);
        } while (changed);
        var replaceable = sectionTeams.Where(t => replaceableIds.Contains(t.Id)).ToList();
        var allPaidSignups = sectionSignups.Where(s => s.Status == SignupPaymentStatus.Paid
                && (onlySignupId == null || s.Id == onlySignupId)
                && linkedIds[s.Id].All(replaceableIds.Contains))
            .OrderBy(s => s.CreatedAt).ToList();
        var paidIds = allPaidSignups.Select(s => s.Id).ToList();
        var paidMeta = await LoadMatchmakingMapAsync(paidIds);
        var paidExtras = await LoadExtrasMapAsync(paidIds);
        var paidSignups = allPaidSignups
            .Where(s => !(paidMeta.TryGetValue(s.Id, out var mm) && mm.WaitingForGuestSpot == true)
                     && !(paidExtras.TryGetValue(s.Id, out var ex) && (ex.IsWaitlist || ex.IsWithdrawn)))
            .ToList();
        if (paidSignups.Count == 0)
            return null;

        // Resolve each signup's club from its free-text PonyClubName (case-insensitive). A name that
        // isn't a club yet becomes its own club when the teams are formed, so different new clubs
        // are never merged; only a blank name goes to "Unaffiliated".
        var allClubs = await _db.Clubs.ToListAsync();
        var clubsByName = allClubs.ToDictionary(c => c.Name, c => c, StringComparer.OrdinalIgnoreCase);
        string ClubNameOf(SectionSignup s)
        {
            var typed = (s.PonyClubName ?? string.Empty).Trim();
            return typed.Length == 0 ? "Unaffiliated" : typed;
        }
        if (!req.Preview)
        {
            foreach (var typed in paidSignups.Select(ClubNameOf).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (clubsByName.ContainsKey(typed)) continue;
                var club = new Club { Name = typed };
                _db.Clubs.Add(club);
                clubsByName[typed] = club;
                allClubs.Add(club);
            }
            await _db.SaveChangesAsync();
        }

        // Bin by club, then: whole-team entries and custom-named teams stay together as the team they
        // asked for; everyone else is split into teams of `ridersPerTeam`.
        // Solo pair-seekers (LookingForPair == true) in Pairs sections are paired in twos and never put into a 1-rider Pairs team.
        var previews = new List<FormedTeamPreview>();
        var lookingForPairIds = section.Format == SectionFormat.Pairs
            ? paidSignups.Where(s => paidMeta.TryGetValue(s.Id, out var mm) && mm.LookingForPair == true).Select(s => s.Id).ToHashSet()
            : new HashSet<int>();
        var regularSignups = paidSignups.Where(s => !lookingForPairIds.Contains(s.Id)).ToList();

        foreach (var group in regularSignups.GroupBy(ClubNameOf, StringComparer.OrdinalIgnoreCase)
                     .OrderBy(g => clubsByName.TryGetValue(g.Key, out var known) ? known.Name : g.Key, StringComparer.OrdinalIgnoreCase))
        {
            var known = clubsByName.GetValueOrDefault(group.Key);
            var clubName = known?.Name ?? group.Key;
            var clubId = known?.Id ?? 0;

            foreach (var whole in group.Where(s => s.IsWholeTeam))
            {
                var tCount = paidExtras.TryGetValue(whole.Id, out var wEx) && wEx.TeamsCount > 1 ? wEx.TeamsCount : 1;
                if (tCount <= 1)
                {
                    previews.Add(new FormedTeamPreview(clubName, clubId, string.Empty,
                        new[] { whole.Id }, new[] { whole.FullName }, whole.TeamName));
                }
                else
                {
                    var customNames = (whole.TeamName ?? string.Empty)
                        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                        .ToList();
                    var baseName = customNames.Count == 1 ? customNames[0] : clubName;
                    if (baseName.EndsWith(" A", StringComparison.OrdinalIgnoreCase) && baseName.Length > 2)
                        baseName = baseName[..^2].TrimEnd();
                    for (var k = 0; k < tCount; k++)
                    {
                        var suffix = ((char)('A' + k)).ToString();
                        var tName = customNames.Count > 1 && k < customNames.Count
                            ? customNames[k]
                            : $"{baseName} {suffix}".Trim();
                        previews.Add(new FormedTeamPreview(clubName, clubId, suffix,
                            new[] { whole.Id }, new[] { whole.FullName }, tName));
                    }
                }
            }
            var singles = group.Where(s => !s.IsWholeTeam).OrderBy(s => s.CreatedAt).ToList();
            foreach (var named in singles.Where(s => !string.IsNullOrWhiteSpace(s.TeamName))
                         .GroupBy(s => s.TeamName!.Trim(), StringComparer.OrdinalIgnoreCase))
                previews.Add(new FormedTeamPreview(clubName, clubId, string.Empty,
                    named.Select(x => x.Id).ToList(), named.Select(x => x.FullName).ToList(), named.Key));
            var ordered = singles.Where(s => string.IsNullOrWhiteSpace(s.TeamName)).ToList();
            for (var i = 0; i < ordered.Count; i += ridersPerTeam)
            {
                var slice = ordered.Skip(i).Take(ridersPerTeam).ToList();
                if (section.Format == SectionFormat.Individual && ridersPerTeam == 1)
                {
                    previews.Add(new FormedTeamPreview(
                        clubName, clubId, string.Empty,
                        slice.Select(x => x.Id).ToList(),
                        slice.Select(x => x.FullName).ToList(),
                        RiderNames.Display(slice[0].FullName, slice[0].UseInitialOnly, false)));
                }
                else if (section.Format == SectionFormat.Pairs && ridersPerTeam == 2)
                {
                    var pairName = string.Join(" & ", slice.Select(x => RiderNames.Display(x.FullName, x.UseInitialOnly, false)));
                    previews.Add(new FormedTeamPreview(
                        clubName, clubId, string.Empty,
                        slice.Select(x => x.Id).ToList(),
                        slice.Select(x => x.FullName).ToList(),
                        pairName));
                }
                else
                {
                    var suffix = ((char)('A' + i / ridersPerTeam)).ToString();
                    previews.Add(new FormedTeamPreview(
                        clubName, clubId, suffix,
                        slice.Select(x => x.Id).ToList(),
                        slice.Select(x => x.FullName).ToList()));
                }
            }
        }

        if (lookingForPairIds.Count >= 2)
        {
            var seekers = paidSignups.Where(s => lookingForPairIds.Contains(s.Id)).OrderBy(s => s.CreatedAt).ToList();
            for (var i = 0; i + 1 < seekers.Count; i += 2)
            {
                var first = seekers[i];
                var second = seekers[i + 1];
                var pairClubKey = ClubNameOf(first);
                var knownClub = clubsByName.GetValueOrDefault(pairClubKey);
                var pairClubName = knownClub?.Name ?? pairClubKey;
                var pairClubId = knownClub?.Id ?? 0;
                var pairName = $"{RiderNames.Display(first.FullName, first.UseInitialOnly, false)} & {RiderNames.Display(second.FullName, second.UseInitialOnly, false)}";
                previews.Add(new FormedTeamPreview(
                    pairClubName, pairClubId, string.Empty,
                    new[] { first.Id, second.Id },
                    new[] { first.FullName, second.FullName },
                    pairName));
            }
        }

        if (req.Preview)
        {
            return new FormTeamsResult(true, ridersPerTeam, paidSignups.Count, previews, Array.Empty<TeamDto>());
        }

        if (replaceable.Count > 0)
        {
            foreach (var t in replaceable)
            {
                // Detach signups so we can re-bin them.
                var linkedSignups = await _db.SectionSignups
                    .Where(s => s.TeamId == t.Id).ToListAsync();
                foreach (var s in linkedSignups) s.TeamId = null;
                _db.RemoveRange(sectionLinks.Where(l => l.TeamId == t.Id));
                _db.Teams.Remove(t);
            }
            await _db.SaveChangesAsync();
        }

        var created = new List<Team>();
        foreach (var preview in previews)
        {
            // Find next available suffix in case existing teams already use A/B.
            var existingSuffixes = await _db.Teams
                .Where(t => t.CompetitionSectionId == sectionId && t.ClubId == preview.ClubId)
                .Select(t => t.Suffix)
                .ToListAsync();
            var suffix = preview.Suffix;
            var bump = 0;
            while (suffix.Length > 0 && existingSuffixes.Contains(suffix, StringComparer.OrdinalIgnoreCase))
            {
                bump++;
                suffix = ((char)('A' + (preview.Suffix[0] - 'A') + bump)).ToString();
                if (bump > 25) break;
            }

            var team = new Team
            {
                CompetitionId = competitionId,
                CompetitionSectionId = sectionId,
                ClubId = preview.ClubId,
                Suffix = suffix,
                DisplayName = preview.TeamName ?? $"{preview.ClubName} {suffix}".Trim(),
                BibColour = allClubs.First(c => c.Id == preview.ClubId).BibColour,
            };
            _db.Teams.Add(team);
            await _db.SaveChangesAsync();
            created.Add(team);

            // Link each signup in the preview to the new team (keep first created team if multiple teams came from 1 signup).
            foreach (var signupId in preview.SignupIds)
            {
                var signup = await _db.SectionSignups.FindAsync(signupId);
                if (signup is not null)
                {
                    signup.TeamId ??= team.Id;
                    _db.Add(new SignupTeamLink { SignupId = signup.Id, TeamId = team.Id });
                    if (lookingForPairIds.Contains(signup.Id))
                    {
                        await SetMatchmakingAsync(signup.Id, false, false, false, null, null, "Accepted");
                    }
                    await GrantDeclarationAccessAsync(signup.Id);
                }
            }
        }
        await _db.SaveChangesAsync();

        // Reload teams with club / section for proper DTO mapping.
        var createdIds = created.Select(t => t.Id).ToList();
        var loaded = await _db.Teams
            .Include(t => t.Club).Include(t => t.Section).Include(t => t.Trainer)
            .Where(t => createdIds.Contains(t.Id))
            .ToListAsync();
        return new FormTeamsResult(false, ridersPerTeam, paidSignups.Count, previews, loaded.Select(t => t.ToDto()).ToList());
    }

    /// <summary>
    /// Sends polite BACS payment reminder emails only to the organiser-selected Pending signups that have a ContactEmail,
    /// recording LastReminderSentAt on SignupExtras.
    /// </summary>
    [HttpPost("api/competitions/{competitionId:int}/signups/send-unpaid-reminders")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SendUnpaidRemindersResultDto>> SendUnpaidReminders(
        int competitionId, SendUnpaidRemindersInput req,
        [FromServices] SignupConfirmationService confirmation, [FromServices] TimeProvider clock)
    {
        var comp = await _db.Competitions.AsNoTracking().FirstOrDefaultAsync(c => c.Id == competitionId);
        if (comp is null) return NotFound();
        var requestedIds = (req.SignupIds ?? Array.Empty<int>()).Distinct().ToArray();
        if (requestedIds.Length == 0)
            return BadRequest(new { message = "Select at least one unpaid entry to remind." });
        if (req.CustomNote?.Trim().Length > 500)
            return BadRequest(new { message = "Custom note must be 500 characters or fewer." });

        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId && requestedIds.Contains(s.Id))
            .OrderBy(s => s.CreatedAt)
            .ToListAsync();
        var ids = rows.Select(r => r.Id).ToList();
        var meta = await LoadMatchmakingMapAsync(ids);
        var extras = await LoadExtrasMapAsync(ids);
        var nowUtc = clock.GetUtcNow().UtcDateTime;

        var sentCount = 0;
        var failedCount = 0;
        var skippedCount = requestedIds.Length - rows.Count;
        var updatedDtos = new List<SectionSignupExtendedDto>();

        foreach (var signup in rows)
        {
            extras.TryGetValue(signup.Id, out var ex);
            if (signup.Status != SignupPaymentStatus.Pending || signup.AmountMinor <= 0
                || ex?.IsWithdrawn == true || ex?.IsWaitlist == true
                || string.IsNullOrWhiteSpace(signup.ContactEmail))
            {
                skippedCount++;
                continue;
            }

            var status = await confirmation.SendPaymentReminderAsync(signup, comp, signup.Section!, req.CustomNote);
            if (status == EmailDeliveryStatus.Failed)
            {
                failedCount++;
                continue;
            }

            if (ex is null)
            {
                ex = new SignupExtras { SignupId = signup.Id };
                _db.Add(ex);
                extras[signup.Id] = ex;
            }
            ex.LastReminderSentAt = nowUtc;
            sentCount++;
        }

        if (sentCount > 0)
            await _db.SaveChangesAsync();

        foreach (var signup in rows)
        {
            updatedDtos.Add(ToExtendedDto(signup, meta.GetValueOrDefault(signup.Id), extras.GetValueOrDefault(signup.Id)));
        }

        return new SendUnpaidRemindersResultDto(sentCount, failedCount, skippedCount, nowUtc, updatedDtos);
    }

    /// <summary>Allows an entrant (or competition staff) to update their arrival window and horsebox/vehicle registration.</summary>
    [HttpPut("api/my/signups/{signupId:int}/arrival")]
    [HttpPost("api/my/signups/{signupId:int}/arrival")]
    [Authorize]
    public async Task<ActionResult<MySignupExtendedDto>> UpdateMySignupArrival(int signupId, UpdateSignupArrivalInput req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var mySignup = await _db.SectionSignups
            .Include(s => s.Section).ThenInclude(sec => sec!.Competition)
            .FirstOrDefaultAsync(s => s.Id == signupId);
        if (mySignup is null) return NotFound();

        var compId = mySignup.Section?.CompetitionId ?? 0;
        if (mySignup.UserId != userId && !User.IsInRole(Roles.Admin) && !await _db.CanManageAsync(User, compId))
            return Forbid();

        if (!TryNormaliseArrivalWindow(req.ArrivalWindow, out var arrivalWindow))
            return BadRequest(new { message = "Arrival window must be FridayEvening, SaturdayMorning, or Other." });
        if (!TryNormaliseVehicleReg(req.VehicleRegistration, out var vehicleRegistration))
            return BadRequest(new { message = "Vehicle registration must be 40 characters or fewer." });

        var ex = await _db.Set<SignupExtras>().FindAsync(mySignup.Id);
        if (ex?.IsWithdrawn == true || mySignup.Status is SignupPaymentStatus.Cancelled or SignupPaymentStatus.Refunded)
            return Conflict(new { message = "This entry is no longer active." });
        if (ex is null)
        {
            ex = new SignupExtras { SignupId = mySignup.Id };
            _db.Add(ex);
        }
        ex.ArrivalWindow = arrivalWindow;
        ex.VehicleRegistration = vehicleRegistration;
        await _db.SaveChangesAsync();

        return (await BuildMySignupDtosAsync(new List<SectionSignup> { mySignup })).Single();
    }

    /// <summary>Returns the arrival-night and horsebox/vehicle manifest grouped by Friday evening, Saturday morning, and Other.</summary>
    [HttpGet("api/competitions/{competitionId:int}/arrival-manifest")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<ArrivalManifestDto>> GetArrivalManifest(int competitionId)
    {
        var compExists = await _db.Competitions.AsNoTracking().AnyAsync(c => c.Id == competitionId);
        if (!compExists) return NotFound();

        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId
                && s.Status != SignupPaymentStatus.Cancelled
                && s.Status != SignupPaymentStatus.Refunded)
            .OrderBy(s => s.CreatedAt)
            .ToListAsync();
        var extras = await LoadExtrasMapAsync(rows.Select(r => r.Id));

        var friday = new List<ArrivalManifestEntryDto>();
        var saturday = new List<ArrivalManifestEntryDto>();
        var other = new List<ArrivalManifestEntryDto>();

        foreach (var r in rows)
        {
            extras.TryGetValue(r.Id, out var ex);
            if (ex?.IsWithdrawn == true || ex?.IsWaitlist == true) continue;
            var hasStables = (ex?.StablesCount ?? 0) > 0;
            var hasArrival = !string.IsNullOrWhiteSpace(ex?.ArrivalWindow);
            var hasVehicle = !string.IsNullOrWhiteSpace(ex?.VehicleRegistration);
            if (!hasStables && !hasArrival && !hasVehicle) continue;

            var window = ex?.ArrivalWindow is "FridayEvening" or "SaturdayMorning" ? ex.ArrivalWindow : "Other";
            var item = new ArrivalManifestEntryDto(
                r.Id,
                r.CompetitionSectionId,
                r.Section?.DisplayName ?? string.Empty,
                r.FullName,
                r.PonyClubName,
                r.TeamName,
                ex?.TeamsCount > 0 ? ex.TeamsCount : 1,
                ex?.StablesCount ?? 0,
                ex?.StablingClubOrTeam,
                window,
                ex?.VehicleRegistration,
                r.Status
            );
            if (window == "FridayEvening") friday.Add(item);
            else if (window == "SaturdayMorning") saturday.Add(item);
            else other.Add(item);
        }

        return new ArrivalManifestDto(friday, saturday, other);
    }

    /// <summary>Updates the fee disposition (None, RefundPending, Refunded, Retained, CreditRollover) and accounting note for a signup.</summary>
    [HttpPut("api/competitions/{competitionId:int}/signups/{signupId:int}/disposition")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<SectionSignupExtendedDto>> UpdateDisposition(
        int competitionId, int signupId, UpdateSignupDispositionInput req, [FromServices] TimeProvider clock) =>
        InEntryTransactionAsync(() => UpdateDispositionOnceAsync(competitionId, signupId, req, clock));

    private async Task<ActionResult<SectionSignupExtendedDto>> UpdateDispositionOnceAsync(
        int competitionId, int signupId, UpdateSignupDispositionInput req, TimeProvider clock)
    {
        var signup = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstOrDefaultAsync(s => s.Id == signupId && s.Section!.CompetitionId == competitionId);
        if (signup is null) return NotFound();

        var disposition = req.FeeDisposition?.Trim() ?? string.Empty;
        if (!ValidFeeDispositions.Contains(disposition))
            return BadRequest(new { message = "Fee disposition must be None, RefundPending, Refunded, Retained, or CreditRollover." });

        if (req.RefundedAmountMinor.HasValue)
        {
            if (req.RefundedAmountMinor.Value < 0)
                return BadRequest(new { message = "Refunded amount cannot be negative." });
            if (req.RefundedAmountMinor.Value > signup.AmountMinor)
                return BadRequest(new { message = "Refunded amount cannot exceed the entry fee." });
        }
        if (req.DispositionNote?.Trim().Length > 500)
            return BadRequest(new { message = "Disposition note must be 500 characters or fewer." });

        var ex = await _db.Set<SignupExtras>().FindAsync(signup.Id);
        if (ex is null)
        {
            ex = new SignupExtras { SignupId = signup.Id };
            _db.Add(ex);
        }

        var nowUtc = clock.GetUtcNow().UtcDateTime;
        ex.FeeDisposition = disposition;
        ex.RefundPending = disposition == "RefundPending";
        ex.DispositionNote = string.IsNullOrWhiteSpace(req.DispositionNote) ? null : req.DispositionNote.Trim();
        ex.DispositionUpdatedAt = nowUtc;

        if (disposition == "Refunded")
        {
            ex.RefundedAmountMinor = req.RefundedAmountMinor ?? signup.AmountMinor;
            var isDemo = await _db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == competitionId && x.IsDemo);
            var hasTestPayment = await _db.Set<TestPaymentRecord>().AnyAsync(x => x.Target == TestPaymentTarget.SectionSignup && x.TargetId == signup.Id);
            if (!isDemo && !hasTestPayment)
            {
                signup.Status = SignupPaymentStatus.Refunded;
                signup.PaidAt = null;
                await ReleasePendingPairAsync(signup.Id);
            }
        }
        else
        {
            ex.RefundedAmountMinor = req.RefundedAmountMinor;
        }

        await _db.SaveChangesAsync();
        var meta = await _db.Set<SignupMatchmaking>().FindAsync(signup.Id);
        return ToExtendedDto(signup, meta, ex);
    }

    /// <summary>Returns the Refund, Retained-Fee and Credit Ledger summary totals and rows for a competition.</summary>
    [HttpGet("api/competitions/{competitionId:int}/signups/disposition-summary")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<FeeDispositionLedgerSummaryDto>> GetDispositionSummary(int competitionId)
    {
        var compExists = await _db.Competitions.AsNoTracking().AnyAsync(c => c.Id == competitionId);
        if (!compExists) return NotFound();

        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
        var ids = rows.Select(r => r.Id).ToList();
        var meta = await LoadMatchmakingMapAsync(ids);
        var extras = await LoadExtrasMapAsync(ids);

        var totalRetained = 0;
        var totalRefunded = 0;
        var refundsPending = 0;
        var creditsRolledOver = 0;
        var ledgerRows = new List<SectionSignupExtendedDto>();

        foreach (var r in rows)
        {
            extras.TryGetValue(r.Id, out var ex);
            var dto = ToExtendedDto(r, meta.GetValueOrDefault(r.Id), ex);
            var isLedgerRow = dto.IsWithdrawn || dto.Status is SignupPaymentStatus.Refunded or SignupPaymentStatus.Cancelled || dto.FeeDisposition != "None";
            if (!isLedgerRow) continue;

            ledgerRows.Add(dto);
            switch (dto.FeeDisposition)
            {
                case "Retained":
                    totalRetained += dto.AmountMinor;
                    break;
                case "Refunded":
                {
                    var refunded = Math.Clamp(dto.RefundedAmountMinor ?? dto.AmountMinor, 0, dto.AmountMinor);
                    totalRefunded += refunded;
                    if (refunded < dto.AmountMinor)
                        totalRetained += dto.AmountMinor - refunded;
                    break;
                }
                case "RefundPending":
                    refundsPending += dto.AmountMinor;
                    break;
                case "CreditRollover":
                    creditsRolledOver += dto.AmountMinor;
                    break;
            }
        }

        return new FeeDispositionLedgerSummaryDto(totalRetained, totalRefunded, refundsPending, creditsRolledOver, ledgerRows);
    }

    /// <summary>Returns combined club invoice groups for clubs with 2+ active signups across sections in the competition.</summary>
    [HttpGet("api/competitions/{competitionId:int}/signups/club-invoices")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IEnumerable<ClubInvoiceGroupDto>>> GetClubInvoices(int competitionId)
    {
        var compExists = await _db.Competitions.AsNoTracking().AnyAsync(c => c.Id == competitionId);
        if (!compExists) return NotFound();

        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId
                && (s.Status == SignupPaymentStatus.Pending || s.Status == SignupPaymentStatus.Paid))
            .OrderBy(s => s.CreatedAt)
            .ToListAsync();
        var ids = rows.Select(r => r.Id).ToList();
        var meta = await LoadMatchmakingMapAsync(ids);
        var extras = await LoadExtrasMapAsync(ids);

        var activeDtos = rows
            .Select(r => ToExtendedDto(r, meta.GetValueOrDefault(r.Id), extras.GetValueOrDefault(r.Id)))
            .Where(d => !d.IsWithdrawn && !d.IsWaitlist && !string.IsNullOrWhiteSpace(d.PonyClubName)
                && !string.Equals(d.PonyClubName.Trim(), "Unaffiliated", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var groups = activeDtos
            .GroupBy(d => d.PonyClubName!.Trim(), StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() >= 2)
            .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase)
            .Select(g =>
            {
                var signups = g.ToList();
                var clubName = signups[0].PonyClubName!.Trim();
                var slug = BuildClubSlug(clubName);
                var bacsRef = BuildClubBacsReference(competitionId, clubName);
                var teamsCount = signups.Sum(s => s.WaitingForGuestSpot ? 0 : Math.Max(1, s.TeamsCount));
                var stablesCount = signups.Sum(s => s.StablesCount);
                var totalAmount = signups.Sum(s => s.AmountMinor);
                var totalDue = signups.Where(s => s.Status == SignupPaymentStatus.Pending).Sum(s => s.AmountMinor);
                var totalPaid = signups.Where(s => s.Status == SignupPaymentStatus.Paid).Sum(s => s.AmountMinor);
                return new ClubInvoiceGroupDto(
                    clubName, slug, bacsRef, signups.Count, teamsCount, stablesCount,
                    totalAmount, totalDue, totalPaid, signups
                );
            })
            .ToList();

        return groups;
    }

    /// <summary>Allocates payment across all Pending signups for a club in the competition in one transaction and forms their teams.</summary>
    [HttpPost("api/competitions/{competitionId:int}/signups/mark-club-paid")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<MarkClubPaidResultDto>> MarkClubPaid(int competitionId, MarkClubPaidInput req) =>
        InEntryTransactionAsync(() => MarkClubPaidOnceAsync(competitionId, req));

    private async Task<ActionResult<MarkClubPaidResultDto>> MarkClubPaidOnceAsync(int competitionId, MarkClubPaidInput req)
    {
        var compExists = await _db.Competitions.AsNoTracking().AnyAsync(c => c.Id == competitionId);
        if (!compExists) return NotFound();

        if (await _db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == competitionId && x.IsDemo))
            return Conflict(new { message = "Demo entry payments can only be changed through the labelled test checkout." });

        var clubName = req.PonyClubName?.Trim();
        var explicitIds = (req.SignupIds ?? Array.Empty<int>()).Distinct().ToArray();
        if (string.IsNullOrEmpty(clubName) && explicitIds.Length == 0)
            return BadRequest(new { message = "Specify a Pony Club name or signup IDs to mark paid." });

        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId && s.Status == SignupPaymentStatus.Pending)
            .OrderBy(s => s.CreatedAt)
            .ToListAsync();
        var ids = rows.Select(r => r.Id).ToList();
        var meta = await LoadMatchmakingMapAsync(ids);
        var extras = await LoadExtrasMapAsync(ids);

        var matching = rows.Where(s =>
        {
            extras.TryGetValue(s.Id, out var ex);
            if (ex?.IsWithdrawn == true || ex?.IsWaitlist == true) return false;
            if (explicitIds.Length > 0 && !explicitIds.Contains(s.Id)) return false;
            if (!string.IsNullOrEmpty(clubName))
                return !string.IsNullOrWhiteSpace(s.PonyClubName)
                    && string.Equals(s.PonyClubName.Trim(), clubName, StringComparison.OrdinalIgnoreCase);
            return true;
        }).ToList();

        if (matching.Count == 0)
            return BadRequest(new { message = "No unpaid entries found for that club." });

        var matchingIds = matching.Select(s => s.Id).ToArray();
        if (await _db.Set<TestPaymentRecord>().AnyAsync(x => x.Target == TestPaymentTarget.SectionSignup && matchingIds.Contains(x.TargetId)))
            return Conflict(new { message = "Demo entry payments can only be changed through the labelled test checkout." });

        var resolvedClubName = clubName ?? matching.FirstOrDefault(s => !string.IsNullOrWhiteSpace(s.PonyClubName))?.PonyClubName?.Trim() ?? "Club";
        var nowUtc = DateTime.UtcNow;
        var totalAmountMinor = 0;

        foreach (var signup in matching)
        {
            signup.Status = SignupPaymentStatus.Paid;
            signup.PaidAt = nowUtc;
            totalAmountMinor += signup.AmountMinor;
        }
        await _db.SaveChangesAsync();

        foreach (var signup in matching)
        {
            meta.TryGetValue(signup.Id, out var m);
            if (m?.LookingForPair != true && m?.WaitingForGuestSpot != true)
            {
                await FormTeamsCoreAsync(competitionId, signup.CompetitionSectionId,
                    new FormTeamsFromSignupsRequest(null, Preview: false, ReplaceExisting: false), signup.Id);
            }
        }

        var refreshedMeta = await LoadMatchmakingMapAsync(matchingIds);
        var refreshedExtras = await LoadExtrasMapAsync(matchingIds);
        var dtos = matching.Select(s => ToExtendedDto(s, refreshedMeta.GetValueOrDefault(s.Id), refreshedExtras.GetValueOrDefault(s.Id))).ToList();
        return new MarkClubPaidResultDto(
            resolvedClubName,
            BuildClubBacsReference(competitionId, resolvedClubName),
            matching.Count,
            totalAmountMinor,
            dtos
        );
    }

    /// <summary>Offers a 24-hour acceptance spot to a waitlisted signup and sends an email notification.</summary>
    [HttpPost("api/competitions/{competitionId:int}/signups/{signupId:int}/offer-waitlist-spot")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SectionSignupExtendedDto>> OfferWaitlistSpot(
        int competitionId, int signupId,
        [FromServices] SignupConfirmationService confirmation, [FromServices] TimeProvider clock)
    {
        var signup = await _db.SectionSignups
            .Include(s => s.Section).ThenInclude(sec => sec!.Competition)
            .FirstOrDefaultAsync(s => s.Id == signupId && s.Section!.CompetitionId == competitionId);
        if (signup is null) return NotFound();

        var ex = await _db.Set<SignupExtras>().FindAsync(signup.Id);
        var meta = await _db.Set<SignupMatchmaking>().FindAsync(signup.Id);
        if (ex?.IsWaitlist != true || ex.IsWithdrawn || signup.Status is SignupPaymentStatus.Cancelled or SignupPaymentStatus.Refunded)
            return Conflict(new { message = "This entry is not on the waiting list." });

        var teamsCount = ex.TeamsCount > 0 ? ex.TeamsCount : 1;
        if (signup.Section!.MaxParticipants is int cap && meta?.WaitingForGuestSpot != true
            && (long)await ActivePlacesAsync(signup.CompetitionSectionId, signup.Id) + teamsCount > cap)
            return Conflict(new { message = "There is no space in this section to offer a waitlist spot yet." });

        var nowUtc = clock.GetUtcNow().UtcDateTime;
        var expiresAtUtc = nowUtc.AddHours(24);
        ex.WaitlistOfferedAt = nowUtc;
        ex.WaitlistOfferExpiresAt = expiresAtUtc;
        await _db.SaveChangesAsync();

        var expectedAmount = meta?.WaitingForGuestSpot == true ? 0L : meta?.LookingForPair == true
            ? signup.Section.PriceMinor / 2 : (long)signup.Section.PriceMinor * teamsCount;
        var amountMinor = (int)Math.Min(expectedAmount, int.MaxValue);

        if (!string.IsNullOrWhiteSpace(signup.ContactEmail))
        {
            await confirmation.SendWaitlistOfferAsync(signup, signup.Section.Competition!, signup.Section, expiresAtUtc, amountMinor);
        }

        return ToExtendedDto(signup, meta, ex);
    }

    /// <summary>Allows a waitlisted entrant with an active 24-hour spot offer to accept their spot and proceed to payment.</summary>
    [HttpPost("api/competitions/{competitionId:int}/signups/{signupId:int}/accept-waitlist-spot")]
    [Authorize]
    public Task<ActionResult<MySignupExtendedDto>> AcceptWaitlistSpot(
        int competitionId, int signupId, [FromServices] TimeProvider clock) =>
        InEntryTransactionAsync(() => AcceptWaitlistSpotOnceAsync(competitionId, signupId, clock));

    private async Task<ActionResult<MySignupExtendedDto>> AcceptWaitlistSpotOnceAsync(
        int competitionId, int signupId, TimeProvider clock)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var signup = await _db.SectionSignups
            .Include(s => s.Section).ThenInclude(sec => sec!.Competition)
            .FirstOrDefaultAsync(s => s.Id == signupId && s.Section!.CompetitionId == competitionId);
        if (signup is null) return NotFound();

        if (signup.UserId != userId && !User.IsInRole(Roles.Admin) && !await _db.CanManageAsync(User, competitionId))
            return Forbid();

        var ex = await _db.Set<SignupExtras>().FindAsync(signup.Id);
        var meta = await _db.Set<SignupMatchmaking>().FindAsync(signup.Id);
        if (ex?.IsWaitlist != true || ex.IsWithdrawn || signup.Status is SignupPaymentStatus.Cancelled or SignupPaymentStatus.Refunded)
            return Conflict(new { message = "This entry is no longer on the waiting list." });

        var nowUtc = clock.GetUtcNow().UtcDateTime;
        if (ex.WaitlistOfferExpiresAt is null)
            return Conflict(new { message = "No waitlist spot offer is active for this entry." });
        if (ex.WaitlistOfferExpiresAt.Value <= nowUtc)
            return Conflict(new { message = "This waitlist offer has expired." });

        var teamsCount = ex.TeamsCount > 0 ? ex.TeamsCount : 1;
        if (signup.Section!.MaxParticipants is int cap && meta?.WaitingForGuestSpot != true
            && (long)await ActivePlacesAsync(signup.CompetitionSectionId, signup.Id) + teamsCount > cap)
            return Conflict(new { message = "That spot has already been filled." });

        var amount = meta?.WaitingForGuestSpot == true ? 0L : meta?.LookingForPair == true
            ? signup.Section.PriceMinor / 2 : (long)signup.Section.PriceMinor * teamsCount;
        if (amount > int.MaxValue) return BadRequest(new { message = "The total entry fee is too large." });

        var amountMinor = (int)amount;
        var isFree = amountMinor == 0;
        signup.AmountMinor = amountMinor;
        signup.Status = isFree ? SignupPaymentStatus.Paid : SignupPaymentStatus.Pending;
        signup.PaidAt = isFree ? nowUtc : null;
        ex.IsWaitlist = false;
        ex.WaitlistOfferExpiresAt = null;
        await _db.SaveChangesAsync();

        if (isFree && meta?.LookingForPair != true && meta?.WaitingForGuestSpot != true)
        {
            await FormTeamsCoreAsync(competitionId, signup.CompetitionSectionId,
                new FormTeamsFromSignupsRequest(null, Preview: false, ReplaceExisting: false), signup.Id);
        }

        return (await BuildMySignupDtosAsync(new List<SectionSignup> { signup })).Single();
    }
}
