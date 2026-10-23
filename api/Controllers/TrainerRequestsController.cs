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

    private async Task<IActionResult> Review(string userId, bool approve, CancellationToken ct)
    {
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
