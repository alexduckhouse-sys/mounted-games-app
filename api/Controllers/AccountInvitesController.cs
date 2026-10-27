using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Security;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Accounts;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Inviting an organiser or site admin by email. Admins make, list, resend and cancel invitations; the invited person opens
/// the emailed link and gives a name and a password, which signs them in. The token is shown to nobody: it exists only in the
/// email, and only its SHA-256 is stored.
/// </summary>
[ApiController]
public sealed class AccountInvitesController(
    AppDbContext db, AccountInviteService invites, TokenService tokens, AccountIpRecorder ipRecorder, TimeProvider time) : ControllerBase
{
    [HttpGet("api/admin/invites")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<IReadOnlyList<InviteDto>>> Pending(CancellationToken ct)
    {
        var rows = await db.AccountInvites.AsNoTracking().Where(i => i.AcceptedAt == null && i.CancelledAt == null)
            .OrderByDescending(i => i.CreatedAt).ThenByDescending(i => i.Id).Take(200).ToListAsync(ct);
        return await ToDtosAsync(rows, ct);
    }

    [HttpPost("api/admin/invites")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<InviteDto>> Create(CreateInviteRequest request, CancellationToken ct)
    {
        try
        {
            var (invite, _) = await invites.CreateAsync(request.Email, request.Access, User.FindFirstValue(ClaimTypes.NameIdentifier)!, ct);
            return Created($"/api/admin/invites/{invite.Id}", (await ToDtosAsync([invite], ct))[0]);
        }
        catch (AccountInviteException ex) { return Problem(statusCode: ex.StatusCode, title: "Invitation not sent", detail: ex.Message); }
    }

    [HttpPost("api/admin/invites/{id:int}/resend")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<InviteDto>> Resend(int id, CancellationToken ct)
    {
        try
        {
            var (invite, _) = await invites.ResendAsync(id, ct);
            return (await ToDtosAsync([invite], ct))[0];
        }
        catch (AccountInviteException ex) { return Problem(statusCode: ex.StatusCode, title: "Invitation not sent", detail: ex.Message); }
    }

    [HttpDelete("api/admin/invites/{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Cancel(int id, CancellationToken ct)
    {
        try { await invites.CancelAsync(id, ct); return NoContent(); }
        catch (AccountInviteException ex) { return Problem(statusCode: ex.StatusCode, title: "Invitation not cancelled", detail: ex.Message); }
    }

    /// <summary>What the accept page shows. An unknown, used, cancelled or expired token all answer the same 404.</summary>
    [HttpPost("api/auth/invites/lookup")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<InvitePreviewDto>> Lookup(InviteTokenRequest request, CancellationToken ct)
    {
        var invite = await invites.FindUsableAsync(request.Token, ct);
        return invite is null
            ? NotFound(new { message = "This invitation has expired or isn't valid. Ask for a new one." })
            : new InvitePreviewDto(invite.Email, invite.Access, DateTime.SpecifyKind(invite.ExpiresAt, DateTimeKind.Utc));
    }

    /// <summary>Creates the account from the invitation and signs the person in.</summary>
    [HttpPost("api/auth/invites/accept")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Accept(AcceptInviteRequest request, CancellationToken ct)
    {
        if (await db.IsIpBlockedAsync(HttpContext, ct))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Sign-in from this network is blocked." });

        try
        {
            var (user, failure) = await invites.AcceptAsync(request.Token, request.FullName, request.Password, ct);
            if (user is null)
                return BadRequest(new
                {
                    errors = failure!.Errors.Select(PasswordRules.Friendly).Distinct(),
                    errorCodes = failure.Errors.Select(e => e.Code),
                });
            await ipRecorder.RecordAsync(user.Id, HttpContext.Connection.RemoteIpAddress?.ToString(), ct);
            var (token, expiresAt, roles) = await tokens.CreateTokenAsync(user);
            return new AuthResponse(token, expiresAt,
                new UserProfile(user.Id, user.Email!, user.FullName, null, null, roles.ToList(), user.EmailConfirmed));
        }
        catch (AccountInviteException ex) { return Problem(statusCode: ex.StatusCode, title: "Invitation not accepted", detail: ex.Message); }
    }

    private async Task<List<InviteDto>> ToDtosAsync(IReadOnlyList<AccountInvite> rows, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var inviterIds = rows.Select(r => r.InvitedByUserId).Where(id => id != null).Distinct().ToList();
        var names = await db.Users.AsNoTracking().Where(u => inviterIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FullName, ct);
        return rows.Select(i => new InviteDto(i.Id, i.Email, i.Access, DateTime.SpecifyKind(i.CreatedAt, DateTimeKind.Utc),
            DateTime.SpecifyKind(i.ExpiresAt, DateTimeKind.Utc),
            i.LastSentAt.HasValue ? DateTime.SpecifyKind(i.LastSentAt.Value, DateTimeKind.Utc) : null,
            i.LastEmailStatus, i.SendCount, i.ExpiresAt <= now,
            i.InvitedByUserId is not null ? names.GetValueOrDefault(i.InvitedByUserId) : null)).ToList();
    }
}
