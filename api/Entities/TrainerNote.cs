namespace MountedGames.Api.Entities;

public class TrainerNote
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public AppUser? User { get; set; }

    public string? Title { get; set; }
    public string Body { get; set; } = string.Empty;
    public string? Pinned { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
