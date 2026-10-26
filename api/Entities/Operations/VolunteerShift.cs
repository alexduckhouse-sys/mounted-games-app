namespace MountedGames.Api.Entities.Operations;

public class VolunteerShift
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public int? SessionId { get; set; }
    public Session? Session { get; set; }
    public string? ArenaName { get; set; }
    public string Role { get; set; } = string.Empty;
    public string? StartTimeLabel { get; set; }
    public string? Notes { get; set; }
    public int RequiredCount { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<VolunteerClaim> Claims { get; set; } = new List<VolunteerClaim>();
}

public class VolunteerClaim
{
    public int Id { get; set; }
    public int ShiftId { get; set; }
    public VolunteerShift? Shift { get; set; }
    public string UserId { get; set; } = string.Empty;
    public AppUser? User { get; set; }
    public string VolunteerName { get; set; } = string.Empty;
    public string? ClubName { get; set; }
    public string? ContactPhone { get; set; }
    public DateTime ClaimedAt { get; set; } = DateTime.UtcNow;
}
