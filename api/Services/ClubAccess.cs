using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services;

/// <summary>What a signed-in person may do for the club they belong to (<c>AppUser.ClubId</c>).</summary>
public static class ClubAccess
{
    public static string? UserIdOf(ClaimsPrincipal user) => user.FindFirst(ClaimTypes.NameIdentifier)?.Value;

    /// <summary>The signed-in user's club, or null when they have none.</summary>
    public static async Task<int?> ClubIdOfAsync(this AppDbContext db, ClaimsPrincipal user, CancellationToken ct = default)
    {
        var uid = UserIdOf(user);
        if (string.IsNullOrEmpty(uid)) return null;
        return await db.Users.AsNoTracking().Where(u => u.Id == uid).Select(u => u.ClubId).FirstOrDefaultAsync(ct);
    }

    /// <summary>A club's Team Manager: heads the club, so can see and run all of its teams and riders.</summary>
    public static async Task<bool> IsClubManagerAsync(this AppDbContext db, ClaimsPrincipal user, int clubId, CancellationToken ct = default)
        => user.IsInRole(Roles.Manager) && await db.ClubIdOfAsync(user, ct) == clubId;

    /// <summary>A Team Manager or trainer of this club: they share the club's saved riders.</summary>
    public static async Task<bool> SharesClubRosterAsync(this AppDbContext db, ClaimsPrincipal user, int clubId, CancellationToken ct = default)
        => (user.IsInRole(Roles.Manager) || user.IsInRole(Roles.Trainer)) && await db.ClubIdOfAsync(user, ct) == clubId;
}
