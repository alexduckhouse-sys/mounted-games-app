using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using System.Security.Claims;
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Security;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Accounts;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    public const string CreatedIpClaimType = "created_ip";

    private readonly UserManager<AppUser> _users;
    private readonly SignInManager<AppUser> _signIn;
    private readonly TokenService _tokens;
    private readonly AppDbContext _db;

    public AuthController(
        UserManager<AppUser> users,
        SignInManager<AppUser> signIn,
        TokenService tokens,
        AppDbContext db)
    {
        _users = users;
        _signIn = signIn;
        _tokens = tokens;
        _db = db;
    }

    [EnableRateLimiting("auth")]
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req, [FromServices] AccountIpRecorder ipRecorder)
    {
        if (await _db.IsIpBlockedAsync(HttpContext, HttpContext.RequestAborted))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Sign-in from this network is blocked." });

        var user = await _users.FindByEmailAsync(req.Email);
        // The shared organiser account uses the admin key. Old demo databases
        // must not retain a second, well-known password login in production.
        if (user is null || (user.Email == "admin@mg.local"
            && !HttpContext.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment()))
            return Unauthorized(new { message = "Invalid email or password." });

        var check = await _signIn.CheckPasswordSignInAsync(user, req.Password, lockoutOnFailure: true);
        if (!check.Succeeded)
            return Unauthorized(new { message = "Invalid email or password." });
        // Only someone who knows the password hears that the account is stopped, and not why: a lock or a block gives the same answer.
        if (user.IsAccessStopped)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = AccessStoppedMessage, code = "account_stopped" });

        await ipRecorder.RecordAsync(user.Id, HttpContext.Connection.RemoteIpAddress?.ToString(), HttpContext.RequestAborted);
        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club?.Name, roles.ToList(), user.EmailConfirmed));
    }

    private const string AccessStoppedMessage = "This account can't sign in right now. Contact an organiser or administrator.";

    [EnableRateLimiting("auth")]
    [HttpPost("admin-key")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> AdminKey([FromServices] IConfiguration config, AdminKeyRequest req, [FromServices] AccountEmailService accountEmail,
        [FromServices] AccountIpRecorder ipRecorder)
    {
        var expected = config["Admin:Key"];
        if (string.IsNullOrWhiteSpace(expected) || string.IsNullOrEmpty(req.Key) || !CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(req.Key)), SHA256.HashData(Encoding.UTF8.GetBytes(expected))))
            return Unauthorized(new { message = "Invalid admin key." });

        // The key is not a way round a block on the network.
        if (await _db.IsIpBlockedAsync(HttpContext, HttpContext.RequestAborted))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Sign-in from this network is blocked." });

        string? titleOverride = null;
        if (!string.IsNullOrWhiteSpace(req.Title))
        {
            titleOverride = req.Title.Trim();
            if (titleOverride.Length > 100)
                return BadRequest(new { message = "Title must be 100 characters or fewer." });
        }

        string? emailOverride = null;
        if (!string.IsNullOrWhiteSpace(req.Email))
        {
            if (!EmailValidation.TryNormalise(req.Email, out var normEmail))
                return EmailRejected(EmailProblem.Format);
            emailOverride = normEmail;
        }

        if (emailOverride is not null)
        {
            if (string.Equals(emailOverride, "admin@mg.local", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { message = "Choose your own email address." });
            if (string.IsNullOrEmpty(req.Password))
                return BadRequest(new { message = "Password is required to protect your account." });

            var existing = await _users.FindByEmailAsync(emailOverride);
            if (existing is not null)
            {
                // Nor a way round a lock or block on the account.
                if (existing.IsAccessStopped)
                    return StatusCode(StatusCodes.Status403Forbidden, new { message = AccessStoppedMessage, code = "account_stopped" });
                // A shared organiser key does not prove ownership of an existing passwordless identity.
                if (await _users.IsLockedOutAsync(existing) || !await _users.HasPasswordAsync(existing))
                    return Unauthorized(new { message = "This account cannot use organiser-key sign-in. Use your account recovery process or a different address." });
                var check = await _signIn.CheckPasswordSignInAsync(existing, req.Password, lockoutOnFailure: true);
                if (!check.Succeeded)
                    return Unauthorized(new { message = "That email already has an account — enter its password to sign in." });
                if (existing.IsAccessStopped)
                    return StatusCode(StatusCodes.Status403Forbidden, new { message = AccessStoppedMessage, code = "account_stopped" });
                await ipRecorder.RecordAsync(existing.Id, HttpContext.Connection.RemoteIpAddress?.ToString(), HttpContext.RequestAborted);
                return await _db.Database.CreateExecutionStrategy().ExecuteAsync<ActionResult<AuthResponse>>(async () =>
                {
                    _db.ChangeTracker.Clear();
                    existing = await _users.FindByIdAsync(existing.Id);
                    if (existing is null) return Unauthorized(new { message = "This account is no longer available." });
                    await using (var accountTransaction = await _db.Database.BeginTransactionAsync(HttpContext.RequestAborted))
                    {
                        if (!await _users.IsInRoleAsync(existing, Roles.Admin))
                        {
                            var granted = await _users.AddToRoleAsync(existing, Roles.Admin);
                            if (!granted.Succeeded) return PasswordProblems(granted);
                        }
                        existing.FullName = titleOverride ?? existing.FullName;
                        var updated = await _users.UpdateAsync(existing);
                        if (!updated.Succeeded) return PasswordProblems(updated);
                        await accountTransaction.CommitAsync(HttpContext.RequestAborted);
                    }
                    var (existingToken, existingExpires, existingRoles) = await _tokens.CreateTokenAsync(existing);
                    var existingClub = existing.ClubId.HasValue ? await _db.Clubs.FindAsync(existing.ClubId.Value) : null;
                    return new AuthResponse(existingToken, existingExpires,
                        new UserProfile(existing.Id, existing.Email!, existing.FullName, existing.ClubId, existingClub?.Name, existingRoles.ToList(), existing.EmailConfirmed));
                });
            }

            var createdAccount = await CreateAccountAsync(config, async (ipHash, accountId) =>
            {
                var adminUser = new AppUser
                {
                    Id = accountId,
                    UserName = emailOverride,
                    Email = emailOverride,
                    FullName = titleOverride ?? emailOverride.Split('@')[0],
                    EmailConfirmed = false
                };
                var created = await _users.CreateAsync(adminUser, req.Password);
                if (!created.Succeeded)
                    return PasswordProblems(created);
                var grantedRole = await _users.AddToRoleAsync(adminUser, Roles.Admin);
                if (!grantedRole.Succeeded) return PasswordProblems(grantedRole);
                var recordedIp = await _users.AddClaimAsync(adminUser, new Claim(CreatedIpClaimType, ipHash));
                if (!recordedIp.Succeeded) return PasswordProblems(recordedIp);
                var (adminToken, adminExpires, adminRoles) = await _tokens.CreateTokenAsync(adminUser);
                return new AuthResponse(adminToken, adminExpires,
                    new UserProfile(adminUser.Id, adminUser.Email!, adminUser.FullName, null, null, adminRoles.ToList(), adminUser.EmailConfirmed));
            });
            if (createdAccount.Value is { } createdProfile)
            {
                await ipRecorder.RecordAsync(createdProfile.User.Id, HttpContext.Connection.RemoteIpAddress?.ToString(), HttpContext.RequestAborted);
                await accountEmail.SendConfirmationAsync((await _users.FindByIdAsync(createdProfile.User.Id))!);
            }
            return createdAccount;
        }

        var user = await _users.FindByEmailAsync("admin@mg.local");
        if (user is null) return StatusCode(500, new { message = "Shared admin account missing — re-seed the database." });

        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user, titleOverride, emailOverride);
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, emailOverride ?? user.Email!, titleOverride ?? user.FullName, user.ClubId, null, roles.ToList(), user.EmailConfirmed));
    }

    /// <summary>
    /// Becomes master admin by giving the master admin key. A signed-in Admin only. The key itself is never stored: the host holds
    /// its SHA-256 (<c>MasterAdmin:KeyHash</c>). Without that setting this answers 404, as if it didn't exist. The shared
    /// admin-key account can't take the role (everyone who signs in with the admin key would get it). Returns a fresh token,
    /// because roles travel in the token. Logs only the account id.
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpPost("master-admin")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<AuthResponse>> BecomeMasterAdmin(
        MasterAdminKeyRequest req, [FromServices] IConfiguration config, [FromServices] ILogger<AuthController> log)
    {
        var hash = config["MasterAdmin:KeyHash"];
        if (!MasterAdminKey.IsValidHash(hash)) return NotFound();
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (string.Equals(user.Email, "admin@mg.local", StringComparison.OrdinalIgnoreCase))
            return Conflict(new { message = "Sign in with your own account to become master admin." });
        if (!MasterAdminKey.Matches(req?.Key, hash!))
        {
            log.LogWarning("Wrong master admin key from account {UserId}.", user.Id);
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "That key isn't right." });
        }
        if (!await _users.IsInRoleAsync(user, Roles.MasterAdmin))
        {
            var granted = await _users.AddToRoleAsync(user, Roles.MasterAdmin);
            if (!granted.Succeeded) return StatusCode(500, new { message = "Could not grant the role." });
            log.LogInformation("Account {UserId} became master admin.", user.Id);
        }
        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user);
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, null, roles.ToList(), user.EmailConfirmed));
    }

    [EnableRateLimiting("auth")]
    [HttpPost("signup-trainer")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> SignupTrainer(
        SignupTrainerRequest req,
        [FromServices] IEmailDomainChecker domains,
        [FromServices] AccountEmailService accountEmail,
        [FromServices] IConfiguration config,
        [FromServices] AccountIpRecorder ipRecorder)
    {
        if (await _db.IsIpBlockedAsync(HttpContext, HttpContext.RequestAborted))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Sign-up from this network is blocked." });

        var raw = (req.Username ?? string.Empty).Trim();
        if (raw.Length == 0)
            return BadRequest(new { message = "Username is required." });
        if (string.IsNullOrEmpty(req.Password))
            return BadRequest(new { message = "Password is required." });

        // Identity needs an email-like UserName for uniqueness; synthesise one if a bare username was given.
        var realEmail = raw.Contains('@');
        var email = raw.ToLowerInvariant();
        if (realEmail)
        {
            if (!EmailValidation.TryNormalise(raw, out email))
                return EmailRejected(EmailProblem.Format);
            if (EmailValidation.IsDisposable(EmailValidation.DomainOf(email)))
                return EmailRejected(EmailProblem.Disposable);
        }
        else
            email = $"{Sanitise(raw)}@trainer.mg.local";
        var fullName = realEmail ? email.Split('@')[0] : raw;
        var givenName = (req.FullName ?? string.Empty).Trim();
        if (givenName.Length > 100)
            return BadRequest(new { message = "Your name must be 100 characters or fewer." });
        if (givenName.Length > 0) fullName = givenName;

        if (await _users.FindByEmailAsync(email) is not null)
            return Conflict(new { message = "That username is already taken." });

        // The domain has to be able to receive mail. A DNS failure is logged by the checker and lets the sign-up through.
        if (realEmail && await domains.CheckAsync(EmailValidation.DomainOf(email), HttpContext.RequestAborted) == DomainMail.NoMail)
            return EmailRejected(EmailProblem.NoMailServer);

        // Trainer is the default request.
        var requested = (req.Role ?? Roles.Trainer).Trim();
        var role = requested.Equals(Roles.Manager, StringComparison.OrdinalIgnoreCase) ? Roles.Manager
                 : requested.Equals(Roles.Member, StringComparison.OrdinalIgnoreCase) ? Roles.Member
                 : Roles.Trainer;

        // Everyone belongs to a club (Admin accounts are made separately). A name that matches an
        // existing club (case-insensitive) joins it; a new name creates the club.
        var clubName = (req.ClubName ?? string.Empty).Trim();
        if (clubName.Length == 0)
            return BadRequest(new { message = "Pony Club or team name is required." });
        if (clubName.Length > 100)
            return BadRequest(new { message = "Pony Club or team name must be 100 characters or fewer." });

        var createdAccount = await CreateAccountAsync(config, async (ipHash, accountId) =>
        {
            var club = await _db.Clubs.FirstOrDefaultAsync(c => c.Name.ToLower() == clubName.ToLower());
            // A new club is saved together with the account, so a failed signup leaves nothing behind.
            club ??= new Club { Name = clubName, Region = "Custom" };

            var user = new AppUser
            {
                Id = accountId,
                UserName = email,
                Email = email,
                FullName = fullName,
                Club = club.Id == 0 ? club : null,
                ClubId = club.Id == 0 ? null : club.Id,
                // A made-up username address can't receive mail, so only a real one is left to confirm.
                EmailConfirmed = !realEmail
            };
            var result = await _users.CreateAsync(user, req.Password);
            if (!result.Succeeded)
                return PasswordProblems(result);

            var recordedIp = await _users.AddClaimAsync(user, new Claim(CreatedIpClaimType, ipHash));
            if (!recordedIp.Succeeded) return PasswordProblems(recordedIp);

            // Organising access needs approval: trainers by an admin or their club's manager, managers by an admin.
            var assignedRoles = role == Roles.Trainer ? new[] { Roles.Member, Roles.TrainerRequest }
                : role == Roles.Manager ? new[] { Roles.Member, Roles.ManagerRequest }
                : new[] { role };
            var assigned = await _users.AddToRolesAsync(user, assignedRoles);
            if (!assigned.Succeeded)
                return BadRequest(new { errors = assigned.Errors.Select(e => e.Description) });

            var (token, expiresAt, rolesOut) = await _tokens.CreateTokenAsync(user);
            return new AuthResponse(token, expiresAt,
                new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club.Name, rolesOut.ToList(), user.EmailConfirmed));
        });
        // Send once, after the retryable database transaction has committed.
        if (createdAccount.Value is { } signedUp)
            await ipRecorder.RecordAsync(signedUp.User.Id, HttpContext.Connection.RemoteIpAddress?.ToString(), HttpContext.RequestAborted);
        if (realEmail && createdAccount.Value is { } createdProfile)
            await accountEmail.SendConfirmationAsync((await _users.FindByIdAsync(createdProfile.User.Id))!);
        return createdAccount;
    }

    private Task<ActionResult<AuthResponse>> CreateAccountAsync(IConfiguration config, Func<string, string, Task<ActionResult<AuthResponse>>> create)
    {
        var accountId = Guid.NewGuid().ToString();
        AuthResponse? preparedResponse = null;
        return _db.Database.CreateExecutionStrategy().ExecuteAsync<ActionResult<AuthResponse>>(async () =>
        {
            _db.ChangeTracker.Clear();
            // A lost commit acknowledgement must not turn a successful creation into a duplicate/limit error.
            // Only this operation can have created this random id, and its roles/claim share the transaction.
            if (preparedResponse is not null && await _db.Users.AsNoTracking().AnyAsync(u => u.Id == accountId, HttpContext.RequestAborted))
                return preparedResponse;
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var key = !string.IsNullOrWhiteSpace(config["Privacy:IpHashKey"]) ? Encoding.UTF8.GetBytes(config["Privacy:IpHashKey"]!)
                : HMACSHA256.HashData(Encoding.UTF8.GetBytes(config["Jwt:Key"] ?? "dev-only-secret-please-change-me-256-bit-min!!"), "mg-ip-retention-v1"u8);
            var ipHash = IpRetention.Hash(ip, key);
            await using var transaction = await _db.Database.BeginTransactionAsync(HttpContext.RequestAborted);
            // SQLite begins an immediate write transaction. PostgreSQL serialises this network's
            // creations across instances before the count, then releases the lock with the transaction.
            if (_db.Database.IsNpgsql())
            {
                var lockKey = BinaryPrimitives.ReadInt64BigEndian(SHA256.HashData(Encoding.UTF8.GetBytes(ipHash)));
                await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({lockKey})", HttpContext.RequestAborted);
            }
            var maxAccountsPerIp = config.GetValue("RateLimits:AccountsPerIp", 40);
            var createdFromIp = await _db.UserClaims.CountAsync(
                c => c.ClaimType == CreatedIpClaimType && c.ClaimValue == ipHash,
                HttpContext.RequestAborted);
            if (createdFromIp >= maxAccountsPerIp)
                return StatusCode(StatusCodes.Status429TooManyRequests, new { message = $"This network already has the maximum of {maxAccountsPerIp} registered accounts." });
            var result = await create(ipHash, accountId);
            preparedResponse = result.Value;
            if (preparedResponse is not null) await transaction.CommitAsync(HttpContext.RequestAborted);
            return result;
        });
    }

    private BadRequestObjectResult EmailRejected(EmailProblem problem)
        => BadRequest(new { message = EmailValidation.Message(problem), code = problem switch
        {
            EmailProblem.Disposable => "email_disposable",
            EmailProblem.NoMailServer => "email_domain",
            _ => "email_invalid",
        } });

    /// <summary>A 400 with the friendly wording per rule (never Identity's own "non-alphanumeric"), plus the raw codes.</summary>
    private BadRequestObjectResult PasswordProblems(IdentityResult result)
        => BadRequest(new
        {
            errors = result.Errors.Select(PasswordRules.Friendly).Distinct(),
            errorCodes = result.Errors.Select(e => e.Code),
        });

    private static string Sanitise(string s)
    {
        var chars = s.Where(c => char.IsLetterOrDigit(c) || c == '.' || c == '_' || c == '-').ToArray();
        var cleaned = new string(chars).ToLowerInvariant();
        return cleaned.Length == 0 ? "user" : cleaned;
    }

    [EnableRateLimiting("auth")]
    [HttpPost("register")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        if (await _db.IsIpBlockedAsync(HttpContext, HttpContext.RequestAborted))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Registration from this network is blocked." });

        if (await _users.FindByEmailAsync(req.Email) is not null)
            return Conflict(new { message = "An account with that email already exists." });

        var user = new AppUser
        {
            UserName = req.Email,
            Email = req.Email,
            FullName = req.FullName,
            ClubId = req.ClubId,
            EmailConfirmed = true
        };
        var result = await _users.CreateAsync(user, req.Password);
        if (!result.Succeeded)
            return PasswordProblems(result);

        var role = string.IsNullOrWhiteSpace(req.Role) ? Roles.Trainer : req.Role;
        if (role == Roles.Admin && !User.IsInRole(Roles.MasterAdmin))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Only a master admin can make an admin account." });
        // MasterAdmin is never handed out here, so no admin can make a master admin.
        if (!Roles.Assignable.Contains(role))
            role = Roles.Trainer;
        await _users.AddToRoleAsync(user, role);

        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club?.Name, roles.ToList(), user.EmailConfirmed));
    }

    /// <summary>
    /// Deletes the signed-in person's own account (see <see cref="AccountDeletionService"/> for what happens to
    /// their data). Needs the current password. The shared admin account and the last Admin are refused.
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpDelete("me")]
    [Authorize]
    public async Task<IActionResult> DeleteMe(DeleteAccountRequest req, [FromServices] AccountDeletionService deletion, [FromServices] LiveAccounts accounts)
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();

        // Signing in with the admin key gives a token for the shared organiser account, which has no password of its own to confirm.
        if (string.Equals(user.Email, "admin@mg.local", StringComparison.OrdinalIgnoreCase) || !await _users.HasPasswordAsync(user))
            return Conflict(new { message = "This account signs in without a password, so it can't be deleted here. Ask an administrator." });
        if (string.IsNullOrEmpty(req.Password))
            return BadRequest(new { message = "Enter your current password to delete your account." });

        // Counts towards the same lockout as signing in, so this can't be used to guess the password.
        var check = await _signIn.CheckPasswordSignInAsync(user, req.Password, lockoutOnFailure: true);
        if (check.IsLockedOut)
            return BadRequest(new { message = "Too many wrong passwords. Try again in a few minutes." });
        if (!check.Succeeded)
            return BadRequest(new { message = "That password isn't right." });

        if (await deletion.IsLastAdminAsync(user, Roles.Admin))
            return Conflict(new { message = "This is the only administrator account. Make someone else an administrator first." });

        await deletion.DeleteAsync(user, HttpContext.RequestAborted);
        accounts.Forget(user.Id);
        return NoContent();
    }

    /// <summary>
    /// Changes the signed-in person's own name (their sign-in email stays as it is). The shared admin account
    /// takes its name from the sign-in, so it is refused.
    /// </summary>
    [HttpPut("me")]
    [Authorize]
    public async Task<ActionResult<UserProfile>> UpdateMe(UpdateMyProfileRequest req)
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (string.Equals(user.Email, "admin@mg.local", StringComparison.OrdinalIgnoreCase))
            return Conflict(new { message = "This shared account takes its name from how you sign in, so it can't be changed here." });

        var name = (req.FullName ?? string.Empty).Trim();
        if (name.Length == 0)
            return BadRequest(new { message = "Enter your name." });
        if (name.Length > 100)
            return BadRequest(new { message = "Your name must be 100 characters or fewer." });

        user.FullName = name;
        var saved = await _users.UpdateAsync(user);
        if (!saved.Succeeded) return StatusCode(500, new { message = "Could not save your name. Try again." });

        var roles = await _users.GetRolesAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        return new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club?.Name, roles.ToList(), user.EmailConfirmed);
    }

    /// <summary>
    /// Changes the signed-in person's own password. Needs the current one; a wrong guess counts towards the same
    /// lockout as signing in, so this can't be used to guess it. Other signed-in devices keep their tokens until
    /// those expire (tokens aren't tied to the password), so an account that may be stolen should also be locked
    /// by an administrator.
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest req)
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();

        // The shared admin signs in with the admin key and has no password of its own to change.
        if (string.Equals(user.Email, "admin@mg.local", StringComparison.OrdinalIgnoreCase) || !await _users.HasPasswordAsync(user))
            return Conflict(new { message = "This account signs in without a password, so there's none to change." });
        if (string.IsNullOrEmpty(req.CurrentPassword))
            return BadRequest(new { message = "Enter your current password." });
        if (string.IsNullOrEmpty(req.NewPassword))
            return BadRequest(new { message = "Enter a new password." });

        var check = await _signIn.CheckPasswordSignInAsync(user, req.CurrentPassword, lockoutOnFailure: true);
        if (check.IsLockedOut)
            return BadRequest(new { message = "Too many wrong passwords. Try again in a few minutes." });
        if (!check.Succeeded)
            return BadRequest(new { message = "Your current password isn't right." });

        if (req.NewPassword == req.CurrentPassword)
            return BadRequest(new { message = "Choose a different password from your current one." });

        var result = await _users.ChangePasswordAsync(user, req.CurrentPassword, req.NewPassword);
        if (!result.Succeeded)
            return BadRequest(new { message = string.Join(" ", result.Errors.Select(PasswordRules.Friendly).Distinct()) });
        return NoContent();
    }

    /// <summary>
    /// Opens the link from the confirmation email. No sign-in needed. A wrong user, a wrong or old token and an
    /// expired one all get the same answer, so it can't be used to find out who has an account.
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpPost("confirm-email")]
    [AllowAnonymous]
    public async Task<IActionResult> ConfirmEmail(ConfirmEmailRequest req, [FromServices] EmailConfirmationTokens tokens)
    {
        var user = string.IsNullOrWhiteSpace(req.UserId) ? null : await _users.FindByIdAsync(req.UserId);
        if (user is null || !tokens.IsValid(user, req.Token))
            return BadRequest(new { message = "This confirmation link has expired or isn't valid. Sign in and ask for a new one." });
        if (!user.EmailConfirmed)
        {
            user.EmailConfirmed = true;
            var saved = await _users.UpdateAsync(user);
            if (!saved.Succeeded) return StatusCode(500, new { message = "Could not confirm your email. Try again." });
        }
        return Ok(new { confirmed = true });
    }

    /// <summary>Sends the confirmation email again to the signed-in person. Limited to a few a minute per person.</summary>
    [EnableRateLimiting(RequestLimits.EmailResendPolicy)]
    [HttpPost("resend-confirmation")]
    [Authorize]
    public async Task<IActionResult> ResendConfirmation([FromServices] AccountEmailService accountEmail)
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (user.EmailConfirmed) return Ok(new { status = "AlreadyConfirmed" });
        // Made-up usernames and the shared admin account have no mailbox to write to.
        if (string.IsNullOrEmpty(user.Email) || user.Email.EndsWith(".mg.local", StringComparison.OrdinalIgnoreCase))
            return Ok(new { status = "NotSent" });
        var result = await accountEmail.SendConfirmationAsync(user);
        // The per-account cap lives in the database, so it holds whatever the rate limiter allows.
        if (result is ConfirmationResult.TooSoon or ConfirmationResult.DailyLimit)
            return StatusCode(StatusCodes.Status429TooManyRequests, new
            {
                status = result.ToString(),
                message = result == ConfirmationResult.DailyLimit
                    ? "We've sent enough confirmation emails today. Try again tomorrow."
                    : "We sent one a moment ago. Check your inbox and spam folder, or try again in a couple of minutes.",
            });
        return Ok(new { status = result.ToString() });
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<UserProfile>> Me()
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        var roles = await _users.GetRolesAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        var isSharedAdmin = string.Equals(user.Email, "admin@mg.local", StringComparison.OrdinalIgnoreCase);
        var claimName = isSharedAdmin ? User.FindFirstValue("fullName") : null;
        var claimEmail = isSharedAdmin ? (User.FindFirstValue(ClaimTypes.Email) ?? User.FindFirstValue("email")) : null;
        var email = !string.IsNullOrWhiteSpace(claimEmail) ? claimEmail : user.Email!;
        var fullName = !string.IsNullOrWhiteSpace(claimName) ? claimName : user.FullName;
        return new UserProfile(user.Id, email, fullName, user.ClubId, club?.Name, roles.ToList(), user.EmailConfirmed);
    }
}
