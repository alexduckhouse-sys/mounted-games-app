using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Broadcast;

public static class BroadcastFeature
{
    public static void ConfigureModels(ModelBuilder b)
    {
        b.Entity<BroadcastSnapshot>(e => {
            e.ToTable("BroadcastSnapshots");
            e.HasKey(x => x.Id);
            e.Property(x => x.Arena).HasMaxLength(80);
            e.HasIndex(x => new { x.CompetitionId, x.Arena, x.SectionKey, x.ObservedAt });
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<BroadcastCue>(e => {
            e.ToTable("BroadcastCues");
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.CommandId).IsUnique();
            e.HasIndex(x => new { x.CompetitionId, x.Arena, x.StartsAt });
            e.Property(x => x.Arena).HasMaxLength(80);
            e.Property(x => x.Kind).HasMaxLength(24);
            e.Property(x => x.Action).HasMaxLength(16);
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<BroadcastOutput>(e => {
            e.ToTable("BroadcastOutputs");
            e.HasKey(x => new { x.CompetitionId, x.Arena });
            e.Property(x => x.Arena).HasMaxLength(80);
            e.Property(x => x.Revision).IsConcurrencyToken();
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    public static async Task EnsureSqliteAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "BroadcastSnapshots" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "CompetitionId" INTEGER NOT NULL,
                "Arena" TEXT NOT NULL, "SectionKey" INTEGER NOT NULL, "ObservedAt" TEXT NOT NULL, "PayloadJson" TEXT NOT NULL,
                FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS "IX_BroadcastSnapshots_CompetitionId_Arena_SectionKey_ObservedAt"
                ON "BroadcastSnapshots" ("CompetitionId", "Arena", "SectionKey", "ObservedAt");
            CREATE TABLE IF NOT EXISTS "BroadcastCues" (
                "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "CommandId" TEXT NOT NULL, "CompetitionId" INTEGER NOT NULL,
                "Arena" TEXT NOT NULL, "SectionId" INTEGER NULL, "Kind" TEXT NOT NULL, "Action" TEXT NOT NULL,
                "StartsAt" TEXT NOT NULL, "ExpiresAt" TEXT NOT NULL, "PayloadJson" TEXT NOT NULL,
                FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE);
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_BroadcastCues_CommandId" ON "BroadcastCues" ("CommandId");
            CREATE INDEX IF NOT EXISTS "IX_BroadcastCues_CompetitionId_Arena_StartsAt" ON "BroadcastCues" ("CompetitionId", "Arena", "StartsAt");
            CREATE TABLE IF NOT EXISTS "BroadcastOutputs" (
                "CompetitionId" INTEGER NOT NULL, "Arena" TEXT NOT NULL, "Hidden" INTEGER NOT NULL,
                "DiscardBefore" TEXT NOT NULL, "Revision" INTEGER NOT NULL, "SponsorOffset" INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY ("CompetitionId", "Arena"),
                FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE);
            """);
    }
}
