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
/// Self-service signup. Role defaults to "Trainer" but can be "Manager" or
/// "Member" — all three are identical capability-wise today; the difference
/// is just self-identification on profile / display. ClubName is optional;
/// if it matches an existing Club row (case-insensitive) we set ClubId.
/// </summary>
public record SignupTrainerRequest(
    string Username,
    string Password,
    string? Role = null,
    string? ClubName = null);

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
