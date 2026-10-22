using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
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
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var user = await _users.FindByEmailAsync(req.Email);
        // The shared organiser account uses the admin key. Old demo databases
        // must not retain a second, well-known password login in production.
        if (user is null || (user.Email == "admin@mg.local"
            && !HttpContext.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment()))
            return Unauthorized(new { message = "Invalid email or password." });

        var check = await _signIn.CheckPasswordSignInAsync(user, req.Password, lockoutOnFailure: true);
        if (!check.Succeeded)
            return Unauthorized(new { message = "Invalid email or password." });

        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club?.Name, roles.ToList()));
    }

    [EnableRateLimiting("auth")]
    [HttpPost("admin-key")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> AdminKey([FromServices] IConfiguration config, AdminKeyRequest req)
    {
        var expected = config["Admin:Key"];
        if (string.IsNullOrWhiteSpace(expected) || string.IsNullOrEmpty(req.Key) || !CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(req.Key)), SHA256.HashData(Encoding.UTF8.GetBytes(expected))))
            return Unauthorized(new { message = "Invalid admin key." });

        var user = await _users.FindByEmailAsync("admin@mg.local");
        if (user is null) return StatusCode(500, new { message = "Shared admin account missing — re-seed the database." });

        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user);
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, null, roles.ToList()));
    }

    [EnableRateLimiting("auth")]
    [HttpPost("signup-trainer")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> SignupTrainer(SignupTrainerRequest req)
    {
        var raw = (req.Username ?? string.Empty).Trim();
        if (raw.Length == 0)
            return BadRequest(new { message = "Username is required." });
        if (string.IsNullOrEmpty(req.Password))
            return BadRequest(new { message = "Password is required." });

        // Identity needs an email-like UserName for uniqueness; synthesise one if a bare username was given.
        var email = raw.Contains('@') ? raw.ToLowerInvariant() : $"{Sanitise(raw)}@trainer.mg.local";
        var fullName = raw.Contains('@') ? raw.Split('@')[0] : raw;

        if (await _users.FindByEmailAsync(email) is not null)
            return Conflict(new { message = "That username is already taken." });

        // Trainer is the default request; organising access needs admin approval.
        var requested = (req.Role ?? Roles.Trainer).Trim();
        var role = requested.Equals(Roles.Manager, StringComparison.OrdinalIgnoreCase) ? Roles.Manager
                 : requested.Equals(Roles.Member, StringComparison.OrdinalIgnoreCase) ? Roles.Member
                 : Roles.Trainer;

        // Optional pony club name → ClubId. Case-insensitive exact match; if
        // no match we just leave ClubId null (we don't auto-create clubs).
        int? clubId = null;
        var clubName = (req.ClubName ?? string.Empty).Trim();
        if (clubName.Length > 0)
        {
            var club = await _db.Clubs.FirstOrDefaultAsync(c => c.Name.ToLower() == clubName.ToLower());
            if (club is not null) clubId = club.Id;
        }

        var user = new AppUser
        {
            UserName = email,
            Email = email,
            FullName = fullName,
            ClubId = clubId,
            EmailConfirmed = true
        };
        var result = await _users.CreateAsync(user, req.Password);
        if (!result.Succeeded)
            return BadRequest(new { errors = result.Errors.Select(e => e.Description) });

        var assignedRoles = role == Roles.Trainer
            ? new[] { Roles.Member, Roles.TrainerRequest }
            : new[] { role };
        var assigned = await _users.AddToRolesAsync(user, assignedRoles);
        if (!assigned.Succeeded)
            return BadRequest(new { errors = assigned.Errors.Select(e => e.Description) });

        var (token, expiresAt, rolesOut) = await _tokens.CreateTokenAsync(user);
        var clubNameOut = clubId.HasValue ? (await _db.Clubs.FindAsync(clubId.Value))?.Name : null;
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, clubNameOut, rolesOut.ToList()));
    }

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
            return BadRequest(new { errors = result.Errors.Select(e => e.Description) });

        var role = string.IsNullOrWhiteSpace(req.Role) ? Roles.Trainer : req.Role;
        if (!Roles.All.Contains(role))
            role = Roles.Trainer;
        await _users.AddToRoleAsync(user, role);

        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club?.Name, roles.ToList()));
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

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<UserProfile>> Me()
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        var roles = await _users.GetRolesAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        return new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club?.Name, roles.ToList());
    }
}
