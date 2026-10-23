using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

public class ScorerLinkSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ScorerLinkSchemaTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task ExistingSqliteDatabaseGainsScorerLinksAndTheActorLabel_WithoutLosingScores()
    {
        var arena = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var scoring = scope.ServiceProvider.GetRequiredService<ScoringService>();
        await scoring.ApplyVersionedAsync(races[0], new UpdateRaceScoreRequest(
            [new(arena.TeamIds[0], 1, false), new(arena.TeamIds[1], 2, false)], 0, "schema-1", null), null, default, "Scorer link: Before");
        await db.Database.ExecuteSqlRawAsync("DROP TABLE ScorerLinks; ALTER TABLE RaceScoreEvent DROP COLUMN ActorLabel;");

        await DbInitializer.SeedAsync(_f.Services);
        db.ChangeTracker.Clear();

        var link = new ScorerLink
        {
            CompetitionId = arena.CompetitionId, Label = "Sam", ArenaName = "Main", TokenHash = ScorerLinkTokens.Hash(Guid.NewGuid().ToString()),
            CreatedByUserId = "u", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1),
        };
        db.ScorerLinks.Add(link);
        await db.SaveChangesAsync();
        Assert.Equal("Sam", (await db.ScorerLinks.SingleAsync(l => l.CompetitionId == arena.CompetitionId)).Label);
        var kept = await db.Set<RaceScoreEvent>().SingleAsync(e => e.RaceId == races[0]);
        Assert.Equal("schema-1", kept.RequestId);
        Assert.Null(kept.ActorLabel);
        // The unique index on the hash came back too.
        db.ScorerLinks.Add(new ScorerLink
        {
            CompetitionId = arena.CompetitionId, Label = "Dup", ArenaName = "Main", TokenHash = link.TokenHash,
            CreatedByUserId = "u", CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow,
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
