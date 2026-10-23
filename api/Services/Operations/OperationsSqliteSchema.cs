using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services.Operations;

public static class OperationsSqliteSchema
{
    public static async Task EnsureAsync(AppDbContext db)
    {
        await MakeRulebooksGlobalAsync(db);
        await CreateAsync(db);
    }

    /// <summary>Rulebooks used to belong to one competition. Keep the newest copy of each title and edition as a shared rulebook.</summary>
    private static async Task MakeRulebooksGlobalAsync(AppDbContext db)
    {
        var legacy = await db.Database.SqlQueryRaw<int>("""SELECT COUNT(*) AS "Value" FROM pragma_table_info('Rulebook') WHERE name = 'CompetitionId'""").SingleAsync();
        if (legacy == 0) return;
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE "Rulebook" RENAME TO "Rulebook_old";
            DROP INDEX IF EXISTS "IX_Rulebook_CompetitionId_Title_Edition";
            """);
        await CreateRulebookTableAsync(db);
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO "Rulebook" ("Title", "Edition", "SourceUrl", "Text", "UpdatedAt", "UpdatedByUserId")
            SELECT r."Title", r."Edition", r."SourceUrl", r."Text", r."UpdatedAt", r."UpdatedByUserId" FROM "Rulebook_old" r
            WHERE r."Id" = (SELECT o."Id" FROM "Rulebook_old" o WHERE o."Title" = r."Title" AND o."Edition" = r."Edition" ORDER BY o."UpdatedAt" DESC, o."Id" DESC LIMIT 1);
            DROP TABLE "Rulebook_old";
            """);
    }

    private static Task CreateRulebookTableAsync(AppDbContext db) => db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "Rulebook" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "Title" TEXT NOT NULL,
            "Edition" TEXT NOT NULL,
            "SourceUrl" TEXT,
            "Text" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL,
            "UpdatedByUserId" TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_Rulebook_Title_Edition" ON "Rulebook" ("Title", "Edition");
        """);

    private static async Task CreateAsync(AppDbContext db)
    {
        await CreateRulebookTableAsync(db);
        await db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "EquipmentAcknowledgement" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "ItemKey" TEXT NOT NULL,
            "AcknowledgedAt" TEXT NOT NULL,
            "AcknowledgedByUserId" TEXT,
            CONSTRAINT "FK_EquipmentAcknowledgement_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_EquipmentAcknowledgement_CompetitionId_ItemKey" ON "EquipmentAcknowledgement" ("CompetitionId", "ItemKey");

        CREATE TABLE IF NOT EXISTS "RaceScoreEvent" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "RaceId" INTEGER NOT NULL,
            "Revision" INTEGER NOT NULL,
            "Kind" INTEGER NOT NULL,
            "BeforeJson" TEXT NOT NULL,
            "AfterJson" TEXT NOT NULL,
            "ActorUserId" TEXT,
            "Reason" TEXT NOT NULL,
            "RequestId" TEXT NOT NULL,
            "PayloadFingerprint" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_RaceScoreEvent_Races_RaceId" FOREIGN KEY ("RaceId") REFERENCES "Races" ("Id") ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_RaceScoreEvent_RaceId_RequestId" ON "RaceScoreEvent" ("RaceId", "RequestId");

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_RaceScoreEvent_RaceId_Revision" ON "RaceScoreEvent" ("RaceId", "Revision");

        CREATE TABLE IF NOT EXISTS "RaceScoreState" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "RaceId" INTEGER NOT NULL,
            "Revision" INTEGER NOT NULL,
            "IsSignedOff" INTEGER NOT NULL,
            "SignedOffAt" TEXT,
            "SignedOffByUserId" TEXT,
            "UpdatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_RaceScoreState_Races_RaceId" FOREIGN KEY ("RaceId") REFERENCES "Races" ("Id") ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_RaceScoreState_RaceId" ON "RaceScoreState" ("RaceId");


        CREATE TABLE IF NOT EXISTS "TeamStatusEvent" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "TeamId" INTEGER NOT NULL,
            "Status" INTEGER NOT NULL,
            "Reason" TEXT NOT NULL,
            "ActorUserId" TEXT,
            "RemovedEntriesJson" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_TeamStatusEvent_Teams_TeamId" FOREIGN KEY ("TeamId") REFERENCES "Teams" ("Id") ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS "IX_TeamStatusEvent_CompetitionId" ON "TeamStatusEvent" ("CompetitionId");

        CREATE INDEX IF NOT EXISTS "IX_TeamStatusEvent_TeamId_Id" ON "TeamStatusEvent" ("TeamId", "Id");

        CREATE TABLE IF NOT EXISTS "DrawChange" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "SectionId" INTEGER NOT NULL,
            "Kind" INTEGER NOT NULL,
            "RequestId" TEXT NOT NULL,
            "Fingerprint" TEXT NOT NULL,
            "ActorUserId" TEXT,
            "ResultJson" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_DrawChange_CompetitionId_RequestId" ON "DrawChange" ("CompetitionId", "RequestId");

        CREATE INDEX IF NOT EXISTS "IX_DrawChange_CompetitionId_SectionId" ON "DrawChange" ("CompetitionId", "SectionId");

        CREATE TABLE IF NOT EXISTS "RiderSwapEvent" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "DeclarationFormId" INTEGER NOT NULL,
            "TeamId" INTEGER NOT NULL,
            "OutRiderEntryId" INTEGER NOT NULL,
            "InRiderEntryId" INTEGER NOT NULL,
            "BeforeJson" TEXT NOT NULL,
            "AfterJson" TEXT NOT NULL,
            "ActorUserId" TEXT,
            "Reason" TEXT NOT NULL,
            "OverrodeLock" INTEGER NOT NULL,
            "RequestId" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_RiderSwapEvent_DeclarationForms_DeclarationFormId" FOREIGN KEY ("DeclarationFormId") REFERENCES "DeclarationForms" ("Id") ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS "IX_RiderSwapEvent_CompetitionId" ON "RiderSwapEvent" ("CompetitionId");

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_RiderSwapEvent_DeclarationFormId_RequestId" ON "RiderSwapEvent" ("DeclarationFormId", "RequestId");
        """);
    }
}
