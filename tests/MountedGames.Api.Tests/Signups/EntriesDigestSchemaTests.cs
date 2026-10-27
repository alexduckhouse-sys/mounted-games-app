using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

public class EntriesDigestSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public EntriesDigestSchemaTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task AnExistingSqliteDatabaseGainsTheDigestTablesWithoutLosingEmailData()
    {
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var address = $"keep-{Guid.NewGuid():N}@example.org";
        db.EmailOptIns.Add(new EmailOptIn { Email = address, WordingVersion = "w", Source = "signup-form", UnsubscribeTokenHash = Guid.NewGuid().ToString("N") });
        var optIns = await db.EmailOptIns.CountAsync();
        await db.SaveChangesAsync();
        optIns++;
        await db.Database.ExecuteSqlRawAsync("DROP TABLE EntriesDigestRecipients; DROP TABLE EntriesDigestCompetitions; DROP TABLE EntriesDigestRuns;");

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services); // and again: the guards are idempotent

        db.ChangeTracker.Clear();
        Assert.Equal(optIns, await db.EmailOptIns.CountAsync());
        Assert.True(await db.EmailOptIns.AnyAsync(o => o.Email == address));
        var run = new EntriesDigestRun { RunDate = "2030-01-01", ClaimedAt = DateTime.UtcNow, Status = EntriesDigestRunStatus.Sending, Competitions = 1, Total = 1 };
        run.CompetitionRows.Add(new EntriesDigestCompetition { CompetitionId = 99 });
        run.Recipients.Add(new EntriesDigestRecipient { OptInId = 1 });
        db.EntriesDigestRuns.Add(run);
        await db.SaveChangesAsync();

        // The unique keys that make a claim safe are really there.
        db.ChangeTracker.Clear();
        db.EntriesDigestRuns.Add(new EntriesDigestRun { RunDate = "2030-01-01", ClaimedAt = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        var other = new EntriesDigestRun { RunDate = "2030-01-02", ClaimedAt = DateTime.UtcNow };
        other.CompetitionRows.Add(new EntriesDigestCompetition { CompetitionId = 99 });
        db.EntriesDigestRuns.Add(other);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        db.EntriesDigestRecipients.Add(new EntriesDigestRecipient { RunId = run.Id, OptInId = 1 });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
