using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MountedGames.Api.Data;

namespace MountedGames.Api.Auth;

/// <summary>
/// A sign-in token outlives the account it was issued for (24 hours by default). This turns away a token whose
/// account has been deleted or emptied (see <c>AccountDeletionService</c>), or locked or blocked by an admin (see
/// <c>AccountAccessService</c>), and a token issued before the account's sessions were ended (a password reset raises
/// <c>AppUser.SessionVersion</c>; each token carries the value it was issued under in <see cref="SessionVersionClaim"/>).
/// Answers are cached briefly so most requests don't touch the database; <see cref="Forget"/> clears one at once on the
/// instance that made the change. Other instances catch up within <see cref="CacheFor"/>.
/// </summary>
public sealed class LiveAccounts(IServiceScopeFactory scopes, IMemoryCache cache)
{
    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);

    /// <summary>The token claim holding the account's <c>SessionVersion</c> when the token was made. Older tokens have none (0).</summary>
    public const string SessionVersionClaim = "sv";

    private sealed record State(bool Active, int SessionVersion);

    /// <summary>Whether the account can be used at all: it exists, isn't an emptied shell, and isn't locked or blocked.</summary>
    public async Task<bool> IsActiveAsync(string userId, CancellationToken ct = default)
        => (await StateAsync(userId, refresh: false, ct)).Active;

    /// <summary>
    /// Whether a token for <paramref name="userId"/> issued under <paramref name="sessionVersion"/> still works: the account
    /// is active and its sessions haven't been ended since. A token newer than this instance remembers means the cache is
    /// behind, so it reads again rather than wait for the entry to expire.
    /// </summary>
    public async Task<bool> AcceptsTokenAsync(string userId, int sessionVersion, CancellationToken ct = default)
    {
        var state = await StateAsync(userId, refresh: false, ct);
        if (state.Active && sessionVersion > state.SessionVersion) state = await StateAsync(userId, refresh: true, ct);
        return state.Active && sessionVersion >= state.SessionVersion;
    }

    /// <summary>The session version a validated token was issued under; 0 for tokens made before the claim existed.</summary>
    public static int SessionVersionOf(ClaimsPrincipal? principal)
        => int.TryParse(principal?.FindFirstValue(SessionVersionClaim), NumberStyles.None, CultureInfo.InvariantCulture, out var version) ? version : 0;

    public void Forget(string userId) => cache.Remove(Key(userId));

    private async Task<State> StateAsync(string userId, bool refresh, CancellationToken ct)
    {
        if (!refresh && cache.TryGetValue(Key(userId), out State? cached) && cached is not null) return cached;
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var account = await db.Users.AsNoTracking().Where(u => u.Id == userId)
            .Select(u => new { u.LockoutEnd, u.LockedAt, u.BlockedAt, u.SessionVersion }).FirstOrDefaultAsync(ct);
        // An emptied account is locked out for good; an ordinary lockout after wrong passwords ends, and keeps its sessions.
        // An admin lock or block ends them at once.
        var active = account is not null && account.LockoutEnd != DateTimeOffset.MaxValue
            && account.LockedAt == null && account.BlockedAt == null;
        var state = new State(active, account?.SessionVersion ?? 0);
        cache.Set(Key(userId), state, CacheFor);
        return state;
    }

    private static string Key(string userId) => $"live-account:{userId}";
}
