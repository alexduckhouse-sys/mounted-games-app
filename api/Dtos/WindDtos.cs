using System.ComponentModel.DataAnnotations;
namespace MountedGames.Api.Dtos;

public record WindRulesRequest(int ExpectedRevision, [Required, MaxLength(80)] string ProfileId,
    [MaxLength(100)] string EventLevel, [MaxLength(150)] string PublishedSpare,
    IReadOnlyList<string> PermittedRaces, [MaxLength(1000)] string VenueNotes,
    [Range(1, 100)] double ReviewMph = 25, [Range(1, 100)] double OfficialReviewMph = 35,
    [Range(1, 150)] double? VenueLimitMph = null, bool AdoptionConfirmed = false, int SectionId = 0);
public record WindPreviewRequest(int SessionId, int RaceId, [Required, MaxLength(150)] string Replacement);
public record WindApplyRequest(int SessionId, int RaceId, [Required, MaxLength(150)] string Replacement,
    [Required, MaxLength(80)] string Fingerprint, [Required, MaxLength(80)] string RequestId,
    [Required, MaxLength(100)] string Authority, [Required, MaxLength(1000)] string Decision, bool EquipmentConfirmed);
public record WindRaceScopeDto(int RaceId, int HeatId, string Heat, string Before, string After, int Revision);
public record WindPreviewDto(string Fingerprint, string ProfileId, string Authority, string Source, string Clause,
    IReadOnlyList<WindRaceScopeDto> Races, string Rules, string DiagramJson, string Equipment,
    bool CanApply, string? BlockedReason);

public record WindAcknowledgeRequest([MaxLength(500)] string Arena, long StartsAt, long EndsAt,
    [Range(0, 300)] double PeakMph, [Range(1, 2)] int Severity);

// Compare the programme the organiser edited, including future races in every heat.
public record WindProgrammeSnapshot(IReadOnlyList<string> PlannedRaces, IReadOnlyList<int> HeatIds,
    IReadOnlyList<WindProgrammeRace> Races);
public record WindProgrammeRace(int RaceId, int HeatId, int OrderIndex, string Name, int ProgrammeRevision);
