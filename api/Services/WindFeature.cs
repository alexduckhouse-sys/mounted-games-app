using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

public static class WindFeature
{
    public static void Configure(ModelBuilder b)
    {
        b.Entity<WindRulesSelection>(e => {
            e.ToTable("WindRulesSelections"); e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.CompetitionId, x.SectionId }).IsUnique();
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.Revision).IsConcurrencyToken();
        });
        b.Entity<WindRaceDecision>(e => {
            e.ToTable("WindRaceDecisions"); e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.CompetitionId, x.RequestId }).IsUnique();
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.ActorUserId).HasMaxLength(450);
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.ActorUserId).OnDelete(DeleteBehavior.SetNull);
        });
        b.Entity<WindAcknowledgement>(e => {
            e.ToTable("WindAcknowledgements"); e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.CompetitionId, x.EndsAt });
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<Race>().Property(x => x.ProgrammeRevision).HasDefaultValue(0);
    }

    public static async Task EnsureSqliteAsync(AppDbContext db)
    {
        if (!db.Database.IsSqlite()) return;
        var connection = db.Database.GetDbConnection();
        var wasOpen = connection.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await connection.OpenAsync();
        try {
            await using var cmd = connection.CreateCommand(); cmd.CommandText = "PRAGMA table_info('Races')";
            var found = false;
            await using (var reader = await cmd.ExecuteReaderAsync())
                while (await reader.ReadAsync()) if (reader.GetString(1) == "ProgrammeRevision") found = true;
            if (!found) await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Races\" ADD COLUMN \"ProgrammeRevision\" INTEGER NOT NULL DEFAULT 0");
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TABLE IF NOT EXISTS "WindRulesSelections" (
                    "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "CompetitionId" INTEGER NOT NULL REFERENCES "Competitions"("Id") ON DELETE CASCADE,
                    "SectionId" INTEGER NOT NULL, "ProfileId" TEXT NOT NULL, "Revision" INTEGER NOT NULL, "EventLevel" TEXT NOT NULL,
                    "PublishedSpare" TEXT NOT NULL, "PermittedRacesJson" TEXT NOT NULL, "VenueNotes" TEXT NOT NULL,
                    "ReviewMph" REAL NOT NULL, "OfficialReviewMph" REAL NOT NULL, "VenueLimitMph" REAL NULL, "AdoptionConfirmed" INTEGER NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS "IX_WindRulesSelections_CompetitionId_SectionId" ON "WindRulesSelections" ("CompetitionId", "SectionId");
                CREATE TABLE IF NOT EXISTS "WindRaceDecisions" (
                    "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "CompetitionId" INTEGER NOT NULL REFERENCES "Competitions"("Id") ON DELETE CASCADE,
                    "SessionId" INTEGER NOT NULL, "RequestId" TEXT NOT NULL, "Fingerprint" TEXT NOT NULL, "ProfileId" TEXT NOT NULL,
                    "BeforeJson" TEXT NOT NULL, "AfterJson" TEXT NOT NULL, "Authority" TEXT NOT NULL, "Decision" TEXT NOT NULL,
                    "ActorUserId" TEXT NULL REFERENCES "AspNetUsers"("Id") ON DELETE SET NULL, "CreatedAt" TEXT NOT NULL, "PublishedAt" TEXT NULL);
                CREATE TABLE IF NOT EXISTS "WindAcknowledgements" (
                    "Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "CompetitionId" INTEGER NOT NULL REFERENCES "Competitions"("Id") ON DELETE CASCADE,
                    "Arena" TEXT NOT NULL, "StartsAt" INTEGER NOT NULL, "EndsAt" INTEGER NOT NULL, "PeakMph" REAL NOT NULL,
                    "Severity" INTEGER NOT NULL, "AcknowledgedAt" TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS "IX_WindAcknowledgements_CompetitionId_EndsAt" ON "WindAcknowledgements" ("CompetitionId", "EndsAt");
                CREATE UNIQUE INDEX IF NOT EXISTS "IX_WindRaceDecisions_CompetitionId_RequestId" ON "WindRaceDecisions" ("CompetitionId", "RequestId");
                """);
        } finally { if (!wasOpen) await connection.CloseAsync(); }
    }

    public static async Task SeedTemplatesAsync(AppDbContext db)
    {
        foreach (var format in new[] { SectionFormat.Teams, SectionFormat.Pairs, SectionFormat.Individual })
        {
            var name = WindRuleCatalogue.HooplaName(format);
            if (await db.RaceTemplates.AnyAsync(t => t.Name == name)) continue;
            var ground = format == SectionFormat.Teams ? 4 : 2;
            var diagram = RaceLibraryPairs.D.Make(0, false, [
                RaceLibraryPairs.D.Cone("ball", "pole1"), RaceLibraryPairs.D.Item("quoit", "start"),
                .. Enumerable.Range(0, ground).Select(_ => RaceLibraryPairs.D.Item("quoit", "beyond"))]);
            var sequence = format == SectionFormat.Individual
                ? "Place the carried ring over the cone. Collect each of the two rings at the far end separately, placing each over the cone, then finish."
                : $"Each rider places a ring over the cone, collects a ring at the far end and hands it to the next rider. The last rider also places the collected ring before finishing.";
            db.RaceTemplates.Add(new RaceTemplate { Name = name, Category = "Equipment", IsBuiltIn = true,
                Summary = "Reviewed IMGA race, not a Bottle adaptation. Requires official approval for substitution.",
                Rules = $"IMGA 2026, Hoopla, printed p{(format == SectionFormat.Teams ? 61 : format == SectionFormat.Pairs ? 95 : 123)}. {WindRuleCatalogue.Imga}\nOne cone level with pole 1; {ground} rubber rings flat and separate on the 3 m mark beyond the changeover, offset between pole lines; one ring carried at the start. {sequence} The cone tip must remain visible above every ring. Apply IMGA general and games rules.",
                DiagramJson = diagram });
        }
        await db.SaveChangesAsync();
    }
}
