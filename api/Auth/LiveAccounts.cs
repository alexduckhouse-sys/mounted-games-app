using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MountedGames.Api.Data;

namespace MountedGames.Api.Auth;

/// <summary>
/// A sign-in token outlives the account it was issued for (24 hours by default). This turns away a token whose
/// account has been deleted or emptied (see <c>AccountDeletionService</c>). Answers are cached briefly so most
/// requests don't touch the database; <see cref="Forget"/> clears one at once on the instance that did the deletion.
/// </summary>
public sealed class LiveAccounts(IServiceScopeFactory scopes, IMemoryCache cache)
{
    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);

    public async Task<bool> IsActiveAsync(string userId, CancellationToken ct = default)
    {
        if (cache.TryGetValue(Key(userId), out bool active)) return active;
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var account = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.LockoutEnd }).FirstOrDefaultAsync(ct);
        // An emptied account is locked out for good; an ordinary lockout after wrong passwords ends, and keeps its sessions.
        active = account is not null && account.LockoutEnd != DateTimeOffset.MaxValue;
        cache.Set(Key(userId), active, CacheFor);
        return active;
    }

    public void Forget(string userId) => cache.Remove(Key(userId));

    private static string Key(string userId) => $"live-account:{userId}";
}
