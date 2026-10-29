using System.ComponentModel.DataAnnotations;
namespace MountedGames.Api.Dtos;
public record HeatCallDto(int HeatId, DateTime CalledAt);
public record RequestSubstitutionDto(
    [Range(1, int.MaxValue)] int OutRiderEntryId,
    [Range(0, int.MaxValue)] int InRiderEntryId,
    [Required, StringLength(500, MinimumLength = 1)] string Reason,
    [StringLength(200)] string? ReplacementRiderName = null,
    [StringLength(200)] string? ReplacementHorseName = null);
public record SubstitutionRequestDto(int Id, int DeclarationFormId, int TeamId, string TeamName,
    int OutRiderEntryId, int InRiderEntryId, string OutRiderName, string? InRiderName,
    string? ReplacementRiderName, string? ReplacementHorseName, string Reason, string Status,
    DateTime RequestedAt, DateTime? DecidedAt);
public record DecideSubstitutionDto(bool Approve);
