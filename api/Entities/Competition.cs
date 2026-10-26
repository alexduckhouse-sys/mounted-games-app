namespace MountedGames.Api.Entities;

public class Competition
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Icon { get; set; } = "flag";
    public string? Location { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsArchived { get; set; }
    public string? Description { get; set; }
    public string? What3Words { get; set; }
    public string? AppleMapsUrl { get; set; }
    /// <summary>The venue's postcode, trimmed and upper-cased (at most 12 characters). Null when not given.</summary>
    public string? Postcode { get; set; }
    /// <summary>The governing body's number for the event (at most 40 characters). Null when not given.</summary>
    public string? CompetitionNumber { get; set; }
    /// <summary>Where entrants write to the organiser (a plain address, at most 254 characters). Shown on the public Details tab.</summary>
    public string? ContactEmail { get; set; }
    /// <summary>One live-stream URL for the whole competition (YouTube, Twitch, etc).</summary>
    public string? StreamUrl { get; set; }

    /// <summary>
    /// Free-text name of the organising person / club. Set when a trainer
    /// self-promotes to "organiser" by creating a comp.
    /// </summary>
    public string? OrganiserName { get; set; }

    /// <summary>
    /// Where signup money should go — PayPal handle, bank account details,
    /// venmo etc. Free text for v1; will be replaced by a structured Stripe
    /// Connect account id when real payments land.
    /// </summary>
    public string? PaymentDestination { get; set; }

    /// <summary>
    /// When true, the public signup form is hidden on the comp Details tab
    /// and the API rejects new signups. Flip this on once entries close so
    /// the organiser can run the format-after-signups wizard against a
    /// stable signup list. Existing signups stay editable (refund / cancel).
    /// </summary>
    public bool SignupsLocked { get; set; }

    /// <summary>
    /// The event's terms and conditions, as plain text the organiser writes. Shown beside the sign-up tick.
    /// Empty means the form shows a neutral placeholder the organiser should replace.
    /// </summary>
    public string? TermsText { get; set; }

    /// <summary>
    /// The organiser's dec form setup as JSON (<c>DecFormConfig</c>). Null means the standard form: rider name, date of birth,
    /// pony, height and bib. One column rather than a table because it is only ever read and written whole.
    /// </summary>
    public string? DecFormConfigJson { get; set; }

    /// <summary>
    /// The hatband colour worn in each lane, as a JSON array of names: index 0 is lane 1. Set by the organiser when
    /// the competition is created. Null means not set.
    /// </summary>
    public string? LaneHatbands { get; set; }

    /// <summary>
    /// When true, stewards tick off each pony's passport and vaccinations on arrival (event tools, staff only).
    /// </summary>
    public bool EnablePassportCheck { get; set; }

    public string? CreatedByUserId { get; set; }
    public AppUser? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<CompetitionSection> Sections { get; set; } = new List<CompetitionSection>();
    public ICollection<Team> Teams { get; set; } = new List<Team>();
    public ICollection<Session> Sessions { get; set; } = new List<Session>();
    public ICollection<ChatMessage> ChatMessages { get; set; } = new List<ChatMessage>();
}
