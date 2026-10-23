using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services.Sponsors;

public static class SponsorsSqliteSchema
{
    public static Task EnsureAsync(AppDbContext db) => db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "Sponsors" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_Sponsors" PRIMARY KEY AUTOINCREMENT,
            "CompetitionId" INTEGER NOT NULL,
            "Name" TEXT NOT NULL,
            "LinkUrl" TEXT NULL,
            "LogoBytes" BLOB NULL,
            "LogoContentType" TEXT NULL,
            "LogoVersion" INTEGER NOT NULL DEFAULT 0,
            "Tier" INTEGER NOT NULL DEFAULT 0,
            "SortOrder" INTEGER NOT NULL DEFAULT 0,
            "ShowOn" INTEGER NOT NULL DEFAULT 0,
            "IsEnabled" INTEGER NOT NULL DEFAULT 1,
            "StartsAt" TEXT NULL,
            "EndsAt" TEXT NULL,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_Sponsors_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId")
                REFERENCES "Competitions" ("Id") ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS "IX_Sponsors_CompetitionId" ON "Sponsors" ("CompetitionId");

        CREATE TABLE IF NOT EXISTS "SponsorExposures" (
            "SponsorId" INTEGER NOT NULL,
            "Day" TEXT NOT NULL,
            "Placement" INTEGER NOT NULL,
            "Views" INTEGER NOT NULL DEFAULT 0,
            "Seconds" INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT "PK_SponsorExposures" PRIMARY KEY ("SponsorId", "Day", "Placement"),
            CONSTRAINT "FK_SponsorExposures_Sponsors_SponsorId" FOREIGN KEY ("SponsorId")
                REFERENCES "Sponsors" ("Id") ON DELETE CASCADE
        );
        """);
}
