using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Accounts;

/// <summary>
/// Remembers which networks an account signs in from, as keyed hashes only (see <see cref="AccountIp"/>), so that blocking
/// the account can block them. Keeps the 20 most recent per account. It never throws and never logs an address: a failure
/// to record must not stop someone signing in.
/// </summary>
public sealed class AccountIpRecorder(AppDbContext db, IConfiguration configuration, TimeProvider time, ILogger<AccountIpRecorder> log)
{
    public async Task RecordAsync(string userId, string? ip, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(ip)) return;
        try
        {
            var hash = IpRetention.HashFor(configuration, ip);
            var now = time.GetUtcNow().UtcDateTime;
            var touched = await db.AccountIps.Where(a => a.UserId == userId && a.IpHash == hash)
                .ExecuteUpdateAsync(set => set.SetProperty(a => a.LastSeenAt, now), ct);
            if (touched > 0) return;

            db.AccountIps.Add(new AccountIp { UserId = userId, IpHash = hash, FirstSeenAt = now, LastSeenAt = now });
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException)
            {
                // The same address recorded by a parallel request: already there, which is all we wanted.
                db.ChangeTracker.Clear();
                return;
            }
            var extra = await db.AccountIps.Where(a => a.UserId == userId)
                .OrderByDescending(a => a.LastSeenAt).ThenByDescending(a => a.Id)
                .Skip(AccountIp.MaxPerAccount).Select(a => a.Id).ToListAsync(ct);
            if (extra.Count > 0) await db.AccountIps.Where(a => extra.Contains(a.Id)).ExecuteDeleteAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning("Could not record a sign-in network: {Reason}", ex.GetType().Name);
        }
    }
}
