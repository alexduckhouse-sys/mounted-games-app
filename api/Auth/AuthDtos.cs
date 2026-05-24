namespace MountedGames.Api.Auth;

public record LoginRequest(string Email, string Password);

public record AdminKeyRequest(string Key);

public record RegisterRequest(
    string Email,
    string Password,
    string FullName,
    string? Role,
    int? ClubId);

public record SignupTrainerRequest(
    string Username,
    string Password);

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
