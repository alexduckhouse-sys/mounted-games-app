using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services.Operations;

public static class OperationsSqliteSchema
{
    public static Task EnsureAsync(AppDbContext db) => db.Database.ExecuteSqlRawAsync("""
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

        CREATE TABLE IF NOT EXISTS "Rulebook" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "Title" TEXT NOT NULL,
            "Edition" TEXT NOT NULL,
            "SourceUrl" TEXT,
            "Text" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL,
            "UpdatedByUserId" TEXT,
            CONSTRAINT "FK_Rulebook_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_Rulebook_CompetitionId_Title_Edition" ON "Rulebook" ("CompetitionId", "Title", "Edition");
        """);
}
