using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// Locking, unlocking, blocking and unblocking each give the account a new ConcurrencyStamp, so an Identity save that read
/// the account before (a password reset or change) fails instead of writing the old LockedAt or BlockedAt back over it.
/// </summary>
public class AccountAccessStampTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task EveryLockAndBlockChangeGivesTheAccountANewConcurrencyStamp()
    {
        var admin = await f.AdminAsync();
        var (_, organiser) = await f.ApprovedTrainerAsync();
        var id = organiser.User.Id;
        var lockUrl = $"/api/admin/users/{id}/account-lock";
        var blockUrl = $"/api/admin/users/{id}/block";
        var seen = new List<string?> { await StampAsync(id) };

        foreach (var change in new Func<Task<HttpResponseMessage>>[]
                 {
                     () => admin.PostAsync(lockUrl, null),
                     () => admin.DeleteAsync(lockUrl),
                     () => admin.PostAsJsonAsync(blockUrl, new BlockAccountRequest("Test block")),
                     () => admin.DeleteAsync(blockUrl),
                 })
        {
            (await change()).EnsureSuccessStatusCode();
            var stamp = await StampAsync(id);
            Assert.DoesNotContain(stamp, seen);
            seen.Add(stamp);
        }
    }

    private Task<string?> StampAsync(string id)
        => f.WithDbAsync(db => db.Users.AsNoTracking().Where(u => u.Id == id).Select(u => u.ConcurrencyStamp).SingleAsync());
}
