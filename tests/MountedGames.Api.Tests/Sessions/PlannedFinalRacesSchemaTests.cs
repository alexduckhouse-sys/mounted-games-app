using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sessions;

/// <summary>An existing SQLite database gains <c>Sessions.PlannedFinalRaces</c> at startup, and keeps its sessions.</summary>
public class PlannedFinalRacesSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public PlannedFinalRacesSchemaTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task ExistingDatabaseGainsThePlannedFinalRacesColumn_Idempotently()
    {
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var sessions = await db.Sessions.AsNoTracking().CountAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Sessions\" DROP COLUMN \"PlannedFinalRaces\"");

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services);
        db.ChangeTracker.Clear();

        Assert.Equal(sessions, await db.Sessions.AsNoTracking().CountAsync());
        Assert.All(await db.Sessions.AsNoTracking().Select(s => s.PlannedFinalRaces).ToListAsync(), Assert.Null);
    }
}
