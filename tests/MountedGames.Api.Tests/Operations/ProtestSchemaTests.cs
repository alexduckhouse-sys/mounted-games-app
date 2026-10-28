using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

/// <summary>An existing SQLite database gains the protest log and <c>Races.HasOpenProtest</c> at startup, keeping its races.</summary>
public class ProtestSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ProtestSchemaTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task ExistingDatabaseGainsTheProtestLog_Idempotently()
    {
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var races = await db.Races.AsNoTracking().OrderBy(r => r.Id).Select(r => new { r.Id, r.Name, r.HeatId }).ToListAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE IF EXISTS \"Protest\"; ALTER TABLE \"Races\" DROP COLUMN \"HasOpenProtest\";");

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services);
        db.ChangeTracker.Clear();

        Assert.Equal(races, await db.Races.AsNoTracking().OrderBy(r => r.Id).Select(r => new { r.Id, r.Name, r.HeatId }).ToListAsync());
        Assert.All(await db.Races.AsNoTracking().Select(r => r.HasOpenProtest).ToListAsync(), Assert.False);
        var race = await db.Races.AsNoTracking().Include(r => r.Heat).ThenInclude(h => h!.Session).FirstAsync();
        db.Add(new Protest { CompetitionId = race.Heat!.Session!.CompetitionId, HeatId = race.HeatId, RaceId = race.Id, Reason = "Schema check", RequestId = "schema-check" });
        await db.SaveChangesAsync();
        Assert.Single(await db.Set<Protest>().Where(p => p.RequestId == "schema-check").ToListAsync());
    }
}
