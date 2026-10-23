using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.DeclarationForms;

public class DecFormSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public DecFormSchemaTests(ApiFactory f) => _f = f;

    private static readonly (string Table, string Column)[] NewColumns =
    [
        ("RiderEntries", "PonyHeightHands"), ("SavedRiders", "PonyHeightHands"),
        ("DeclarationForms", "TrainerName"), ("DeclarationForms", "TermsAcceptedAt"), ("DeclarationForms", "TermsAcceptedByUserId"),
    ];

    private static async Task<HashSet<string>> ColumnsAsync(AppDbContext db, string table)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) await connection.OpenAsync();
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT name FROM pragma_table_info('{table}')";
        using var reader = await command.ExecuteReaderAsync();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (await reader.ReadAsync()) names.Add(reader.GetString(0));
        return names;
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsTheDecFormColumns_AndKeepsItsRows()
    {
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var forms = await db.DeclarationForms.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Notes }).ToListAsync();
        var riders = await db.RiderEntries.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.FullName, x.HorseName }).ToListAsync();
        var saved = await db.SavedRiders.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.FullName }).ToListAsync();
        Assert.NotEmpty(forms);
        Assert.NotEmpty(riders);
        foreach (var (table, column) in NewColumns)
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" DROP COLUMN \"{column}\"");
        foreach (var (table, column) in NewColumns)
            Assert.DoesNotContain(column, await ColumnsAsync(db, table));

        await DbInitializer.SeedAsync(_f.Services);
        db.ChangeTracker.Clear();

        foreach (var (table, column) in NewColumns)
            Assert.Contains(column, await ColumnsAsync(db, table));
        Assert.Equal(forms, await db.DeclarationForms.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Notes }).ToListAsync());
        Assert.Equal(riders, await db.RiderEntries.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.FullName, x.HorseName }).ToListAsync());
        Assert.Equal(saved, await db.SavedRiders.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.FullName }).ToListAsync());
        // Forms from before the tick have no agreement recorded, and no pony height.
        Assert.All(await db.DeclarationForms.AsNoTracking().Select(x => x.TermsAcceptedAt).ToListAsync(), at => Assert.Null(at));
        Assert.All(await db.RiderEntries.AsNoTracking().Select(x => x.PonyHeightHands).ToListAsync(), hh => Assert.Null(hh));
    }
}
