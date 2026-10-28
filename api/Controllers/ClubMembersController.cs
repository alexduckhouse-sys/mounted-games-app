using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

/// <summary>
/// The people in a club. A club's Team Manager runs their own club; an admin runs any. Approving or declining a
/// join request stays with <see cref="TrainerRequestsController"/>, which already applies the same club rule.
/// A club the caller can't run answers 404, the same as a club that doesn't exist.
/// </summary>
[ApiController]
[Route("api/clubs/{clubId:int}/members")]
[Authorize(Roles = Roles.Admin + "," + Roles.Manager)]
public class ClubMembersController(AppDbContext db, UserManager<AppUser> users) : ControllerBase
{
    private static readonly string[] RankedRoles = [Roles.Manager, Roles.Trainer, Roles.Member];
    private static readonly string[] OwnedRoles = [Roles.Manager, Roles.Trainer, Roles.Member, Roles.Rider, Roles.TrainerRequest, Roles.ManagerRequest];

    [HttpGet]
    public async Task<ActionResult<ClubMembersDto>> List(int clubId, CancellationToken ct)
    {
        var club = await ScopeAsync(clubId, ct);
        if (club is null) return NotFound();
        var isAdmin = User.IsInRole(Roles.Admin);

        var rows = await db.Users.AsNoTracking().Where(u => u.ClubId == clubId)
            .OrderBy(u => u.FullName).ThenBy(u => u.Id)
            .Select(u => new { u.Id, u.FullName, u.Email, u.CreatedAt }).ToListAsync(ct);
        var ids = rows.Select(r => r.Id).ToList();
        var roleRows = await (from userRole in db.UserRoles
                              join role in db.Roles on userRole.RoleId equals role.Id
                              where ids.Contains(userRole.UserId)
                              select new { userRole.UserId, Role = role.Name! }).ToListAsync(ct);
        var rolesOf = roleRows.GroupBy(x => x.UserId).ToDictionary(g => g.Key, g => g.Select(x => x.Role).ToHashSet());
        var teamRows = await db.Teams.AsNoTracking()
            .Where(t => t.ClubId == clubId && t.TrainerUserId != null)
            .OrderByDescending(t => t.Competition!.StartDate).ThenBy(t => t.DisplayName)
            .Select(t => new { t.TrainerUserId, t.DisplayName }).ToListAsync(ct);
        var teamsOf = teamRows.GroupBy(t => t.TrainerUserId!)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(t => t.DisplayName).Distinct().Take(6).ToList());

        var members = new List<ClubMemberDto>();
        var pending = new List<TrainerRequestDto>();
        foreach (var row in rows)
        {
            var roles = rolesOf.GetValueOrDefault(row.Id) ?? [];
            if (roles.Contains(Roles.Admin)) continue;
            var wantsTrainer = roles.Contains(Roles.TrainerRequest);
            // A manager request on someone who holds no other role is a new sign-up; an admin decides those from the pending list.
            var newManager = roles.Contains(Roles.ManagerRequest) && !roles.Contains(Roles.Manager) && !roles.Contains(Roles.Trainer) && isAdmin;
            if (wantsTrainer || newManager)
            {
                pending.Add(new TrainerRequestDto(row.Id, row.FullName, row.Email, club.Name,
                    DateTime.SpecifyKind(row.CreatedAt, DateTimeKind.Utc), wantsTrainer ? Roles.Trainer : Roles.Manager));
                continue;
            }
            var role = RankedRoles.FirstOrDefault(roles.Contains) ?? Roles.Member;
            members.Add(new ClubMemberDto(row.Id, row.FullName, role,
                role == Roles.Member ? [] : teamsOf.GetValueOrDefault(row.Id) ?? [],
                roles.Contains(Roles.ManagerRequest)));
        }
        return new ClubMembersDto(club.Id, club.Name, members, pending);
    }

    /// <summary>
    /// Sets someone's role to Manager, Trainer or Member. A Team Manager can't make someone else a Team Manager
    /// themselves: that files a request for an admin and changes nothing yet.
    /// </summary>
    [HttpPut("{userId}/role")]
    public Task<ActionResult<ChangeMemberRoleResponse>> ChangeRole(int clubId, string userId, ChangeMemberRoleRequest req, CancellationToken ct)
        => db.Database.CreateExecutionStrategy().ExecuteAsync(() => ChangeRoleOnceAsync(clubId, userId, req, ct));

    // Postgres runs with a retrying execution strategy, which refuses a transaction started outside it. Run the whole
    // change inside the strategy, starting from a clean change tracker in case it is retried.
    private async Task<ActionResult<ChangeMemberRoleResponse>> ChangeRoleOnceAsync(int clubId, string userId, ChangeMemberRoleRequest req, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var club = await ScopeAsync(clubId, ct);
        if (club is null) return NotFound();
        var wanted = RankedRoles.FirstOrDefault(r => string.Equals(r, req.Role?.Trim(), StringComparison.OrdinalIgnoreCase));
        if (wanted is null) return BadRequest(new { message = "Role must be Manager, Trainer or Member." });

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var (target, roles, problem) = await FindTargetAsync(clubId, userId);
        if (problem is not null) return problem;
        // A trainer request, or a manager request on someone with no other role (a new sign-up), is decided with Approve or Decline.
        if (roles!.Contains(Roles.TrainerRequest)
            || (roles.Contains(Roles.ManagerRequest) && !roles.Contains(Roles.Trainer) && !roles.Contains(Roles.Manager)))
            return Conflict(new { message = "Approve or decline their request first." });

        var current = RankedRoles.FirstOrDefault(roles.Contains) ?? Roles.Member;
        var isAdmin = User.IsInRole(Roles.Admin);
        if (current == Roles.Manager && !isAdmin) return Forbid();
        if (current == wanted) return new ChangeMemberRoleResponse(current, roles.Contains(Roles.ManagerRequest));

        if (wanted == Roles.Manager && !isAdmin)
        {
            // Making a team manager is the admins' call: ask them, and leave the person as they are.
            if (!roles.Contains(Roles.ManagerRequest))
            {
                var asked = await users.AddToRoleAsync(target!, Roles.ManagerRequest);
                if (!asked.Succeeded) return Conflict(new { message = "Could not send the request. Refresh and try again." });
            }
            await transaction.CommitAsync(ct);
            return new ChangeMemberRoleResponse(current, true);
        }

        if (ConfirmedAddress.Refuses(target!, wanted)) return ConfirmedAddress.Refusal();
        var removed = await users.RemoveFromRolesAsync(target!, roles.Where(r => OwnedRoles.Contains(r)));
        if (!removed.Succeeded) return Conflict(new { message = "Could not change the role. Refresh and try again." });
        var added = await users.AddToRoleAsync(target!, wanted);
        if (!added.Succeeded) return Conflict(new { message = "Could not change the role. Refresh and try again." });
        // A plain member doesn't look after teams, so those go back to the club's manager to hand out again.
        if (wanted == Roles.Member) await ClearTeamsAsync(clubId, userId, ct);
        await transaction.CommitAsync(ct);
        return new ChangeMemberRoleResponse(wanted, false);
    }

    /// <summary>
    /// Takes someone out of the club. They stay signed up with a Member role and no club; the riders they saved
    /// stay on the club's roster, and the teams they looked after have no trainer until the manager picks one.
    /// </summary>
    [HttpDelete("{userId}")]
    public Task<IActionResult> Remove(int clubId, string userId, CancellationToken ct)
        => db.Database.CreateExecutionStrategy().ExecuteAsync(() => RemoveOnceAsync(clubId, userId, ct));

    // Postgres runs with a retrying execution strategy, which refuses a transaction started outside it. Run the whole
    // removal inside the strategy, starting from a clean change tracker in case it is retried.
    private async Task<IActionResult> RemoveOnceAsync(int clubId, string userId, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var club = await ScopeAsync(clubId, ct);
        if (club is null) return NotFound();

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var (target, roles, problem) = await FindTargetAsync(clubId, userId);
        if (problem is not null) return problem;
        if (roles!.Contains(Roles.Manager) && !User.IsInRole(Roles.Admin)) return Forbid();

        var removed = await users.RemoveFromRolesAsync(target!, roles.Where(r => OwnedRoles.Contains(r)));
        if (!removed.Succeeded) return Conflict(new { message = "Could not remove them. Refresh and try again." });
        var added = await users.AddToRoleAsync(target!, Roles.Member);
        if (!added.Succeeded) return Conflict(new { message = "Could not remove them. Refresh and try again." });
        target!.ClubId = null;
        var saved = await users.UpdateAsync(target);
        if (!saved.Succeeded) return Conflict(new { message = "Could not remove them. Refresh and try again." });
        await ClearTeamsAsync(clubId, userId, ct);
        await transaction.CommitAsync(ct);
        return NoContent();
    }

    /// <summary>The club, if the caller may run it: an admin for any club, a Team Manager for their own.</summary>
    private async Task<Club?> ScopeAsync(int clubId, CancellationToken ct)
    {
        var club = await db.Clubs.AsNoTracking().FirstOrDefaultAsync(c => c.Id == clubId, ct);
        if (club is null) return null;
        if (User.IsInRole(Roles.Admin)) return club;
        // The sign-in token carries the roles it was issued with, so check the manager role as it is now.
        var me = await users.FindByIdAsync(ClubAccess.UserIdOf(User) ?? string.Empty);
        return me is not null && me.ClubId == clubId && await users.IsInRoleAsync(me, Roles.Manager) ? club : null;
    }

    /// <summary>The person in this club the call is about. Not found for anyone outside it, an admin account or yourself.</summary>
    private async Task<(AppUser? Target, IList<string>? Roles, ActionResult? Problem)> FindTargetAsync(int clubId, string userId)
    {
        var target = await users.FindByIdAsync(userId);
        if (target is null || target.ClubId != clubId) return (null, null, NotFound());
        var roles = await users.GetRolesAsync(target);
        if (roles.Contains(Roles.Admin)) return (null, null, NotFound());
        if (target.Id == ClubAccess.UserIdOf(User))
            return (null, null, Conflict(new { message = "You can't change your own place in the club." }));
        return (target, roles, null);
    }

    private async Task ClearTeamsAsync(int clubId, string userId, CancellationToken ct)
    {
        var teams = await db.Teams.Where(t => t.ClubId == clubId && t.TrainerUserId == userId).ToListAsync(ct);
        foreach (var team in teams) team.TrainerUserId = null;
        if (teams.Count > 0) await db.SaveChangesAsync(ct);
    }
}
