using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services.Accounts;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Locking and blocking accounts. Lock stops an Admin or organiser account signing in (admins lock organisers; only a master admin locks an Admin). Block (admins)
/// stops any account signing in, entering competitions and posting in chat, and blocks the networks it has used. Finding the
/// account is the existing <c>GET /api/admin/users?q=</c>, which searches by name and email. See
/// <see cref="AccountAccessService"/> for the rules. The block reason is for admins only.
/// </summary>
[ApiController]
public sealed class AccountAccessController(AppDbContext db, AccountAccessService access) : ControllerBase
{
    private string CallerId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    private bool CallerIsMaster => User.IsInRole(Roles.MasterAdmin);

    // ---- lock ----

    /// <summary>Admin and organiser accounts with their lock state, newest first. Admins.</summary>
    [HttpGet("api/admin/staff-accounts")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<IReadOnlyList<StaffAccountDto>>> StaffAccounts([FromQuery] string? q, CancellationToken ct)
    {
        var staffIds = db.UserRoles.Join(db.Roles, ur => ur.RoleId, r => r.Id, (ur, r) => new { ur.UserId, r.Name })
            .Where(x => x.Name == Roles.Admin || x.Name == Roles.Trainer).Select(x => x.UserId);
        var query = db.Users.AsNoTracking().Where(u => staffIds.Contains(u.Id) || u.LockedAt != null || u.BlockedAt != null);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLower();
            query = query.Where(u => u.FullName.ToLower().Contains(term) || (u.Email != null && u.Email.ToLower().Contains(term)));
        }
        var rows = await query.OrderByDescending(u => u.CreatedAt).ThenBy(u => u.Id).Take(200)
            .Select(u => new { u.Id, u.FullName, u.Email, u.LockedAt, u.CreatedAt }).ToListAsync(ct);
        var roles = await RolesOfAsync(rows.Select(r => r.Id).ToList(), ct);
        return rows.Select(r => new StaffAccountDto(r.Id, r.FullName, r.Email, roles.GetValueOrDefault(r.Id) ?? [],
            r.LockedAt.HasValue ? DateTime.SpecifyKind(r.LockedAt.Value, DateTimeKind.Utc) : null,
            DateTime.SpecifyKind(r.CreatedAt, DateTimeKind.Utc))).ToList();
    }

    [HttpPost("api/admin/users/{userId}/account-lock")]
    [Authorize(Roles = Roles.Admin)]
    public Task<IActionResult> Lock(string userId, CancellationToken ct)
        => RunAsync(() => access.LockAsync(userId, CallerId, CallerIsMaster, ct));

    [HttpDelete("api/admin/users/{userId}/account-lock")]
    [Authorize(Roles = Roles.Admin)]
    public Task<IActionResult> Unlock(string userId, CancellationToken ct)
        => RunAsync(() => access.UnlockAsync(userId, CallerIsMaster, ct));

    // ---- block ----

    /// <summary>Blocked accounts with the reason each was blocked. Admins only.</summary>
    [HttpGet("api/admin/blocked-users")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<IReadOnlyList<BlockedAccountDto>>> Blocked(CancellationToken ct)
    {
        var rows = await db.Users.AsNoTracking().Where(u => u.BlockedAt != null)
            .OrderByDescending(u => u.BlockedAt).ThenBy(u => u.Id).Take(500)
            .Select(u => new
            {
                u.Id, u.FullName, u.Email, BlockedAt = u.BlockedAt!.Value, u.BlockReason,
                By = db.Users.Where(b => b.Id == u.BlockedByUserId).Select(b => b.FullName).FirstOrDefault(),
            }).ToListAsync(ct);
        var roles = await RolesOfAsync(rows.Select(r => r.Id).ToList(), ct);
        return rows.Select(r => new BlockedAccountDto(r.Id, r.FullName, r.Email, roles.GetValueOrDefault(r.Id) ?? [],
            DateTime.SpecifyKind(r.BlockedAt, DateTimeKind.Utc), r.By, r.BlockReason)).ToList();
    }

    [HttpPost("api/admin/users/{userId}/block")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<BlockResultDto>> Block(string userId, BlockAccountRequest? request, CancellationToken ct)
    {
        try { return new BlockResultDto(await access.BlockAsync(userId, CallerId, CallerIsMaster, request?.Reason, ct)); }
        catch (AccountAccessException ex) { return Problem(statusCode: ex.StatusCode, title: "Account not blocked", detail: ex.Message); }
    }

    [HttpDelete("api/admin/users/{userId}/block")]
    [Authorize(Roles = Roles.Admin)]
    public Task<IActionResult> Unblock(string userId, CancellationToken ct)
        => RunAsync(() => access.UnblockAsync(userId, CallerIsMaster, ct));

    private async Task<IActionResult> RunAsync(Func<Task> action)
    {
        try { await action(); return NoContent(); }
        catch (AccountAccessException ex) { return Problem(statusCode: ex.StatusCode, title: "Account not changed", detail: ex.Message); }
    }

    private async Task<Dictionary<string, IReadOnlyList<string>>> RolesOfAsync(List<string> ids, CancellationToken ct)
    {
        var pairs = await (from ur in db.UserRoles
                           join r in db.Roles on ur.RoleId equals r.Id
                           where ids.Contains(ur.UserId) && r.Name != null
                           select new { ur.UserId, Role = r.Name! }).ToListAsync(ct);
        return pairs.GroupBy(x => x.UserId).ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(x => x.Role).Order().ToList());
    }
}
