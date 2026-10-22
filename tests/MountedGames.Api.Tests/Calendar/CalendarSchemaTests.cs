using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Calendar;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Calendar;

public class CalendarSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CalendarSchemaTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task AnExistingSqliteDatabaseGainsTheFeedColumnsAndVersionTable_WithoutLosingData()
    {
        var arena = await _f.CreateArenaAsync(2);
        var (heatId, _) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var teamsBefore = await db.Teams.AsNoTracking().OrderBy(t => t.Id).Select(t => new { t.Id, t.DisplayName, t.SupporterJoinKey }).ToListAsync();
        var heatsBefore = await db.Heats.AsNoTracking().CountAsync();

        // Put the database back as it was before this feature: no table, no columns.
        await db.Database.ExecuteSqlRawAsync("DROP TABLE CalendarHeatVersions;");
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE Teams DROP COLUMN CalendarFeedTokenHash;");
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE Teams DROP COLUMN CalendarFeedTokenCreatedAt;");

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services); // and it is safe to run again

        db.ChangeTracker.Clear();
        var token = CalendarFeedTokens.Generate();
        var team = await db.Teams.FirstAsync(t => t.Id == arena.TeamIds[0]);
        team.CalendarFeedTokenHash = CalendarFeedTokens.Hash(token);
        team.CalendarFeedTokenCreatedAt = DateTime.UtcNow;
        db.CalendarHeatVersions.Add(new CalendarHeatVersion { HeatId = heatId, TeamId = team.Id, Fingerprint = "f", Sequence = 2 });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        Assert.Equal(teamsBefore, await db.Teams.AsNoTracking().OrderBy(t => t.Id).Select(t => new { t.Id, t.DisplayName, t.SupporterJoinKey }).Take(teamsBefore.Count).ToListAsync());
        Assert.Equal(heatsBefore, await db.Heats.AsNoTracking().CountAsync());
        Assert.True(CalendarFeedTokens.Matches((await db.Teams.AsNoTracking().FirstAsync(t => t.Id == team.Id)).CalendarFeedTokenHash, token));
        Assert.Equal(2, (await db.CalendarHeatVersions.AsNoTracking().SingleAsync()).Sequence);

        // The unique index and the cascade survive: a duplicate is refused, and deleting the heat removes the row.
        db.CalendarHeatVersions.Add(new CalendarHeatVersion { HeatId = heatId, TeamId = team.Id, Fingerprint = "g" });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        db.Heats.Remove(await db.Heats.FirstAsync(h => h.Id == heatId));
        await db.SaveChangesAsync();
        Assert.Equal(0, await db.CalendarHeatVersions.CountAsync());
    }
}

public class CalendarFeedTokenTests
{
    [Fact]
    public void Tokens_AreLongRandomAndUrlSafe()
    {
        var tokens = Enumerable.Range(0, 50).Select(_ => CalendarFeedTokens.Generate()).ToList();

        Assert.Equal(50, tokens.Distinct().Count());
        Assert.All(tokens, t =>
        {
            Assert.Equal(43, t.Length);
            Assert.Matches("^[A-Za-z0-9_-]+$", t);
        });
    }

    [Fact]
    public void OnlyTheMatchingTokenPasses()
    {
        var token = CalendarFeedTokens.Generate();
        var hash = CalendarFeedTokens.Hash(token);

        Assert.Equal(64, hash.Length);
        Assert.NotEqual(token, hash);
        Assert.True(CalendarFeedTokens.Matches(hash, token));
        Assert.False(CalendarFeedTokens.Matches(hash, token + "x"));
        Assert.False(CalendarFeedTokens.Matches(hash, CalendarFeedTokens.Generate()));
        Assert.False(CalendarFeedTokens.Matches(null, token));
        Assert.False(CalendarFeedTokens.Matches(hash, null));
        Assert.False(CalendarFeedTokens.Matches("", ""));
        Assert.False(CalendarFeedTokens.Matches("short", token));
    }

    [Theory]
    [InlineData("https://app.example.org/some/path?x=1", "https://app.example.org")]
    [InlineData("http://localhost:5173", "http://localhost:5173")]
    [InlineData("javascript:alert(1)", null)]
    [InlineData("ftp://example.org", null)]
    [InlineData("https://user:pass@example.org", null)]
    [InlineData("not a url", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void PublicSite_KeepsOnlyAWebOrigin(string? given, string? expected)
        => Assert.Equal(expected, PublicSite.Origin(given));

    [Fact]
    public void PublicSite_ConfiguredAddressWinsOverTheRequestedOne()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Sharing:PublicBaseUrl"] = "https://mg.example.org/ignored" }).Build();
        var empty = new ConfigurationBuilder().Build();

        Assert.Equal("https://mg.example.org", PublicSite.Resolve(config, "https://evil.example"));
        Assert.Equal("https://evil.example", PublicSite.Resolve(empty, "https://evil.example"));
        Assert.Null(PublicSite.Resolve(empty, null));
        Assert.Null(PublicSite.Origin("https://" + new string('a', 300) + ".org"));
    }
}
