namespace MountedGames.Api.Entities;

public class RiderEntry
{
    public int Id { get; set; }
    public int DeclarationFormId { get; set; }
    public DeclarationForm? DeclarationForm { get; set; }

    public int? SavedRiderId { get; set; }
    public SavedRider? SavedRider { get; set; }

    public string FullName { get; set; } = string.Empty;
    public DateTime? DateOfBirth { get; set; }
    public string? HorseName { get; set; }
    /// <summary>The pony's height in hands, written as a decimal: 13.2 means 13 hands 2 inches.</summary>
    public decimal? PonyHeightHands { get; set; }
    public string? BibColour { get; set; }
    public bool IsCaptain { get; set; }
    public bool IsReserve { get; set; }
    /// <summary>A guest rider borrowed from outside the team.</summary>
    public bool IsGuestRider { get; set; }
    public int OrderIndex { get; set; }

    /// <summary>Show only the surname's initial on public pages ("Oliver S.").</summary>
    public bool UseInitialOnly { get; set; }
    /// <summary>Opt out of close-up filming and photography; shown to stream staff only.</summary>
    public bool NoFilming { get; set; }

    // Adaptive dec form (see Services/DecForms). All of these are personal data about a child: staff and the
    // submitting trainer only, never a public DTO, stats or log line. A field the organiser switched off is never stored.

    /// <summary>Birth year, when the competition asks for the year only.</summary>
    public int? BirthYear { get; set; }
    /// <summary>Age group as typed ("U12"), when the competition asks for that instead of a birth date.</summary>
    public string? AgeGroup { get; set; }
    /// <summary>Rider weight in kilograms; the form may show stone and pounds, but this is the stored unit.</summary>
    public decimal? WeightKg { get; set; }
    public string? PonyPassportNumber { get; set; }
    /// <summary>The pony's age in years.</summary>
    public int? PonyAge { get; set; }
    public string? MembershipNumber { get; set; }
    public string? EmergencyContactName { get; set; }
    public string? EmergencyContactPhone { get; set; }
    public string? MedicalNotes { get; set; }
    /// <summary>The organiser's own fields, as a JSON object keyed by field id.</summary>
    public string? CustomValuesJson { get; set; }
    /// <summary>
    /// Rule breaches found when the form was submitted, as a JSON array of plain sentences. Stored (not recomputed) so a later
    /// change to the rules doesn't rewrite what the trainer was told. Null or empty means nothing was flagged.
    /// </summary>
    public string? FlagsJson { get; set; }
}
