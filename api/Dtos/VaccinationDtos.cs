using System.ComponentModel.DataAnnotations;
namespace MountedGames.Api.Dtos;
public record VaccinationPolicyDto(string Id, string Organisation, string Edition, string? SourceUrl,
    DateOnly? EffectiveFrom, DateOnly? EffectiveUntil, DateOnly? VerifiedOn, bool Automatic,
    IReadOnlyList<string> Mandatory, IReadOnlyList<string> Recommended);
public record VenueVaccinationRule(
    [Required, MaxLength(100)] string Name, [Required, MaxLength(80)] string Version,
    [Required, MaxLength(500)] string SourceUrl, DateOnly EffectiveFrom, DateOnly EffectiveUntil,
    [Range(1, 24)] int? MaximumMonths, [Range(0, 31)] int AdditionalDays,
    [Range(0, 30)] int StandDownDays, bool ClearDays, bool ManualReview);
public record VaccinationSettingsDto(int Revision, string PolicyVersionId, string ReferenceDateBasis,
    IReadOnlyList<VenueVaccinationRule> VenueRules, DateOnly EventStartOn);
public record SaveVaccinationSettingsRequest([Range(0, int.MaxValue)] int ExpectedRevision,
    [Required, MaxLength(80)] string PolicyVersionId, [Required] string ReferenceDateBasis,
    [Required, MaxLength(8)] IReadOnlyList<VenueVaccinationRule> VenueRules);
public record VaccinationFinding(string Code, string Message, string? SourceUrl = null, DateOnly? RelevantOn = null);
public record VaccinationEvaluationDto(string Status, DateOnly? ReferenceOn, string PolicyVersionId,
    IReadOnlyList<VaccinationFinding> Mandatory, IReadOnlyList<VaccinationFinding> Recommendations,
    IReadOnlyList<VaccinationFinding> Review, DateOnly? NextRelevantOn);
public record VaccinationEvidenceDto(long Id, int Revision, string Source, IReadOnlyList<DateOnly> Dates,
    bool CompleteHistory, DateOnly? ArrivalOn, bool ExceptionReview, string? Notes, DateTime RecordedAt,
    VaccinationEvaluationDto Evaluation, DateOnly? LastOtherVaccinationOn = null);
public record VaccinationInspectionDto(long Id, string Decision, string Reason, DateTime InspectedAt,
    long EvidenceId, int EvidenceRevision, int SettingsRevision, bool Current, string? InspectedByUserId);
public record VaccinationPonyDto(int RiderEntryId, int DeclarationFormId, int TeamId, string TeamName,
    string PonyName, int Revision, Guid? HorseId, bool IdentityChanged, bool LegacyInspection,
    VaccinationEvidenceDto? Provisional, VaccinationEvidenceDto? Verified,
    VaccinationInspectionDto? Inspection, IReadOnlyList<VaccinationInspectionDto> InspectionHistory);
public record VaccinationBoardDto(bool Enabled, VaccinationSettingsDto Settings,
    IReadOnlyList<VaccinationPolicyDto> Policies, IReadOnlyList<VaccinationPonyDto> Ponies);
public record SaveVaccinationEvidenceRequest([Range(0, int.MaxValue)] int ExpectedRevision,
    [Required, MaxLength(160)] IReadOnlyList<DateOnly> Dates, bool CompleteHistory,
    DateOnly? ArrivalOn, bool ExceptionReview, [MaxLength(1000)] string? Notes, DateOnly? LastOtherVaccinationOn = null);
public record LinkVaccinationHorseRequest([Range(0, int.MaxValue)] int ExpectedRevision, Guid HorseId,
    bool ConfirmSameHorse);
public record InspectVaccinationRequest([Range(1, int.MaxValue)] int ExpectedRevision,
    [Range(0, int.MaxValue)] int ExpectedSettingsRevision, long EvidenceId, DateOnly ExpectedEventStartOn,
    [Required] string Decision, [Required, MaxLength(1000)] string Reason, bool PassportInspected);
