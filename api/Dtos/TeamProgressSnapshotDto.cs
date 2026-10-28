namespace MountedGames.Api.Dtos;

/// <summary>
/// ObservedAt is the snapshot read time, not the last event change. StaleAt is a display freshness bound;
/// consumers must stop presenting this snapshot as live after it, even if they are offline.
/// </summary>
public sealed record TeamProgressSnapshotDto(
    TeamProgressDto Progress,
    DateTimeOffset ObservedAt,
    DateTimeOffset StaleAt);
