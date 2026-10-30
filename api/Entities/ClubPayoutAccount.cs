namespace MountedGames.Api.Entities;

public enum PayoutStatus { NotStarted = 0, InProgress = 1, Ready = 2 }

public enum PayoutBusinessType { Individual = 0, Club = 1, Charity = 2, Company = 3 }

/// <summary>Where the club is based. It fixes the currency (GBP or EUR) and the kind of bank details taken.</summary>
public enum PayoutRegion { Uk = 0, Eu = 1 }

public enum PayoutSchedule { Daily = 0, Weekly = 1, AfterEachEvent = 2 }

public interface IPayoutAccount
{
    int Id { get; set; }
    PayoutStatus Status { get; set; }
    PayoutBusinessType? BusinessType { get; set; }
    PayoutRegion Region { get; set; }
    string Currency { get; set; }
    string? LegalName { get; set; }
    string? TradingName { get; set; }
    string? AddressLine1 { get; set; }
    string? AddressLine2 { get; set; }
    string? City { get; set; }
    string? Postcode { get; set; }
    string? ContactEmail { get; set; }
    string? ContactPhone { get; set; }
    string? RegistrationNumber { get; set; }
    string? VatNumber { get; set; }
    string? PersonFullName { get; set; }
    DateOnly? PersonDateOfBirth { get; set; }
    string? StatementDescriptor { get; set; }
    PayoutSchedule Schedule { get; set; }
    string? BankAccountHolder { get; set; }
    string? BankName { get; set; }
    string? SortCode { get; set; }
    string? AccountLast4 { get; set; }
    string? IbanCountry { get; set; }
    string? IbanLast4 { get; set; }
    string? StripeAccountId { get; set; }
    bool StripeChargesEnabled { get; set; }
    bool StripePayoutsEnabled { get; set; }
    bool StripeDetailsSubmitted { get; set; }
    DateTime? StripeConnectedAt { get; set; }
    bool ManualBacsReady { get; set; }
    DateTime CreatedAt { get; set; }
    DateTime UpdatedAt { get; set; }
    string? UpdatedByUserId { get; set; }
}

/// <summary>
/// A club's payout set-up: Stripe Connect hosted onboarding and/or manual BACS details.
/// One per club. Bank details are kept masked only: the sort code, the last four digits of the account or IBAN and
/// the IBAN's country. The full account number and full IBAN are validated on the way in and never stored or logged.
/// </summary>
public class ClubPayoutAccount : IPayoutAccount
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public Club? Club { get; set; }

    public PayoutStatus Status { get; set; }
    public PayoutBusinessType? BusinessType { get; set; }
    public PayoutRegion Region { get; set; } = PayoutRegion.Uk;
    /// <summary>GBP or EUR, following <see cref="Region"/>.</summary>
    public string Currency { get; set; } = "GBP";

    public string? LegalName { get; set; }
    public string? TradingName { get; set; }
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? City { get; set; }
    public string? Postcode { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    /// <summary>Charity number or company number, when the business type has one.</summary>
    public string? RegistrationNumber { get; set; }
    public string? VatNumber { get; set; }

    /// <summary>The responsible person (real onboarding asks for this). Personal data: managers and admins only.</summary>
    public string? PersonFullName { get; set; }
    public DateOnly? PersonDateOfBirth { get; set; }

    public string? StatementDescriptor { get; set; }
    public PayoutSchedule Schedule { get; set; } = PayoutSchedule.Weekly;

    // Masked bank details. There is deliberately no column for a full account number or IBAN.
    public string? BankAccountHolder { get; set; }
    public string? BankName { get; set; }
    public string? SortCode { get; set; }
    public string? AccountLast4 { get; set; }
    public string? IbanCountry { get; set; }
    public string? IbanLast4 { get; set; }

    public string? StripeAccountId { get; set; }
    public bool StripeChargesEnabled { get; set; }
    public bool StripePayoutsEnabled { get; set; }
    public bool StripeDetailsSubmitted { get; set; }
    public DateTime? StripeConnectedAt { get; set; }
    public bool ManualBacsReady { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string? UpdatedByUserId { get; set; }
}
