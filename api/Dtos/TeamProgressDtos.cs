namespace MountedGames.Api.Dtos;

public enum TeamProgressStatus
{
    Unknown = 0,
    Upcoming = 1,
    InArena = 2,
    Paused = 3,
    DrawPending = 4,
    Finished = 5,
    Withdrawn = 6,
}

/// <summary>
/// Public event progress only. LaneIndex is the one-based drawn lane, not the lane after race rotations.
/// HeatsUntil counts unfinished heats ahead, including a heat currently running; zero does not mean InArena.
/// Transport freshness and Live Activity lifetime belong to the caller, not this calculation.
/// </summary>
public sealed record TeamProgressDto(
    int CompetitionId,
    int TeamId,
    TeamProgressStatus Status,
    int? SessionId,
    int? HeatId,
    int? LaneIndex,
    int? HeatsUntil,
    string? ArenaName,
    string? HeatLabel);
