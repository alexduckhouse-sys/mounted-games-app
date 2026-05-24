namespace MountedGames.Api.Entities;

public class DeclarationForm
{
    public int Id { get; set; }
    public int TeamId { get; set; }
    public Team? Team { get; set; }

    public string? SubmittedByUserId { get; set; }
    public AppUser? SubmittedBy { get; set; }

    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
    public string? Notes { get; set; }
    public bool IsLocked { get; set; }

    public ICollection<RiderEntry> Riders { get; set; } = new List<RiderEntry>();
}
