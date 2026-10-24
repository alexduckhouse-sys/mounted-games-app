using System.Data.Common;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Controllers;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

public class EntryRetryTests
{
    [Fact]
    public async Task Create_WithoutClientRequestId_RetriesPostCommitReadWithoutAnotherEntryOrReservation()
    {
        using var factory = new RetryApiFactory();
        var section = await factory.NewSectionAsync(priceMinor: 1000, max: 10);
        var entrant = await factory.TrainerAsync();
        factory.Failure.SectionId = section.Id;

        var response = await entrant.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups",
            new CreateSectionSignupInput("Synthetic Retry Entrant", "Synthetic Retry Club", null,
                AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion,
                TeamName: "Synthetic Retry Teams", WholeTeam: true, TeamsCount: 2, StablesCount: 3));
        response.EnsureSuccessStatusCode();
        var returned = await response.ReadAsync<SectionSignupExtendedDto>();

        Assert.Equal(1, factory.Failure.ReadFailures);
        Assert.Equal(1, factory.Failure.Commits);
        await factory.InDbAsync(async db =>
        {
            var saved = Assert.Single(await db.SectionSignups.Where(s => s.CompetitionSectionId == section.Id).ToListAsync());
            Assert.Equal(saved.Id, returned.Id);
            Assert.False(string.IsNullOrWhiteSpace(saved.ClientRequestId));
            Assert.Equal(2000, saved.AmountMinor);
            var extras = Assert.Single(await db.Set<SignupExtras>().Where(x => x.SignupId == saved.Id).ToListAsync());
            Assert.Equal(2, extras.TeamsCount);
            Assert.Equal(3, extras.StablesCount);
        });
        var publicCompetition = await (await entrant.GetAsync($"/api/competitions/{section.CompetitionId}")).ReadAsync<System.Text.Json.JsonElement>();
        Assert.Equal(2, publicCompetition.GetProperty("sections")[0].GetProperty("activeSignupsCount").GetInt32());
    }

    private sealed class RetryApiFactory : ApiFactory
    {
        public PostCommitFailure Failure { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services => services.AddDbContext<AppDbContext>(options =>
                options.ReplaceService<IExecutionStrategyFactory, RetryStrategyFactory>()
                    .AddInterceptors(new ObserveCommit(Failure), new FailNextSignupRead(Failure))));
        }
    }

    private sealed class PostCommitFailure
    {
        public int SectionId { get; set; }
        public int Commits { get; set; }
        public int ReadFailures { get; set; }
        public bool PendingReadFailure { get; set; }
    }

    private sealed class SyntheticTransientException : Exception;

    // SQLite's normal strategy does not retry. This reproduces the production execution-strategy boundary
    // without relying on network failures, delays or a PostgreSQL service.
    private sealed class RetryStrategyFactory(ExecutionStrategyDependencies dependencies) : IExecutionStrategyFactory
    {
        public IExecutionStrategy Create() => new RetryStrategy(dependencies);
    }

    private sealed class RetryStrategy(ExecutionStrategyDependencies dependencies)
        : ExecutionStrategy(dependencies, maxRetryCount: 1, maxRetryDelay: TimeSpan.Zero)
    {
        protected override bool ShouldRetryOn(Exception exception) => exception is SyntheticTransientException;
    }

    private sealed class ObserveCommit(PostCommitFailure failure) : DbTransactionInterceptor
    {
        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (failure.SectionId != 0 && eventData.Context?.ChangeTracker.Entries<SectionSignup>()
                    .Any(e => e.Entity.CompetitionSectionId == failure.SectionId) == true)
            {
                failure.Commits++;
                if (failure.ReadFailures == 0) failure.PendingReadFailure = true;
            }
            return Task.CompletedTask;
        }
    }

    private sealed class FailNextSignupRead(PostCommitFailure failure) : DbCommandInterceptor
    {
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (failure.PendingReadFailure && command.CommandText.TrimStart().StartsWith("SELECT", StringComparison.OrdinalIgnoreCase)
                && command.CommandText.Contains("SectionSignups", StringComparison.Ordinal))
            {
                failure.PendingReadFailure = false;
                failure.ReadFailures++;
                throw new SyntheticTransientException();
            }
            return ValueTask.FromResult(result);
        }
    }
}
