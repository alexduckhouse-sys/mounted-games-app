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

/// <summary>
/// Deleting your own account needs the current password again, so a stolen session can't do it. An account with no
/// password (made with Google, Apple or Facebook) confirms with a fresh sign-in instead: one of its linked providers'
/// tokens and the raw nonce, as in <see cref="ExternalAuthRequest"/>.
/// </summary>
public record DeleteAccountRequest(string? Password = null, string? Provider = null, string? IdToken = null, string? Nonce = null);

/// <summary>
/// Proof that the owner is here, for changing how the account signs in (<c>POST /api/auth/logins</c>,
/// <c>DELETE /api/auth/logins/{provider}</c>): the current password if the account has one, otherwise a fresh sign-in
/// with a provider already linked to it, exactly as for <see cref="DeleteAccountRequest"/>.
/// </summary>
public record ReauthRequest(string? Password = null, string? Provider = null, string? IdToken = null, string? Nonce = null);

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
/// A sign-in provider that is switched on (Google, Apple, Facebook). <c>ClientId</c> is the public web client ID the browser
/// passes to the provider's own script; it is not a secret.
/// </summary>
public record ExternalProviderDto(string Id, string Name, string ClientId);

/// <summary>
/// Signs in with a provider's ID token. <c>Nonce</c> is the raw nonce whose SHA-256 the provider put in the token; the
/// pair works once. <c>ProviderName</c> is the name Apple hands the page on the first sign-in only (it is not in the
/// token); it is only ever the suggested name for a new account.
/// </summary>
public record ExternalAuthRequest(
    string Provider,
    string IdToken,
    string? Nonce = null,
    string? ProviderName = null);

/// <summary>
/// Result of <c>POST /api/auth/external</c>. When <c>NeedsSignup</c> is true, the caller is a new person who needs to
/// pick their club and role: <c>SignupTicket</c> finishes the account through <c>POST /api/auth/external/signup</c>
/// within ten minutes.
/// </summary>
public record ExternalAuthResultDto(
    bool NeedsSignup,
    AuthResponse? Auth,
    string? Email = null,
    string? SuggestedName = null,
    string? Provider = null,
    string? SignupTicket = null);

/// <summary>
/// Finishes a provider sign-up: the ticket from <see cref="ExternalAuthResultDto"/> plus the same details as
/// <see cref="SignupTrainerRequest"/>. The email is always the provider's: a sign-in that gave none never gets a ticket.
/// </summary>
public record ExternalSignupRequest(string Ticket, string? FullName = null, string? ClubName = null, string? Role = null);

/// <summary>
/// Adds a Google, Apple or Facebook sign-in to the signed-in account: a fresh token for it (with the raw nonce for Google
/// and Apple), and <c>Confirm</c>, proof that the owner is here (<see cref="ReauthRequest"/>).
/// </summary>
public record ExternalConnectRequest(string Provider, string IdToken, string? Nonce = null, ReauthRequest? Confirm = null);

/// <summary>One provider sign-in linked to the account. The provider's own id for the person is never sent.</summary>
public record LinkedSignInDto(string Provider, string Name);

/// <summary>
/// How the signed-in person can sign in: whether there is a password, and which providers are linked. After Connect or
/// Remove, <c>Auth</c> is this device's new sign-in: the change ended every other session, as changing the password does.
/// </summary>
public record LinkedSignInsDto(bool HasPassword, IReadOnlyList<LinkedSignInDto> Logins, AuthResponse? Auth = null);
