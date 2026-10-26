using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests;

public class EntryExtensionsSchemaTests
{
    private static readonly string[] Tables = ["SignupMatchmaking", "SignupExtras", "CompetitionEntrySettings", "CompetitionDeclarationLocks"];
    private static readonly DateTime CloseAt = new(2030, 6, 1, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task ExistingDatabaseGainsTablesAndColumnsWithoutChangingItsEvents()
    {
        using var factory = new ApiFactory();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var competitionIds = await db.Competitions.OrderBy(x => x.Id).Select(x => x.Id).ToListAsync();
        var team = await db.Teams.FirstAsync();
        var season = new Season { OwnerUserId = await db.Users.Select(x => x.Id).FirstAsync(), Title = "Synthetic season", AgeGroup = "Synthetic", Year = 2030 };
        var round = new SeasonRound { Season = season, CompetitionId = team.CompetitionId, CompetitionSectionId = team.CompetitionSectionId, OrderIndex = 1 };
        var tack = new TackCheckSection { CompetitionId = team.CompetitionId, CompetitionSectionId = team.CompetitionSectionId,
            Sectors = [new TackCheckSector { Name = "Synthetic sector", Marks = [new TackCheckMark { TeamId = team.Id, Points = 3 }] }] };
        db.AddRange(round, tack);
        await db.SaveChangesAsync();
        foreach (var table in Tables)
        {
            var sql = $"DROP TABLE \"{table}\"";
            await db.Database.ExecuteSqlRawAsync(sql);
        }
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"TackCheckMarks\" DROP COLUMN \"RiderScoresJson\"; ALTER TABLE \"SeasonRound\" DROP COLUMN \"PointsMultiplier\";");

        await DbInitializer.SeedAsync(factory.Services);
        await DbInitializer.SeedAsync(factory.Services);
        Assert.Equal(competitionIds, await db.Competitions.OrderBy(x => x.Id).Select(x => x.Id).ToListAsync());
        Assert.Empty(await db.Set<SignupMatchmaking>().ToListAsync());
        Assert.Empty(await db.Set<SignupExtras>().ToListAsync());
        Assert.Empty(await db.Set<CompetitionEntrySettings>().ToListAsync());
        Assert.Empty(await db.Set<CompetitionDeclarationLock>().ToListAsync());

        db.ChangeTracker.Clear();
        Assert.Equal(1.0, (await db.Set<SeasonRound>().SingleAsync(x => x.Id == round.Id)).PointsMultiplier);
        var mark = await db.Set<TackCheckMark>().SingleAsync();
        Assert.Equal(3, mark.Points);
        Assert.Null(mark.RiderScoresJson);
        mark.RiderScoresJson = "[1,2,null]";
        round = await db.Set<SeasonRound>().SingleAsync(x => x.Id == round.Id);
        round.PointsMultiplier = 1.5;
        await db.SaveChangesAsync();
        await DbInitializer.SeedAsync(factory.Services);
        db.ChangeTracker.Clear();
        Assert.Equal(1.5, (await db.Set<SeasonRound>().SingleAsync(x => x.Id == round.Id)).PointsMultiplier);
        Assert.Equal("[1,2,null]", (await db.Set<TackCheckMark>().SingleAsync()).RiderScoresJson);
    }

    [Fact]
    public async Task RuntimeTablesKeepAllValuesAndGainForeignKeysOnRepeatedUpgrade()
    {
        using var factory = new ApiFactory();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var section = await db.CompetitionSections.FirstAsync();
        var owner = new SectionSignup { CompetitionSectionId = section.Id, FullName = "Synthetic entry A" };
        var partner = new SectionSignup { CompetitionSectionId = section.Id, FullName = "Synthetic entry B" };
        db.AddRange(owner, partner);
        await db.SaveChangesAsync();
        foreach (var table in Tables)
        {
            var sql = $"DROP TABLE \"{table}\"";
            await db.Database.ExecuteSqlRawAsync(sql);
        }
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE "SignupMatchmaking" ("SignupId" INTEGER NOT NULL PRIMARY KEY, "LookingForPair" INTEGER NOT NULL DEFAULT 0,
                "LookingForGuestRiders" INTEGER NOT NULL DEFAULT 0, "WaitingForGuestSpot" INTEGER NOT NULL DEFAULT 0,
                "PairRequestFromSignupId" INTEGER NULL, "PairRequestToSignupId" INTEGER NULL, "PairRequestStatus" TEXT NULL);
            CREATE TABLE "SignupExtras" ("SignupId" INTEGER NOT NULL PRIMARY KEY, "StablesCount" INTEGER NOT NULL DEFAULT 0,
                "StablingClubOrTeam" TEXT NULL, "PaymentMethod" TEXT NULL, "IsWaitlist" INTEGER NOT NULL DEFAULT 0,
                "IsWithdrawn" INTEGER NOT NULL DEFAULT 0, "RefundPending" INTEGER NOT NULL DEFAULT 0, "TeamsCount" INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE "CompetitionEntrySettings" ("CompetitionId" INTEGER NOT NULL PRIMARY KEY, "EntriesCloseAt" TEXT NULL);
            CREATE TABLE "CompetitionDeclarationLocks" ("CompetitionId" INTEGER NOT NULL PRIMARY KEY, "DeclarationsCloseAt" TEXT NULL);
            """);
        var iso = CloseAt.ToString("O");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"SignupMatchmaking\" VALUES ({owner.Id}, 1, 1, 1, {partner.Id}, {partner.Id}, 'pending');");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"SignupExtras\" VALUES ({owner.Id}, 3, 'Synthetic club', 'bacs', 1, 1, 1, 2);");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"CompetitionEntrySettings\" VALUES ({section.CompetitionId}, {iso});");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"CompetitionDeclarationLocks\" VALUES ({section.CompetitionId}, {iso});");

        await DbInitializer.SeedAsync(factory.Services);
        await DbInitializer.SeedAsync(factory.Services);
        db.ChangeTracker.Clear();
        var match = await db.Set<SignupMatchmaking>().SingleAsync();
        Assert.Equal(owner.Id, match.SignupId);
        Assert.False(match.DeclarationAccessGranted);
        Assert.True(match.LookingForPair && match.LookingForGuestRiders && match.WaitingForGuestSpot);
        Assert.Equal(partner.Id, match.PairRequestFromSignupId);
        Assert.Equal(partner.Id, match.PairRequestToSignupId);
        Assert.Equal("pending", match.PairRequestStatus);
        var extras = await db.Set<SignupExtras>().SingleAsync();
        Assert.Equal(owner.Id, extras.SignupId);
        Assert.Equal(3, extras.StablesCount);
        Assert.Equal(0, extras.HookupsCount);
        Assert.Equal("Synthetic club", extras.StablingClubOrTeam);
        Assert.Equal("bacs", extras.PaymentMethod);
        Assert.True(extras.IsWaitlist && extras.IsWithdrawn && extras.RefundPending);
        Assert.Equal(2, extras.TeamsCount);
        Assert.Null(extras.StableAssignment);
        Assert.Null(extras.HookupAssignment);
        Assert.Null(extras.VehicleRegistration);
        Assert.Null(extras.ArrivalNotes);
        extras.StableAssignment = "Barn B, Boxes 14–18";
        extras.HookupAssignment = "Hook-up Post 4";
        extras.VehicleRegistration = "AB12 CDE";
        extras.ArrivalNotes = "Friday 18:00";
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        var savedExtras = await db.Set<SignupExtras>().SingleAsync();
        Assert.Equal("Barn B, Boxes 14–18", savedExtras.StableAssignment);
        Assert.Equal("Hook-up Post 4", savedExtras.HookupAssignment);
        Assert.Equal("AB12 CDE", savedExtras.VehicleRegistration);
        Assert.Equal("Friday 18:00", savedExtras.ArrivalNotes);
        var settings = await db.Set<CompetitionEntrySettings>().SingleAsync();
        Assert.Equal(CloseAt, settings.EntriesCloseAt);
        Assert.Null(settings.MaxStables);
        Assert.Null(settings.MaxHookups);
        Assert.Equal(DateTimeKind.Utc, settings.EntriesCloseAt!.Value.Kind);
        Assert.Equal(CloseAt, (await db.Set<CompetitionDeclarationLock>().SingleAsync()).DeclarationsCloseAt);
        settings.EntriesCloseAt = CloseAt.AddHours(1);
        settings.MaxStables = 80;
        settings.MaxHookups = 20;
        extras.HookupsCount = 2;
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        var updatedSettings = await db.Set<CompetitionEntrySettings>().SingleAsync();
        Assert.Equal(CloseAt.AddHours(1), updatedSettings.EntriesCloseAt);
        Assert.Equal(80, updatedSettings.MaxStables);
        Assert.Equal(20, updatedSettings.MaxHookups);
        Assert.Equal(2, (await db.Set<SignupExtras>().SingleAsync()).HookupsCount);

        // SET NULL and CASCADE must work for adopted tables, not only brand-new ones.
        await db.SectionSignups.Where(x => x.Id == partner.Id).ExecuteDeleteAsync();
        db.ChangeTracker.Clear();
        match = await db.Set<SignupMatchmaking>().SingleAsync();
        Assert.Null(match.PairRequestFromSignupId);
        Assert.Null(match.PairRequestToSignupId);
        await db.SectionSignups.Where(x => x.Id == owner.Id).ExecuteDeleteAsync();
        Assert.Empty(await db.Set<SignupMatchmaking>().ToListAsync());
        Assert.Empty(await db.Set<SignupExtras>().ToListAsync());
    }

    [Fact]
    public async Task ExistingMappedTableGainsAccessFlagDefaultingToDenied()
    {
        using var factory = new ApiFactory();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var signup = new SectionSignup { CompetitionSectionId = await db.CompetitionSections.Select(s => s.Id).FirstAsync(), FullName = "Synthetic entry" };
        db.Add(signup);
        await db.SaveChangesAsync();
        db.Add(new SignupMatchmaking { SignupId = signup.Id, LookingForPair = true });
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"SignupMatchmaking\" DROP COLUMN \"DeclarationAccessGranted\";");
        await EntryExtensionsSqliteSchema.EnsureAsync(db);
        db.ChangeTracker.Clear();
        var match = await db.Set<SignupMatchmaking>().SingleAsync();
        Assert.False(match.DeclarationAccessGranted);
        Assert.True(match.LookingForPair);
        match.DeclarationAccessGranted = true;
        await db.SaveChangesAsync();
        await EntryExtensionsSqliteSchema.EnsureAsync(db);
        db.ChangeTracker.Clear();
        Assert.True((await db.Set<SignupMatchmaking>().SingleAsync()).DeclarationAccessGranted);
    }

    [Fact]
    public async Task SignupTeamLinks_UpgradeIsIdempotentAndBothOwnersCascade()
    {
        using var factory = new ApiFactory();
        var arena = await factory.CreateArenaAsync(2);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var team = await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0]);
        var signup = new SectionSignup { CompetitionSectionId = team.CompetitionSectionId, FullName = "Synthetic multiple-team entry" };
        db.Add(signup);
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE \"SignupTeamLinks\";");
        await EntryExtensionsSqliteSchema.EnsureAsync(db);
        db.AddRange(arena.TeamIds.Select(teamId => new SignupTeamLink { SignupId = signup.Id, TeamId = teamId }));
        await db.SaveChangesAsync();
        await EntryExtensionsSqliteSchema.EnsureAsync(db);
        db.ChangeTracker.Clear();
        Assert.Equal(2, await db.Set<SignupTeamLink>().CountAsync(x => x.SignupId == signup.Id));
        Assert.Equal(1, await db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM pragma_index_list('SignupTeamLinks') WHERE name = 'IX_SignupTeamLinks_TeamId'").SingleAsync());
        await db.Teams.Where(t => t.Id == team.Id).ExecuteDeleteAsync();
        Assert.Single(await db.Set<SignupTeamLink>().Where(x => x.SignupId == signup.Id).ToListAsync());
        await db.SectionSignups.Where(s => s.Id == signup.Id).ExecuteDeleteAsync();
        Assert.Empty(await db.Set<SignupTeamLink>().Where(x => x.SignupId == signup.Id).ToListAsync());
    }

    [Fact]
    public async Task InvalidLegacyReferencesAbortUpgradeWithoutRemovingTheOriginalRows()
    {
        using var factory = new ApiFactory();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("""
            DROP TABLE "CompetitionEntrySettings";
            CREATE TABLE "CompetitionEntrySettings" ("CompetitionId" INTEGER NOT NULL PRIMARY KEY, "EntriesCloseAt" TEXT NULL);
            INSERT INTO "CompetitionEntrySettings" VALUES (-999, NULL);
            """);
        await Assert.ThrowsAsync<SqliteException>(() => EntryExtensionsSqliteSchema.EnsureAsync(db));
        Assert.Equal(-999, (await db.Set<CompetitionEntrySettings>().SingleAsync()).CompetitionId);
        Assert.Equal(0, await db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM pragma_foreign_key_list('CompetitionEntrySettings')").SingleAsync());
        Assert.Equal(0, await db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM sqlite_master WHERE name = 'CompetitionEntrySettings_ef_upgrade'").SingleAsync());
    }

    [Fact]
    public void PostgresMappingsPreserveLegacyStorageAndUseNativeUuidRoundKeys()
    {
        using var db = new AppDbContextFactory().CreateDbContext([]);
        var match = db.Model.FindEntityType(typeof(SignupMatchmaking))!;
        Assert.Equal(typeof(int), match.FindProperty(nameof(SignupMatchmaking.LookingForPair))!.GetTypeMapping().Converter!.ProviderClrType);
        var settings = db.Model.FindEntityType(typeof(CompetitionEntrySettings))!;
        Assert.Equal("text", settings.FindProperty(nameof(CompetitionEntrySettings.EntriesCloseAt))!.GetColumnType());
        Assert.Equal(typeof(string), settings.FindProperty(nameof(CompetitionEntrySettings.EntriesCloseAt))!.GetTypeMapping().Converter!.ProviderClrType);
        var round = db.Model.FindEntityType(typeof(SeasonRound))!;
        Assert.Equal("uuid", round.FindProperty(nameof(SeasonRound.Id))!.GetColumnType());
        Assert.Equal("double precision", round.FindProperty(nameof(SeasonRound.PointsMultiplier))!.GetColumnType());
        var id = Guid.NewGuid();
        var sql = db.Set<SeasonRound>().Where(x => x.Id == id).Select(x => x.PointsMultiplier).ToQueryString();
        Assert.Contains("PointsMultiplier", sql);
        Assert.DoesNotContain("UPPER", sql);
    }
}
