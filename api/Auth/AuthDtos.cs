namespace MountedGames.Api.Auth;

public record LoginRequest(string Email, string Password);

public record MasterAdminKeyRequest(string Key);

public record AdminKeyRequest(string Key, string? Title = null, string? Email = null, string? Password = null);

public record RegisterRequest(
    string Email,
    string Password,
    string FullName,
    string? Role,
    int? ClubId);

/// <summary>
/// Self-service signup. Trainer requests receive Member access until approved
/// by an admin or their club's team manager; manager requests until approved by an admin.
/// Member signups are granted directly. ClubName is required: if it matches an existing Club
/// (case-insensitive) we use it, otherwise a new Club is created. FullName is the person's own name;
/// without it the name is taken from the start of the username or email.
/// </summary>
public record SignupTrainerRequest(
    string Username,
    string Password,
    string? Role = null,
    string? ClubName = null,
    string? FullName = null);

/// <summary>Deleting your own account needs the current password again, so a stolen session can't do it.</summary>
public record DeleteAccountRequest(string Password);

/// <summary>Changing your own password needs the current one, so a stolen session can't lock the owner out.</summary>
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

/// <summary>The signed-in person's own name, as shown on their profile and in the team.</summary>
public record UpdateMyProfileRequest(string FullName);

public record AuthResponse(
    string Token,
    DateTime ExpiresAt,
    UserProfile User);

public record UserProfile(
    string Id,
    string Email,
    string FullName,
    int? ClubId,
    string? ClubName,
    IReadOnlyList<string> Roles,
    bool EmailConfirmed = true);

/// <summary>Opened from the link in the confirmation email.</summary>
public record ConfirmEmailRequest(string UserId, string Token);

public record TrainerRequestDto(
    string UserId,
    string FullName,
    string? Email,
    string? ClubName,
    DateTime RequestedAt,
    string RequestedRole = Roles.Trainer);

/// <summary>
/// A sign-in provider that is switched on (Google, Apple). <c>ClientId</c> is the public web client ID the browser
/// passes to the provider's own script; it is not a secret.
/// </summary>
public record ExternalProviderDto(string Id, string Name, string ClientId);

/// <summary>
/// Signs in, or finishes creating an account, with a provider's ID token. <c>Nonce</c> is the raw nonce whose SHA-256
/// the provider put in the token. <c>ProviderName</c> is the name Apple hands the page on the first sign-in only (it is
/// not in the token); it is used as the suggested name for a new account and for nothing else. <c>FullName</c>,
/// <c>ClubName</c> and <c>Role</c> complete a new account, as in <see cref="SignupTrainerRequest"/>.
/// </summary>
public record ExternalAuthRequest(
    string Provider,
    string IdToken,
    string? Nonce = null,
    string? FullName = null,
    string? ClubName = null,
    string? Role = null,
    string? ProviderName = null);

/// <summary>
/// Result of <c>POST /api/auth/external</c>. When <c>NeedsSignup</c> is true, the caller is a new person who
/// needs to pick their club and role before the account is created.
/// </summary>
public record ExternalAuthResultDto(
    bool NeedsSignup,
    AuthResponse? Auth,
    string? Email = null,
    string? SuggestedName = null,
    string? Provider = null);
