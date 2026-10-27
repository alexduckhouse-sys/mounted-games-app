namespace MountedGames.Api.Entities;

public class ChatReport
{
    public int Id { get; set; }
    public int MessageId { get; set; }
    public ChatMessage Message { get; set; } = null!;
    public string ReporterUserId { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
}

public class ChatUserBlock
{
    public string UserId { get; set; } = string.Empty;
    public string BlockedUserId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}
