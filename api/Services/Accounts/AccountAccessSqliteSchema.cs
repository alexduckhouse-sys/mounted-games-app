using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services.Accounts;

/// <summary>SQLite upgrade for account locking, blocking, remembered networks and invitations (Postgres uses the EF migration).</summary>
public static class AccountAccessSqliteSchema
{
    public static async Task EnsureAsync(AppDbContext db)
    {
        await DbInitializer.EnsureColumnAsync(db, "AspNetUsers", "LockedAt", "TEXT NULL");
        await DbInitializer.EnsureColumnAsync(db, "AspNetUsers", "LockedByUserId", "TEXT NULL");
        await DbInitializer.EnsureColumnAsync(db, "AspNetUsers", "BlockedAt", "TEXT NULL");
        await DbInitializer.EnsureColumnAsync(db, "AspNetUsers", "BlockedByUserId", "TEXT NULL");
        await DbInitializer.EnsureColumnAsync(db, "AspNetUsers", "BlockReason", "TEXT NULL");
        await DbInitializer.EnsureColumnAsync(db, "AspNetUsers", "LockedByMaster", "INTEGER NOT NULL DEFAULT 0");
        await DbInitializer.EnsureColumnAsync(db, "AspNetUsers", "BlockedByMaster", "INTEGER NOT NULL DEFAULT 0");
        await DbInitializer.EnsureColumnAsync(db, "IpBlocks", "BlockedAccountUserId", "TEXT NULL");
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS "IX_IpBlocks_BlockedAccountUserId" ON "IpBlocks" ("BlockedAccountUserId");
            CREATE TABLE IF NOT EXISTS "AccountIps" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_AccountIps" PRIMARY KEY AUTOINCREMENT,
                "UserId" TEXT NOT NULL,
                "IpHash" TEXT NOT NULL,
                "FirstSeenAt" TEXT NOT NULL,
                "LastSeenAt" TEXT NOT NULL,
                CONSTRAINT "FK_AccountIps_AspNetUsers_UserId" FOREIGN KEY ("UserId")
                    REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_AccountIps_UserId_IpHash" ON "AccountIps" ("UserId", "IpHash");
            CREATE INDEX IF NOT EXISTS "IX_AccountIps_IpHash" ON "AccountIps" ("IpHash");
            CREATE TABLE IF NOT EXISTS "AccountInvites" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_AccountInvites" PRIMARY KEY AUTOINCREMENT,
                "Email" TEXT NOT NULL,
                "Access" INTEGER NOT NULL,
                "TokenHash" TEXT NOT NULL,
                "InvitedByUserId" TEXT NULL,
                "CreatedAt" TEXT NOT NULL,
                "ExpiresAt" TEXT NOT NULL,
                "LastSentAt" TEXT NULL,
                "LastEmailStatus" INTEGER NOT NULL DEFAULT 0,
                "SendCount" INTEGER NOT NULL DEFAULT 0,
                "AcceptedAt" TEXT NULL,
                "AcceptedUserId" TEXT NULL,
                "CancelledAt" TEXT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_AccountInvites_TokenHash" ON "AccountInvites" ("TokenHash");
            CREATE INDEX IF NOT EXISTS "IX_AccountInvites_Email" ON "AccountInvites" ("Email");
            """);
    }
}
