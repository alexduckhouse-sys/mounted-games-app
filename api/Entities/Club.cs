namespace MountedGames.Api.Entities;

public class Club
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Region { get; set; }
    public string? BibColour { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<SavedRider> SavedRiders { get; set; } = new List<SavedRider>();
    public ICollection<Team> Teams { get; set; } = new List<Team>();
}
