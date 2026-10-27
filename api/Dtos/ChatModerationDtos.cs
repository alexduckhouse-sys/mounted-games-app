namespace MountedGames.Api.Dtos;

public record ReportChatMessageRequest(string? Reason);
public record ChatReportDto(int Id, int MessageId, string ReporterUserId, string Reason,
    DateTime CreatedAt, DateTime? ResolvedAt);
public record BlockedChatUserDto(string UserId);
