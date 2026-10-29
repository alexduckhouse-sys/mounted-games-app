using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

// Everything here is organiser-only (competition staff): it carries reasons and rider names.

/// <summary>One team's entry status for the organiser's Entries list.</summary>
public record TeamEntryDto(
    int TeamId, string TeamName, int SectionId, string SectionName, bool IsHorsConcours,
    TeamEntryStatus Status, string? Reason, DateTime? ChangedAt,
    /// <summary>False once a draw that depends on the withdrawal has been applied.</summary>
    bool CanReinstate,
    /// <summary>The unscored heats may be able to take a re-draw (a team in this section is out).</summary>
    bool RedrawAvailable);

public record SetTeamEntryStatusRequest(TeamEntryStatus Status, string? Reason);

public record SetTeamEntryStatusResult(
    TeamEntryDto Team,
    /// <summary>How many unscored heat places the team left (withdrawn) or took back (reinstated).</summary>
    int HeatPlacesChanged,
    /// <summary>The sessions whose timetable changed, so the caller can broadcast them.</summary>
    IReadOnlyList<int> ChangedSessionIds);

public record RedrawHeatMoveDto(int TeamId, string TeamName, int? FromHeatId, int? ToHeatId);

public record RedrawSessionDto(
    int SessionId, string Name,
    /// <summary>Heats left alone because they are scored, signed off or already started.</summary>
    int ProtectedHeats,
    IReadOnlyList<DrawHeatDto> Before,
    IReadOnlyList<DrawHeatDto> After,
    IReadOnlyList<int> RemovedHeatIds,
    IReadOnlyList<RedrawHeatMoveDto> Moves);

public record WithdrawnTeamDto(int TeamId, string TeamName, TeamEntryStatus Status);

public record RedrawPreviewDto(
    int SectionId, string Fingerprint, bool HasChanges,
    IReadOnlyList<WithdrawnTeamDto> OutTeams,
    IReadOnlyList<RedrawSessionDto> Sessions,
    IReadOnlyList<string> Notes,
    /// <summary>True when this answer repeats an apply that already went through (a retry).</summary>
    bool Replayed = false);

public record ApplyRedrawRequest(string Fingerprint, string RequestId);

public record SwapRiderRequest(
    int OutRiderEntryId, int InRiderEntryId, string? Reason, bool OverrideLock, string RequestId);

public record RiderSwapSnapshotDto(
    int RiderEntryId, string FullName, bool IsReserve, bool IsCaptain, int OrderIndex, string? HorseName = null);

public record RiderSwapDto(
    int Id, int DeclarationFormId, int TeamId, int OutRiderEntryId, int InRiderEntryId,
    IReadOnlyList<RiderSwapSnapshotDto> Before, IReadOnlyList<RiderSwapSnapshotDto> After,
    string? ActorUserId, string Reason, bool OverrodeLock, DateTime CreatedAt,
    bool Replayed = false);
