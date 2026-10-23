using Microsoft.AspNetCore.Identity;

namespace MountedGames.Api.Entities;

public class AppUser : IdentityUser
{
    public string FullName { get; set; } = string.Empty;
    public int? ClubId { get; set; }
    public Club? Club { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>When a confirmation email was last sent. With <see cref="ConfirmationsSentToday"/> it caps how often one account can be mailed.</summary>
    public DateTime? LastConfirmationSentAt { get; set; }
    /// <summary>Confirmation emails sent on the UTC day of <see cref="LastConfirmationSentAt"/>.</summary>
    public int ConfirmationsSentToday { get; set; }

    public ICollection<TrainerNote> Notes { get; set; } = new List<TrainerNote>();
    public ICollection<Team> CoachedTeams { get; set; } = new List<Team>();
}
