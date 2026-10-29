using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class SubstitutionRequestRetryTests
{
    [Fact]
    public async Task Create_RetriesRolledBackSaveWithoutKeepingTrackedRequestOrDuplicatingIt()
    {
        using var factory = new RetryApiFactory();
        var arena = await factory.CreateArenaAsync(2);
        var (trainer, auth) = await factory.ApprovedTrainerAsync();
        var form = await factory.WithDbAsync(async db =>
        {
            var form = new DeclarationForm { TeamId = arena.TeamIds[0], SubmittedByUserId = auth.User.Id, IsLocked = true };
            form.Riders.Add(new RiderEntry { FullName = "Example Retry Rider", HorseName = "Example Retry Pony" });
            form.Riders.Add(new RiderEntry { FullName = "Example Retry Reserve", IsReserve = true });
            db.Add(form);
            await db.SaveChangesAsync();
            return form;
        });
        factory.Failure.FormId = form.Id;
        var input = new RequestSubstitutionDto(form.Riders.First(r => !r.IsReserve).Id,
            form.Riders.First(r => r.IsReserve).Id, "Example retry reason");

        var response = await trainer.PostAsJsonAsync(
            $"/api/competitions/{arena.CompetitionId}/substitution-requests/declarations/{form.Id}", input);
        response.EnsureSuccessStatusCode();
        var returned = await response.ReadAsync<SubstitutionRequestDto>();

        Assert.Equal(1, factory.Failure.Failures);
        Assert.Equal(2, factory.Failure.Saves);
        await factory.WithDbAsync(async db =>
        {
            var saved = Assert.Single(await db.Set<SubstitutionRequest>().Where(x => x.DeclarationFormId == form.Id).ToListAsync());
            Assert.Equal(returned.Id, saved.Id);
            Assert.Equal("pending", saved.Status);
            Assert.Equal(input.Reason, saved.Reason);
            Assert.False((await db.RiderEntries.FindAsync(input.OutRiderEntryId))!.IsReserve);
        });
    }

    private sealed class RetryApiFactory : ApiFactory
    {
        public SaveFailure Failure { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services => services.AddDbContext<AppDbContext>(options =>
                options.ReplaceService<IExecutionStrategyFactory, RetryStrategyFactory>()
                    .AddInterceptors(new FailFirstRequestSave(Failure))));
        }
    }

    private sealed class SaveFailure
    {
        public int FormId { get; set; }
        public int Saves { get; set; }
        public int Failures { get; set; }
    }

    private sealed class SyntheticTransientException : Exception;

    // Match production's retrying strategy without requiring a PostgreSQL server or a real network fault.
    private sealed class RetryStrategyFactory(ExecutionStrategyDependencies dependencies) : IExecutionStrategyFactory
    {
        public IExecutionStrategy Create() => new RetryStrategy(dependencies);
    }

    private sealed class RetryStrategy(ExecutionStrategyDependencies dependencies)
        : ExecutionStrategy(dependencies, maxRetryCount: 1, maxRetryDelay: TimeSpan.Zero)
    {
        protected override bool ShouldRetryOn(Exception exception) => exception is SyntheticTransientException;
    }

    private sealed class FailFirstRequestSave(SaveFailure failure) : SaveChangesInterceptor
    {
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result,
            CancellationToken cancellationToken = default)
        {
            if (failure.FormId != 0 && eventData.Context?.ChangeTracker.Entries<SubstitutionRequest>()
                    .Any(e => e.Entity.DeclarationFormId == failure.FormId) == true)
            {
                failure.Saves++;
                if (failure.Failures == 0)
                {
                    failure.Failures++;
                    // The INSERT succeeded but the surrounding transaction has not committed. The retry must
                    // discard the tracked generated ID as well as rerunning validation and the transaction.
                    throw new SyntheticTransientException();
                }
            }
            return ValueTask.FromResult(result);
        }
    }
}
