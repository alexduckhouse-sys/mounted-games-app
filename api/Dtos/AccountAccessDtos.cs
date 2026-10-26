using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

public record CreateInviteRequest(string Email, InviteAccess Access);

/// <summary>
/// A pending invitation, for admins. <c>EmailStatus</c> says whether the last send reached the mail provider
/// (1 sent, 2 failed, 3 sending is switched off), so an admin knows to tell the person another way.
/// </summary>
public record InviteDto(
    int Id, string Email, InviteAccess Access, DateTime CreatedAt, DateTime ExpiresAt, DateTime? LastSentAt,
    EmailDeliveryStatus EmailStatus, int SendCount, bool IsExpired, string? InvitedByName);

/// <summary>What the accept page may show before the person chooses a name and password.</summary>
public record InvitePreviewDto(string Email, InviteAccess Access, DateTime ExpiresAt);
public record InviteTokenRequest(string Token);
public record AcceptInviteRequest(string Token, string FullName, string Password);

public record BlockAccountRequest(string? Reason);
public record BlockResultDto(int NetworksBlocked);

/// <summary>A blocked account, for admins only. <c>Reason</c> is never shown to anyone else.</summary>
public record BlockedAccountDto(
    string Id, string FullName, string? Email, IReadOnlyList<string> Roles, DateTime BlockedAt, string? BlockedByName, string? Reason);

/// <summary>An Admin or organiser account, for the master admin's lock list.</summary>
public record StaffAccountDto(
    string Id, string FullName, string? Email, IReadOnlyList<string> Roles, DateTime? LockedAt, DateTime CreatedAt);
