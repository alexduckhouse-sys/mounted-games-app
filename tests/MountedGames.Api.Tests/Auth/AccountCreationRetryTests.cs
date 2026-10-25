using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

public class AccountCreationRetryTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LostCommitAcknowledgement_ReturnsTheCreatedAccountEvenAtTheIpLimit(bool organiser)
    {
        using var factory = new RetryFactory();
        using var client = factory.CreateClient();
        factory.Failure.Armed = true;
        const string email = "synthetic-retry@example.com";
        const string password = "SyntheticPassword1!";
        var response = organiser
            ? await client.PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Synthetic organiser", email, password))
            : await client.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(email, password, null, "Synthetic retry club"));
        response.EnsureSuccessStatusCode();
        var auth = await response.ReadAsync<AuthResponse>();
        Assert.Equal(1, factory.Failure.Failures);
        await factory.InDbAsync(async db =>
        {
            var saved = Assert.Single(await db.Users.Where(u => u.Email == email).ToListAsync());
            Assert.Equal(saved.Id, auth.User.Id);
            Assert.False(saved.EmailConfirmed);
            Assert.Single(await db.UserClaims.Where(c => c.UserId == saved.Id && c.ClaimType == "created_ip").ToListAsync());
        });
        Assert.Contains(organiser ? Roles.Admin : Roles.TrainerRequest, auth.User.Roles);
        (await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password))).EnsureSuccessStatusCode();
        var overLimit = await client.PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest("synthetic-other@example.com", password, null, "Synthetic retry club"));
        Assert.Equal(HttpStatusCode.TooManyRequests, overLimit.StatusCode);
    }

    private sealed class RetryFactory : ApiFactory
    {
        public LostAcknowledgement Failure { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("RateLimits:AccountsPerIp", "1");
            builder.ConfigureServices(services => services.AddDbContext<AppDbContext>(options =>
                options.ReplaceService<IExecutionStrategyFactory, RetryStrategyFactory>()
                    .AddInterceptors(new FailAfterCommit(Failure))));
        }
    }

    private sealed class LostAcknowledgement
    {
        public bool Armed { get; set; }
        public int Failures { get; set; }
    }
    private sealed class SyntheticTransientException : Exception;
    private sealed class RetryStrategyFactory(ExecutionStrategyDependencies dependencies) : IExecutionStrategyFactory
    {
        public IExecutionStrategy Create() => new RetryStrategy(dependencies);
    }
    private sealed class RetryStrategy(ExecutionStrategyDependencies dependencies)
        : ExecutionStrategy(dependencies, maxRetryCount: 1, maxRetryDelay: TimeSpan.Zero)
    {
        protected override bool ShouldRetryOn(Exception exception) => exception is SyntheticTransientException;
    }
    private sealed class FailAfterCommit(LostAcknowledgement failure) : DbTransactionInterceptor
    {
        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (failure.Armed && failure.Failures == 0 && eventData.Context?.ChangeTracker.Entries<AppUser>()
                    .Any(e => e.Entity.Email == "synthetic-retry@example.com") == true)
            {
                failure.Failures++;
                throw new SyntheticTransientException();
            }
            return Task.CompletedTask;
        }
    }
}
