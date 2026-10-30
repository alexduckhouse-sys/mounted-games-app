using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

/// <summary>Saved bank details, masked. Never holds a full account number or IBAN.</summary>
public record PayoutBankDto(
    string AccountHolder, string? BankName, string? SortCode, string MaskedAccount, string? IbanCountry);

/// <summary>
/// A club's or user's payout set-up for its managers, trainers, sellers and admins. Includes the responsible person's date of birth, so it
/// must never be sent to anyone else (see <c>ClubPayoutsController</c>).
/// </summary>
public record ClubPayoutsDto(
    int ClubId, string ClubName, PayoutStatus Status, PayoutBusinessType? BusinessType,
    PayoutRegion Region, string Currency,
    string? LegalName, string? TradingName,
    string? AddressLine1, string? AddressLine2, string? City, string? Postcode,
    string? ContactEmail, string? ContactPhone, string? RegistrationNumber, string? VatNumber,
    string? PersonFullName, DateOnly? PersonDateOfBirth,
    string? StatementDescriptor, PayoutSchedule Schedule,
    PayoutBankDto? Bank,
    IReadOnlyList<string> Missing,
    DateTime? UpdatedAt,
    bool StripeConnected = false,
    bool StripeChargesEnabled = false,
    bool StripePayoutsEnabled = false,
    bool StripeDetailsSubmitted = false,
    bool StripeConfigured = false,
    bool ManualBacsReady = false,
    string? StripeAccountId = null);

/// <summary>
/// Details apart from the bank account. A null field is left as it is; an empty string clears an optional one.
/// </summary>
public record SavePayoutDetailsRequest(
    PayoutBusinessType? BusinessType = null, PayoutRegion? Region = null,
    string? LegalName = null, string? TradingName = null,
    string? AddressLine1 = null, string? AddressLine2 = null, string? City = null, string? Postcode = null,
    string? ContactEmail = null, string? ContactPhone = null,
    string? RegistrationNumber = null, string? VatNumber = null,
    string? PersonFullName = null, DateOnly? PersonDateOfBirth = null,
    string? StatementDescriptor = null, PayoutSchedule? Schedule = null,
    bool? ClearPersonDateOfBirth = null);

/// <summary>
/// Bank details. UK clubs send a sort code and account number; Ireland and EU clubs send an IBAN (and may add a BIC).
/// They are checked and masked, then dropped: only the sort code and last four digits are kept.
/// </summary>
public record SavePayoutBankRequest(
    string? AccountHolder = null, string? SortCode = null, string? AccountNumber = null,
    string? Iban = null, string? Bic = null);

/// <summary>What anyone may see about where an event's entry fees go: the club, the masked account and whether it's ready.</summary>
public record PayoutsToDto(
    string ClubName, string? MaskedAccount, bool Ready,
    bool StripeConnected = false, bool StripeChargesEnabled = false, bool StripePayoutsEnabled = false,
    bool StripeDetailsSubmitted = false, bool ManualBacsReady = false);

/// <summary>Optional parameters when starting Stripe Connect onboarding (e.g. a 2-letter ISO country code for EU accounts).</summary>
public record StripeOnboardRequestDto(string? Country = null);

/// <summary>Hosted Stripe Connect onboarding redirect URL and connected account identifier.</summary>
public record StripeOnboardResponseDto(string Url, string StripeAccountId);
