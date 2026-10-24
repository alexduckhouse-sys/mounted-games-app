using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Services.Seasons;

public static class SeasonsSqliteSchema
{
    public static async Task EnsureAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "Season" (
        "Id" TEXT NOT NULL,
        "OwnerUserId" TEXT NOT NULL,
        "Title" TEXT NOT NULL,
        "Year" INTEGER NOT NULL,
        "Format" INTEGER NOT NULL,
        "AgeGroup" TEXT NOT NULL,
        "BestResultsToCount" INTEGER,
        "CreatedAt" TEXT NOT NULL,
        "UpdatedAt" TEXT NOT NULL,
        CONSTRAINT "PK_Season" PRIMARY KEY ("Id"),
        CONSTRAINT "FK_Season_AspNetUsers_OwnerUserId" FOREIGN KEY ("OwnerUserId") REFERENCES "AspNetUsers" ("Id") ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS "IX_Season_OwnerUserId" ON "Season" ("OwnerUserId");

        CREATE INDEX IF NOT EXISTS "IX_Season_Year_Format_AgeGroup" ON "Season" ("Year", "Format", "AgeGroup");

        CREATE TABLE IF NOT EXISTS "TeamProfile" (
        "Id" TEXT NOT NULL,
        "OwnerUserId" TEXT NOT NULL,
        "ClubId" INTEGER NOT NULL,
        "Suffix" TEXT NOT NULL,
        "DisplayName" TEXT NOT NULL,
        "CreatedAt" TEXT NOT NULL,
        "UpdatedAt" TEXT NOT NULL,
        CONSTRAINT "PK_TeamProfile" PRIMARY KEY ("Id"),
        CONSTRAINT "FK_TeamProfile_AspNetUsers_OwnerUserId" FOREIGN KEY ("OwnerUserId") REFERENCES "AspNetUsers" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_TeamProfile_Clubs_ClubId" FOREIGN KEY ("ClubId") REFERENCES "Clubs" ("Id") ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS "IX_TeamProfile_ClubId" ON "TeamProfile" ("ClubId");

        CREATE INDEX IF NOT EXISTS "IX_TeamProfile_OwnerUserId" ON "TeamProfile" ("OwnerUserId");

        CREATE TABLE IF NOT EXISTS "SeasonPlacePoints" (
        "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "SeasonId" TEXT NOT NULL,
        "Place" INTEGER NOT NULL,
        "Points" INTEGER NOT NULL,
        CONSTRAINT "FK_SeasonPlacePoints_Season_SeasonId" FOREIGN KEY ("SeasonId") REFERENCES "Season" ("Id") ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_SeasonPlacePoints_SeasonId_Place" ON "SeasonPlacePoints" ("SeasonId", "Place");

        CREATE TABLE IF NOT EXISTS "SeasonRound" (
        "Id" TEXT NOT NULL,
        "SeasonId" TEXT NOT NULL,
        "CompetitionId" INTEGER NOT NULL,
        "CompetitionSectionId" INTEGER NOT NULL,
        "OrderIndex" INTEGER NOT NULL,
        "IsIncluded" INTEGER NOT NULL,
        "PointsMultiplier" REAL NOT NULL DEFAULT 1.0,
        "CreatedAt" TEXT NOT NULL,
        CONSTRAINT "PK_SeasonRound" PRIMARY KEY ("Id"),
        CONSTRAINT "FK_SeasonRound_CompetitionSections_CompetitionSectionId" FOREIGN KEY ("CompetitionSectionId") REFERENCES "CompetitionSections" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_SeasonRound_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_SeasonRound_Season_SeasonId" FOREIGN KEY ("SeasonId") REFERENCES "Season" ("Id") ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS "IX_SeasonRound_CompetitionId" ON "SeasonRound" ("CompetitionId");

        CREATE INDEX IF NOT EXISTS "IX_SeasonRound_CompetitionSectionId" ON "SeasonRound" ("CompetitionSectionId");

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_SeasonRound_SeasonId_CompetitionSectionId" ON "SeasonRound" ("SeasonId", "CompetitionSectionId");

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_SeasonRound_SeasonId_OrderIndex" ON "SeasonRound" ("SeasonId", "OrderIndex");

        CREATE TABLE IF NOT EXISTS "EventTeamProfileLink" (
        "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "TeamProfileId" TEXT NOT NULL,
        "CompetitionId" INTEGER NOT NULL,
        "TeamId" INTEGER NOT NULL,
        "LinkedByUserId" TEXT NOT NULL,
        "LinkedAt" TEXT NOT NULL,
        CONSTRAINT "FK_EventTeamProfileLink_AspNetUsers_LinkedByUserId" FOREIGN KEY ("LinkedByUserId") REFERENCES "AspNetUsers" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_EventTeamProfileLink_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE,
        CONSTRAINT "FK_EventTeamProfileLink_TeamProfile_TeamProfileId" FOREIGN KEY ("TeamProfileId") REFERENCES "TeamProfile" ("Id") ON DELETE CASCADE,
        CONSTRAINT "FK_EventTeamProfileLink_Teams_TeamId" FOREIGN KEY ("TeamId") REFERENCES "Teams" ("Id") ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_EventTeamProfileLink_CompetitionId_TeamProfileId" ON "EventTeamProfileLink" ("CompetitionId", "TeamProfileId");

        CREATE INDEX IF NOT EXISTS "IX_EventTeamProfileLink_LinkedByUserId" ON "EventTeamProfileLink" ("LinkedByUserId");

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_EventTeamProfileLink_TeamId" ON "EventTeamProfileLink" ("TeamId");

        CREATE INDEX IF NOT EXISTS "IX_EventTeamProfileLink_TeamProfileId" ON "EventTeamProfileLink" ("TeamProfileId");

        CREATE TABLE IF NOT EXISTS "SeasonRoundPublication" (
        "Id" TEXT NOT NULL,
        "SeasonRoundId" TEXT NOT NULL,
        "Version" INTEGER NOT NULL,
        "SourceFingerprint" TEXT NOT NULL,
        "PublishedByUserId" TEXT NOT NULL,
        "PublishedAt" TEXT NOT NULL,
        CONSTRAINT "PK_SeasonRoundPublication" PRIMARY KEY ("Id"),
        CONSTRAINT "FK_SeasonRoundPublication_AspNetUsers_PublishedByUserId" FOREIGN KEY ("PublishedByUserId") REFERENCES "AspNetUsers" ("Id") ON DELETE RESTRICT,
        CONSTRAINT "FK_SeasonRoundPublication_SeasonRound_SeasonRoundId" FOREIGN KEY ("SeasonRoundId") REFERENCES "SeasonRound" ("Id") ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS "IX_SeasonRoundPublication_PublishedByUserId" ON "SeasonRoundPublication" ("PublishedByUserId");

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_SeasonRoundPublication_SeasonRoundId_Version" ON "SeasonRoundPublication" ("SeasonRoundId", "Version");

        CREATE TABLE IF NOT EXISTS "SeasonRoundResult" (
        "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "SeasonRoundPublicationId" TEXT NOT NULL,
        "TeamProfileId" TEXT NOT NULL,
        "EventTeamId" INTEGER NOT NULL,
        "TeamName" TEXT NOT NULL,
        "ClubName" TEXT NOT NULL,
        "EventRank" INTEGER NOT NULL,
        "EventPoints" REAL NOT NULL,
        "SeasonPoints" INTEGER NOT NULL,
        CONSTRAINT "FK_SeasonRoundResult_SeasonRoundPublication_SeasonRoundPublica~" FOREIGN KEY ("SeasonRoundPublicationId") REFERENCES "SeasonRoundPublication" ("Id") ON DELETE CASCADE,
        CONSTRAINT "FK_SeasonRoundResult_TeamProfile_TeamProfileId" FOREIGN KEY ("TeamProfileId") REFERENCES "TeamProfile" ("Id") ON DELETE RESTRICT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "IX_SeasonRoundResult_SeasonRoundPublicationId_TeamProfileId" ON "SeasonRoundResult" ("SeasonRoundPublicationId", "TeamProfileId");

        CREATE INDEX IF NOT EXISTS "IX_SeasonRoundResult_TeamProfileId" ON "SeasonRoundResult" ("TeamProfileId");
        """);
        await DbInitializer.EnsureColumnAsync(db, "SeasonRound", "PointsMultiplier", "REAL NOT NULL DEFAULT 1.0");
    }
}
