using System.Data.Common;
using System.Diagnostics;
using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Tests.Infrastructure;
using Xunit.Abstractions;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// The per-request token check (<see cref="LiveAccounts"/>): nothing is cached, so whatever another instance writes to the
/// shared database (a reset, a lock, a block, an emptied account) is refused by the very next request here, and it costs
/// one database round trip, the same as the roles query it replaced.
/// </summary>
public class LiveAccountsTests(ApiFactory f, ITestOutputHelper output) : IClassFixture<ApiFactory>
{
    public static TheoryData<string> Changes => ["session ended", "locked", "blocked", "emptied"];

    [Theory]
    [MemberData(nameof(Changes))]
    public async Task AChangeMadeElsewhereIsRefusedByTheNextRequest(string change)
    {
        var (client, auth) = await f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/auth/me")).StatusCode);

        // Written straight to the database, as another instance would, with nothing said to this one.
        var now = DateTime.UtcNow;
        await f.WithDbAsync(db =>
        {
            var account = db.Users.Where(u => u.Id == auth.User.Id);
            return change switch
            {
                "session ended" => account.ExecuteUpdateAsync(s => s.SetProperty(u => u.SessionVersion, 1)),
                "locked" => account.ExecuteUpdateAsync(s => s.SetProperty(u => u.LockedAt, now)),
                "blocked" => account.ExecuteUpdateAsync(s => s.SetProperty(u => u.BlockedAt, now)),
                _ => account.ExecuteUpdateAsync(s => s.SetProperty(u => u.LockoutEnd, DateTimeOffset.MaxValue)),
            };
        });

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task LiftingALockElsewhereWorksByTheNextRequestToo()
    {
        var (client, auth) = await f.SignupAsync("Member");
        await f.WithDbAsync(db => db.Users.Where(u => u.Id == auth.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.LockedAt, DateTime.UtcNow)));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);

        await f.WithDbAsync(db => db.Users.Where(u => u.Id == auth.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.LockedAt, (DateTime?)null)));

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task TheCheckReadsTheAccountAndItsRolesInOneRoundTrip()
    {
        var (_, auth) = await f.SignupAsync("Member");
        var connectionString = await f.WithDbAsync(db => Task.FromResult(db.Database.GetConnectionString()!));
        var counter = new CommandCounter();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connectionString).AddInterceptors(counter).Options);

        var state = await LiveAccounts.StateAsync(db, auth.User.Id);
        var missing = await LiveAccounts.StateAsync(db, "no-such-account");

        Assert.Equal(2, counter.Count);
        Assert.NotNull(state);
        Assert.Equal(new[] { Roles.Member }, state.Roles);
        Assert.True(state.Accepts(0));
        Assert.Null(missing);

        // The same query against Postgres (the production database), as SQL: one statement.
        await using var postgres = new AppDbContextFactory().CreateDbContext([]);
        var sql = LiveAccounts.StateQuery(postgres, "user-id").Take(1).ToQueryString();
        output.WriteLine(sql);
        Assert.Single(sql.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        Assert.Contains("AspNetUsers", sql);
        Assert.Contains("AspNetUserRoles", sql);

        // Rough cost on the test's SQLite file, for the record (not asserted: the machine's load decides it).
        var clock = Stopwatch.StartNew();
        for (var i = 0; i < 200; i++) await LiveAccounts.StateAsync(db, auth.User.Id);
        output.WriteLine($"200 checks took {clock.ElapsedMilliseconds} ms on SQLite.");
    }

    [Theory]
    [InlineData(0, 0, true)]
    [InlineData(1, 0, false)]
    [InlineData(1, 1, true)]
    [InlineData(1, 2, true)]
    public void ATokenIsAcceptedFromTheAccountsCurrentSessionVersion(int accountVersion, int tokenVersion, bool accepted)
        => Assert.Equal(accepted, new LiveAccounts.TokenState { SessionVersion = accountVersion }.Accepts(tokenVersion));

    [Fact]
    public void AWrongPasswordLockoutKeepsSessions_ButAnEmptiedAccountDoesNot()
    {
        Assert.True(new LiveAccounts.TokenState { LockoutEnd = DateTimeOffset.UtcNow.AddMinutes(15) }.Accepts(0));
        Assert.False(new LiveAccounts.TokenState { LockoutEnd = DateTimeOffset.MaxValue }.Accepts(0));
    }

    private sealed class CommandCounter : DbCommandInterceptor
    {
        public int Count;

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref Count);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
