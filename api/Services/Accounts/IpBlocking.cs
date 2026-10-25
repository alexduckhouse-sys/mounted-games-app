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
    public static async Task<bool> IsIpBlockedAsync(this AppDbContext db, HttpContext http, CancellationToken ct = default)
    {
        var ip = http.Connection.RemoteIpAddress?.ToString();
        if (string.IsNullOrEmpty(ip)) return false;
        var hash = IpRetention.HashFor(http.RequestServices.GetRequiredService<IConfiguration>(), ip);
        return await db.IpBlocks.AnyAsync(b => b.IpAddress == ip || b.IpAddress == hash, ct);
    }
}
