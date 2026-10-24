using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services;

/// <summary>
/// SQLite guards for the results book's special awards and the organiser's tie orders.
/// Points moved from int to double (half points). Databases made earlier keep an INTEGER-affinity <c>Results.Points</c>
/// (and <c>SeasonRoundResult.EventPoints</c>) column, which SQLite cannot alter in place and does not need to:
/// INTEGER affinity stores 2.5 as a REAL without loss (<c>HalfPointTests</c> proves it), so no guard is added for them.
/// </summary>
public static class ResultsSqliteSchema
{
    public static Task EnsureAsync(AppDbContext db) => db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "SpecialAwards" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_SpecialAwards" PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "CompetitionSectionId" INTEGER NULL,
            "Title" TEXT NOT NULL,
            "Recipient" TEXT NOT NULL,
            "Note" TEXT NULL,
            "OrderIndex" INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT "FK_SpecialAwards_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId")
                REFERENCES "Competitions" ("Id") ON DELETE CASCADE,
            CONSTRAINT "FK_SpecialAwards_CompetitionSections_CompetitionSectionId" FOREIGN KEY ("CompetitionSectionId")
                REFERENCES "CompetitionSections" ("Id") ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS "IX_SpecialAwards_CompetitionId" ON "SpecialAwards" ("CompetitionId");
        CREATE INDEX IF NOT EXISTS "IX_SpecialAwards_CompetitionSectionId" ON "SpecialAwards" ("CompetitionSectionId");

        CREATE TABLE IF NOT EXISTS "FinalsTieOrders" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_FinalsTieOrders" PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "TeamId" INTEGER NOT NULL,
            "Points" REAL NOT NULL,
            "Position" INTEGER NOT NULL,
            "SetAt" TEXT NOT NULL,
            "SetByUserId" TEXT NULL,
            CONSTRAINT "FK_FinalsTieOrders_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId")
                REFERENCES "Competitions" ("Id") ON DELETE CASCADE,
            CONSTRAINT "FK_FinalsTieOrders_Teams_TeamId" FOREIGN KEY ("TeamId")
                REFERENCES "Teams" ("Id") ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_FinalsTieOrders_TeamId" ON "FinalsTieOrders" ("TeamId");
        CREATE INDEX IF NOT EXISTS "IX_FinalsTieOrders_CompetitionId" ON "FinalsTieOrders" ("CompetitionId");
        """);
}
