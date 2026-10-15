using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

public class AuthEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public AuthEndpointsTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task Login_ReturnsToken_ForSeededAdmin()
    {
        var auth = await _f.LoginAsync(TestClients.AdminEmail, TestClients.AdminPassword);
        Assert.Contains(Roles.Admin, auth.User.Roles);
    }

    [Fact]
    public async Task Login_Returns401_WhenPasswordWrong()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(TestClients.AdminEmail, "nope"));
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }
}
