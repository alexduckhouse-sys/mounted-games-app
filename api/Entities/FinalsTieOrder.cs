namespace MountedGames.Api.Entities;

/// <summary>
/// The organiser's order for a team among teams level on points: from a run-off, or decided by hand. It holds the
/// points total it was set at, and only counts while the team still has that total, so a later score change
/// makes it lapse rather than quietly reorder a different tie.
/// </summary>
public class FinalsTieOrder
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public int TeamId { get; set; }
    public Team? Team { get; set; }

    /// <summary>The team's total points when the order was set.</summary>
    public double Points { get; set; }
    /// <summary>1 for the team placed highest in its tie, 2 for the next, and so on.</summary>
    public int Position { get; set; }
    public DateTime SetAt { get; set; } = DateTime.UtcNow;
    public string? SetByUserId { get; set; }
}
