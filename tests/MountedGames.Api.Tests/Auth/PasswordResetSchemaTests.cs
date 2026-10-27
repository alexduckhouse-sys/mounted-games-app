using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>An existing SQLite file from before password resets gains the table and the session version without losing accounts.</summary>
public class PasswordResetSchemaTests
{
    [Fact]
    public async Task AnOlderDatabaseGainsTheResetTableAndSessionVersion_KeepingEveryAccount()
    {
        using var factory = new ApiFactory();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var accounts = await db.Users.AsNoTracking().OrderBy(u => u.Id).Select(u => new { u.Id, u.Email, u.PasswordHash }).ToListAsync();
        Assert.NotEmpty(accounts);

        await db.Database.ExecuteSqlRawAsync("""
            DROP TABLE "PasswordResetTokens";
            ALTER TABLE "AspNetUsers" DROP COLUMN "SessionVersion";
            """);

        await DbInitializer.SeedAsync(factory.Services);
        await DbInitializer.SeedAsync(factory.Services);

        db.ChangeTracker.Clear();
        var after = await db.Users.AsNoTracking().OrderBy(u => u.Id).Select(u => new { u.Id, u.Email, u.PasswordHash }).ToListAsync();
        Assert.Equal(accounts, after);
        Assert.All(await db.Users.AsNoTracking().Select(u => u.SessionVersion).ToListAsync(), v => Assert.Equal(0, v));
        Assert.Empty(await db.PasswordResetTokens.ToListAsync());

        var indexes = await db.Database.SqlQueryRaw<string>(
            "SELECT name AS \"Value\" FROM sqlite_master WHERE type = 'index' AND tbl_name = 'PasswordResetTokens'").ToListAsync();
        Assert.Contains("IX_PasswordResetTokens_TokenHash", indexes);
        Assert.Contains("IX_PasswordResetTokens_UserId_CreatedAt", indexes);
        Assert.Contains("IX_PasswordResetTokens_CreatedAt", indexes);

        // The upgraded table takes a link and keeps it through another start-up, and the hash stays unique.
        var userId = accounts[0].Id;
        var now = new DateTime(2030, 6, 1, 12, 0, 0, DateTimeKind.Utc);
        db.PasswordResetTokens.Add(new PasswordResetToken
        {
            UserId = userId, TokenHash = new string('a', 64), CreatedAt = now, ExpiresAt = now.AddMinutes(30), RequestedIpHash = "h1:0123",
        });
        await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s.SetProperty(u => u.SessionVersion, 3));
        await db.SaveChangesAsync();
        await DbInitializer.SeedAsync(factory.Services);
        db.ChangeTracker.Clear();
        var kept = await db.PasswordResetTokens.AsNoTracking().SingleAsync();
        Assert.Equal((userId, now.AddMinutes(30), "h1:0123"), (kept.UserId, kept.ExpiresAt, kept.RequestedIpHash));
        Assert.Equal(3, await db.Users.Where(u => u.Id == userId).Select(u => u.SessionVersion).SingleAsync());

        db.PasswordResetTokens.Add(new PasswordResetToken { UserId = userId, TokenHash = new string('a', 64), CreatedAt = now, ExpiresAt = now });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
