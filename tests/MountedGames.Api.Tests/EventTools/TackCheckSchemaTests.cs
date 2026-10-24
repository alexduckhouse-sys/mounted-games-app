using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.EventTools;

public class TackCheckSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public TackCheckSchemaTests(ApiFactory f) => _f = f;

    private static readonly string[] Tables = ["TackCheckMarks", "TackCheckSectors", "TackCheckSections", "PassportChecks"];

    private static async Task<HashSet<string>> NamesAsync(AppDbContext db, string sql)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) await connection.OpenAsync();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        using var reader = await command.ExecuteReaderAsync();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (await reader.ReadAsync()) names.Add(reader.GetString(0));
        return names;
    }

    [Fact]
    public async Task VaccineUpgradeKeepsExistingPassportChecksAndAddsNullableFieldsIdempotently()
    {
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var team = await db.Teams.FirstAsync();
        var check = new PassportCheck { CompetitionId = team.CompetitionId, TeamId = team.Id, PonyName = "Test schema pony", PonyKey = "test-schema-pony" };
        db.Add(check);
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE CertifiedHorses");
        foreach (var column in new[] { "FluValidUntil", "InspectorRole", "LastFluVaccineDate", "LastTetanusDate", "OfficialNotes", "OwnerFullName", "PassportCode", "TetanusValidUntil" })
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE PassportChecks DROP COLUMN {column}");
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE RiderEntries DROP COLUMN PonyOwnerFullName; ALTER TABLE SavedRiders DROP COLUMN PonyOwnerFullName; ALTER TABLE SavedRiders DROP COLUMN PonyPassportNumber;");
        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services);
        db.ChangeTracker.Clear();
        var kept = await db.Set<PassportCheck>().SingleAsync(x => x.Id == check.Id);
        Assert.Equal("Test schema pony", kept.PonyName);
        Assert.Null(kept.LastFluVaccineDate);
        Assert.Contains("PonyOwnerFullName", await NamesAsync(db, "SELECT name FROM pragma_table_info('RiderEntries')"));
        Assert.Contains("PonyPassportNumber", await NamesAsync(db, "SELECT name FROM pragma_table_info('SavedRiders')"));
        Assert.Contains("PassportCode", await NamesAsync(db, "SELECT name FROM pragma_table_info('CertifiedHorses')"));
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsTheTackAndPassportSchema_AndKeepsItsCompetitions()
    {
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var competitions = await db.Competitions.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.Name }).ToListAsync();
        Assert.NotEmpty(competitions);
        foreach (var table in Tables) await db.Database.ExecuteSqlRawAsync($"DROP TABLE \"{table}\"");
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Competitions\" DROP COLUMN \"EnablePassportCheck\"");
        Assert.DoesNotContain("EnablePassportCheck", await NamesAsync(db, "SELECT name FROM pragma_table_info('Competitions')"));

        await DbInitializer.SeedAsync(_f.Services);
        db.ChangeTracker.Clear();

        var tables = await NamesAsync(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
        Assert.All(Tables, t => Assert.Contains(t, tables));
        Assert.Contains("EnablePassportCheck", await NamesAsync(db, "SELECT name FROM pragma_table_info('Competitions')"));
        Assert.Contains("RiderScoresJson", await NamesAsync(db, "SELECT name FROM pragma_table_info('TackCheckMarks')"));
        Assert.Equal(competitions, await db.Competitions.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.Name }).ToListAsync());
        Assert.All(await db.Competitions.AsNoTracking().Select(x => x.EnablePassportCheck).ToListAsync(), on => Assert.False(on));

        // The recreated tables take rows through the model.
        var competition = await db.Competitions.Include(c => c.Sections).Include(c => c.Teams).FirstAsync(c => c.Sections.Any() && c.Teams.Any());
        var section = competition.Sections.First();
        var team = competition.Teams.First();
        var setup = new TackCheckSection { CompetitionId = competition.Id, CompetitionSectionId = section.Id, IsEnabled = true, Sectors = { new TackCheckSector { Name = "Bit" } } };
        db.Add(setup);
        await db.SaveChangesAsync();
        db.Add(new TackCheckMark { TackCheckSectorId = setup.Sectors.First().Id, TeamId = team.Id, Points = 3 });
        db.Add(new PassportCheck { CompetitionId = competition.Id, TeamId = team.Id, PonyName = "Bramble", PonyKey = "bramble" });
        await db.SaveChangesAsync();
        db.Remove(setup);
        db.RemoveRange(await db.Set<PassportCheck>().ToListAsync());
        await db.SaveChangesAsync();
    }
}
