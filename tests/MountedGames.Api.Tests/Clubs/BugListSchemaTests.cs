using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Clubs;

public class BugListSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public BugListSchemaTests(ApiFactory f) => _f = f;

    private static readonly (string Table, string Column)[] NewColumns =
    [
        ("Sessions", "LaneRotationMode"), ("Results", "IsSitOut"), ("Teams", "BibDescription"),
        ("RiderEntries", "IsGuestRider"), ("SectionSignups", "TeamName"), ("SectionSignups", "IsWholeTeam"),
        ("ChatMessages", "RecipientUserId"),
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
    public async Task ExistingSqliteDatabaseGainsTheNewColumns_AndKeepsItsRows()
    {
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var sessions = await db.Sessions.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.Name }).ToListAsync();
        var results = await db.Results.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Points }).ToListAsync();
        var teams = await db.Teams.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.DisplayName }).ToListAsync();
        Assert.NotEmpty(sessions);
        foreach (var (table, column) in NewColumns)
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" DROP COLUMN \"{column}\"");
        foreach (var (table, column) in NewColumns)
            Assert.DoesNotContain(column, await ColumnsAsync(db, table));

        await DbInitializer.SeedAsync(_f.Services);
        db.ChangeTracker.Clear();

        foreach (var (table, column) in NewColumns)
            Assert.Contains(column, await ColumnsAsync(db, table));
        Assert.Equal(sessions, await db.Sessions.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.Name }).ToListAsync());
        Assert.Equal(results, await db.Results.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Points }).ToListAsync());
        Assert.Equal(teams, await db.Teams.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.DisplayName }).ToListAsync());
        // Existing sessions keep rotating up one lane after each race, as they always did.
        Assert.All(await db.Sessions.AsNoTracking().Select(x => x.LaneRotationMode).ToListAsync(), mode => Assert.Equal(LaneRotationMode.MoveUp, mode));
        Assert.All(await db.Results.AsNoTracking().Select(x => x.IsSitOut).ToListAsync(), sitOut => Assert.False(sitOut));
    }
}
