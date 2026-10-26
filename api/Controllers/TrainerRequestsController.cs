using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Pending trainer and team-manager signups. Admins review every request; a club's Team Manager
/// reviews the trainer requests of their own club (manager requests are for admins only).
/// </summary>
[ApiController]
[Route("api/admin/trainer-requests")]
[Authorize(Roles = Roles.Admin + "," + Roles.Manager)]
public class TrainerRequestsController(AppDbContext db, UserManager<AppUser> users) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<TrainerRequestDto>>> List(CancellationToken ct)
    {
        var isAdmin = User.IsInRole(Roles.Admin);
        var clubId = isAdmin ? null : await db.ClubIdOfAsync(User, ct);
        if (!isAdmin && clubId is null) return new List<TrainerRequestDto>();

        var pending = await (from userRole in db.UserRoles
                             join role in db.Roles on userRole.RoleId equals role.Id
                             where role.Name == Roles.TrainerRequest || role.Name == Roles.ManagerRequest
                             select new { userRole.UserId, Role = role.Name }).ToListAsync(ct);
        var ids = pending.Select(p => p.UserId).ToList();
        var rows = await db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id) && (isAdmin || u.ClubId == clubId))
            .OrderBy(u => u.CreatedAt).ThenBy(u => u.Id)
            .Select(u => new { u.Id, u.FullName, u.Email, ClubName = u.Club == null ? null : u.Club.Name, u.CreatedAt })
            .ToListAsync(ct);

        return rows
            .Select(u => new { Row = u, Requested = pending.First(p => p.UserId == u.Id).Role })
            // A club's manager only reviews trainers; manager requests are the admin's.
            .Where(x => isAdmin || x.Requested == Roles.TrainerRequest)
            .Select(x => new TrainerRequestDto(x.Row.Id, x.Row.FullName, x.Row.Email, x.Row.ClubName,
                DateTime.SpecifyKind(x.Row.CreatedAt, DateTimeKind.Utc),
                x.Requested == Roles.ManagerRequest ? Roles.Manager : Roles.Trainer))
            .ToList();
    }

    [HttpPost("{userId}/approve")]
    public Task<IActionResult> Approve(string userId, CancellationToken ct) => Review(userId, true, ct);

    [HttpPost("{userId}/decline")]
    public Task<IActionResult> Decline(string userId, CancellationToken ct) => Review(userId, false, ct);

    // Postgres runs with a retrying execution strategy, which refuses a transaction started outside it. Run the whole
    // decision inside the strategy, starting from a clean change tracker in case it is retried.
    private Task<IActionResult> Review(string userId, bool approve, CancellationToken ct)
        => db.Database.CreateExecutionStrategy().ExecuteAsync(() => ReviewOnceAsync(userId, approve, ct));

    private async Task<IActionResult> ReviewOnceAsync(string userId, bool approve, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        // Identity saves each role change separately. Keep the decision atomic.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var user = await users.FindByIdAsync(userId);
        if (user is null) return NotFound();
        var roles = await users.GetRolesAsync(user);
        var requestedRole = roles.Contains(Roles.TrainerRequest) ? Roles.TrainerRequest
            : roles.Contains(Roles.ManagerRequest) ? Roles.ManagerRequest : null;
        if (requestedRole is null) return NotFound();

        if (!User.IsInRole(Roles.Admin))
        {
            // A club's manager reviews their own club's trainers, and nothing else (404 hides the rest).
            if (requestedRole != Roles.TrainerRequest || user.ClubId is null
                || !await db.IsClubManagerAsync(User, user.ClubId.Value, ct))
                return NotFound();
        }

        var grant = requestedRole == Roles.ManagerRequest ? Roles.Manager : Roles.Trainer;
        var removed = await users.RemoveFromRolesAsync(user,
            roles.Where(r => r == requestedRole || (approve && r == Roles.Member)));
        if (!removed.Succeeded)
            return Conflict(new { message = "Could not update this request. Refresh the list and try again." });

        if (approve && !roles.Contains(grant))
        {
            var added = await users.AddToRoleAsync(user, grant);
            if (!added.Succeeded)
                return Conflict(new { message = "Could not approve this request. Refresh the list and try again." });
        }

        await transaction.CommitAsync(ct);
        return NoContent();
    }
}

[ApiController]
[Route("api/admin/users")]
[Authorize(Roles = Roles.Admin)]
public class AdminUsersController(AppDbContext db, UserManager<AppUser> users) : ControllerBase
{
    private static readonly HashSet<string> AllowedRoles = new(StringComparer.Ordinal)
    {
        Roles.Admin,
        Roles.Trainer,
        Roles.Manager,
        Roles.Member,
    };

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AdminUserDto>>> List([FromQuery] string? q = null, CancellationToken ct = default)
    {
        var query = db.Users.AsNoTracking().Include(u => u.Club).AsQueryable();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLowerInvariant();
            query = query.Where(u =>
                u.FullName.ToLower().Contains(term)
                || (u.Email != null && u.Email.ToLower().Contains(term))
                || (u.Club != null && u.Club.Name.ToLower().Contains(term)));
        }

        var userRows = await query
            .OrderBy(u => u.FullName)
            .ThenBy(u => u.Email)
            .Take(100)
            .Select(u => new
            {
                u.Id,
                u.FullName,
                u.Email,
                u.ClubId,
                ClubName = u.Club == null ? null : u.Club.Name,
                u.LockoutEnd,
                u.CreatedAt,
                u.LockedAt,
                u.BlockedAt,
            })
            .ToListAsync(ct);

        var userIds = userRows.Select(u => u.Id).ToList();
        var rolePairs = await (from ur in db.UserRoles
                               join r in db.Roles on ur.RoleId equals r.Id
                               where userIds.Contains(ur.UserId) && r.Name != null
                               select new { ur.UserId, RoleName = r.Name! }).ToListAsync(ct);
        var rolesByUser = rolePairs
            .GroupBy(x => x.UserId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(x => x.RoleName).OrderBy(x => x).ToList());

        var now = DateTimeOffset.UtcNow;
        return userRows.Select(u => new AdminUserDto(
            u.Id,
            u.FullName,
            u.Email,
            u.ClubId,
            u.ClubName,
            rolesByUser.GetValueOrDefault(u.Id, Array.Empty<string>()),
            u.LockoutEnd.HasValue && u.LockoutEnd.Value > now,
            DateTime.SpecifyKind(u.CreatedAt, DateTimeKind.Utc),
            u.LockedAt != null, u.BlockedAt != null)).ToList();
    }

    [HttpPost("{userId}/roles")]
    public async Task<ActionResult<AdminUserDto>> SetRole(string userId, ToggleUserRoleRequest req, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(req.Role) || !AllowedRoles.Contains(req.Role))
            return BadRequest(new { message = "Unsupported role." });

        var user = await users.FindByIdAsync(userId);
        if (user is null) return NotFound();

        var currentRoles = await users.GetRolesAsync(user);
        // The Admin role is a master admin's to give and take away, or a lock could be dodged by dropping the role and regaining it.
        if (req.Role == Roles.Admin && !User.IsInRole(Roles.MasterAdmin))
            return Forbid();
        // A locked or blocked account's roles are frozen until it is restored.
        if (user.IsAccessStopped)
            return Conflict(new { message = "This account is locked or blocked, so its roles can't be changed." });
        // A master admin's roles are theirs to change: otherwise any admin could strip the Admin role from one.
        if (currentRoles.Contains(Roles.MasterAdmin) && !User.IsInRole(Roles.MasterAdmin))
            return Forbid();
        if (req.Grant && !currentRoles.Contains(req.Role))
        {
            var res = await users.AddToRoleAsync(user, req.Role);
            if (!res.Succeeded) return Conflict(new { message = "Could not add role." });
        }
        else if (!req.Grant && currentRoles.Contains(req.Role))
        {
            var res = await users.RemoveFromRoleAsync(user, req.Role);
            if (!res.Succeeded) return Conflict(new { message = "Could not remove role." });
        }

        var updatedRoles = (await users.GetRolesAsync(user)).OrderBy(r => r).ToList();
        var clubName = user.ClubId.HasValue
            ? await db.Clubs.AsNoTracking().Where(c => c.Id == user.ClubId.Value).Select(c => c.Name).FirstOrDefaultAsync(ct)
            : null;
        return new AdminUserDto(
            user.Id,
            user.FullName,
            user.Email,
            user.ClubId,
            clubName,
            updatedRoles,
            user.LockoutEnd.HasValue && user.LockoutEnd.Value > DateTimeOffset.UtcNow,
            DateTime.SpecifyKind(user.CreatedAt, DateTimeKind.Utc),
            user.LockedAt != null, user.BlockedAt != null);
    }

    [HttpPost("{userId}/unlock")]
    public async Task<IActionResult> Unlock(string userId)
    {
        var user = await users.FindByIdAsync(userId);
        if (user is null) return NotFound();
        await users.SetLockoutEndDateAsync(user, null);
        await users.ResetAccessFailedCountAsync(user);
        return NoContent();
    }
}

public record AdminUserDto(
    string Id,
    string FullName,
    string? Email,
    int? ClubId,
    string? ClubName,
    IReadOnlyList<string> Roles,
    bool IsLockedOut,
    DateTime CreatedAt,
    bool IsLocked = false,
    bool IsBlocked = false);

public record ToggleUserRoleRequest(string Role, bool Grant);
