using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using System.Security.Claims;
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
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

    /// <summary>The sign-in providers that are switched on (a provider with no client ID is left out).</summary>
    [HttpGet("providers")]
    [AllowAnonymous]
    public ActionResult<IReadOnlyList<ExternalProviderDto>> GetProviders([FromServices] IExternalTokenValidator externalValidator)
        => Ok(externalValidator.GetEnabledProviders());

    private const string ExternalTokenRefused = "We couldn't check that sign-in. Try again.";
    private const string AdminsUsePassword = "Admins need to sign in with their email and password, not Google, Apple or Facebook.";
    private const string TicketExpired = "Your sign-in has expired. Sign in again to finish creating your account.";

    /// <summary>Someone signed in with a provider whose address belongs to an account it can't simply open.</summary>
    private ConflictObjectResult AccountExistsUsePassword(string providerName) => Conflict(new
    {
        message = $"There's already an account with this email address. Sign in with your email and password, then add {providerName} from My account.",
        code = "external_link_refused",
    });

    /// <summary>
    /// Signs in with a Google or Apple ID token, or a Facebook access token.
    /// <list type="bullet">
    /// <item>The token must pass <see cref="IExternalTokenValidator"/> (signature, issuer, audience, expiry, nonce, and
    /// for Google and Apple not used before; Facebook's SDK reuses its token, so a Facebook one may sign in again).</item>
    /// <item>A provider sign-in already linked to an account signs in to that account.</item>
    /// <item>Otherwise an account with the same email is linked only when the provider runs that mailbox
    /// (<see cref="ExternalIdentity.MayLinkByEmail"/>) and the account's own email is confirmed, so nobody can register
    /// someone else's address with a password and wait for its owner to sign in. The account's address is told.</item>
    /// <item>Admin accounts and locked, blocked or deleted accounts are never signed in or linked this way. A lockout
    /// after wrong passwords doesn't stop it: that only guards the password.</item>
    /// <item>Nobody found: a ten-minute sign-up ticket (<see cref="ExternalSignupTickets"/>) for
    /// <see cref="ExternalSignup"/>, which makes the account once they've picked a club and role. A provider that didn't
    /// share an address (Facebook can withhold it) gets no ticket: an account's address must come from somewhere checked,
    /// so the person signs up with email and password and adds Facebook from My account.</item>
    /// </list>
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpPost("external")]
    [AllowAnonymous]
    public async Task<ActionResult<ExternalAuthResultDto>> ExternalLogin(
        ExternalAuthRequest req,
        [FromServices] IExternalTokenValidator externalValidator,
        [FromServices] ExternalSignupTickets tickets,
        [FromServices] AccountEmailService accountEmail,
        [FromServices] AccountIpRecorder ipRecorder)
    {
        if (await _db.IsIpBlockedAsync(HttpContext, HttpContext.RequestAborted))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Sign-in from this network is blocked." });

        var checkedSignIn = await CheckExternalTokenAsync(externalValidator, req.Provider, req.IdToken, req.Nonce, ExternalTokenUse.SignIn);
        if (checkedSignIn is not ({ } provider, { } identity))
            return Unauthorized(new { message = ExternalTokenRefused, code = "external_token" });

        // An existing link decides first, so an odd address from the provider never stops someone who is already linked.
        var linkedUser = await _users.FindByLoginAsync(provider.Id, identity.Subject);
        if (linkedUser is not null)
        {
            if (await RefuseExternalSignInAsync(linkedUser) is { } refused) return refused;
            if (!linkedUser.EmailConfirmed && identity.MayLinkByEmail && identity.Email is not null
                && EmailValidation.TryNormalise(identity.Email, out var linkedEmail)
                && string.Equals(linkedUser.Email, linkedEmail, StringComparison.OrdinalIgnoreCase))
            {
                linkedUser.EmailConfirmed = true;
                await _users.UpdateAsync(linkedUser);
            }
            return await ExternalSignInAsync(linkedUser, ipRecorder);
        }

        if (identity.Email is null)
            return BadRequest(new
            {
                message = $"{provider.Name} didn't share your email address with us, so we can't make an account from it. Sign up with your email and a password, then add {provider.Name} from My account.",
                code = "external_email_missing",
            });
        if (!EmailValidation.TryNormalise(identity.Email, out var email))
            return EmailRejected(EmailProblem.Format);

        // The same answer whether or not an account uses this address, so an unconfirmed address reveals nothing.
        if (ExternalProviders.VerifiesEmail(provider.Id) && !identity.EmailVerified)
            return Unauthorized(new
            {
                message = $"{provider.Name} hasn't confirmed this email address yet. Confirm it in your {provider.Name} account, or sign in with your email and password.",
                code = "external_email_unverified",
            });

        var existing = await _users.FindByEmailAsync(email);
        if (existing is not null)
        {
            if (!identity.MayLinkByEmail || !existing.EmailConfirmed)
                return AccountExistsUsePassword(provider.Name);
            if (await RefuseExternalSignInAsync(existing) is { } refused) return refused;
            if (await LinkProblemAsync(existing, provider) is { } problem) return problem;
            var linked = await _users.AddLoginAsync(existing, new UserLoginInfo(provider.Id, identity.Subject, provider.Name));
            if (!linked.Succeeded)
                return AccountExistsUsePassword(provider.Name);
            await accountEmail.SendSignInAddedAsync(existing, provider.Name);
            return await ExternalSignInAsync(existing, ipRecorder);
        }

        if (EmailValidation.IsDisposable(EmailValidation.DomainOf(email)))
            return EmailRejected(EmailProblem.Disposable);

        // Apple's name arrives beside the token, not in it, so it only ever suggests a name for a new account.
        var suggestedName = SuggestedExternalName(identity, req.ProviderName, email);
        // A verified Apple relay address starts confirmed: Apple runs the relay and made it for this person and this app.
        // It still never links to an existing account by email (MayLinkByEmail stays false).
        var vouched = identity.MayLinkByEmail || (identity.IsPrivateRelay && identity.EmailVerified);
        var ticket = tickets.Create(new ExternalSignupTicket(provider.Id, identity.Subject, email, vouched, suggestedName));
        return new ExternalAuthResultDto(NeedsSignup: true, Auth: null, Email: email, SuggestedName: suggestedName, Provider: provider.Id, SignupTicket: ticket);
    }

    /// <summary>
    /// Makes the account for a provider sign-in that found none, from its sign-up ticket and the person's club and role,
    /// through the same path as <see cref="SignupTrainer"/> (the per-network account limit, Member at once, a Trainer or
    /// Manager request awaiting approval). The email is the provider's own; it starts confirmed only when the provider runs
    /// the mailbox (or it's an Apple relay address); otherwise the usual confirmation email goes out.
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpPost("external/signup")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> ExternalSignup(
        ExternalSignupRequest req,
        [FromServices] ExternalSignupTickets tickets,
        [FromServices] IExternalTokenValidator externalValidator,
        [FromServices] AccountEmailService accountEmail,
        [FromServices] IConfiguration config,
        [FromServices] AccountIpRecorder ipRecorder)
    {
        if (await _db.IsIpBlockedAsync(HttpContext, HttpContext.RequestAborted))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Sign-up from this network is blocked." });

        var ticket = tickets.Read(req.Ticket);
        var provider = ticket is null ? null : externalValidator.GetEnabledProviders().FirstOrDefault(p => p.Id == ticket.Provider);
        if (ticket is null || provider is null)
            return Unauthorized(new { message = TicketExpired, code = "external_ticket" });
        if (await _users.FindByLoginAsync(provider.Id, ticket.Subject) is not null)
            return Conflict(new { message = $"You already have an account. Sign in with {provider.Name}.", code = "external_account_exists" });

        var email = ticket.Email;
        if (EmailValidation.IsDisposable(EmailValidation.DomainOf(email)))
            return EmailRejected(EmailProblem.Disposable);
        if (await _users.FindByEmailAsync(email) is not null)
            return AccountExistsUsePassword(provider.Name);

        var clubName = (req.ClubName ?? string.Empty).Trim();
        if (ClubNameProblem(clubName) is { } clubProblem)
            return BadRequest(new { message = clubProblem });
        var givenName = (req.FullName ?? string.Empty).Trim();
        if (givenName.Length > 100)
            return BadRequest(new { message = "Your name must be 100 characters or fewer." });
        var fullName = givenName.Length > 0 ? givenName : ticket.SuggestedName;
        if (fullName.Length == 0)
            return BadRequest(new { message = "Enter your name." });

        var created = await CreateSelfServiceAccountAsync(config, email, fullName, clubName, SelfServiceRole(req.Role),
            emailConfirmed: ticket.EmailVouched, password: null, login: new UserLoginInfo(provider.Id, ticket.Subject, provider.Name));
        if (created.Value is not { } signedUp)
            return created;
        await ipRecorder.RecordAsync(signedUp.User.Id, HttpContext.Connection.RemoteIpAddress?.ToString(), HttpContext.RequestAborted);
        // Sent once, after the account's transaction has committed.
        if (!ticket.EmailVouched)
            await accountEmail.SendConfirmationAsync((await _users.FindByIdAsync(signedUp.User.Id))!);
        return signedUp;
    }

    /// <summary>
    /// Facebook's data deletion callback, set as the app's Data Deletion Request URL. Facebook posts a <c>signed_request</c>
    /// when someone removes the app. Only one signed with our app secret, issued within the last 24 hours and not seen
    /// before is accepted (<see cref="FacebookSignedRequest"/>, <see cref="ExternalTokenReplayGuard"/>). Then:
    /// <list type="bullet">
    /// <item>An account that can only sign in with Facebook (no password, no other provider) is deleted, as if its owner
    /// had deleted it (<see cref="AccountDeletionService"/>), and its sessions end. Otherwise it would be left with no way
    /// in. The last administrator is never deleted this way; only the link goes.</item>
    /// <item>Any other account just loses its Facebook link, so the Facebook user id is gone; it keeps its name and email,
    /// as the privacy page explains, and can be deleted from My account.</item>
    /// </list>
    /// No record of the request is kept beyond a log line with its code (keeping one would need a new table), so the
    /// status page says what happens to every request rather than what happened to this one. The reply is what Facebook
    /// asks for: a status page and a confirmation code. Answers 404 unless Facebook is configured.
    /// </summary>
    [HttpPost("facebook/data-deletion")]
    [AllowAnonymous]
    [Consumes("application/x-www-form-urlencoded")]
    public async Task<IActionResult> FacebookDataDeletion(
        [FromForm(Name = "signed_request")] string? signedRequest,
        [FromServices] FacebookApp facebook,
        [FromServices] ExternalTokenReplayGuard replay,
        [FromServices] AccountDeletionService deletion,
        [FromServices] LiveAccounts accounts,
        [FromServices] TimeProvider time,
        [FromServices] IOptions<EmailOptions> emailOptions,
        [FromServices] IConfiguration config,
        [FromServices] ILogger<AuthController> log)
    {
        if (!facebook.IsConfigured) return NotFound();
        var request = FacebookSignedRequest.Read(signedRequest, facebook.AppSecret!, time.GetUtcNow());
        if (request is null) return BadRequest(new { message = "That request isn't signed by Facebook for this app, or it's out of date." });
        var requestHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(signedRequest!)));
        if (!await replay.TryUseAsync("facebook-deletion", request.UserId, requestHash, request.IssuedAt + FacebookSignedRequest.MaxAge))
            return BadRequest(new { message = "That request has already been handled." });

        var outcome = "no linked account";
        var user = await _users.FindByLoginAsync(ExternalProviders.Facebook, request.UserId);
        if (user is not null)
        {
            var onlyWayIn = !await _users.HasPasswordAsync(user)
                && (await _users.GetLoginsAsync(user)).All(l => l.LoginProvider == ExternalProviders.Facebook);
            if (onlyWayIn && !await deletion.IsLastAdminAsync(user, Roles.Admin))
            {
                await deletion.DeleteAsync(user, HttpContext.RequestAborted);
                await accounts.SessionsEndedAsync(user.Id);
                outcome = "account deleted";
            }
            else
            {
                await _users.RemoveLoginAsync(user, ExternalProviders.Facebook, request.UserId);
                outcome = "link removed";
            }
        }
        var code = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8));
        log.LogInformation("Facebook data deletion request {Code}: {Outcome}.", code, outcome);
        var site = EmailSite.Origin(emailOptions.Value, config) ?? $"{Request.Scheme}://{Request.Host}";
        return Ok(new { url = $"{site}/data-deletion?code={code}", confirmation_code = code });
    }

    /// <summary>How the signed-in person can sign in: whether they have a password, and which providers are linked.</summary>
    [HttpGet("logins")]
    [Authorize]
    public async Task<ActionResult<LinkedSignInsDto>> MyLogins()
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        return await LinkedSignInsAsync(user);
    }

    /// <summary>
    /// Adds a Google, Apple or Facebook sign-in to the signed-in account, from a fresh token for it. Being signed in isn't
    /// enough: <c>Confirm</c> must prove the owner is here (<see cref="ConfirmItsYouAsync"/>), so a stolen session can't
    /// add the thief's own way in. The provider's address doesn't have to match. The account's address is told, and every
    /// other session ends (as when the password changes): this device gets a fresh sign-in back in <c>Auth</c>.
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpPost("logins")]
    [Authorize]
    public async Task<ActionResult<LinkedSignInsDto>> ConnectLogin(
        ExternalConnectRequest req,
        [FromServices] IExternalTokenValidator externalValidator,
        [FromServices] AccountEmailService accountEmail,
        [FromServices] LiveAccounts accounts)
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (await RefuseExternalSignInAsync(user) is { } refused) return refused;
        // Checked before the new token, so a session without the owner never uses it up.
        var confirm = req.Confirm ?? new ReauthRequest();
        if (await ConfirmItsYouAsync(user, confirm.Password, confirm.Provider, confirm.IdToken, confirm.Nonce, externalValidator,
                "Enter your current password to add a way to sign in.", NoWayToConfirm) is { } unconfirmed)
            return unconfirmed;

        var checkedSignIn = await CheckExternalTokenAsync(externalValidator, req.Provider, req.IdToken, req.Nonce, ExternalTokenUse.Confirm);
        if (checkedSignIn is not ({ } provider, { } identity))
            return Unauthorized(new { message = ExternalTokenRefused, code = "external_token" });

        var owner = await _users.FindByLoginAsync(provider.Id, identity.Subject);
        if (owner is not null)
            return owner.Id == user.Id
                ? await LinkedSignInsAsync(user)
                : Conflict(new { message = $"That {provider.Name} account is already linked to a different Mounted Games account.", code = "external_login_taken" });
        if (await LinkProblemAsync(user, provider) is { } problem) return problem;

        // Saved with the new link (AddLoginAsync saves the whole account), so every older token stops working.
        user.SessionVersion++;
        var linked = await _users.AddLoginAsync(user, new UserLoginInfo(provider.Id, identity.Subject, provider.Name));
        if (!linked.Succeeded)
        {
            user.SessionVersion--;
            return Conflict(new { message = $"That {provider.Name} account is already linked to a different Mounted Games account.", code = "external_login_taken" });
        }
        await accounts.SessionsEndedAsync(user.Id, user.SessionVersion);
        await accountEmail.SendSignInAddedAsync(user, provider.Name);
        return await LinkedSignInsAsync(user, await FreshAuthAsync(user));
    }

    /// <summary>
    /// Removes a provider sign-in from the signed-in account, once the owner has proved they're here (the body is a
    /// <see cref="ReauthRequest"/>). The last way in is never removed: an account with no password keeps its only provider.
    /// The account's address is told, and every other session ends; this device gets a fresh sign-in back in <c>Auth</c>.
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpDelete("logins/{provider}")]
    [Authorize]
    public async Task<ActionResult<LinkedSignInsDto>> RemoveLogin(
        string provider,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] ReauthRequest? req,
        [FromServices] IExternalTokenValidator externalValidator,
        [FromServices] AccountEmailService accountEmail,
        [FromServices] LiveAccounts accounts)
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        var logins = await _users.GetLoginsAsync(user);
        var login = logins.FirstOrDefault(l => l.LoginProvider == provider);
        if (login is null) return NotFound();
        if (logins.Count == 1 && !await _users.HasPasswordAsync(user))
            return Conflict(new
            {
                message = $"{login.ProviderDisplayName} is the only way you can sign in, because your account has no password. Keep it, or set a password first.",
                code = "last_sign_in",
            });
        var confirm = req ?? new ReauthRequest();
        if (await ConfirmItsYouAsync(user, confirm.Password, confirm.Provider, confirm.IdToken, confirm.Nonce, externalValidator,
                "Enter your current password to remove a way to sign in.", NoWayToConfirm) is { } unconfirmed)
            return unconfirmed;

        // Saved with the removal (RemoveLoginAsync saves the whole account), so every older token stops working.
        user.SessionVersion++;
        var removed = await _users.RemoveLoginAsync(user, login.LoginProvider, login.ProviderKey);
        if (!removed.Succeeded)
        {
            user.SessionVersion--;
            return StatusCode(500, new { message = "Couldn't remove it. Try again." });
        }
        await accounts.SessionsEndedAsync(user.Id, user.SessionVersion);
        var name = login.ProviderDisplayName ?? login.LoginProvider;
        await accountEmail.SendSignInRemovedAsync(user, name);
        return await LinkedSignInsAsync(user, await FreshAuthAsync(user));
    }

    private const string NoWayToConfirm = "This account has no password or sign-in to confirm it's you. Ask an administrator.";

    /// <summary>
    /// Null when the owner has proved they're here; otherwise the answer to send. An account with a password needs it
    /// (a wrong one counts towards the sign-in lockout, so this can't be used to guess it). One without (made with Google,
    /// Apple or Facebook) needs a fresh sign-in with one of its own linked providers, used once. The shared admin account
    /// has neither, so it can't confirm.
    /// </summary>
    private async Task<ActionResult?> ConfirmItsYouAsync(AppUser user, string? password, string? providerId, string? idToken, string? nonce,
        IExternalTokenValidator externalValidator, string enterPassword, string noWayIn)
    {
        // Signing in with the admin key gives a token for the shared organiser account, which has no password of its own to confirm.
        var shared = string.Equals(user.Email, "admin@mg.local", StringComparison.OrdinalIgnoreCase);
        if (!shared && await _users.HasPasswordAsync(user))
        {
            if (string.IsNullOrEmpty(password))
                return BadRequest(new { message = enterPassword, code = "confirm_with_password" });

            var check = await _signIn.CheckPasswordSignInAsync(user, password, lockoutOnFailure: true);
            if (check.IsLockedOut)
                return BadRequest(new { message = "Too many wrong passwords. Try again in a few minutes." });
            if (!check.Succeeded)
                return BadRequest(new { message = "That password isn't right.", code = "wrong_password" });
            return null;
        }

        IList<UserLoginInfo> logins = shared ? [] : await _users.GetLoginsAsync(user);
        if (logins.Count == 0)
            return Conflict(new { message = noWayIn });
        if (string.IsNullOrEmpty(idToken))
            return BadRequest(new { message = "Sign in again to confirm it's you.", code = "confirm_with_provider" });
        var checkedSignIn = await CheckExternalTokenAsync(externalValidator, providerId, idToken, nonce, ExternalTokenUse.Confirm);
        if (checkedSignIn is not ({ } provider, { } identity))
            return BadRequest(new { message = ExternalTokenRefused, code = "external_token" });
        if (!logins.Any(l => l.LoginProvider == provider.Id && l.ProviderKey == identity.Subject))
            return BadRequest(new { message = $"That isn't the {provider.Name} account linked to this one. Sign in with that one to confirm.", code = "external_wrong_account" });
        return null;
    }

    /// <summary>A new sign-in for this device, under the account's current session version.</summary>
    private async Task<AuthResponse> FreshAuthAsync(AppUser user)
    {
        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club?.Name, roles.ToList(), user.EmailConfirmed));
    }

    private async Task<LinkedSignInsDto> LinkedSignInsAsync(AppUser user, AuthResponse? auth = null)
        => new(await _users.HasPasswordAsync(user),
            (await _users.GetLoginsAsync(user))
                .OrderBy(l => l.LoginProvider, StringComparer.Ordinal)
                .Select(l => new LinkedSignInDto(l.LoginProvider, l.ProviderDisplayName ?? l.LoginProvider))
                .ToList(),
            auth);

    /// <summary>The provider (if it's switched on) and who signed in, or null when the token doesn't pass every check.</summary>
    private async Task<(ExternalProviderDto Provider, ExternalIdentity Identity)?> CheckExternalTokenAsync(
        IExternalTokenValidator externalValidator, string? providerId, string? token, string? nonce, ExternalTokenUse use)
    {
        var id = (providerId ?? string.Empty).Trim().ToLowerInvariant();
        var provider = externalValidator.GetEnabledProviders().FirstOrDefault(p => p.Id == id);
        if (provider is null) return null;
        var checkedToken = await externalValidator.ValidateAsync(provider.Id, token ?? string.Empty, nonce, use, HttpContext.RequestAborted);
        return checkedToken.Identity is { } identity ? (provider, identity) : null;
    }

    /// <summary>One identity per provider per account: a second one is someone else's, or needs the first removed.</summary>
    private async Task<ActionResult?> LinkProblemAsync(AppUser user, ExternalProviderDto provider)
        => (await _users.GetLoginsAsync(user)).Any(l => l.LoginProvider == provider.Id)
            ? Conflict(new
            {
                message = $"Your account here is already linked to a different {provider.Name} account. Use that one, or remove it from My account first.",
                code = "external_other_login",
            })
            : null;

    /// <summary>
    /// Why an account can't be signed in to or linked through a provider, or null if it can. Admins must use their
    /// password; a lock, block or deletion stops this route as it stops the password one. A lockout after wrong
    /// passwords does not: it guards the password, and letting it stop provider sign-in would let anyone who knows the
    /// address lock its owner out.
    /// </summary>
    private async Task<ActionResult?> RefuseExternalSignInAsync(AppUser user)
    {
        var roles = await _users.GetRolesAsync(user);
        if (roles.Contains(Roles.Admin) || roles.Contains(Roles.MasterAdmin))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = AdminsUsePassword, code = "admin_password_only" });
        if (user.IsAccessStopped || user.LockoutEnd == DateTimeOffset.MaxValue)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = AccessStoppedMessage, code = "account_stopped" });
        return null;
    }

    private async Task<ActionResult<ExternalAuthResultDto>> ExternalSignInAsync(AppUser user, AccountIpRecorder ipRecorder)
    {
        await ipRecorder.RecordAsync(user.Id, HttpContext.Connection.RemoteIpAddress?.ToString(), HttpContext.RequestAborted);
        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        return new ExternalAuthResultDto(NeedsSignup: false, Auth: new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club?.Name, roles.ToList(), user.EmailConfirmed)));
    }

    /// <summary>
    /// The name offered for a new account: the token's (Google), else the one the provider handed the page (Apple), else
    /// the start of a real email address. An Apple relay address's start is random letters, so it suggests nothing.
    /// </summary>
    private static string SuggestedExternalName(ExternalIdentity identity, string? providerName, string? email)
    {
        var name = identity.Name;
        if (string.IsNullOrWhiteSpace(name)) name = providerName;
        if (string.IsNullOrWhiteSpace(name)) name = identity.IsPrivateRelay || email is null ? string.Empty : email.Split('@')[0];
        name = string.Join(' ', new string(name.Select(c => char.IsControl(c) ? ' ' : c).ToArray())
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return name.Length > 100 ? name[..100].TrimEnd() : name;
    }


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

        // Everyone belongs to a club (Admin accounts are made separately).
        var clubName = (req.ClubName ?? string.Empty).Trim();
        if (ClubNameProblem(clubName) is { } clubProblem)
            return BadRequest(new { message = clubProblem });

        // A made-up username address can't receive mail, so only a real one is left to confirm.
        var createdAccount = await CreateSelfServiceAccountAsync(config, email, fullName, clubName, SelfServiceRole(req.Role),
            emailConfirmed: !realEmail, password: req.Password, login: null);
        // Send once, after the retryable database transaction has committed.
        if (createdAccount.Value is { } signedUp)
            await ipRecorder.RecordAsync(signedUp.User.Id, HttpContext.Connection.RemoteIpAddress?.ToString(), HttpContext.RequestAborted);
        if (realEmail && createdAccount.Value is { } createdProfile)
            await accountEmail.SendConfirmationAsync((await _users.FindByIdAsync(createdProfile.User.Id))!);
        return createdAccount;
    }

    /// <summary>The role a self-service sign-up asks for: Trainer by default, or Manager or Member.</summary>
    private static string SelfServiceRole(string? requested)
    {
        var value = (requested ?? Roles.Trainer).Trim();
        return value.Equals(Roles.Manager, StringComparison.OrdinalIgnoreCase) ? Roles.Manager
             : value.Equals(Roles.Member, StringComparison.OrdinalIgnoreCase) ? Roles.Member
             : Roles.Trainer;
    }

    private static string? ClubNameProblem(string clubName) => clubName.Length switch
    {
        0 => "Pony Club or team name is required.",
        > 100 => "Pony Club or team name must be 100 characters or fewer.",
        _ => null,
    };

    /// <summary>
    /// Makes a self-service account, the one way both sign-up routes create people: within the per-network account limit,
    /// in the club of that name (joined case-insensitively, or created with the account so a failed sign-up leaves nothing
    /// behind), with Member at once and a Trainer or Manager request awaiting approval (trainers by an admin or their club's
    /// manager, managers by an admin). A password sign-up passes its password; a provider sign-up passes its login instead.
    /// </summary>
    private Task<ActionResult<AuthResponse>> CreateSelfServiceAccountAsync(IConfiguration config, string email, string fullName,
        string clubName, string role, bool emailConfirmed, string? password, UserLoginInfo? login)
        => CreateAccountAsync(config, async (ipHash, accountId) =>
        {
            var club = await _db.Clubs.FirstOrDefaultAsync(c => c.Name.ToLower() == clubName.ToLower());
            club ??= new Club { Name = clubName, Region = "Custom" };

            var user = new AppUser
            {
                Id = accountId,
                UserName = email,
                Email = email,
                FullName = fullName,
                Club = club.Id == 0 ? club : null,
                ClubId = club.Id == 0 ? null : club.Id,
                EmailConfirmed = emailConfirmed
            };
            var result = password is null ? await _users.CreateAsync(user) : await _users.CreateAsync(user, password);
            if (!result.Succeeded)
                return PasswordProblems(result);

            var recordedIp = await _users.AddClaimAsync(user, new Claim(CreatedIpClaimType, ipHash));
            if (!recordedIp.Succeeded) return PasswordProblems(recordedIp);

            if (login is not null)
            {
                var linked = await _users.AddLoginAsync(user, login);
                if (!linked.Succeeded) return AccountExistsUsePassword(login.ProviderDisplayName ?? login.LoginProvider);
            }

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
    /// their data). Needs the current password, or for an account without one a fresh sign-in with its own provider
    /// (<see cref="ConfirmItsYouAsync"/>). The shared admin account and the last Admin are refused.
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpDelete("me")]
    [Authorize]
    public async Task<IActionResult> DeleteMe(DeleteAccountRequest req, [FromServices] AccountDeletionService deletion, [FromServices] LiveAccounts accounts,
        [FromServices] IExternalTokenValidator externalValidator)
    {
        var user = await _users.GetUserAsync(User);
        if (user is null) return Unauthorized();

        if (await ConfirmItsYouAsync(user, req.Password, req.Provider, req.IdToken, req.Nonce, externalValidator,
                "Enter your current password to delete your account.",
                "This account signs in without a password, so it can't be deleted here. Ask an administrator.") is { } unconfirmed)
            return unconfirmed;

        if (await deletion.IsLastAdminAsync(user, Roles.Admin))
            return Conflict(new { message = "This is the only administrator account. Make someone else an administrator first." });

        await deletion.DeleteAsync(user, HttpContext.RequestAborted);
        await accounts.SessionsEndedAsync(user.Id);
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
    /// lockout as signing in, so this can't be used to guess it. It also signs the account out everywhere else: the
    /// account's <c>SessionVersion</c> goes up with the new password, so <see cref="LiveAccounts"/> refuses every older
    /// token at once and their live-hub connections close, and this device gets a fresh token back. Any Google or Apple
    /// sign-in is disconnected in the same transaction, so one an intruder linked doesn't survive the change.
    /// </summary>
    [EnableRateLimiting("auth")]
    [HttpPost("change-password")]
    [Authorize]
    public async Task<ActionResult<AuthResponse>> ChangePassword(ChangePasswordRequest req, [FromServices] LiveAccounts accounts)
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

        var userId = user.Id;
        var (result, changed) = await _db.Database.CreateExecutionStrategy().ExecuteAsync<(IdentityResult, AppUser?)>(async () =>
        {
            _db.ChangeTracker.Clear();
            await using var transaction = await _db.Database.BeginTransactionAsync(HttpContext.RequestAborted);
            var account = await _users.FindByIdAsync(userId);
            if (account is null) return (IdentityResult.Failed(new IdentityError { Code = "Gone", Description = "This account no longer exists." }), null);
            // Saved with the new password (ChangePasswordAsync saves the whole account), so other devices' tokens stop working.
            account.SessionVersion++;
            var outcome = await _users.ChangePasswordAsync(account, req.CurrentPassword, req.NewPassword);
            if (!outcome.Succeeded) return (outcome, null);
            await _db.UserLogins.Where(l => l.UserId == userId).ExecuteDeleteAsync(HttpContext.RequestAborted);
            await transaction.CommitAsync(HttpContext.RequestAborted);
            return (outcome, account);
        });
        if (changed is null)
            return BadRequest(new { message = string.Join(" ", result.Errors.Select(PasswordRules.Friendly).Distinct()) });
        // Live-hub connections opened with an older token close; this device carries on with the token returned here.
        await accounts.SessionsEndedAsync(userId, changed.SessionVersion);
        user = changed;
        var (token, expiresAt, roles) = await _tokens.CreateTokenAsync(user);
        var club = user.ClubId.HasValue ? await _db.Clubs.FindAsync(user.ClubId.Value) : null;
        return new AuthResponse(token, expiresAt,
            new UserProfile(user.Id, user.Email!, user.FullName, user.ClubId, club?.Name, roles.ToList(), user.EmailConfirmed));
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
