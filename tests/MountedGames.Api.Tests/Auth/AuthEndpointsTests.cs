using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

public class AuthEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public AuthEndpointsTests(ApiFactory f) => _f = f;

    private HttpClient Anon => _f.CreateClient();

    private static string Unique(string prefix = "u") => $"{prefix}{Guid.NewGuid():N}"[..14];

    // ---- login ----

    [Fact]
    public async Task Login_RefusesSeededAdminPassword_OutsideDevelopment()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/login", new LoginRequest(TestClients.AdminEmail, TestClients.AdminPassword));

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task AdminKey_ReturnsAdminToken()
    {
        var auth = await _f.AdminLoginAsync();

        Assert.Contains(Roles.Admin, auth.User.Roles);
    }

    [Fact]
    public async Task Login_Returns401_WhenPasswordWrong()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/login", new LoginRequest(TestClients.AdminEmail, "nope"));

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Login_Returns401_WhenUserUnknown()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/login", new LoginRequest("nobody@example.com", "Whatever1!"));

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Login_IncludesClubName_ForUserInAClub()
    {
        var clubName = $"Login Club {Guid.NewGuid():N}";
        await _f.InDbAsync(async db => { db.Clubs.Add(new Club { Name = clubName }); await db.SaveChangesAsync(); });
        var (_, signedUp) = await _f.SignupAsync(clubName: clubName);

        var auth = await _f.LoginAsync(signedUp.User.Email, "Passw0rd!x");

        Assert.Equal(clubName, auth.User.ClubName);
    }

    // ---- admin key ----

    [Fact]
    public async Task AdminKey_ReturnsAdminSession_ForCorrectKey()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey));

        var auth = await r.ReadAsync<AuthResponse>();
        Assert.Equal((HttpStatusCode.OK, true), (r.StatusCode, auth.User.Roles.Contains(Roles.Admin)));
    }

    [Theory]
    [InlineData("wrong")]
    [InlineData("")]
    public async Task AdminKey_Returns401_ForWrongKey(string key)
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(key));

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    // ---- self-service signup ----

    [Fact]
    public async Task SignupTrainer_CreatesTrainer_WithSynthesisedEmail_ByDefault()
    {
        var name = Unique();

        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(name, "Passw0rd!x"));

        var user = (await r.ReadAsync<AuthResponse>()).User;
        Assert.Equal(($"{name}@trainer.mg.local", name, Roles.Trainer), (user.Email, user.FullName, user.Roles.Single()));
    }

    [Fact]
    public async Task SignupTrainer_SanitisesUsernameIntoEmail()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest($"  Jo Bloggs!#{Unique()}  ", "Passw0rd!x"));

        var email = (await r.ReadAsync<AuthResponse>()).User.Email;
        Assert.Matches(@"^jobloggs[a-z0-9]+@trainer\.mg\.local$", email);
    }

    [Fact]
    public async Task SignupTrainer_FallsBackToGenericName_WhenUsernameHasNoUsableCharacters()
    {
        // Distinct per run via the second sign-up colliding on the same synthesised address.
        var first = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest("!!!", "Passw0rd!x"));
        var second = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest("???", "Passw0rd!x"));

        Assert.Equal(
            ("user@trainer.mg.local", HttpStatusCode.Conflict),
            ((await first.ReadAsync<AuthResponse>()).User.Email, second.StatusCode));
    }

    [Fact]
    public async Task SignupTrainer_UsesEmailAsGiven_WhenUsernameContainsAt()
    {
        var local = Unique();

        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest($"{local}@Example.com", "Passw0rd!x"));

        var user = (await r.ReadAsync<AuthResponse>()).User;
        Assert.Equal(($"{local}@example.com", local), (user.Email, user.FullName));
    }

    [Theory]
    [InlineData("Manager", Roles.Manager)]
    [InlineData("member", Roles.Member)]
    [InlineData("Trainer", Roles.Trainer)]
    [InlineData("Admin", Roles.Trainer)]
    [InlineData("gibberish", Roles.Trainer)]
    public async Task SignupTrainer_MapsRequestedRole_NeverGrantingAdmin(string requested, string expected)
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "Passw0rd!x", requested));

        Assert.Equal(expected, (await r.ReadAsync<AuthResponse>()).User.Roles.Single());
    }

    [Fact]
    public async Task SignupTrainer_LinksClub_WhenNameMatchesIgnoringCase()
    {
        var clubName = $"Signup Club {Guid.NewGuid():N}";
        await _f.InDbAsync(async db => { db.Clubs.Add(new Club { Name = clubName }); await db.SaveChangesAsync(); });

        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(Unique(), "Passw0rd!x", null, $"  {clubName.ToUpperInvariant()} "));

        Assert.Equal(clubName, (await r.ReadAsync<AuthResponse>()).User.ClubName);
    }

    [Fact]
    public async Task SignupTrainer_LeavesClubEmpty_WhenNameUnknown()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(Unique(), "Passw0rd!x", null, "No Such Club"));

        Assert.Null((await r.ReadAsync<AuthResponse>()).User.ClubId);
    }

    [Theory]
    [InlineData("", "Passw0rd!x")]
    [InlineData("   ", "Passw0rd!x")]
    [InlineData("someone", "")]
    public async Task SignupTrainer_Returns400_WhenUsernameOrPasswordMissing(string username, string password)
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(username, password));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task SignupTrainer_Returns409_WhenUsernameTaken()
    {
        var name = Unique();
        await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(name, "Passw0rd!x"));

        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(name, "Passw0rd!x"));

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    [Fact]
    public async Task SignupTrainer_Returns400_WithErrors_WhenPasswordTooWeak()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "weak"));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("errors", await r.Content.ReadAsStringAsync());
    }

    // ---- admin registration ----

    [Fact]
    public async Task Register_CreatesUserWithRole_ForAdmin()
    {
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest($"{Unique()}@example.com", "Passw0rd!x", "Registered", Roles.Rider, null));

        Assert.Equal(Roles.Rider, (await r.ReadAsync<AuthResponse>()).User.Roles.Single());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    [InlineData("NotARole")]
    public async Task Register_DefaultsToTrainer_WhenRoleMissingOrInvalid(string? role)
    {
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest($"{Unique()}@example.com", "Passw0rd!x", "Registered", role, null));

        Assert.Equal(Roles.Trainer, (await r.ReadAsync<AuthResponse>()).User.Roles.Single());
    }

    [Fact]
    public async Task Register_ReturnsClubName_WhenClubGiven()
    {
        var clubName = $"Reg Club {Guid.NewGuid():N}";
        var clubId = await _f.InDbAsync(async db =>
        {
            var c = new Club { Name = clubName };
            db.Clubs.Add(c);
            await db.SaveChangesAsync();
            return c.Id;
        });
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest($"{Unique()}@example.com", "Passw0rd!x", "Registered", null, clubId));

        Assert.Equal(clubName, (await r.ReadAsync<AuthResponse>()).User.ClubName);
    }

    [Fact]
    public async Task Register_Returns409_WhenEmailExists()
    {
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest(TestClients.AdminEmail, "Passw0rd!x", "Dup", null, null));

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    [Fact]
    public async Task Register_Returns400_WhenPasswordWeak()
    {
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest($"{Unique()}@example.com", "weak", "Weak", null, null));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Register_Returns401_WhenAnonymous()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/register", new RegisterRequest("a@b.c", "Passw0rd!x", "X", null, null));

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Register_Returns403_ForTrainer()
    {
        var trainer = await _f.TrainerAsync();

        var r = await trainer.PostAsJsonAsync("/api/auth/register", new RegisterRequest("a@b.c", "Passw0rd!x", "X", null, null));

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    // ---- me ----

    [Fact]
    public async Task Me_ReturnsProfile_ForSignedInUser()
    {
        var clubName = $"Me Club {Guid.NewGuid():N}";
        await _f.InDbAsync(async db => { db.Clubs.Add(new Club { Name = clubName }); await db.SaveChangesAsync(); });
        var (me, auth) = await _f.SignupAsync(Roles.Member, clubName);

        var profile = await (await me.GetAsync("/api/auth/me")).ReadAsync<UserProfile>();

        Assert.Equal((auth.User.Id, clubName, Roles.Member), (profile.Id, profile.ClubName, profile.Roles.Single()));
    }

    [Fact]
    public async Task Me_Returns401_WhenAnonymous()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await Anon.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Me_Returns401_WhenTokenBelongsToDeletedUser()
    {
        var (me, auth) = await _f.SignupAsync();
        await _f.InDbAsync(async db =>
        {
            db.Users.Remove(await db.Users.SingleAsync(u => u.Id == auth.User.Id));
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.Unauthorized, (await me.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Me_Returns401_WhenTokenIsGarbage()
    {
        var c = _f.WithToken("not.a.jwt");

        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/auth/me")).StatusCode);
    }
}

public class AdminKeyWithoutAdminAccountTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public AdminKeyWithoutAdminAccountTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task AdminKey_Returns500_WhenSharedAdminAccountMissing()
    {
        await _f.InDbAsync(async db =>
        {
            db.Users.Remove(await db.Users.SingleAsync(u => u.Email == TestClients.AdminEmail));
            await db.SaveChangesAsync();
        });

        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey));

        Assert.Equal(HttpStatusCode.InternalServerError, r.StatusCode);
    }
}
