using System.ComponentModel.DataAnnotations;
using MountedGames.Api.Entities.Commerce;
namespace MountedGames.Api.Dtos;

public record NativeInstallationDto(Guid InstallationId, string Capability);
public record AppleActivityRequest([Required, StringLength(200)] string ActivityId, int CompetitionId, int TeamId,
    [Required, RegularExpression("^[0-9a-fA-F]{32,512}$")] string PushToken, bool Sandbox, DateTimeOffset StartedAt);
public record ArrivalSourceRequest(int OrderLineId, [Range(1, 1000)] int Quantity);
public record ArrivalBookingRequest(long ExpectedRevision, int? SignupId, [StringLength(40)] string VehicleRegistration,
    [Required, MaxLength(100)] List<ArrivalSourceRequest> Sources);
public record ArrivalAllocationRequest(int SourceId, [Required, StringLength(80)] string Resource,
    [Required, RegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")] string Night);
public record ArrivalAllocateRequest(long ExpectedRevision, [Required, MaxLength(500)] List<ArrivalAllocationRequest> Allocations);
public record FulfilmentRequest(ArrivalFulfilmentKind Kind, string? FromDate, string? UntilDate, long ExpectedVersion);
public record ArrivalEntitlementDto(int OrderLineId, string Title, ArrivalFulfilmentKind Kind, int Quantity,
    int Assigned, string Status, string? FromDate, string? UntilDate, long Revision);
public record ArrivalBenefitDto(int SourceId, int OrderLineId, ArrivalFulfilmentKind Kind, int Quantity,
    string Status, string? FromDate, string? UntilDate, IReadOnlyList<ArrivalPlaceDto> Allocations);
public record ArrivalPlaceDto(string Resource, string Night);
public record ArrivalBookingDto(Guid Id, int CompetitionId, string CompetitionName, DateTime StartDate,
    DateTime? EndDate, string? Venue, string VehicleRegistration, string Reference, long Revision,
    string Admission, IReadOnlyList<ArrivalBenefitDto> Benefits, bool NeedsReview, bool Voided, bool WalletAvailable, double? Latitude, double? Longitude, int? SignupId = null);
public record WalletRegisterRequest([Required, RegularExpression("^[0-9a-fA-F]{32,512}$")] string PushToken);
