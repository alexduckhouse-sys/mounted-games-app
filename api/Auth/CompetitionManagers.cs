using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Auth;

/// <summary>
/// Who can run a competition: admins reach any; a Trainer reaches the ones they created; a competition admin
/// (anyone on that competition's team) reaches that one. The single source for every per-competition check.
/// </summary>
public static class CompetitionManagers
{
    /// <summary>The competitions this user can run, as a query so callers can narrow it further.</summary>
    public static IQueryable<Competition> Manageable(this AppDbContext db, ClaimsPrincipal user)
    {
        var competitions = db.Competitions.AsNoTracking();
        if (user.IsInRole(Roles.Admin)) return competitions;
        var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(uid)) return competitions.Where(_ => false);
        var trainer = user.IsInRole(Roles.Trainer);
        return competitions.Where(c => (trainer && c.CreatedByUserId == uid)
            || db.CompetitionCollaborators.Any(k => k.CompetitionId == c.Id && k.UserId == uid));
    }

    public static Task<bool> CanManageAsync(this AppDbContext db, ClaimsPrincipal user, int competitionId, CancellationToken ct = default) =>
        db.Manageable(user).AnyAsync(c => c.Id == competitionId, ct);

    /// <summary>Current, active staff recipients; never rely on roles captured when a socket connected.</summary>
    public static async Task<List<string>> ManagerIdsAsync(this AppDbContext db, int competitionId)
    {
        var admins = from membership in db.UserRoles
                     join role in db.Roles on membership.RoleId equals role.Id
                     where role.Name == Roles.Admin
                     select membership.UserId;
        var trainers = from membership in db.UserRoles
                       join role in db.Roles on membership.RoleId equals role.Id
                       where role.Name == Roles.Trainer
                       select membership.UserId;
        var owners = db.Competitions.Where(c => c.Id == competitionId && c.CreatedByUserId != null
            && trainers.Contains(c.CreatedByUserId)).Select(c => c.CreatedByUserId!);
        var collaborators = db.CompetitionCollaborators.Where(c => c.CompetitionId == competitionId).Select(c => c.UserId);
        var ids = admins.Union(owners).Union(collaborators);
        return await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)
            && u.LockedAt == null && u.BlockedAt == null && u.LockoutEnd != DateTimeOffset.MaxValue)
            .Select(u => u.Id).ToListAsync();
    }

}
