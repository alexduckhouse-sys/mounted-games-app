using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

public class TrainerRequestsFailureTests : IClassFixture<RoleUpdateFailureFactory>
{
    private readonly RoleUpdateFailureFactory _f;
    public TrainerRequestsFailureTests(RoleUpdateFailureFactory f) => _f = f;

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task FailedRoleUpdate_RollsBackDecision_AndCanBeRetried(int failingUpdate)
    {
        var (client, pending) = await _f.SignupAsync();
        var admin = await _f.AdminAsync();
        _f.RejectUpdate(pending.User.Id, failingUpdate);
        var url = $"/api/admin/trainer-requests/{pending.User.Id}/approve";

        var response = await admin.PostAsync(url, null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var profile = await (await client.GetAsync("/api/auth/me")).ReadAsync<UserProfile>();
        Assert.Equal(new[] { Roles.Member, Roles.TrainerRequest }, profile.Roles.Order());
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(url, null)).StatusCode);
        profile = await (await client.GetAsync("/api/auth/me")).ReadAsync<UserProfile>();
        Assert.Equal(new[] { Roles.Trainer }, profile.Roles);
    }
}

public class RoleUpdateFailureFactory : ApiFactory
{
    private string? _userId;
    private int _remainingUpdates;

    public void RejectUpdate(string userId, int update)
    {
        _userId = userId;
        _remainingUpdates = update;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureServices(services => services.AddScoped<IUserValidator<AppUser>>(_ => new RejectOneUpdate(this)));
    }

    private sealed class RejectOneUpdate(RoleUpdateFailureFactory factory) : IUserValidator<AppUser>
    {
        public Task<IdentityResult> ValidateAsync(UserManager<AppUser> manager, AppUser user)
            => Task.FromResult(user.Id == factory._userId && --factory._remainingUpdates == 0
                ? IdentityResult.Failed(new IdentityError { Code = "TestFailure", Description = "Test role update failure" })
                : IdentityResult.Success);
    }
}
