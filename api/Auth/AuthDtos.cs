namespace MountedGames.Api.Auth;

public record LoginRequest(string Email, string Password);

public record AdminKeyRequest(string Key);

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
/// (case-insensitive) we use it, otherwise a new Club is created.
/// </summary>
public record SignupTrainerRequest(
    string Username,
    string Password,
    string? Role = null,
    string? ClubName = null);

/// <summary>Deleting your own account needs the current password again, so a stolen session can't do it.</summary>
public record DeleteAccountRequest(string Password);

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
    IReadOnlyList<string> Roles);

public record TrainerRequestDto(
    string UserId,
    string FullName,
    string? Email,
    string? ClubName,
    DateTime RequestedAt,
    string RequestedRole = Roles.Trainer);
