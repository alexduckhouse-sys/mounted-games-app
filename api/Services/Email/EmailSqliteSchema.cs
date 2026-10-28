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
            CREATE TABLE IF NOT EXISTS "CustomEmails" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_CustomEmails" PRIMARY KEY AUTOINCREMENT,
                "Subject" TEXT NOT NULL,
                "Audience" INTEGER NOT NULL,
                "BlocksJson" TEXT NOT NULL,
                "HtmlBody" TEXT NOT NULL,
                "TextBody" TEXT NOT NULL,
                "CreatedByUserId" TEXT NULL,
                "CreatedAt" TEXT NOT NULL,
                "Status" INTEGER NOT NULL,
                "Total" INTEGER NOT NULL,
                "Sent" INTEGER NOT NULL,
                "Failed" INTEGER NOT NULL,
                "Skipped" INTEGER NOT NULL,
                "CompletedAt" TEXT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_CustomEmails_CreatedAt" ON "CustomEmails" ("CreatedAt");
            CREATE TABLE IF NOT EXISTS "CustomEmailRecipients" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_CustomEmailRecipients" PRIMARY KEY AUTOINCREMENT,
                "CustomEmailId" INTEGER NOT NULL,
                "Address" TEXT NOT NULL,
                "OptInId" INTEGER NULL,
                "Status" INTEGER NOT NULL,
                "ClaimedAt" TEXT NULL,
                "ClaimToken" TEXT NULL,
                "Attempts" INTEGER NOT NULL,
                CONSTRAINT "FK_CustomEmailRecipients_CustomEmails_CustomEmailId" FOREIGN KEY ("CustomEmailId")
                    REFERENCES "CustomEmails" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_CustomEmailRecipients_CustomEmailId_Status" ON "CustomEmailRecipients" ("CustomEmailId", "Status");
            CREATE TABLE IF NOT EXISTS "CustomEmailImages" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_CustomEmailImages" PRIMARY KEY,
                "Bytes" BLOB NOT NULL,
                "ContentType" TEXT NOT NULL,
                "UploadedByUserId" TEXT NULL,
                "CreatedAt" TEXT NOT NULL,
                "UsedByEmailId" INTEGER NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_CustomEmailImages_UsedByEmailId" ON "CustomEmailImages" ("UsedByEmailId");
            CREATE TABLE IF NOT EXISTS "EntriesDigestRuns" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_EntriesDigestRuns" PRIMARY KEY AUTOINCREMENT,
                "RunDate" TEXT NOT NULL,
                "ClaimedAt" TEXT NOT NULL,
                "Status" INTEGER NOT NULL,
                "Manual" INTEGER NOT NULL,
                "Competitions" INTEGER NOT NULL,
                "Total" INTEGER NOT NULL,
                "CompletedAt" TEXT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_EntriesDigestRuns_RunDate" ON "EntriesDigestRuns" ("RunDate");
            CREATE TABLE IF NOT EXISTS "EntriesDigestCompetitions" (
                "CompetitionId" INTEGER NOT NULL CONSTRAINT "PK_EntriesDigestCompetitions" PRIMARY KEY,
                "RunId" INTEGER NOT NULL,
                "Name" TEXT NOT NULL DEFAULT '',
                "Location" TEXT NULL,
                "StartDate" TEXT NOT NULL DEFAULT '0001-01-01 00:00:00',
                "EndDate" TEXT NULL,
                "Latitude" REAL NULL,
                "Longitude" REAL NULL,
                "EntriesCloseAt" TEXT NULL,
                CONSTRAINT "FK_EntriesDigestCompetitions_EntriesDigestRuns_RunId" FOREIGN KEY ("RunId")
                    REFERENCES "EntriesDigestRuns" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_EntriesDigestCompetitions_RunId" ON "EntriesDigestCompetitions" ("RunId");
            CREATE TABLE IF NOT EXISTS "EntriesDigestRecipients" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_EntriesDigestRecipients" PRIMARY KEY AUTOINCREMENT,
                "RunId" INTEGER NOT NULL,
                "OptInId" INTEGER NOT NULL,
                "Status" INTEGER NOT NULL,
                "ClaimedAt" TEXT NULL,
                "ClaimToken" TEXT NULL,
                "Attempts" INTEGER NOT NULL,
                CONSTRAINT "FK_EntriesDigestRecipients_EntriesDigestRuns_RunId" FOREIGN KEY ("RunId")
                    REFERENCES "EntriesDigestRuns" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_EntriesDigestRecipients_RunId_OptInId" ON "EntriesDigestRecipients" ("RunId", "OptInId");
            CREATE INDEX IF NOT EXISTS "IX_EntriesDigestRecipients_RunId_Status" ON "EntriesDigestRecipients" ("RunId", "Status");
            CREATE INDEX IF NOT EXISTS "IX_SectionSignups_ContactEmail" ON "SectionSignups" ("ContactEmail");
            """);
        // A development file from before the digest froze its text.
        await DbInitializer.EnsureColumnAsync(db, "EntriesDigestCompetitions", "Name", "TEXT NOT NULL DEFAULT ''");
        await DbInitializer.EnsureColumnAsync(db, "EntriesDigestCompetitions", "Location", "TEXT NULL");
        await DbInitializer.EnsureColumnAsync(db, "EntriesDigestCompetitions", "StartDate", "TEXT NOT NULL DEFAULT '0001-01-01 00:00:00'");
        await DbInitializer.EnsureColumnAsync(db, "EntriesDigestCompetitions", "EndDate", "TEXT NULL");
        await DbInitializer.EnsureColumnAsync(db, "EntriesDigestCompetitions", "Latitude", "REAL NULL");
        await DbInitializer.EnsureColumnAsync(db, "EntriesDigestCompetitions", "Longitude", "REAL NULL");
        await DbInitializer.EnsureColumnAsync(db, "EntriesDigestCompetitions", "EntriesCloseAt", "TEXT NULL");
        // Fill rows that predate the frozen text from their competition, as the Postgres migration does.
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE "EntriesDigestCompetitions"
            SET "Name" = COALESCE(SUBSTR((SELECT c."Name" FROM "Competitions" c WHERE c."Id" = "EntriesDigestCompetitions"."CompetitionId"), 1, 200), ''),
                "Location" = SUBSTR((SELECT c."Location" FROM "Competitions" c WHERE c."Id" = "EntriesDigestCompetitions"."CompetitionId"), 1, 500),
                "StartDate" = COALESCE((SELECT c."StartDate" FROM "Competitions" c WHERE c."Id" = "EntriesDigestCompetitions"."CompetitionId"), "StartDate"),
                "EndDate" = (SELECT c."EndDate" FROM "Competitions" c WHERE c."Id" = "EntriesDigestCompetitions"."CompetitionId"),
                "Latitude" = (SELECT c."Latitude" FROM "Competitions" c WHERE c."Id" = "EntriesDigestCompetitions"."CompetitionId"),
                "Longitude" = (SELECT c."Longitude" FROM "Competitions" c WHERE c."Id" = "EntriesDigestCompetitions"."CompetitionId")
            WHERE "Name" = '' AND EXISTS (SELECT 1 FROM "Competitions" c WHERE c."Id" = "EntriesDigestCompetitions"."CompetitionId");
            """);
    }
}
