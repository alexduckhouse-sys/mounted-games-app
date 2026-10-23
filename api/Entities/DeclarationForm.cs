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

    /// <summary>The coach as typed on the form; it starts as the submitter's account name.</summary>
    public string? TrainerName { get; set; }

    /// <summary>When the submitter agreed to the terms and conditions, and who they were. Null on forms from before the tick existed.</summary>
    public DateTime? TermsAcceptedAt { get; set; }
    public string? TermsAcceptedByUserId { get; set; }

    public ICollection<RiderEntry> Riders { get; set; } = new List<RiderEntry>();
}
