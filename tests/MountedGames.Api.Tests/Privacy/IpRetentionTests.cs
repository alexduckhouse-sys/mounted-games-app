using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Privacy;

public class IpRetentionTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public IpRetentionTests(ApiFactory f) => _f = f;

    private static IConfiguration Config(params (string Key, string Value)[] values)
        => new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value)).Build();

    private static readonly IConfiguration Default = Config(("Jwt:Key", "test-jwt-key-0123456789-0123456789-0123456789"));

    private static async Task<int> SweepAsync(ApiFactory f, TimeProvider clock, IConfiguration? config = null)
        => await f.WithDbAsync(db => new IpRetention(db, clock, config ?? Default).SweepAsync());

    private async Task<(int Chat, int Post, int Comment, int Report)> SeedAsync(DateTime createdAt, string ip)
    {
        var arena = await _f.CreateArenaAsync(1);
        return await _f.WithDbAsync(async db =>
        {
            var chat = new ChatMessage { CompetitionId = arena.CompetitionId, AuthorName = "Fake", Body = "hi", IpAddress = ip, CreatedAt = createdAt };
            var post = new ShopPost { AuthorName = "Fake", Title = "t", Body = "b", IpAddress = ip, CreatedAt = createdAt };
            db.ChatMessages.Add(chat);
            db.ShopPosts.Add(post);
            await db.SaveChangesAsync();
            var comment = new ShopComment { PostId = post.Id, AuthorName = "Fake", Body = "c", IpAddress = ip, CreatedAt = createdAt };
            var report = new ShopReport { PostId = post.Id, IpAddress = ip, CreatedAt = createdAt };
            db.ShopComments.Add(comment);
            db.ShopReports.Add(report);
            await db.SaveChangesAsync();
            return (chat.Id, post.Id, comment.Id, report.Id);
        });
    }

    private async Task<string?[]> IpsAsync((int Chat, int Post, int Comment, int Report) ids)
        => await _f.WithDbAsync(async db => new[]
        {
            (await db.ChatMessages.AsNoTracking().SingleAsync(x => x.Id == ids.Chat)).IpAddress,
            (await db.ShopPosts.AsNoTracking().SingleAsync(x => x.Id == ids.Post)).IpAddress,
            (await db.ShopComments.AsNoTracking().SingleAsync(x => x.Id == ids.Comment)).IpAddress,
            (await db.ShopReports.AsNoTracking().SingleAsync(x => x.Id == ids.Report)).IpAddress,
        });

    [Fact]
    public async Task AddressesOlderThanThirtyDays_AreHashed_AndNewerOnesKept()
    {
        var clock = new ManualTimeProvider();
        var now = clock.GetUtcNow().UtcDateTime;
        var old = await SeedAsync(now.AddDays(-31), "203.0.113.77");
        var recent = await SeedAsync(now.AddDays(-29), "203.0.113.78");

        var changed = await SweepAsync(_f, clock);

        Assert.True(changed >= 4);
        foreach (var ip in await IpsAsync(old))
        {
            Assert.StartsWith(IpRetention.HashPrefix, ip);
            Assert.DoesNotContain("203.0.113", ip);
            Assert.Equal(IpRetention.HashPrefix.Length + 32, ip!.Length);
        }
        Assert.All(await IpsAsync(recent), ip => Assert.Equal("203.0.113.78", ip));
    }

    [Fact]
    public async Task TheCutoffFollowsTheClock_AndTheSweepIsIdempotent()
    {
        var clock = new ManualTimeProvider();
        var ids = await SeedAsync(clock.GetUtcNow().UtcDateTime.AddDays(-5), "203.0.113.80");
        await SweepAsync(_f, clock);
        Assert.All(await IpsAsync(ids), ip => Assert.Equal("203.0.113.80", ip));

        clock.Advance(TimeSpan.FromDays(26));
        await SweepAsync(_f, clock);
        var hashed = await IpsAsync(ids);
        Assert.All(hashed, ip => Assert.True(IpRetention.IsHashed(ip)));

        // A second pass changes nothing and does not hash a hash.
        Assert.Equal(0, await SweepAsync(_f, clock));
        Assert.Equal(hashed, await IpsAsync(ids));
    }

    [Fact]
    public async Task TheHashIsKeyed_SameAddressSameKeyMatches_DifferentKeyDoesNot()
    {
        var clock = new ManualTimeProvider();
        var old = clock.GetUtcNow().UtcDateTime.AddDays(-40);
        var one = await SeedAsync(old, "203.0.113.90");
        var two = await SeedAsync(old, "203.0.113.90");
        await SweepAsync(_f, clock, Config(("Privacy:IpHashKey", "first-key")));
        var a = await IpsAsync(one);
        Assert.Equal(a, await IpsAsync(two));
        Assert.Equal(1, a.Distinct().Count());

        var three = await SeedAsync(old, "203.0.113.90");
        await SweepAsync(_f, clock, Config(("Privacy:IpHashKey", "second-key")));
        Assert.NotEqual(a[0], (await IpsAsync(three))[0]);

        // And it is not a plain SHA-256 of the address.
        var plain = "h1:" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData("203.0.113.90"u8.ToArray()))[..32].ToLowerInvariant();
        Assert.NotEqual(plain, a[0]);
    }

    [Fact]
    public async Task WithoutAnExplicitKey_TheHashIsDerivedFromTheJwtKey_NotTheKeyItself()
    {
        var clock = new ManualTimeProvider();
        var ids = await SeedAsync(clock.GetUtcNow().UtcDateTime.AddDays(-40), "203.0.113.91");
        await SweepAsync(_f, clock, Config(("Jwt:Key", "some-other-jwt-key-0123456789-0123456789")));
        var viaJwt = (await IpsAsync(ids))[0];
        var other = await SeedAsync(clock.GetUtcNow().UtcDateTime.AddDays(-40), "203.0.113.91");
        await SweepAsync(_f, clock, Config(("Privacy:IpHashKey", "some-other-jwt-key-0123456789-0123456789")));
        Assert.NotEqual(viaJwt, (await IpsAsync(other))[0]);
    }

    [Fact]
    public async Task RowsWithNoAddress_AreLeftAlone()
    {
        var clock = new ManualTimeProvider();
        var arena = await _f.CreateArenaAsync(1);
        var id = await _f.WithDbAsync(async db =>
        {
            var m = new ChatMessage { CompetitionId = arena.CompetitionId, AuthorName = "Fake", Body = "hi", IpAddress = null, CreatedAt = clock.GetUtcNow().UtcDateTime.AddDays(-90) };
            db.ChatMessages.Add(m);
            await db.SaveChangesAsync();
            return m.Id;
        });
        await SweepAsync(_f, clock);
        Assert.Null((await _f.WithDbAsync(db => db.ChatMessages.AsNoTracking().SingleAsync(x => x.Id == id))).IpAddress);
    }

    [Fact]
    public async Task RetentionDaysCanBeConfigured()
    {
        var clock = new ManualTimeProvider();
        var ids = await SeedAsync(clock.GetUtcNow().UtcDateTime.AddDays(-10), "203.0.113.92");
        await SweepAsync(_f, clock, Config(("Privacy:IpRetentionDays", "7")));
        Assert.All(await IpsAsync(ids), ip => Assert.True(IpRetention.IsHashed(ip)));
    }

    [Fact]
    public async Task BlockAuthor_RefusesAMessageWhoseAddressHasBeenHashed()
    {
        var arena = await _f.CreateArenaAsync(1);
        var id = await _f.WithDbAsync(async db =>
        {
            var m = new ChatMessage { CompetitionId = arena.CompetitionId, AuthorName = "Fake", Body = "hi", IpAddress = "h1:0123456789abcdef0123456789abcdef" };
            db.ChatMessages.Add(m);
            await db.SaveChangesAsync();
            return m.Id;
        });
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsync($"/api/competitions/{arena.CompetitionId}/chat/{id}/block-author", null);

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.IpBlocks.AnyAsync(b => b.IpAddress.StartsWith("h1:"))));
    }

    [Fact]
    public async Task TheSweeperRunsOnStartUp_WithTheAppClock()
    {
        var now = TimeProvider.System.GetUtcNow().UtcDateTime;
        var old = await SeedAsync(now.AddDays(-45), "203.0.113.93");
        var recent = await SeedAsync(now.AddDays(-2), "203.0.113.95");
        using var sweeper = new IpRetentionSweeper(_f.Services.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System,
            NullLogger<IpRetentionSweeper>.Instance, TimeSpan.Zero, TimeSpan.FromHours(6));

        await sweeper.StartAsync(CancellationToken.None);
        Assert.True(await StreamingApiFactory.EventuallyAsync(() => IpsAsync(old).GetAwaiter().GetResult().All(IpRetention.IsHashed)));
        await sweeper.StopAsync(CancellationToken.None);
        Assert.All(await IpsAsync(recent), ip => Assert.Equal("203.0.113.95", ip));
    }

    [Fact]
    public async Task TheSweeperRepeatsOnItsInterval_AndSurvivesFailures()
    {
        var clock = new ManualTimeProvider();
        var scopes = new CountingScopes();
        using var sweeper = new IpRetentionSweeper(scopes, clock, NullLogger<IpRetentionSweeper>.Instance,
            TimeSpan.FromSeconds(15), TimeSpan.FromHours(6));

        await sweeper.StartAsync(CancellationToken.None);
        Assert.Equal(0, scopes.Calls);
        // Every run fails (there is no real scope), which must not stop the loop.
        await AdvanceUntilAsync(clock, TimeSpan.FromSeconds(15), () => scopes.Calls >= 1);
        await AdvanceUntilAsync(clock, TimeSpan.FromHours(6), () => scopes.Calls >= 2);
        await sweeper.StopAsync(CancellationToken.None);
        Assert.True(scopes.Calls >= 2);
    }

    // The sweeper registers its timers on another thread, so keep nudging the clock until the expected effect shows.
    private static async Task AdvanceUntilAsync(ManualTimeProvider clock, TimeSpan by, Func<bool> done)
    {
        for (var i = 0; i < 200 && !done(); i++)
        {
            clock.Advance(by);
            await Task.Delay(10);
        }
        Assert.True(done());
    }

    private sealed class CountingScopes : IServiceScopeFactory
    {
        public int Calls;
        public IServiceScope CreateScope() { Interlocked.Increment(ref Calls); throw new InvalidOperationException("Fake failure"); }
    }
}
