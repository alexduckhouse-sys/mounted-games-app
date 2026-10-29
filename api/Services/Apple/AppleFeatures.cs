using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Apple;
using MountedGames.Api.Entities.Commerce;
namespace MountedGames.Api.Services.Apple;

public static class AppleFeatures
{
    public static IServiceCollection AddAppleFeatures(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<AppleOptions>(); services.AddSingleton<AppleSecrets>();
        services.AddScoped<AppleConflictFilter>(); services.AddHostedService<AppleDeliveryWorker>();
        services.AddScoped<ArrivalBookingService>(); services.AddScoped<AppleDeliveryRunner>();
        services.AddScoped<AppleProgressReader>(); services.AddSingleton<ApplePassIssuer>();
        services.AddSingleton<IApplePushProvider, ApplePushProvider>();
        services.AddHttpClient("AppleLivePush").RemoveAllLoggers();
        services.AddHttpClient("AppleWalletPush").RemoveAllLoggers().ConfigurePrimaryHttpMessageHandler(sp =>
        {
            var handler = new HttpClientHandler(); var options = sp.GetRequiredService<AppleOptions>();
            if (options.WalletReady) handler.ClientCertificates.Add(ApplePassIssuer.LoadCertificate(options));
            return handler;
        });
        return services;
    }
    public static void ConfigureAppleModels(this ModelBuilder b)
    {
        b.Entity<NativeInstallation>().ToTable("NativeInstallations").HasKey(x => x.Id);
        b.Entity<LiveActivityRegistration>().ToTable("LiveActivityRegistrations").HasKey(x => x.Id);
        b.Entity<LiveActivityRegistration>().HasIndex(x => new { x.InstallationId, x.ActivityId }).IsUnique();
        b.Entity<LiveActivityRegistration>().HasOne<NativeInstallation>().WithMany().HasForeignKey(x => x.InstallationId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<LiveActivityRegistration>().HasOne<Team>().WithMany().HasForeignKey(x => x.TeamId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<LiveActivityRegistration>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<ArrivalBooking>().ToTable("ArrivalBookings").HasKey(x => x.Id);
        b.Entity<ArrivalBooking>().HasIndex(x => x.Reference).IsUnique();
        b.Entity<ArrivalBooking>().HasIndex(x => x.SignupId).IsUnique();
        b.Entity<ArrivalBooking>().HasOne<Competition>().WithMany().HasForeignKey(x => x.CompetitionId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ArrivalBooking>().Property(x => x.Revision).IsConcurrencyToken();
        b.Entity<ArrivalBookingSource>().ToTable("ArrivalBookingSources").HasKey(x => x.Id);
        b.Entity<ArrivalBookingSource>().HasIndex(x => new { x.ArrivalBookingId, x.EventOrderLineId }).IsUnique();
        b.Entity<ArrivalBookingSource>().HasOne(x => x.Booking).WithMany(x => x.Sources).HasForeignKey(x => x.ArrivalBookingId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ArrivalBookingSource>().HasOne<EventOrderLine>().WithMany().HasForeignKey(x => x.EventOrderLineId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ArrivalAllocation>().ToTable("ArrivalAllocations").HasKey(x => x.Id);
        b.Entity<ArrivalAllocation>().HasOne(x => x.Source).WithMany(x => x.Allocations).HasForeignKey(x => x.ArrivalBookingSourceId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ArrivalAllocation>().HasIndex(x => new { x.CompetitionId, x.Kind, x.Resource, x.Night }).IsUnique();
        b.Entity<WalletPass>().ToTable("WalletPasses").HasKey(x => x.Id);
        b.Entity<WalletPass>().HasIndex(x => x.Serial).IsUnique(); b.Entity<WalletPass>().HasIndex(x => x.ArrivalBookingId).IsUnique();
        b.Entity<WalletPass>().HasOne<ArrivalBooking>().WithMany().HasForeignKey(x => x.ArrivalBookingId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<WalletDeviceRegistration>().ToTable("WalletDeviceRegistrations").HasKey(x => x.Id);
        b.Entity<WalletDeviceRegistration>().HasIndex(x => new { x.WalletPassId, x.DeviceHash }).IsUnique();
        b.Entity<WalletDeviceRegistration>().HasOne<WalletPass>().WithMany().HasForeignKey(x => x.WalletPassId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<AppleChangeClock>().ToTable("AppleChangeClock").HasKey(x => x.Id);
        b.Entity<EventOrderLine>().Property(x => x.FulfilmentRevision).IsConcurrencyToken();
        b.Entity<AppleChangeClock>().HasData(new AppleChangeClock());
    }

    public static async Task EnsureAppleSqliteSchema(AppDbContext db, CancellationToken ct = default)
    {
        if (!db.Database.IsSqlite()) return;
        foreach (var sql in Schema.Split(";", StringSplitOptions.RemoveEmptyEntries)) await db.Database.ExecuteSqlRawAsync(sql, ct);
        foreach (var table in new[] { "CatalogueItem", "EventOrderLine" })
        {
            await EnsureColumn(db, table, table == "CatalogueItem" ? "FulfilmentKind" : "FulfilmentKindSnapshot", "INTEGER NOT NULL DEFAULT 0", ct);
            await EnsureColumn(db, table, "FulfilmentFromDate", "TEXT NULL", ct);
            await EnsureColumn(db, table, "FulfilmentUntilDate", "TEXT NULL", ct);
        }
        await EnsureColumn(db, "EventOrderLine", "FulfilmentReviewedByUserId", "TEXT NULL", ct);
        await EnsureColumn(db, "EventOrderLine", "FulfilmentReviewedAt", "TEXT NULL", ct);
        await EnsureColumn(db, "EventOrderLine", "FulfilmentRevision", "INTEGER NOT NULL DEFAULT 1", ct);
    }
    private static async Task EnsureColumn(AppDbContext db, string table, string column, string type, CancellationToken ct)
    {
        var connection = db.Database.GetDbConnection(); var wasClosed = connection.State != System.Data.ConnectionState.Open;
        if (wasClosed) await connection.OpenAsync(ct);
        try {
            await using var command = connection.CreateCommand(); command.CommandText = $"PRAGMA table_info(\"{table}\")";
            await using var reader = await command.ExecuteReaderAsync(ct); var found = false;
            while (await reader.ReadAsync(ct)) if (reader.GetString(1) == column) found = true;
            await reader.DisposeAsync();
            // Identifiers are constants above, never request values.
#pragma warning disable EF1002
            if (!found) await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {type}", ct);
#pragma warning restore EF1002
        } finally { if (wasClosed) await connection.CloseAsync(); }
    }
    public static async Task DeleteCompetitionAsync(AppDbContext db, int competitionId, CancellationToken ct = default)
    {
        await db.Set<ArrivalBooking>().Where(x => x.CompetitionId == competitionId).ExecuteDeleteAsync(ct);
        await db.Set<LiveActivityRegistration>().Where(x => x.CompetitionId == competitionId).ExecuteDeleteAsync(ct);
    }
    public static async Task DeleteAccountAsync(AppDbContext db, string userId, CancellationToken ct = default)
    {
        await db.Set<ArrivalBooking>().Where(x => x.OwnerUserId == userId).ExecuteDeleteAsync(ct);
        await db.Set<EventOrderLine>().Where(x => x.FulfilmentReviewedByUserId == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.FulfilmentReviewedByUserId, (string?)null), ct);
        var reviewed = await db.Set<ArrivalBooking>().Where(x => x.LegacyAllocationSnapshot != null && x.LegacyAllocationSnapshot.Contains(userId)).ToListAsync(ct);
        foreach (var row in reviewed)
        {
            var json = System.Text.Json.Nodes.JsonNode.Parse(row.LegacyAllocationSnapshot!);
            if (json?["ReviewedBy"]?.GetValue<string>() == userId) { json["ReviewedBy"] = "deleted-account"; row.LegacyAllocationSnapshot = json.ToJsonString(); }
        }
        await db.SaveChangesAsync(ct);
    }
    public static async Task<object> ExportAccountAsync(AppDbContext db, string userId, CancellationToken ct = default) =>
        await db.Set<ArrivalBooking>().AsNoTracking().Where(x => x.OwnerUserId == userId).Select(x => new {
            x.Id, x.CompetitionId, x.SignupId, x.VehicleRegistration, x.Revision, x.UpdatedAt, x.LegacyReconciledAt,
            Sources = x.Sources.Select(s => new { s.EventOrderLineId, s.Quantity, Allocations = s.Allocations.Select(a => new { a.Resource, a.Night, a.Kind }) })
        }).ToListAsync(ct);

    private const string Schema = """
CREATE TABLE IF NOT EXISTS NativeInstallations (Id TEXT PRIMARY KEY, CapabilityHash TEXT NOT NULL, CreatedAt TEXT NOT NULL, LastSeenAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS LiveActivityRegistrations (Id TEXT PRIMARY KEY, InstallationId TEXT NOT NULL REFERENCES NativeInstallations(Id) ON DELETE CASCADE, ActivityId TEXT NOT NULL, CompetitionId INTEGER NOT NULL, TeamId INTEGER NOT NULL REFERENCES Teams(Id) ON DELETE CASCADE, ProtectedPushToken TEXT NOT NULL, Sandbox INTEGER NOT NULL, ExpiresAt TEXT NOT NULL, EndRequested INTEGER NOT NULL, Ended INTEGER NOT NULL, Version INTEGER NOT NULL, LastTimestamp INTEGER NOT NULL, NextAttemptAt TEXT NOT NULL, LeaseToken TEXT NULL, LeaseUntil TEXT NULL, Attempts INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS IX_LiveActivityRegistrations_InstallationId_ActivityId ON LiveActivityRegistrations(InstallationId, ActivityId);
CREATE TABLE IF NOT EXISTS ArrivalBookings (Id TEXT PRIMARY KEY, CompetitionId INTEGER NOT NULL REFERENCES Competitions(Id) ON DELETE CASCADE, OwnerUserId TEXT NOT NULL, SignupId INTEGER NULL, Reference TEXT NOT NULL, VehicleRegistration TEXT NOT NULL, LegacyReconciledAt TEXT NULL, LegacyAllocationSnapshot TEXT NULL, Revision INTEGER NOT NULL, UpdatedAt TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS IX_ArrivalBookings_Reference ON ArrivalBookings(Reference);
CREATE UNIQUE INDEX IF NOT EXISTS IX_ArrivalBookings_SignupId ON ArrivalBookings(SignupId);
CREATE TABLE IF NOT EXISTS ArrivalBookingSources (Id INTEGER PRIMARY KEY AUTOINCREMENT, ArrivalBookingId TEXT NOT NULL REFERENCES ArrivalBookings(Id) ON DELETE CASCADE, EventOrderLineId INTEGER NOT NULL REFERENCES EventOrderLine(Id) ON DELETE RESTRICT, Quantity INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS IX_ArrivalBookingSources_ArrivalBookingId_EventOrderLineId ON ArrivalBookingSources(ArrivalBookingId, EventOrderLineId);
CREATE TABLE IF NOT EXISTS ArrivalAllocations (Id INTEGER PRIMARY KEY AUTOINCREMENT, ArrivalBookingSourceId INTEGER NOT NULL REFERENCES ArrivalBookingSources(Id) ON DELETE CASCADE, CompetitionId INTEGER NOT NULL, Resource TEXT NOT NULL, Night TEXT NOT NULL, Kind INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS IX_ArrivalAllocations_CompetitionId_Kind_Resource_Night ON ArrivalAllocations(CompetitionId, Kind, Resource, Night);
CREATE TABLE IF NOT EXISTS WalletPasses (Id TEXT PRIMARY KEY, ArrivalBookingId TEXT NOT NULL REFERENCES ArrivalBookings(Id) ON DELETE CASCADE, Serial TEXT NOT NULL, ProtectedAuthenticationToken TEXT NOT NULL, AuthenticationTokenHash TEXT NOT NULL, ContentHash TEXT NOT NULL, Revision INTEGER NOT NULL, ChangeCursor INTEGER NOT NULL, ChangedAt TEXT NOT NULL, LastCheckedAt TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS IX_WalletPasses_Serial ON WalletPasses(Serial);
CREATE UNIQUE INDEX IF NOT EXISTS IX_WalletPasses_ArrivalBookingId ON WalletPasses(ArrivalBookingId);
CREATE TABLE IF NOT EXISTS WalletDeviceRegistrations (Id INTEGER PRIMARY KEY AUTOINCREMENT, WalletPassId TEXT NOT NULL REFERENCES WalletPasses(Id) ON DELETE CASCADE, DeviceHash TEXT NOT NULL, ProtectedPushToken TEXT NOT NULL, PendingCursor INTEGER NOT NULL, DeliveredCursor INTEGER NOT NULL, NextAttemptAt TEXT NOT NULL, LeaseToken TEXT NULL, LeaseUntil TEXT NULL, Attempts INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS IX_WalletDeviceRegistrations_WalletPassId_DeviceHash ON WalletDeviceRegistrations(WalletPassId, DeviceHash);
CREATE TABLE IF NOT EXISTS AppleChangeClock (Id INTEGER PRIMARY KEY, Value INTEGER NOT NULL);
INSERT OR IGNORE INTO AppleChangeClock (Id, Value) VALUES (1, 0);
""";
}
