namespace MountedGames.Api.Entities;

public class HeatEntry
{
    public int Id { get; set; }
    public int HeatId { get; set; }
    public Heat? Heat { get; set; }

    public int TeamId { get; set; }
    public Team? Team { get; set; }

    public int LaneIndex { get; set; }
}
