using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services;

public static class ChatModerationSqliteSchema
{
    public static Task EnsureAsync(AppDbContext db) => db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "ChatReports" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_ChatReports" PRIMARY KEY AUTOINCREMENT,
            "MessageId" INTEGER NOT NULL,
            "ReporterUserId" TEXT NOT NULL,
            "Reason" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "ResolvedAt" TEXT NULL,
            CONSTRAINT "FK_ChatReports_ChatMessages_MessageId" FOREIGN KEY ("MessageId") REFERENCES "ChatMessages" ("Id") ON DELETE CASCADE,
            CONSTRAINT "FK_ChatReports_AspNetUsers_ReporterUserId" FOREIGN KEY ("ReporterUserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_ChatReports_MessageId_ReporterUserId" ON "ChatReports" ("MessageId", "ReporterUserId");
        CREATE INDEX IF NOT EXISTS "IX_ChatReports_ReporterUserId" ON "ChatReports" ("ReporterUserId");
        CREATE TABLE IF NOT EXISTS "ChatUserBlocks" (
            "UserId" TEXT NOT NULL,
            "BlockedUserId" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            CONSTRAINT "PK_ChatUserBlocks" PRIMARY KEY ("UserId", "BlockedUserId"),
            CONSTRAINT "FK_ChatUserBlocks_AspNetUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE,
            CONSTRAINT "FK_ChatUserBlocks_AspNetUsers_BlockedUserId" FOREIGN KEY ("BlockedUserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS "IX_ChatUserBlocks_BlockedUserId" ON "ChatUserBlocks" ("BlockedUserId");
        """);
}
