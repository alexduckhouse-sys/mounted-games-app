namespace MountedGames.Api.Entities;

/// <summary>
/// Personal payout set-up for an independent competition organiser (without a club) or an Event Shop / Tack Shop seller.
/// Keyed uniquely by <see cref="UserId"/>. Bank details are stored masked only, matching <see cref="ClubPayoutAccount"/>.
/// </summary>
public class UserPayoutAccount : IPayoutAccount
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public AppUser? User { get; set; }

    public PayoutStatus Status { get; set; }
    public PayoutBusinessType? BusinessType { get; set; }
    public PayoutRegion Region { get; set; } = PayoutRegion.Uk;
    public string Currency { get; set; } = "GBP";

    public string? LegalName { get; set; }
    public string? TradingName { get; set; }
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? City { get; set; }
    public string? Postcode { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string? RegistrationNumber { get; set; }
    public string? VatNumber { get; set; }

    public string? PersonFullName { get; set; }
    public DateOnly? PersonDateOfBirth { get; set; }

    public string? StatementDescriptor { get; set; }
    public PayoutSchedule Schedule { get; set; } = PayoutSchedule.Weekly;

    // Masked bank details.
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

    // DAC7 calendar-year Tack Shop reporting counters & verification flag.
    public int AnnualTackShopSalesCount { get; set; }
    public long AnnualTackShopSalesMinor { get; set; }
    public bool TaxIdVerified { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string? UpdatedByUserId { get; set; }
}
