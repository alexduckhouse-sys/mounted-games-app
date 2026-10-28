using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// Organisers and team managers can reset their password by email, so a request is approved only once the requester's
/// address is confirmed (by an admin or, for trainers, the club's manager). Declining needs nothing.
/// </summary>
public class TrainerRequestAddressTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private const string Route = "/api/admin/trainer-requests";

    private async Task<AuthResponse> RequestAsync(string role, string club)
    {
        var response = await f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest($"request-{Guid.NewGuid():N}@example.org", ResetSteps.Password, role, club));
        response.EnsureSuccessStatusCode();
        var auth = await response.ReadAsync<AuthResponse>();
        Assert.False(auth.User.EmailConfirmed);
        return auth;
    }

    [Theory]
    [InlineData("Trainer", Roles.Trainer)]
    [InlineData("Manager", Roles.Manager)]
    public async Task AnAdminCantApproveUntilTheAddressIsConfirmed(string asked, string granted)
    {
        var request = await RequestAsync(asked, $"Club {Guid.NewGuid():N}");
        var admin = await f.AdminAsync();

        var refused = await admin.PostAsync($"{Route}/{request.User.Id}/approve", null);

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var body = await refused.Content.ReadAsStringAsync();
        Assert.Contains("email_unconfirmed", body);
        Assert.Contains("hasn't confirmed their email address", body);
        Assert.DoesNotContain(granted, (await f.LoginAsync(request.User.Email, ResetSteps.Password)).User.Roles);

        await f.ConfirmAddressAsync(request.User.Id);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"{Route}/{request.User.Id}/approve", null)).StatusCode);
        Assert.Contains(granted, (await f.LoginAsync(request.User.Email, ResetSteps.Password)).User.Roles);
    }

    [Fact]
    public async Task AClubManagerCantApproveUntilTheAddressIsConfirmedEither()
    {
        var club = $"Club {Guid.NewGuid():N}";
        var (manager, _) = await f.ApprovedManagerAsync(club);
        var request = await RequestAsync("Trainer", club);

        var refused = await manager.PostAsync($"{Route}/{request.User.Id}/approve", null);

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Contains("email_unconfirmed", await refused.Content.ReadAsStringAsync());
        await f.ConfirmAddressAsync(request.User.Id);
        Assert.Equal(HttpStatusCode.NoContent, (await manager.PostAsync($"{Route}/{request.User.Id}/approve", null)).StatusCode);
    }

    [Fact]
    public async Task DecliningDoesntNeedAConfirmedAddress()
    {
        var request = await RequestAsync("Trainer", $"Club {Guid.NewGuid():N}");
        Assert.Equal(HttpStatusCode.NoContent, (await (await f.AdminAsync()).PostAsync($"{Route}/{request.User.Id}/decline", null)).StatusCode);
    }
}
