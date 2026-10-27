using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>Changing your own name (<c>PUT /api/auth/me</c>) and password (<c>POST /api/auth/change-password</c>).</summary>
public class AccountProfileTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public AccountProfileTests(ApiFactory f) => _f = f;

    private const string Password = "Passw0rd!x";
    private const string NewPassword = "Brand-new9pw";

    private static Task<HttpResponseMessage> Rename(HttpClient client, string? name)
        => client.PutAsJsonAsync("/api/auth/me", new { fullName = name });

    private static Task<HttpResponseMessage> Change(HttpClient client, string? current, string? next)
        => client.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = current, newPassword = next });

    private static async Task<string> MessageAsync(HttpResponseMessage r)
        => (await r.Content.ReadFromJsonAsync<Dictionary<string, string>>(TestClients.Json))!["message"];

    private async Task<bool> CanSignInAsync(string email, string password)
    {
        using var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password));
        return r.IsSuccessStatusCode;
    }

    // ---- name ----

    [Fact]
    public async Task Rename_Anonymous_Gets401()
    {
        using var r = await Rename(_f.CreateClient(), "Someone");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Rename_SavesTheTrimmedName_AndReturnsTheProfile()
    {
        var (client, auth) = await _f.SignupAsync();
        using var r = await Rename(client, "  Jamie Carter  ");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var profile = await r.ReadAsync<UserProfile>();
        Assert.Equal("Jamie Carter", profile.FullName);
        Assert.Equal(auth.User.Email, profile.Email);
        var me = await (await client.GetAsync("/api/auth/me")).ReadAsync<UserProfile>();
        Assert.Equal("Jamie Carter", me.FullName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Rename_BlankName_Gets400(string? name)
    {
        var (client, auth) = await _f.SignupAsync();
        using var r = await Rename(client, name);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(auth.User.FullName, (await (await client.GetAsync("/api/auth/me")).ReadAsync<UserProfile>()).FullName);
    }

    [Fact]
    public async Task Rename_TooLong_Gets400()
    {
        var (client, _) = await _f.SignupAsync();
        using var r = await Rename(client, new string('a', 101));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("100", await MessageAsync(r), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Rename_TheSharedAdminAccount_IsRefused()
    {
        var admin = await _f.AdminAsync();
        using var r = await Rename(admin, "Somebody Else");
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    // ---- password ----

    [Fact]
    public async Task Change_Anonymous_Gets401()
    {
        using var r = await Change(_f.CreateClient(), Password, NewPassword);
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Change_WithTheRightCurrentPassword_SwitchesTheSignIn()
    {
        var (client, auth) = await _f.SignupAsync();
        using var r = await Change(client, Password, NewPassword);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.False(await CanSignInAsync(auth.User.Email, Password));
        Assert.True(await CanSignInAsync(auth.User.Email, NewPassword));
    }

    [Fact]
    public async Task Change_SignsEveryOtherDeviceOut_AndGivesThisOneAFreshToken()
    {
        var (client, auth) = await _f.SignupAsync();
        var otherDevice = _f.WithToken((await _f.LoginAsync(auth.User.Email, Password)).Token);
        Assert.Equal(HttpStatusCode.OK, (await otherDevice.GetAsync("/api/auth/me")).StatusCode);

        using var r = await Change(client, Password, NewPassword);
        var fresh = await r.ReadAsync<AuthResponse>();

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal((auth.User.Id, auth.User.Email), (fresh.User.Id, fresh.User.Email));
        Assert.Equal(HttpStatusCode.Unauthorized, (await otherDevice.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _f.WithToken(fresh.Token).GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(1, await _f.WithDbAsync(db => db.Users.Where(u => u.Id == auth.User.Id).Select(u => u.SessionVersion).SingleAsync()));
    }

    [Fact]
    public async Task Change_RefusedForTheRules_EndsNoSessions_AndKeepsSignIns()
    {
        var (client, auth) = await _f.SignupAsync();
        await _f.AddSignInsAsync(auth.User.Id, "Google");
        using var r = await Change(client, Password, "short1!");
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(0, await _f.WithDbAsync(db => db.Users.Where(u => u.Id == auth.User.Id).Select(u => u.SessionVersion).SingleAsync()));
        Assert.Equal(1, await _f.SignInsAsync(auth.User.Id));
    }

    [Fact]
    public async Task Change_DisconnectsGoogleAndAppleSignIns()
    {
        var (client, auth) = await _f.SignupAsync();
        await _f.AddSignInsAsync(auth.User.Id, "Google", "Apple");

        using var r = await Change(client, Password, NewPassword);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(0, await _f.SignInsAsync(auth.User.Id));
    }

    [Theory]
    [InlineData(null, NewPassword)]
    [InlineData("", NewPassword)]
    [InlineData(Password, null)]
    [InlineData(Password, "")]
    public async Task Change_MissingEitherPassword_Gets400(string? current, string? next)
    {
        var (client, auth) = await _f.SignupAsync();
        using var r = await Change(client, current, next);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.True(await CanSignInAsync(auth.User.Email, Password));
    }

    [Fact]
    public async Task Change_WrongCurrentPassword_Gets400_AndNothingChanges()
    {
        var (client, auth) = await _f.SignupAsync();
        using var r = await Change(client, "not-the-password", NewPassword);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("isn't right", await MessageAsync(r), StringComparison.Ordinal);
        Assert.True(await CanSignInAsync(auth.User.Email, Password));
        Assert.False(await CanSignInAsync(auth.User.Email, NewPassword));
    }

    [Fact]
    public async Task Change_FiveWrongGuessesLockTheAccount_LikeSigningIn()
    {
        var (client, _) = await _f.SignupAsync();
        for (var i = 0; i < 5; i++)
        {
            using var wrong = await Change(client, "not-the-password", NewPassword);
            Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
            Assert.Contains(i < 4 ? "isn't right" : "Too many", await MessageAsync(wrong), StringComparison.Ordinal);
        }
        // Even the right password is refused once the account is locked.
        using var locked = await Change(client, Password, NewPassword);
        Assert.Equal(HttpStatusCode.BadRequest, locked.StatusCode);
        Assert.Contains("Too many", await MessageAsync(locked), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("short1!")]
    [InlineData("nodigitshere!")]
    [InlineData("NoSymbols123")]
    public async Task Change_NewPasswordBreakingTheRules_Gets400WithTheReason(string weak)
    {
        var (client, auth) = await _f.SignupAsync();
        using var r = await Change(client, Password, weak);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace(await MessageAsync(r)));
        Assert.True(await CanSignInAsync(auth.User.Email, Password));
    }

    [Fact]
    public async Task Change_ToTheSamePassword_Gets400()
    {
        var (client, _) = await _f.SignupAsync();
        using var r = await Change(client, Password, Password);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("Choose a different password from your current one.", await MessageAsync(r));
    }

    [Fact]
    public async Task Change_SharedAdminAndPasswordlessAccounts_GetAClearConflict()
    {
        var admin = await _f.AdminAsync();
        using var shared = await Change(admin, "anything", NewPassword);
        Assert.Equal(HttpStatusCode.Conflict, shared.StatusCode);

        var (client, auth) = await _f.SignupAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == auth.User.Id)).PasswordHash = null;
            await db.SaveChangesAsync();
        });
        using var none = await Change(client, Password, NewPassword);
        Assert.Equal(HttpStatusCode.Conflict, none.StatusCode);
        Assert.Contains("without a password", await MessageAsync(none), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Change_TheAnswerForAWrongPassword_NeverNamesAnyoneElse()
    {
        // The route only ever acts on the caller, so there's no way to ask about another account's password.
        var (client, _) = await _f.SignupAsync();
        var (_, other) = await _f.SignupAsync();
        using var r = await Change(client, "guess", NewPassword);
        Assert.DoesNotContain(other.User.Email, await r.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }
}
