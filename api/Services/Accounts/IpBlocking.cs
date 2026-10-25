using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services.Accounts;

/// <summary>
/// The one test for "is this visitor's network blocked". A block is either the address as an admin typed it, or the keyed
/// hash of it, which is what blocking an account adds so no new raw address is stored. The client address comes from
/// <c>ProxyClientIpMiddleware</c>, so this reads <c>Connection.RemoteIpAddress</c> and nothing else.
/// </summary>
public static class IpBlocking
{
    /// <param name="includeAccountBlocks">
    /// False for public pages: networks added because an account was blocked stop sign-in, sign-up, entries and chat, but never
    /// a public page (a shared network would lose the timetable). Only addresses an admin typed in apply there.
    /// </param>
    public static async Task<bool> IsIpBlockedAsync(this AppDbContext db, HttpContext http, CancellationToken ct = default, bool includeAccountBlocks = true)
    {
        var ip = http.Connection.RemoteIpAddress?.ToString();
        if (string.IsNullOrEmpty(ip)) return false;
        if (!includeAccountBlocks) return await db.IpBlocks.AnyAsync(b => b.BlockedAccountUserId == null && b.IpAddress == ip, ct);
        var hash = IpRetention.HashFor(http.RequestServices.GetRequiredService<IConfiguration>(), ip);
        return await db.IpBlocks.AnyAsync(b => b.IpAddress == ip || b.IpAddress == hash, ct);
    }
}
