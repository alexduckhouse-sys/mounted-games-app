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

    /// <summary>Private messages to the organisers: visible to admins and the sender (and a reply's recipient), never the public feed.</summary>
    public bool AdminOnly { get; set; }

    /// <summary>For an organiser's private reply: the user whose message thread it belongs to. That user and admins see it.</summary>
    public string? RecipientUserId { get; set; }

    /// <summary>IP of the poster, captured server-side. Admin-only use for IP blocking.</summary>
    public string? IpAddress { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
