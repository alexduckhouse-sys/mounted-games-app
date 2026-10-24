using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests;

public class RoleRevocationSecurityTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task RevokedAdminCannotUseOldTokenToRestoreOwnRole()
    {
        using var admin = await f.AdminAsync();
        var (_, member) = await f.SignupAsync("Member");
        var route = $"/api/admin/users/{member.User.Id}/roles";
        (await admin.PostAsJsonAsync(route, new { role = Roles.Admin, grant = true })).EnsureSuccessStatusCode();
        var promoted = await f.LoginAsync(member.User.Email, "Passw0rd!x");
        using var oldAdmin = f.WithToken(promoted.Token);
        Assert.Equal(HttpStatusCode.OK, (await oldAdmin.GetAsync("/api/admin/users")).StatusCode);
        (await admin.PostAsJsonAsync(route, new { role = Roles.Admin, grant = false })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await oldAdmin.PostAsJsonAsync(route, new { role = Roles.Admin, grant = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await oldAdmin.GetAsync("/api/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await oldAdmin.GetAsync("/api/auth/me")).StatusCode);
    }
}
