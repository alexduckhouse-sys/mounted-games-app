using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

public static class ChatModeration
{
    // Personal hiding is not an access boundary: an already-rendered message can still be reported
    // or blocked again. Private message authorisation is always checked independently.
    public static IQueryable<ChatMessage> VisibleTo(this IQueryable<ChatMessage> query, string? userId, bool isAdmin)
        => isAdmin ? query : query.Where(m => !m.AdminOnly
            || (userId != null && (m.UserId == userId || m.RecipientUserId == userId)));

    public static IQueryable<ChatMessage> WithoutBlockedAuthors(this IQueryable<ChatMessage> query,
        AppDbContext db, string? userId)
        => userId == null ? query : query.Where(m => m.UserId == null
            || !db.ChatUserBlocks.Any(b => b.UserId == userId && b.BlockedUserId == m.UserId));

    public static Task<bool> IsDirectMessageBlockedAsync(AppDbContext db, string sender, string recipient,
        CancellationToken cancellationToken = default)
        => db.ChatUserBlocks.AnyAsync(b => (b.UserId == sender && b.BlockedUserId == recipient)
            || (b.UserId == recipient && b.BlockedUserId == sender), cancellationToken);
}
