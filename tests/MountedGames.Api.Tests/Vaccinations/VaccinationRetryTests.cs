using System.Data.Common;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Vaccinations;

public class VaccinationRetryTests
{
    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public async Task RetryingStrategySavesOneHistoryAndDoesNotReplayAfterResponseReadFailure(bool failAfterCommit, bool existingHistory)
    {
        using var factory = new RetryApiFactory();
        var comp = await factory.SeedCompetitionAsync();
        var section = await factory.SeedSectionAsync(comp);
        var club = await factory.SeedClubAsync();
        var team = await factory.SeedTeamAsync(comp, section, club, "Fake retry team");
        var rider = await factory.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(comp))!.EnablePassportCheck = true;
            var form = new DeclarationForm { TeamId = team, Riders = [new() { FullName = "Fake Rider", HorseName = "Fake Pony" }] };
            db.Add(form); await db.SaveChangesAsync(); return form.Riders.Single().Id;
        });
        using var staff = await factory.AdminAsync();
        var route = $"/api/event-tools/competitions/{comp}/passport-check/vaccinations/riders/{rider}/evidence";
        var request = new SaveVaccinationEvidenceRequest(0, [new(2025, 6, 1), new(2025, 7, 1), new(2025, 12, 1)], true, new(2026, 10, 20), false, null);
        if (existingHistory) (await staff.PutAsJsonAsync(route, request)).EnsureSuccessStatusCode();
        factory.Failure.CompetitionId = comp;
        factory.Failure.FailAfterCommit = failAfterCommit;
        var response = await staff.PutAsJsonAsync(route, request with { ExpectedRevision = existingHistory ? 1 : 0 });
        response.EnsureSuccessStatusCode();
        var returned = await response.ReadAsync<VaccinationPonyDto>();
        Assert.NotNull(returned.Verified);
        Assert.Equal(1, factory.Failure.Failures);
        Assert.Equal(1, factory.Failure.Commits);
        await factory.WithDbAsync(async db =>
        {
            var history = await db.Set<VaccinationEvidence>().Where(x => x.CompetitionId == comp).ToListAsync();
            Assert.Equal(existingHistory ? 2 : 1, history.Count);
            var evidence = history.MaxBy(x => x.Revision)!;
            Assert.Equal(returned.Verified.Id, evidence.Id);
            Assert.Equal(existingHistory ? 2 : 1, evidence.Revision);
            Assert.Single(await db.Set<VaccinationHorse>().Where(x => x.CompetitionId == comp).ToListAsync());
            Assert.Single(await db.Set<VaccinationDeclarationHorse>().Where(x => x.CompetitionId == comp).ToListAsync());
        });
    }

    private sealed class RetryApiFactory : ApiFactory
    {
        public FailureState Failure { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services => services.AddDbContext<AppDbContext>(options =>
                options.ReplaceService<IExecutionStrategyFactory, RetryStrategyFactory>()
                    .AddInterceptors(new ObserveTransaction(Failure), new FailResponseRead(Failure))));
        }
    }
    private sealed class FailureState
    {
        public int CompetitionId { get; set; }
        public bool FailAfterCommit { get; set; }
        public bool ReadPending { get; set; }
        public int Failures { get; set; }
        public int Commits { get; set; }
    }
    private sealed class SyntheticTransientException : Exception;
    private sealed class RetryStrategyFactory(ExecutionStrategyDependencies dependencies) : IExecutionStrategyFactory
    {
        public IExecutionStrategy Create() => new RetryStrategy(dependencies);
    }
    // Reproduces PostgreSQL's transaction restriction and a transient retry while using the throwaway SQLite database.
    private sealed class RetryStrategy(ExecutionStrategyDependencies dependencies)
        : ExecutionStrategy(dependencies, maxRetryCount: 1, maxRetryDelay: TimeSpan.Zero)
    {
        protected override bool ShouldRetryOn(Exception exception) => exception is SyntheticTransientException;
    }
    private sealed class ObserveTransaction(FailureState failure) : DbTransactionInterceptor
    {
        private bool IsEvidence(DbContext? context) => failure.CompetitionId != 0 && context?.ChangeTracker.Entries<VaccinationEvidence>()
            .Any(e => e.Entity.CompetitionId == failure.CompetitionId) == true;
        public override ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction, TransactionEventData eventData,
            InterceptionResult result, CancellationToken cancellationToken = default)
        {
            if (IsEvidence(eventData.Context) && !failure.FailAfterCommit && failure.Failures == 0)
            {
                failure.Failures++;
                throw new SyntheticTransientException();
            }
            return ValueTask.FromResult(result);
        }
        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
        {
            if (IsEvidence(eventData.Context))
            {
                failure.Commits++;
                failure.ReadPending = failure.FailAfterCommit && failure.Failures == 0;
            }
            return Task.CompletedTask;
        }
    }
    private sealed class FailResponseRead(FailureState failure) : DbCommandInterceptor
    {
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (failure.ReadPending && command.CommandText.TrimStart().StartsWith("SELECT", StringComparison.OrdinalIgnoreCase)
                && command.CommandText.Contains("VaccinationEvidence", StringComparison.Ordinal))
            {
                failure.ReadPending = false;
                failure.Failures++;
                throw new SyntheticTransientException();
            }
            return ValueTask.FromResult(result);
        }
    }
}
