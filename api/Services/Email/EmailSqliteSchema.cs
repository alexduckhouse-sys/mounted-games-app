using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services.Email;

/// <summary>SQLite upgrade for the entry-email columns and the opt-in table (Postgres uses the EF migration).</summary>
public static class EmailSqliteSchema
{
    public static async Task EnsureAsync(AppDbContext db)
    {
        await DbInitializer.EnsureColumnAsync(db, "SectionSignups", "ContactEmail", "TEXT NULL");
        await DbInitializer.EnsureColumnAsync(db, "SectionSignups", "ConfirmationEmailStatus", "INTEGER NOT NULL DEFAULT 0");
        await DbInitializer.EnsureColumnAsync(db, "SectionSignups", "ConfirmationEmailAt", "TEXT NULL");
        await DbInitializer.EnsureColumnAsync(db, "SectionSignups", "ClientRequestId", "TEXT NULL");
        await db.Database.ExecuteSqlRawAsync("""
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_SectionSignups_CompetitionSectionId_UserId_ClientRequestId"
                ON "SectionSignups" ("CompetitionSectionId", "UserId", "ClientRequestId");
            CREATE TABLE IF NOT EXISTS "EmailOptIns" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_EmailOptIns" PRIMARY KEY AUTOINCREMENT,
                "Email" TEXT NOT NULL,
                "ConsentedAt" TEXT NOT NULL,
                "WordingVersion" TEXT NOT NULL,
                "Source" TEXT NOT NULL,
                "UnsubscribeTokenHash" TEXT NOT NULL,
                "UnsubscribedAt" TEXT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_EmailOptIns_UnsubscribeTokenHash" ON "EmailOptIns" ("UnsubscribeTokenHash");
            CREATE INDEX IF NOT EXISTS "IX_EmailOptIns_Email" ON "EmailOptIns" ("Email");
            """);
    }
}
