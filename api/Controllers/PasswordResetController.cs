using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Security;
using MountedGames.Api.Services.Accounts;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Controllers;

/// <summary>
/// "Forgot your password?" (see <see cref="PasswordResetService"/>). Asking for a link always gets the same 202 and takes
/// at least the same time, so nobody can learn whether an address has an account. The token travels in the emailed page's
/// fragment and then in request bodies, never in a URL, so it stays out of server and proxy logs.
/// </summary>
[ApiController]
public sealed class PasswordResetController(AppDbContext db, PasswordResetService resets, TimeProvider time) : ControllerBase
{
    public const string RequestedMessage =
        "If there's an account for that address, we've sent it a link to choose a new password. The link works for 30 minutes.";
    private const string BlockedMessage = "Password resets from this network are blocked.";

    [HttpPost("api/auth/password-reset/request")]
    [AllowAnonymous]
    [EnableRateLimiting(RequestLimits.PasswordResetRequestPolicy)]
    public async Task<IActionResult> RequestLink(PasswordResetRequest request, CancellationToken ct)
    {
        // Only the shape is checked here, which says nothing about whether the address has an account.
        if (!EmailAddresses.TryNormalise(request.Email, out var address))
            return BadRequest(new { message = "Enter the email address you sign in with." });
        if (await db.IsIpBlockedAsync(HttpContext, ct))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = BlockedMessage });

        var started = time.GetTimestamp();
        await resets.RequestAsync(address, HttpContext.Connection.RemoteIpAddress?.ToString(), ct);
        var wait = resets.MinimumResponse - time.GetElapsedTime(started);
        if (wait > TimeSpan.Zero) await Task.Delay(wait, time, ct);
        return Accepted(new PasswordResetRequestedResponse(RequestedMessage));
    }

    /// <summary>Lets the page say "this link has expired" before anyone types a password. Never says whose account it is.</summary>
    [HttpPost("api/auth/password-reset/check")]
    [AllowAnonymous]
    [EnableRateLimiting(RequestLimits.PasswordResetLinkPolicy)]
    public async Task<ActionResult<PasswordResetCheckResponse>> Check(PasswordResetTokenRequest request, CancellationToken ct)
    {
        var (state, expiresAt) = await resets.CheckAsync(request.Token, ct);
        return new PasswordResetCheckResponse(state, expiresAt);
    }

    /// <summary>Sets the new password and signs the account out everywhere. Returns no session: the person signs in again.</summary>
    [HttpPost("api/auth/password-reset/confirm")]
    [AllowAnonymous]
    [EnableRateLimiting(RequestLimits.PasswordResetLinkPolicy)]
    public async Task<IActionResult> Confirm(PasswordResetConfirmRequest request, CancellationToken ct)
    {
        if (await db.IsIpBlockedAsync(HttpContext, ct))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = BlockedMessage });

        var result = await resets.ConfirmAsync(request.Token, request.NewPassword, ct);
        return result.Outcome switch
        {
            PasswordResetOutcome.Changed => Ok(new PasswordResetDoneResponse("Your password has been changed. Sign in with your new password.")),
            PasswordResetOutcome.PasswordRequired => BadRequest(new PasswordResetProblem("password_required", "Enter a new password.")),
            PasswordResetOutcome.PasswordRules => BadRequest(new PasswordResetProblem("password_rules", "Your new password doesn't meet the rules.",
                result.Errors!.Select(PasswordRules.Friendly).Distinct().ToList(), result.Errors!.Select(e => e.Code).ToList())),
            PasswordResetOutcome.Expired => StatusCode(StatusCodes.Status410Gone,
                new PasswordResetProblem("expired", "This link has expired. Ask for a new one.")),
            PasswordResetOutcome.Used => StatusCode(StatusCodes.Status410Gone,
                new PasswordResetProblem("used", "This link has already been used. Ask for a new one if you still need to reset your password.")),
            _ => NotFound(new PasswordResetProblem("invalid", "This link isn't valid. Ask for a new one.")),
        };
    }
}
