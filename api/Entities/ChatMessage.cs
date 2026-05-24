namespace MountedGames.Api.Entities;

public class ChatMessage
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }

    public string? UserId { get; set; }
    public AppUser? User { get; set; }

    public string AuthorName { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public ChatMessageType Type { get; set; } = ChatMessageType.Chat;
    public string? Tag { get; set; }

    /// <summary>IP of the poster, captured server-side. Admin-only use for IP blocking.</summary>
    public string? IpAddress { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
