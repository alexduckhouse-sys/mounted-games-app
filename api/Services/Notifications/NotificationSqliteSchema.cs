using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services.Notifications;

public static class NotificationSqliteSchema
{
    public static Task EnsureAsync(AppDbContext db) => db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "ScheduledNotifications" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_ScheduledNotifications" PRIMARY KEY AUTOINCREMENT,
            "ReminderKey" TEXT NOT NULL,
            "CompetitionId" INTEGER NOT NULL,
            "DueAt" TEXT NOT NULL,
            "ExpiresAt" TEXT NOT NULL,
            "TimetableVersion" TEXT NOT NULL,
            CONSTRAINT "FK_ScheduledNotifications_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_ScheduledNotifications_ReminderKey" ON "ScheduledNotifications" ("ReminderKey");
        CREATE INDEX IF NOT EXISTS "IX_ScheduledNotifications_ExpiresAt" ON "ScheduledNotifications" ("ExpiresAt");
        CREATE INDEX IF NOT EXISTS "IX_ScheduledNotifications_CompetitionId" ON "ScheduledNotifications" ("CompetitionId");
        CREATE TABLE IF NOT EXISTS "NotificationDeliveries" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_NotificationDeliveries" PRIMARY KEY AUTOINCREMENT,
            "ScheduledNotificationId" INTEGER NOT NULL,
            "PushSubscriptionId" INTEGER NOT NULL,
            "Status" INTEGER NOT NULL,
            "TimetableVersion" TEXT NOT NULL,
            "Attempts" INTEGER NOT NULL,
            "RecoveredLeases" INTEGER NOT NULL,
            "NextAttemptAt" TEXT NOT NULL,
            "ClaimedUntil" TEXT NULL,
            "ClaimToken" TEXT NULL,
            "LastError" TEXT NULL,
            "AcceptedAt" TEXT NULL,
            "UpdatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_NotificationDeliveries_ScheduledNotifications_ScheduledNotificationId" FOREIGN KEY ("ScheduledNotificationId") REFERENCES "ScheduledNotifications" ("Id") ON DELETE CASCADE,
            CONSTRAINT "FK_NotificationDeliveries_PushSubscriptions_PushSubscriptionId" FOREIGN KEY ("PushSubscriptionId") REFERENCES "PushSubscriptions" ("Id") ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_NotificationDeliveries_ScheduledNotificationId_PushSubscriptionId" ON "NotificationDeliveries" ("ScheduledNotificationId", "PushSubscriptionId");
        CREATE INDEX IF NOT EXISTS "IX_NotificationDeliveries_PushSubscriptionId" ON "NotificationDeliveries" ("PushSubscriptionId");
        CREATE INDEX IF NOT EXISTS "IX_NotificationDeliveries_Status_NextAttemptAt_ClaimedUntil" ON "NotificationDeliveries" ("Status", "NextAttemptAt", "ClaimedUntil");
        """);
}
