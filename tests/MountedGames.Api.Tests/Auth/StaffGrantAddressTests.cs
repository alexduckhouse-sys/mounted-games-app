using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// Staff can reset their password by email, so every way of making someone staff needs their address confirmed first:
/// an admin granting a role, a club's manager changing one, and an admin making an account. (Approving requests is in
/// <see cref="TrainerRequestAddressTests"/>, adding a competition admin in <c>CompetitionTeamTests</c>.)
/// </summary>
public class StaffGrantAddressTests(PasswordResetTests.Factory f) : IClassFixture<PasswordResetTests.Factory>
{
    private Task UnconfirmAsync(string userId)
        => f.WithDbAsync(db => db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false)));

    private Task<List<string>> RolesOfAsync(string userId) => f.WithDbAsync(db =>
        (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id where ur.UserId == userId select r.Name!).ToListAsync());

    private static async Task AssertUnconfirmedRefusalAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(ConfirmedAddress.Code, body);
        Assert.Contains("hasn't confirmed their email address", body);
    }

    private static Task<HttpResponseMessage> GrantAsync(HttpClient admin, string userId, string role, bool grant = true)
        => admin.PostAsJsonAsync($"/api/admin/users/{userId}/roles", new ToggleUserRoleRequest(role, grant));

    [Fact]
    public async Task AnAdminCantGrantTrainerOrManager_UntilTheAddressIsConfirmed()
    {
        var (_, person) = await f.SignupAsync("Member");
        await UnconfirmAsync(person.User.Id);
        var admin = await f.AdminAsync();

        await AssertUnconfirmedRefusalAsync(await GrantAsync(admin, person.User.Id, Roles.Trainer));
        await AssertUnconfirmedRefusalAsync(await GrantAsync(admin, person.User.Id, Roles.Manager));
        Assert.DoesNotContain(Roles.Trainer, await RolesOfAsync(person.User.Id));
        Assert.DoesNotContain(Roles.Manager, await RolesOfAsync(person.User.Id));
        // Member isn't staff, and taking a role away needs nothing.
        Assert.Equal(HttpStatusCode.OK, (await GrantAsync(admin, person.User.Id, Roles.Member)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await GrantAsync(admin, person.User.Id, Roles.Member, grant: false)).StatusCode);

        await f.ConfirmAddressAsync(person.User.Id);
        Assert.Equal(HttpStatusCode.OK, (await GrantAsync(admin, person.User.Id, Roles.Trainer)).StatusCode);
        Assert.Contains(Roles.Trainer, await RolesOfAsync(person.User.Id));
    }

    [Fact]
    public async Task AMasterAdminCantGrantAdmin_UntilTheAddressIsConfirmed()
    {
        var master = await f.AccountAsync();
        using (var scope = f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            Assert.True((await users.AddToRolesAsync((await users.FindByIdAsync(master.User.Id))!, [Roles.Admin, Roles.MasterAdmin])).Succeeded);
        }
        await f.ConfirmAddressAsync(master.User.Id);
        var masterClient = f.WithToken((await f.LoginAsync(master.User.Email, ResetSteps.Password)).Token);
        var (_, person) = await f.SignupAsync("Member");
        await UnconfirmAsync(person.User.Id);

        await AssertUnconfirmedRefusalAsync(await GrantAsync(masterClient, person.User.Id, Roles.Admin));
        Assert.DoesNotContain(Roles.Admin, await RolesOfAsync(person.User.Id));

        await f.ConfirmAddressAsync(person.User.Id);
        Assert.Equal(HttpStatusCode.OK, (await GrantAsync(masterClient, person.User.Id, Roles.Admin)).StatusCode);
    }

    [Fact]
    public async Task AClubRoleChangeToTrainerOrManager_NeedsAConfirmedAddress()
    {
        var club = $"Grant Club {Guid.NewGuid():N}";
        var (manager, _) = await f.ApprovedManagerAsync(club);
        var (_, person) = await f.SignupAsync("Member", club);
        await UnconfirmAsync(person.User.Id);
        var clubId = await f.WithDbAsync(db => db.Clubs.Where(c => c.Name == club).Select(c => c.Id).SingleAsync());
        var url = $"/api/clubs/{clubId}/members/{person.User.Id}/role";

        await AssertUnconfirmedRefusalAsync(await manager.PutAsJsonAsync(url, new ChangeMemberRoleRequest(Roles.Trainer)));
        await AssertUnconfirmedRefusalAsync(await (await f.AdminAsync()).PutAsJsonAsync(url, new ChangeMemberRoleRequest(Roles.Manager)));
        Assert.DoesNotContain(Roles.Trainer, await RolesOfAsync(person.User.Id));
        Assert.DoesNotContain(Roles.Manager, await RolesOfAsync(person.User.Id));

        await f.ConfirmAddressAsync(person.User.Id);
        Assert.Equal(HttpStatusCode.OK, (await manager.PutAsJsonAsync(url, new ChangeMemberRoleRequest(Roles.Trainer))).StatusCode);
        Assert.Contains(Roles.Trainer, await RolesOfAsync(person.User.Id));
    }

    [Fact]
    public async Task AnAccountAnAdminMakes_StartsUnconfirmed_AndGetsTheConfirmationEmail()
    {
        var email = ResetSteps.NewEmail();
        var made = await (await f.AdminAsync()).PostAsJsonAsync("/api/auth/register",
            new RegisterRequest(email, ResetSteps.Password, "New Organiser", Roles.Trainer, null));

        Assert.Equal(HttpStatusCode.OK, made.StatusCode);
        Assert.False((await made.ReadAsync<AuthResponse>()).User.EmailConfirmed);
        Assert.False((await f.UserAsync(email)).EmailConfirmed);
        var mail = Assert.Single(f.Mail(email, "Confirm your email address"));
        Assert.Contains("/confirm-email#u=", mail.Text);
        // Unconfirmed staff get no reset link: whoever the admin typed in can't take the account over.
        f.Clock.Advance(TimeSpan.FromMinutes(2));
        await f.RequestResetAsync(email);
        Assert.Empty(f.Mail(email, ResetSteps.ResetSubject));
    }
}
