namespace MountedGames.Api.Entities;

public class Race
{
    public int Id { get; set; }
    public int HeatId { get; set; }
    public Heat? Heat { get; set; }

    public string Name { get; set; } = string.Empty;
    public int OrderIndex { get; set; }
    public bool IsComplete { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }

    public ICollection<Result> Results { get; set; } = new List<Result>();
}
