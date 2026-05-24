namespace MountedGames.Api.Entities;

public class IpBlock
{
    public int Id { get; set; }
    public string IpAddress { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string? CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
