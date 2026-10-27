using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Hubs;

namespace MountedGames.Api.Auth;

/// <summary>
/// A sign-in token outlives the account it was issued for (24 hours by default). <see cref="StateAsync"/> is checked on every
/// request and every live-hub connection (<c>Program.cs</c>, <c>OnTokenValidated</c>), in the same single database round
/// trip that reads the account's current roles. It turns away a token whose account has been deleted or emptied (see
/// <c>AccountDeletionService</c>), locked or blocked by an admin (see <c>AccountAccessService</c>), or whose sessions were
/// ended after it was issued (a password reset or change raises <c>AppUser.SessionVersion</c>; each token carries the value it
/// was issued under in <see cref="SessionVersionClaim"/>). Nothing is cached, so this holds at once on every instance.
/// Call <see cref="SessionsEndedAsync"/> after ending an account's sessions, so its open live-hub connections close too.
/// </summary>
public sealed class LiveAccounts(LiveConnections connections)
{
    /// <summary>The token claim holding the account's <c>SessionVersion</c> when the token was made. Older tokens have none (0).</summary>
    public const string SessionVersionClaim = "sv";

    /// <summary>What a token check needs to know about an account, read in one query.</summary>
    public sealed class TokenState
    {
        public DateTimeOffset? LockoutEnd { get; init; }
        public DateTime? LockedAt { get; init; }
        public DateTime? BlockedAt { get; init; }
        public int SessionVersion { get; init; }
        public List<string> Roles { get; init; } = [];

        /// <summary>
        /// The account can be used and its sessions haven't been ended since the token was issued. An emptied account is
        /// locked out for good; an ordinary lockout after wrong passwords ends, and keeps its sessions.
        /// </summary>
        public bool Accepts(int tokenSessionVersion) =>
            LockoutEnd != DateTimeOffset.MaxValue && LockedAt == null && BlockedAt == null && tokenSessionVersion >= SessionVersion;
    }

    /// <summary>
    /// The account row by primary key, with its role names from a correlated join (<c>AspNetUserRoles</c> by its
    /// <c>(UserId, RoleId)</c> key, <c>AspNetRoles</c> by id): one SQL statement, one round trip.
    /// </summary>
    public static IQueryable<TokenState> StateQuery(AppDbContext db, string userId) =>
        db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new TokenState
        {
            LockoutEnd = u.LockoutEnd,
            LockedAt = u.LockedAt,
            BlockedAt = u.BlockedAt,
            SessionVersion = u.SessionVersion,
            Roles = (from membership in db.UserRoles
                     join role in db.Roles on membership.RoleId equals role.Id
                     where membership.UserId == u.Id && role.Name != null
                     select role.Name!).ToList(),
        });

    /// <summary>Null when the account doesn't exist.</summary>
    public static Task<TokenState?> StateAsync(AppDbContext db, string userId, CancellationToken ct = default)
        => StateQuery(db, userId).FirstOrDefaultAsync(ct);

    /// <summary>The session version a validated token was issued under; 0 for tokens made before the claim existed.</summary>
    public static int SessionVersionOf(ClaimsPrincipal? principal)
        => int.TryParse(principal?.FindFirstValue(SessionVersionClaim), NumberStyles.None, CultureInfo.InvariantCulture, out var version) ? version : 0;

    /// <summary>
    /// Call once an account's sessions have ended (lock, block, deletion, password reset or change). Tokens are already
    /// refused by the next request; this closes the live-hub connections that were opened with them, on every instance.
    /// <paramref name="validFromVersion"/> keeps connections made with a token issued under that session version or later.
    /// </summary>
    public Task SessionsEndedAsync(string userId, int? validFromVersion = null) => connections.EndSessionsAsync(userId, validFromVersion);
}
