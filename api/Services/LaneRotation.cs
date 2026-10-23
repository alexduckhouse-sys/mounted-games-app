using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// Which lane a team races in from one race of a heat to the next. A team's drawn lane is its starting
/// position; each race the positions shift by the session's rotation. When a heat has more teams than
/// the session has lanes, the positions that land past the last lane are the teams sitting that race out.
/// Keep in step with <c>web/src/lib/lanes.ts</c>.
/// </summary>
public static class LaneRotation
{
    /// <summary>The lanes in use: the session's lane limit, or one per team when there is no limit.</summary>
    public static int LanesInUse(int teamsInHeat, int? lanesPerHeat)
        => lanesPerHeat is > 0 ? Math.Min(lanesPerHeat.Value, Math.Max(teamsInHeat, 1)) : Math.Max(teamsInHeat, 1);

    /// <summary>
    /// The position a team holds in race <paramref name="raceIndex"/> (0 for the first race), counted from 1
    /// among all teams in the heat. A position above <see cref="LanesInUse"/> means the team sits that race out.
    /// </summary>
    public static int PositionFor(int drawnLane, int raceIndex, int teamsInHeat, LaneRotationMode mode)
    {
        if (teamsInHeat <= 0) return drawnLane;
        var step = mode switch { LaneRotationMode.MoveUp => 1, LaneRotationMode.MoveDown => -1, _ => 0 };
        var shifted = (drawnLane - 1 + step * raceIndex) % teamsInHeat;
        if (shifted < 0) shifted += teamsInHeat;
        return shifted + 1;
    }

    public static bool SitsOut(int drawnLane, int raceIndex, int teamsInHeat, int? lanesPerHeat, LaneRotationMode mode)
        => PositionFor(drawnLane, raceIndex, teamsInHeat, mode) > LanesInUse(teamsInHeat, lanesPerHeat);
}
