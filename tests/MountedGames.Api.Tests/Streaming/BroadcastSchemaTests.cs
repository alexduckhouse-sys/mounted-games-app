using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Broadcast;

namespace MountedGames.Api.Tests.Streaming;

public class BroadcastSchemaTests
{
    [Fact]
    public async Task ExistingSqliteUpgradeIsIdempotentAndCascadesPublicHistory()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE Competitions (Id INTEGER PRIMARY KEY, Name TEXT); INSERT INTO Competitions VALUES (1, 'Example event');");
        await BroadcastFeature.EnsureSqliteAsync(db); await BroadcastFeature.EnsureSqliteAsync(db);
        db.AddRange(new BroadcastSnapshot { CompetitionId = 1, Arena = "Arena 1", ObservedAt = DateTime.UtcNow },
            new BroadcastOutput { CompetitionId = 1, Arena = "Arena 1", SponsorOffset = 2 },
            new BroadcastCue { CompetitionId = 1, Arena = "Arena 1", Kind = "score", Action = "show", StartsAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddSeconds(10) });
        await db.SaveChangesAsync(); Assert.Single(await db.Set<BroadcastSnapshot>().ToListAsync());
        await db.Database.ExecuteSqlRawAsync("DELETE FROM Competitions WHERE Id = 1");
        Assert.Empty(await db.Set<BroadcastSnapshot>().ToListAsync()); Assert.Empty(await db.Set<BroadcastOutput>().ToListAsync()); Assert.Empty(await db.Set<BroadcastCue>().ToListAsync());
    }
}
