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
    /// <summary>A custom team name ("Welsh Dragons"); riders who share one are formed into a team of that name.</summary>
    public string? TeamName { get; set; }
    /// <summary>A team manager or trainer entering a whole team in one go; it forms its own team named <see cref="TeamName"/>.</summary>
    public bool IsWholeTeam { get; set; }
    /// <summary>Optional phone number (or anything else) captured for the organiser.</summary>
    public string? ContactInfo { get; set; }

    /// <summary>
    /// Optional email address of the adult who signed up (never a rider's). The entry confirmation goes here.
    /// Visible to the competition's staff only.
    /// </summary>
    public string? ContactEmail { get; set; }
    /// <summary>Whether the entry confirmation email went out. Staff can see this; nobody else's email state is shown.</summary>
    public EmailDeliveryStatus ConfirmationEmailStatus { get; set; }
    public DateTime? ConfirmationEmailAt { get; set; }

    /// <summary>
    /// Client-made id for one submit of the sign-up form. A retry of the same submit (same user and section)
    /// returns the existing entry rather than creating another and emailing again.
    /// </summary>
    public string? ClientRequestId { get; set; }

    /// <summary>Show only the surname's initial on public pages ("Oliver S.").</summary>
    public bool UseInitialOnly { get; set; }
    /// <summary>Opt out of close-up filming and photography; shown to stream staff only.</summary>
    public bool NoFilming { get; set; }

    /// <summary>Amount captured from the section's price at signup time (in pence).</summary>
    public int AmountMinor { get; set; }

    public SignupPaymentStatus Status { get; set; } = SignupPaymentStatus.Pending;
    public DateTime? PaidAt { get; set; }

    /// <summary>Optional team id, once the organiser has formed teams from signups.</summary>
    public int? TeamId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// The sign-up tick: parental consent for the riders on this entry (filming opt-outs are <see cref="NoFilming"/>)
    /// plus acceptance of the event terms. Entries made before the tick existed have <c>false</c> and no date.
    /// </summary>
    public bool TermsAccepted { get; set; }
    public DateTime? TermsAcceptedAt { get; set; }
    public string? TermsAcceptedByUserId { get; set; }
    public string? TermsAcceptedByName { get; set; }
    /// <summary>Which wording was on screen (see <c>SignupTerms</c>), so the exact text can be traced later.</summary>
    public string? TermsWordingVersion { get; set; }
}
