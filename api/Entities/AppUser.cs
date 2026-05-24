using Microsoft.AspNetCore.Identity;

namespace MountedGames.Api.Entities;

public class AppUser : IdentityUser
{
    public string FullName { get; set; } = string.Empty;
    public int? ClubId { get; set; }
    public Club? Club { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<TrainerNote> Notes { get; set; } = new List<TrainerNote>();
    public ICollection<Team> CoachedTeams { get; set; } = new List<Team>();
}
