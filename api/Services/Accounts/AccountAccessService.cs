using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Accounts;

/// <summary>A refused or impossible change to an account's access. The message is safe to show the admin.</summary>
public sealed class AccountAccessException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

/// <summary>
/// Locking (master admin; Admin and organiser accounts) and blocking (admins; any account). Both stop sign-in at once and make
/// existing tokens stop working (<see cref="LiveAccounts"/>). Blocking also adds the networks the account has used to the IP
/// block list, as hashes, and unblocking takes them off again. A lock is not the Identity lockout that a run of wrong
/// passwords causes: the admin "unlock" endpoint only clears that one, so it can never undo a master admin's lock.
/// </summary>
public sealed class AccountAccessService(
    AppDbContext db, UserManager<AppUser> users, IConfiguration configuration, LiveAccounts liveAccounts, TimeProvider time)
{
    public const string SharedAdminEmail = "admin@mg.local";
    public const int MaxReasonLength = 500;
    /// <summary>
    /// A network that this many <em>other</em> accounts have used is shared (a venue, a school, a club house), so blocking
    /// it would shut out innocent people. Such addresses are left off the block list.
    /// </summary>
    public const int SharedNetworkAccounts = 5;

    // ---- lock (master admin) ----

    public async Task LockAsync(string targetId, string callerId, CancellationToken ct)
    {
        var target = await FindAsync(targetId);
        if (target.Id == callerId) throw new AccountAccessException("You can't lock your own account.", 409);
        var roles = await users.GetRolesAsync(target);
        if (roles.Contains(Roles.MasterAdmin)) throw new AccountAccessException("A master admin account can't be locked.", 409);
        if (IsSharedAdmin(target)) throw new AccountAccessException("The shared organiser account can't be locked: it is how everyone signs in with the admin key.", 409);
        if (!roles.Contains(Roles.Admin) && !roles.Contains(Roles.Trainer))
            throw new AccountAccessException("Only admin and organiser accounts can be locked.", 409);
        if (target.LockedAt is not null) return;
        var now = time.GetUtcNow().UtcDateTime;
        await db.Users.Where(u => u.Id == targetId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.LockedAt, now).SetProperty(u => u.LockedByUserId, callerId), ct);
        liveAccounts.Forget(targetId);
    }

    public async Task UnlockAsync(string targetId, CancellationToken ct)
    {
        await FindAsync(targetId);
        await db.Users.Where(u => u.Id == targetId)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.LockedAt, (DateTime?)null).SetProperty(u => u.LockedByUserId, (string?)null), ct);
        liveAccounts.Forget(targetId);
    }

    // ---- block (admins) ----

    /// <returns>How many network addresses were added to the block list.</returns>
    public async Task<int> BlockAsync(string targetId, string callerId, bool callerIsMaster, string? reason, CancellationToken ct)
    {
        var target = await FindAsync(targetId);
        if (target.Id == callerId) throw new AccountAccessException("You can't block your own account.", 409);
        var roles = await users.GetRolesAsync(target);
        if (roles.Contains(Roles.MasterAdmin)) throw new AccountAccessException("A master admin account can't be blocked.", 409);
        if (IsSharedAdmin(target)) throw new AccountAccessException("The shared organiser account can't be blocked: it is how everyone signs in with the admin key.", 409);
        if (roles.Contains(Roles.Admin) && !callerIsMaster)
            throw new AccountAccessException("Only a master admin can block an admin account.", 403);
        var cleanReason = reason?.Trim();
        if (cleanReason is { Length: > MaxReasonLength })
            throw new AccountAccessException($"Keep the reason to {MaxReasonLength} characters or fewer.", 400);

        var added = 0;
        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var now = time.GetUtcNow().UtcDateTime;
            await db.Users.Where(u => u.Id == targetId).ExecuteUpdateAsync(s => s
                .SetProperty(u => u.BlockedAt, u => u.BlockedAt ?? now)
                .SetProperty(u => u.BlockedByUserId, u => u.BlockedAt == null ? callerId : u.BlockedByUserId)
                .SetProperty(u => u.BlockReason, string.IsNullOrEmpty(cleanReason) ? (string?)null : cleanReason), ct);

            added = 0;
            foreach (var hash in await NetworksOfAsync(targetId, ct))
            {
                if (await db.IpBlocks.AnyAsync(b => b.IpAddress == hash, ct)) continue;
                var others = await db.AccountIps.Where(a => a.IpHash == hash && a.UserId != targetId)
                    .Select(a => a.UserId).Distinct().CountAsync(ct);
                if (others >= SharedNetworkAccounts) continue;
                db.IpBlocks.Add(new IpBlock
                {
                    IpAddress = hash, Reason = "Account blocked", CreatedByUserId = callerId, BlockedAccountUserId = targetId, CreatedAt = now,
                });
                added++;
            }
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        });
        liveAccounts.Forget(targetId);
        return added;
    }

    public async Task UnblockAsync(string targetId, bool callerIsMaster, CancellationToken ct)
    {
        var target = await FindAsync(targetId);
        if (!callerIsMaster && await users.IsInRoleAsync(target, Roles.Admin))
            throw new AccountAccessException("Only a master admin can unblock an admin account.", 403);

        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.Users.Where(u => u.Id == targetId).ExecuteUpdateAsync(s => s
                .SetProperty(u => u.BlockedAt, (DateTime?)null)
                .SetProperty(u => u.BlockedByUserId, (string?)null)
                .SetProperty(u => u.BlockReason, (string?)null), ct);

            // A network another blocked account has also used stays blocked, now on that account's behalf.
            foreach (var row in await db.IpBlocks.Where(b => b.BlockedAccountUserId == targetId).ToListAsync(ct))
            {
                var heir = await (from a in db.AccountIps
                                  join u in db.Users on a.UserId equals u.Id
                                  where a.IpHash == row.IpAddress && a.UserId != targetId && u.BlockedAt != null
                                  select a.UserId).FirstOrDefaultAsync(ct);
                if (heir is null) db.IpBlocks.Remove(row);
                else row.BlockedAccountUserId = heir;
            }
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        });
        liveAccounts.Forget(targetId);
    }

    /// <summary>
    /// Every network the account is known to have used, as hashes: its recorded sign-ins, plus the addresses on its recent chat
    /// and marketplace posts (raw while they are fresh, hashed after retention; both end up as the same kind of hash).
    /// </summary>
    private async Task<HashSet<string>> NetworksOfAsync(string userId, CancellationToken ct)
    {
        var hashes = (await db.AccountIps.Where(a => a.UserId == userId).Select(a => a.IpHash).ToListAsync(ct)).ToHashSet();
        var seen = new List<string>();
        seen.AddRange(await db.ChatMessages.Where(m => m.UserId == userId && m.IpAddress != null).Select(m => m.IpAddress!).Distinct().ToListAsync(ct));
        seen.AddRange(await db.ShopPosts.Where(p => p.AuthorUserId == userId && p.IpAddress != null).Select(p => p.IpAddress!).Distinct().ToListAsync(ct));
        seen.AddRange(await db.ShopComments.Where(c => c.AuthorUserId == userId && c.IpAddress != null).Select(c => c.IpAddress!).Distinct().ToListAsync(ct));
        foreach (var address in seen.Where(a => !string.IsNullOrWhiteSpace(a)))
            hashes.Add(IpRetention.IsHashed(address) ? address : IpRetention.HashFor(configuration, address));
        return hashes;
    }

    private async Task<AppUser> FindAsync(string id)
        => await users.FindByIdAsync(id) ?? throw new AccountAccessException("Account not found.", 404);

    private static bool IsSharedAdmin(AppUser user) => string.Equals(user.Email, SharedAdminEmail, StringComparison.OrdinalIgnoreCase);
}
