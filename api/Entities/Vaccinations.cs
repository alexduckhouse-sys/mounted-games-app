namespace MountedGames.Api.Entities;

/// <summary>Immutable source edition. New rules receive a new ID; event selections never float to the latest.</summary>
public class VaccinationPolicyVersion
{
    public string Id { get; set; } = string.Empty;
    public string Organisation { get; set; } = string.Empty;
    public string Edition { get; set; } = string.Empty;
    public string? SourceUrl { get; set; }
    public DateOnly? EffectiveFrom { get; set; }
    public DateOnly? EffectiveUntil { get; set; }
    public DateOnly? VerifiedOn { get; set; }
    public bool Automatic { get; set; }
    public string RulesJson { get; set; } = "{}";
}
public class EventVaccinationSettings
{
    public int CompetitionId { get; set; }
    public string PolicyVersionId { get; set; } = "manual-v1";
    public int Revision { get; set; } = 1;
    public string ReferenceDateBasis { get; set; } = "arrival";
    public string VenueRulesJson { get; set; } = "[]";
    public DateTime UpdatedAt { get; set; }
    public string? UpdatedByUserId { get; set; }
}
/// <summary>An explicit event-scoped identity. Identical names or passport text never merge records.</summary>
public class VaccinationHorse
{
    public Guid Id { get; set; }
    public int CompetitionId { get; set; }
    public string? CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; }
}
/// <summary>Links a particular declaration row to a horse. A new declaration needs an explicit new link.</summary>
public class VaccinationDeclarationHorse
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public int DeclarationFormId { get; set; }
    public int RiderEntryId { get; set; }
    public Guid HorseId { get; set; }
    public string PonyNameSnapshot { get; set; } = string.Empty;
    public string? PassportSnapshot { get; set; }
    public int Revision { get; set; } = 1;
}
/// <summary>Append-only evidence. Entrant dates and staff-verified histories are separate records.</summary>
public class VaccinationEvidence
{
    public long Id { get; set; }
    public int CompetitionId { get; set; }
    public int DeclarationHorseId { get; set; }
    public int Revision { get; set; }
    public string Source { get; set; } = "entrant";
    public string DatesJson { get; set; } = "[]";
    public bool CompleteHistory { get; set; }
    public DateOnly? ArrivalOn { get; set; }
    public DateOnly? LastOtherVaccinationOn { get; set; }
    public bool ExceptionReview { get; set; }
    public string? Notes { get; set; }
    public string? RecordedByUserId { get; set; }
    public DateTime RecordedAt { get; set; }
}
/// <summary>Official decision against exact evidence and settings revisions, retained when stale.</summary>
public class VaccinationInspection
{
    public long Id { get; set; }
    public int CompetitionId { get; set; }
    public int DeclarationHorseId { get; set; }
    public int LinkRevision { get; set; }
    public long EvidenceId { get; set; }
    public int EvidenceRevision { get; set; }
    public int SettingsRevision { get; set; }
    public string PolicyVersionId { get; set; } = string.Empty;
    public DateOnly EventStartOn { get; set; }
    public string Decision { get; set; } = "review";
    public string Reason { get; set; } = string.Empty;
    public string EvaluationJson { get; set; } = "{}";
    public string? InspectedByUserId { get; set; }
    public DateTime InspectedAt { get; set; }
}
