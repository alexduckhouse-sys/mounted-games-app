namespace MountedGames.Api.Entities;

public class SavedRider
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public Club? Club { get; set; }

    public string FullName { get; set; } = string.Empty;
    public DateTime? DateOfBirth { get; set; }
    public string? HorseName { get; set; }
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
