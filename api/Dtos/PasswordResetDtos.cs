namespace MountedGames.Api.Dtos;

/// <summary>"Email me a link to reset my password."</summary>
public record PasswordResetRequest(string? Email);

/// <summary>The token from the emailed link (it travels in the page fragment, then in this body; never a URL).</summary>
public record PasswordResetTokenRequest(string? Token);

public record PasswordResetConfirmRequest(string? Token, string? NewPassword);

/// <summary>The one answer to every reset request, whether or not the address has an account.</summary>
public record PasswordResetRequestedResponse(string Message);

/// <summary>What a reset link is, without saying whose account it belongs to.</summary>
public enum PasswordResetLinkState
{
    Valid = 0,
    /// <summary>Past its 30 minutes, or replaced by a newer link or a completed reset.</summary>
    Expired = 1,
    Used = 2,
    /// <summary>Unknown, malformed, or for an account that can no longer be reset (deleted, locked, blocked).</summary>
    Invalid = 3,
}

/// <param name="ExpiresAt">Only for a <see cref="PasswordResetLinkState.Valid"/> link.</param>
public record PasswordResetCheckResponse(PasswordResetLinkState State, DateTime? ExpiresAt);

public record PasswordResetDoneResponse(string Message);

/// <summary>
/// A refused confirm. <see cref="Code"/> is <c>invalid</c> (404), <c>expired</c> or <c>used</c> (410), or
/// <c>password_required</c> or <c>password_rules</c> (400, with friendly <see cref="Errors"/> and Identity's
/// <see cref="ErrorCodes"/>, as sign-up gives them).
/// </summary>
public record PasswordResetProblem(string Code, string Message, IReadOnlyList<string>? Errors = null, IReadOnlyList<string>? ErrorCodes = null);
