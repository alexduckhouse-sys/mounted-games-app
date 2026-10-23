using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services.TackCheck;

/// <summary>Brings an older local SQLite file up to date with the tack check and passport check tables.</summary>
public static class TackCheckSqliteSchema
{
    public static async Task EnsureAsync(AppDbContext db)
    {
        await DbInitializer.EnsureColumnAsync(db, "Competitions", "EnablePassportCheck", "INTEGER NOT NULL DEFAULT 0");
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "TackCheckSections" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_TackCheckSections" PRIMARY KEY AUTOINCREMENT,
                "CompetitionId" INTEGER NOT NULL,
                "CompetitionSectionId" INTEGER NOT NULL,
                "IsEnabled" INTEGER NOT NULL DEFAULT 0,
                "Mode" INTEGER NOT NULL DEFAULT 0,
                "MaxPoints" INTEGER NOT NULL DEFAULT 10,
                "UpdatedAt" TEXT NOT NULL,
                CONSTRAINT "FK_TackCheckSections_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId")
                    REFERENCES "Competitions" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_TackCheckSections_CompetitionSections_CompetitionSectionId" FOREIGN KEY ("CompetitionSectionId")
                    REFERENCES "CompetitionSections" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_TackCheckSections_CompetitionSectionId" ON "TackCheckSections" ("CompetitionSectionId");
            CREATE INDEX IF NOT EXISTS "IX_TackCheckSections_CompetitionId" ON "TackCheckSections" ("CompetitionId");

            CREATE TABLE IF NOT EXISTS "TackCheckSectors" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_TackCheckSectors" PRIMARY KEY AUTOINCREMENT,
                "TackCheckSectionId" INTEGER NOT NULL,
                "Name" TEXT NOT NULL,
                "OrderIndex" INTEGER NOT NULL DEFAULT 0,
                CONSTRAINT "FK_TackCheckSectors_TackCheckSections_TackCheckSectionId" FOREIGN KEY ("TackCheckSectionId")
                    REFERENCES "TackCheckSections" ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_TackCheckSectors_TackCheckSectionId" ON "TackCheckSectors" ("TackCheckSectionId");

            CREATE TABLE IF NOT EXISTS "TackCheckMarks" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_TackCheckMarks" PRIMARY KEY AUTOINCREMENT,
                "TackCheckSectorId" INTEGER NOT NULL,
                "TeamId" INTEGER NOT NULL,
                "Passed" INTEGER NULL,
                "Points" INTEGER NULL,
                "RecordedByUserId" TEXT NULL,
                "RecordedAt" TEXT NOT NULL,
                CONSTRAINT "FK_TackCheckMarks_TackCheckSectors_TackCheckSectorId" FOREIGN KEY ("TackCheckSectorId")
                    REFERENCES "TackCheckSectors" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_TackCheckMarks_Teams_TeamId" FOREIGN KEY ("TeamId")
                    REFERENCES "Teams" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_TackCheckMarks_TackCheckSectorId_TeamId" ON "TackCheckMarks" ("TackCheckSectorId", "TeamId");
            CREATE INDEX IF NOT EXISTS "IX_TackCheckMarks_TeamId" ON "TackCheckMarks" ("TeamId");

            CREATE TABLE IF NOT EXISTS "PassportChecks" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_PassportChecks" PRIMARY KEY AUTOINCREMENT,
                "CompetitionId" INTEGER NOT NULL,
                "TeamId" INTEGER NOT NULL,
                "PonyName" TEXT NOT NULL,
                "PonyKey" TEXT NOT NULL,
                "CheckedAt" TEXT NOT NULL,
                "CheckedByUserId" TEXT NULL,
                "CheckedByName" TEXT NULL,
                CONSTRAINT "FK_PassportChecks_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId")
                    REFERENCES "Competitions" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_PassportChecks_Teams_TeamId" FOREIGN KEY ("TeamId")
                    REFERENCES "Teams" ("Id") ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_PassportChecks_TeamId_PonyKey" ON "PassportChecks" ("TeamId", "PonyKey");
            CREATE INDEX IF NOT EXISTS "IX_PassportChecks_CompetitionId" ON "PassportChecks" ("CompetitionId");
            """);
    }
}
