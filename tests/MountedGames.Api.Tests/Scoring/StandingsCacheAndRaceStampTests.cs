using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

public class StandingsCacheAndRaceStampTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public StandingsCacheAndRaceStampTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task ScoringRace_StampsItsFinish_WithoutInventingNextFlagDown()
    {
        var a = await _f.CreateArenaAsync(3);
        var (heatId, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Heat 1", 1, 3);
        var admin = await _f.AdminAsync();

        var r1Response = await admin.PostAsJsonAsync($"/api/races/{races[0]}/results",
            new SubmitRaceResultsRequest(new[]
            {
                new FinishingPlaceDto(a.TeamIds[0], 1, false),
                new FinishingPlaceDto(a.TeamIds[1], 2, false),
                new FinishingPlaceDto(a.TeamIds[2], 3, false),
            }));
        Assert.Equal(HttpStatusCode.OK, r1Response.StatusCode);

        var heatAfterR1 = await r1Response.ReadAsync<HeatDto>();
        var dtoR1 = heatAfterR1.Races.Single(r => r.Id == races[0]);
        var dtoR2 = heatAfterR1.Races.Single(r => r.Id == races[1]);
        var dtoR3 = heatAfterR1.Races.Single(r => r.Id == races[2]);

        Assert.True(dtoR1.IsComplete);
        Assert.NotNull(dtoR1.StartedAt);
        Assert.NotNull(dtoR1.FinishedAt);
        Assert.False(dtoR2.IsComplete);
        Assert.Null(dtoR2.StartedAt);
        Assert.Null(dtoR2.FinishedAt);
        Assert.Null(dtoR3.StartedAt);
        Assert.Equal(heatId, heatAfterR1.Id);
    }

    [Fact]
    public async Task StandingsService_SharesMemoryCacheSnapshot_AndInvalidatesOnScoreChange()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Heat 1", 1, 1);
        var admin = await _f.AdminAsync();

        using var scope1 = _f.Services.CreateScope();
        var db1 = scope1.ServiceProvider.GetRequiredService<AppDbContext>();
        var cache = scope1.ServiceProvider.GetRequiredService<IMemoryCache>();
        var standings = new StandingsService(db1, cache);

        var initial = await standings.RowsAsync(a.CompetitionId);
        Assert.All(initial, row => Assert.Equal(0, row.TotalPoints));

        // Second call hits the short-lived memory cache and returns a fresh list copy with identical values.
        var cached = await standings.RowsAsync(a.CompetitionId);
        Assert.NotSame(initial, cached);
        Assert.Equal(initial.Select(r => (r.TeamId, r.TotalPoints)), cached.Select(r => (r.TeamId, r.TotalPoints)));

        // Scoring a race saves changes and bumps the cache version immediately.
        var scoreResp = await admin.PostAsJsonAsync($"/api/races/{races[0]}/results",
            new SubmitRaceResultsRequest(new[]
            {
                new FinishingPlaceDto(a.TeamIds[0], 1, false),
                new FinishingPlaceDto(a.TeamIds[1], 2, false),
            }));
        Assert.Equal(HttpStatusCode.OK, scoreResp.StatusCode);

        var updated = await standings.RowsAsync(a.CompetitionId);
        Assert.Equal(a.TeamIds[0], updated[0].TeamId);
        Assert.Equal(2, updated[0].TotalPoints);
    }

    [Fact]
    public async Task SqliteDatabase_UsesWalJournalMode()
    {
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var modes = await db.Database.SqlQueryRaw<string>("PRAGMA journal_mode;").ToListAsync();
        Assert.Equal("wal", Assert.Single(modes), ignoreCase: true);
    }
}
