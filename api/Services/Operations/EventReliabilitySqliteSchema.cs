using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
namespace MountedGames.Api.Services.Operations;
public static class EventReliabilitySqliteSchema
{
    public static Task EnsureAsync(AppDbContext db) => db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "HeatCall" (
            "HeatId" INTEGER NOT NULL PRIMARY KEY,
            "CalledAt" TEXT NOT NULL,
            FOREIGN KEY ("HeatId") REFERENCES "Heats" ("Id") ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS "SubstitutionRequest" (
            "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "DeclarationFormId" INTEGER NOT NULL,
            "RequestedByUserId" TEXT NOT NULL,
            "OutRiderEntryId" INTEGER NOT NULL,
            "InRiderEntryId" INTEGER NOT NULL,
            "ReplacementRiderName" TEXT NULL,
            "ReplacementHorseName" TEXT NULL,
            "Reason" TEXT NOT NULL,
            "DeclarationFingerprint" TEXT NOT NULL,
            "Status" TEXT NOT NULL,
            "RequestedAt" TEXT NOT NULL,
            "DecidedAt" TEXT NULL,
            "DecidedByUserId" TEXT NULL,
            FOREIGN KEY ("DeclarationFormId") REFERENCES "DeclarationForms" ("Id") ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS "IX_SubstitutionRequest_DeclarationFormId" ON "SubstitutionRequest" ("DeclarationFormId");
        CREATE INDEX IF NOT EXISTS "IX_SubstitutionRequest_CompetitionId_Status" ON "SubstitutionRequest" ("CompetitionId", "Status");
        """);
}
