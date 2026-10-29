using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
namespace MountedGames.Api.Services.Vaccinations;

public static class VaccinationFeature
{
    public static IServiceCollection AddVaccinationChecks(this IServiceCollection services) => services.AddScoped<VaccinationService>();
    public static void ConfigureModels(ModelBuilder model)
    {
        model.Entity<VaccinationPolicyVersion>(e => { e.ToTable("VaccinationPolicyVersions"); e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(80); e.HasData(VaccinationPolicies.Rows()); });
        model.Entity<EventVaccinationSettings>(e =>
        {
            e.ToTable("EventVaccinationSettings"); e.HasKey(x => x.CompetitionId); e.Property(x => x.Revision).IsConcurrencyToken();
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<VaccinationPolicyVersion>().WithMany().HasForeignKey(x => x.PolicyVersionId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<VaccinationHorse>(e =>
        {
            e.ToTable("VaccinationHorses"); e.HasKey(x => x.Id);
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        });
        model.Entity<VaccinationDeclarationHorse>(e =>
        {
            e.ToTable("VaccinationDeclarationHorses"); e.HasKey(x => x.Id); e.HasIndex(x => x.RiderEntryId).IsUnique();
            e.Property(x => x.Revision).IsConcurrencyToken();
            e.HasOne<VaccinationHorse>().WithMany().HasForeignKey(x => x.HorseId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
            // Keep the snapshot when the declaration replaces its rider rows. The owning event controls retention.
            e.HasIndex(x => x.DeclarationFormId);
        });
        model.Entity<VaccinationEvidence>(e =>
        {
            e.ToTable("VaccinationEvidence"); e.HasKey(x => x.Id); e.HasIndex(x => new { x.DeclarationHorseId, x.Revision }).IsUnique();
            e.HasOne<VaccinationDeclarationHorse>().WithMany().HasForeignKey(x => x.DeclarationHorseId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        });
        model.Entity<VaccinationInspection>(e =>
        {
            e.ToTable("VaccinationInspections"); e.HasKey(x => x.Id); e.HasIndex(x => new { x.DeclarationHorseId, x.LinkRevision }).IsUnique();
            e.HasOne<VaccinationDeclarationHorse>().WithMany().HasForeignKey(x => x.DeclarationHorseId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<VaccinationEvidence>().WithMany().HasForeignKey(x => x.EvidenceId).OnDelete(DeleteBehavior.Cascade);
        });
    }
    public static async Task EnsureSqliteAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "VaccinationPolicyVersions" ("Id" TEXT NOT NULL PRIMARY KEY, "Organisation" TEXT NOT NULL, "Edition" TEXT NOT NULL, "SourceUrl" TEXT NULL, "EffectiveFrom" TEXT NULL, "EffectiveUntil" TEXT NULL, "VerifiedOn" TEXT NULL, "Automatic" INTEGER NOT NULL, "RulesJson" TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS "EventVaccinationSettings" ("CompetitionId" INTEGER NOT NULL PRIMARY KEY REFERENCES "Competitions"("Id") ON DELETE CASCADE, "PolicyVersionId" TEXT NOT NULL REFERENCES "VaccinationPolicyVersions"("Id"), "Revision" INTEGER NOT NULL, "ReferenceDateBasis" TEXT NOT NULL, "VenueRulesJson" TEXT NOT NULL, "UpdatedAt" TEXT NOT NULL, "UpdatedByUserId" TEXT NULL);
            CREATE INDEX IF NOT EXISTS "IX_EventVaccinationSettings_PolicyVersionId" ON "EventVaccinationSettings"("PolicyVersionId");
            CREATE TABLE IF NOT EXISTS "VaccinationHorses" ("Id" TEXT NOT NULL PRIMARY KEY, "CompetitionId" INTEGER NOT NULL REFERENCES "Competitions"("Id") ON DELETE CASCADE, "CreatedByUserId" TEXT NULL, "CreatedAt" TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS "IX_VaccinationHorses_CompetitionId" ON "VaccinationHorses"("CompetitionId");
            CREATE TABLE IF NOT EXISTS "VaccinationDeclarationHorses" ("Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "CompetitionId" INTEGER NOT NULL REFERENCES "Competitions"("Id") ON DELETE CASCADE, "DeclarationFormId" INTEGER NOT NULL, "RiderEntryId" INTEGER NOT NULL, "HorseId" TEXT NOT NULL REFERENCES "VaccinationHorses"("Id") ON DELETE CASCADE, "PonyNameSnapshot" TEXT NOT NULL, "PassportSnapshot" TEXT NULL, "Revision" INTEGER NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_VaccinationDeclarationHorses_RiderEntryId" ON "VaccinationDeclarationHorses"("RiderEntryId");
            CREATE INDEX IF NOT EXISTS "IX_VaccinationDeclarationHorses_CompetitionId" ON "VaccinationDeclarationHorses"("CompetitionId");
            CREATE INDEX IF NOT EXISTS "IX_VaccinationDeclarationHorses_DeclarationFormId" ON "VaccinationDeclarationHorses"("DeclarationFormId");
            CREATE INDEX IF NOT EXISTS "IX_VaccinationDeclarationHorses_HorseId" ON "VaccinationDeclarationHorses"("HorseId");
            CREATE TABLE IF NOT EXISTS "VaccinationEvidence" ("Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "CompetitionId" INTEGER NOT NULL REFERENCES "Competitions"("Id") ON DELETE CASCADE, "DeclarationHorseId" INTEGER NOT NULL REFERENCES "VaccinationDeclarationHorses"("Id") ON DELETE CASCADE, "Revision" INTEGER NOT NULL, "Source" TEXT NOT NULL, "DatesJson" TEXT NOT NULL, "CompleteHistory" INTEGER NOT NULL, "ArrivalOn" TEXT NULL, "LastOtherVaccinationOn" TEXT NULL, "ExceptionReview" INTEGER NOT NULL, "Notes" TEXT NULL, "RecordedByUserId" TEXT NULL, "RecordedAt" TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_VaccinationEvidence_DeclarationHorseId_Revision" ON "VaccinationEvidence"("DeclarationHorseId", "Revision");
            CREATE INDEX IF NOT EXISTS "IX_VaccinationEvidence_CompetitionId" ON "VaccinationEvidence"("CompetitionId");
            CREATE TABLE IF NOT EXISTS "VaccinationInspections" ("Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "CompetitionId" INTEGER NOT NULL REFERENCES "Competitions"("Id") ON DELETE CASCADE, "DeclarationHorseId" INTEGER NOT NULL REFERENCES "VaccinationDeclarationHorses"("Id") ON DELETE CASCADE, "LinkRevision" INTEGER NOT NULL, "EvidenceId" INTEGER NOT NULL REFERENCES "VaccinationEvidence"("Id") ON DELETE CASCADE, "EvidenceRevision" INTEGER NOT NULL, "SettingsRevision" INTEGER NOT NULL, "PolicyVersionId" TEXT NOT NULL, "EventStartOn" TEXT NOT NULL, "Decision" TEXT NOT NULL, "Reason" TEXT NOT NULL, "EvaluationJson" TEXT NOT NULL, "InspectedByUserId" TEXT NULL, "InspectedAt" TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_VaccinationInspections_DeclarationHorseId_LinkRevision" ON "VaccinationInspections"("DeclarationHorseId", "LinkRevision");
            CREATE INDEX IF NOT EXISTS "IX_VaccinationInspections_CompetitionId" ON "VaccinationInspections"("CompetitionId");
            CREATE INDEX IF NOT EXISTS "IX_VaccinationInspections_EvidenceId" ON "VaccinationInspections"("EvidenceId");
            """);
        foreach (var row in VaccinationPolicies.Rows())
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT OR IGNORE INTO VaccinationPolicyVersions (Id, Organisation, Edition, SourceUrl, EffectiveFrom, EffectiveUntil, VerifiedOn, Automatic, RulesJson) VALUES ({row.Id}, {row.Organisation}, {row.Edition}, {row.SourceUrl}, {row.EffectiveFrom}, {row.EffectiveUntil}, {row.VerifiedOn}, {row.Automatic}, {row.RulesJson})");
    }
}
