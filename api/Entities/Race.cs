namespace MountedGames.Api.Entities;

public class Race
{
    public int Id { get; set; }
    public int HeatId { get; set; }
    public Heat? Heat { get; set; }

    public int ProgrammeRevision { get; set; }

    public string Name { get; set; } = string.Empty;
    public int OrderIndex { get; set; }
    public bool IsComplete { get; set; }
    public DateTime? StartedAt { get; set; }
    public bool StartIsExplicit { get; set; }
    public DateTime? FinishedAt { get; set; }
    /// <summary>
    /// An open protest covers this race (on the race itself or its whole heat). Kept in step by
    /// <c>ProtestService</c> in the same transaction as the protest; the public sees only "under review".
    /// </summary>
    public bool HasOpenProtest { get; set; }

    public ICollection<Result> Results { get; set; } = new List<Result>();
}
