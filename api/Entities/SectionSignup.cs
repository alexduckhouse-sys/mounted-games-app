namespace MountedGames.Api.Entities;

public enum SignupPaymentStatus
{
    Pending = 0,
    Paid = 1,
    Refunded = 2,
    Cancelled = 3,
}

/// <summary>
/// A pay-to-join signup for a single competition section. Captures the
/// signing-up person's details (they may or may not have a logged-in account),
/// the amount due, and the payment status.
///
/// In v1 there is no payment integration — `Status` starts at `Pending` and
/// an admin manually flips it to `Paid` once the money has landed via the
/// comp's <c>PaymentDestination</c>. When Stripe Connect (or similar) is
/// wired in, the status will be driven by webhooks.
/// </summary>
public class SectionSignup
{
    public int Id { get; set; }
    public int CompetitionSectionId { get; set; }
    public CompetitionSection? Section { get; set; }

    /// <summary>Optional — set when the signup came from a logged-in user.</summary>
    public string? UserId { get; set; }
    public AppUser? User { get; set; }

    /// <summary>The person paying (team manager / trainer / individual).</summary>
    public string FullName { get; set; } = string.Empty;
    /// <summary>Pony Club branch they're representing — free text for v1.</summary>
    public string? PonyClubName { get; set; }
    /// <summary>Optional phone / email captured for the organiser.</summary>
    public string? ContactInfo { get; set; }

    /// <summary>Amount captured from the section's price at signup time (in pence).</summary>
    public int AmountMinor { get; set; }

    public SignupPaymentStatus Status { get; set; } = SignupPaymentStatus.Pending;
    public DateTime? PaidAt { get; set; }

    /// <summary>Optional team id, once the organiser has formed teams from signups.</summary>
    public int? TeamId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
