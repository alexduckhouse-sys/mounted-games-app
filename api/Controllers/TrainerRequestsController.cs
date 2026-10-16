using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/admin/trainer-requests")]
[Authorize(Roles = Roles.Admin)]
public class TrainerRequestsController(AppDbContext db, UserManager<AppUser> users) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<TrainerRequestDto>>> List(CancellationToken ct)
    {
        var pendingUserIds = from userRole in db.UserRoles
                             join role in db.Roles on userRole.RoleId equals role.Id
                             where role.Name == Roles.TrainerRequest
                             select userRole.UserId;

        return await db.Users.AsNoTracking()
            .Where(u => pendingUserIds.Contains(u.Id))
            .OrderBy(u => u.CreatedAt).ThenBy(u => u.Id)
            .Select(u => new TrainerRequestDto(u.Id, u.FullName, u.Email,
                u.Club == null ? null : u.Club.Name,
                DateTime.SpecifyKind(u.CreatedAt, DateTimeKind.Utc)))
            .ToListAsync(ct);
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
        if (!roles.Contains(Roles.TrainerRequest)) return NotFound();

        var removed = await users.RemoveFromRolesAsync(user,
            roles.Where(r => r == Roles.TrainerRequest || (approve && r == Roles.Member)));
        if (!removed.Succeeded)
            return Conflict(new { message = "Could not update this request. Refresh the list and try again." });

        if (approve && !roles.Contains(Roles.Trainer))
        {
            var added = await users.AddToRoleAsync(user, Roles.Trainer);
            if (!added.Succeeded)
                return Conflict(new { message = "Could not approve this request. Refresh the list and try again." });
        }

        await transaction.CommitAsync(ct);
        return NoContent();
    }
}
