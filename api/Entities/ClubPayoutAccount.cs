namespace MountedGames.Api.Entities;

public enum PayoutStatus { NotStarted = 0, InProgress = 1, Ready = 2 }

public enum PayoutBusinessType { Individual = 0, Club = 1, Charity = 2, Company = 3 }

/// <summary>Where the club is based. It fixes the currency (GBP or EUR) and the kind of bank details taken.</summary>
public enum PayoutRegion { Uk = 0, Eu = 1 }

public enum PayoutSchedule { Daily = 0, Weekly = 1, AfterEachEvent = 2 }

/// <summary>
/// A club's payout set-up: a mock of provider-hosted onboarding (Stripe Connect Express style). No money moves yet.
/// One per club. Bank details are kept masked only: the sort code, the last four digits of the account or IBAN and
/// the IBAN's country. The full account number and full IBAN are validated on the way in and never stored or logged.
/// </summary>
public class ClubPayoutAccount
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

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string? UpdatedByUserId { get; set; }
}
