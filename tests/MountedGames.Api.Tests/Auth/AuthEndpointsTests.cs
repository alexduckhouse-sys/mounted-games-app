using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Email;
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

    [Fact]
    public async Task AdminKey_WithTitleAndEmail_SetsProfileAndPreservesOnMe_AndRejectsInvalidInputs()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "  Chief Steward  ", "  Steward@Example.com  ", "Passw0rd!x"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var auth = await r.ReadAsync<AuthResponse>();
        Assert.Equal("Chief Steward", auth.User.FullName);
        Assert.Equal("steward@example.com", auth.User.Email);
        Assert.Contains(Roles.Admin, auth.User.Roles);

        var meClient = _f.WithToken(auth.Token);
        var me = await (await meClient.GetAsync("/api/auth/me")).ReadAsync<UserProfile>();
        Assert.Equal("Chief Steward", me.FullName);
        Assert.Equal("steward@example.com", me.Email);

        // Second sign-in works directly from general login with email + password (no admin key needed).
        var secondLogin = await Anon.PostAsJsonAsync("/api/auth/login",
            new LoginRequest("steward@example.com", "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.OK, secondLogin.StatusCode);
        var secondAuth = await secondLogin.ReadAsync<AuthResponse>();
        Assert.Contains(Roles.Admin, secondAuth.User.Roles);
        Assert.Equal("Chief Steward", secondAuth.User.FullName);

        // Someone else with the shared admin key cannot impersonate that email without knowing its password.
        var impersonate = await Anon.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Impostor", "steward@example.com", "WrongPass1!"));
        Assert.Equal(HttpStatusCode.Unauthorized, impersonate.StatusCode);

        // Signing in again via admin-key with the right password succeeds and updates the title.
        var repeatAdminKey = await Anon.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Head Steward", "steward@example.com", "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.OK, repeatAdminKey.StatusCode);
        Assert.Equal("Head Steward", (await repeatAdminKey.ReadAsync<AuthResponse>()).User.FullName);

        var missingPassword = await Anon.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Chief Steward", "other-steward@example.com"));
        Assert.Equal(HttpStatusCode.BadRequest, missingPassword.StatusCode);

        var weakPassword = await Anon.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Chief Steward", "other-steward@example.com", "weak"));
        Assert.Equal(HttpStatusCode.BadRequest, weakPassword.StatusCode);

        var sharedEmailRejected = await Anon.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Chief Steward", "admin@mg.local", "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.BadRequest, sharedEmailRejected.StatusCode);

        var badEmail = await Anon.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Chief Steward", "not-an-email", "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.BadRequest, badEmail.StatusCode);

        var longTitle = await Anon.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, new string('T', 101), "steward@example.com", "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.BadRequest, longTitle.StatusCode);
    }

    [Fact]
    public async Task AdminKey_RejectsPasswordlessIdentityInsteadOfClaimingIt()
    {
        var passwordlessEmail = $"{Unique()}@example.com";
        await _f.InDbAsync(async db =>
        {
            db.Users.Add(new AppUser
            {
                UserName = passwordlessEmail,
                NormalizedUserName = passwordlessEmail.ToUpperInvariant(),
                Email = passwordlessEmail,
                NormalizedEmail = passwordlessEmail.ToUpperInvariant(),
                FullName = "Legacy Organiser",
                SecurityStamp = Guid.NewGuid().ToString()
            });
            await db.SaveChangesAsync();
        });

        var upgraded = await Anon.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Organiser", passwordlessEmail, "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.Unauthorized, upgraded.StatusCode);
        Assert.Null(await _f.WithDbAsync(db => db.Users.Where(u => u.Email == passwordlessEmail).Select(u => u.PasswordHash).SingleAsync()));
    }

    [Fact]
    public async Task AccountsPerIp_CapsNewSignupsAndAdminKeyAccounts_AtFivePerIp()
    {
        using var factory = new AccountCapFactory();
        var sameIp = factory.CreateClient();
        sameIp.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "198.51.100.77");

        for (var i = 0; i < 3; i++)
        {
            var s = await sameIp.PostAsJsonAsync("/api/auth/signup-trainer",
                new SignupTrainerRequest(Unique(), "Passw0rd!x", null, "Cap Club"));
            Assert.Equal(HttpStatusCode.OK, s.StatusCode);
        }
        for (var i = 0; i < 2; i++)
        {
            var a = await sameIp.PostAsJsonAsync("/api/auth/admin-key",
                new AdminKeyRequest(ApiFactory.AdminKey, "Steward", $"{Unique()}@example.com", "Passw0rd!x"));
            Assert.Equal(HttpStatusCode.OK, a.StatusCode);
        }

        // 6th account from the same IP is blocked on both signup-trainer and admin-key.
        var sixthSignup = await sameIp.PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(Unique(), "Passw0rd!x", null, "Cap Club"));
        Assert.Equal(HttpStatusCode.TooManyRequests, sixthSignup.StatusCode);

        var sixthAdmin = await sameIp.PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Steward", $"{Unique()}@example.com", "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.TooManyRequests, sixthAdmin.StatusCode);

        // Another IP can still create an account.
        var otherIp = factory.CreateClient();
        otherIp.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "198.51.100.78");
        var allowed = await otherIp.PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(Unique(), "Passw0rd!x", null, "Cap Club"));
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    }

    [Fact]
    public async Task AccountsPerIp_ParallelSignupAndAdminCreationCannotBothTakeLastSlot()
    {
        using var factory = new AccountCapFactory();
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "198.51.100.81");
        for (var i = 0; i < 4; i++)
            (await client.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "Passw0rd!x", null, "Fake cap club"))).EnsureSuccessStatusCode();
        var results = await Task.WhenAll(
            client.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "Passw0rd!x", null, "Fake cap club")),
            client.PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Test organiser", $"{Unique()}@example.com", "Passw0rd!x")));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.TooManyRequests);
        Assert.Equal(5, await factory.WithDbAsync(db => db.UserClaims.CountAsync(c => c.ClaimType == "created_ip")));
    }

    [Fact]
    public async Task AccountsPerIp_FailedCreationRollsBackAndDeletionFreesARetainedAccountSlot()
    {
        using var factory = new AccountCapFactory();
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "198.51.100.82");
        AuthResponse? first = null;
        for (var i = 0; i < 4; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "Passw0rd!x", null, "Fake cap club"));
            response.EnsureSuccessStatusCode();
            first ??= await response.ReadAsync<AuthResponse>();
        }
        var failed = await client.PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Test organiser", $"{Unique()}@example.com", "weak"));
        Assert.Equal(HttpStatusCode.BadRequest, failed.StatusCode);
        Assert.Equal(4, await factory.WithDbAsync(db => db.UserClaims.CountAsync(c => c.ClaimType == "created_ip")));
        (await client.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "Passw0rd!x", null, "Fake cap club"))).EnsureSuccessStatusCode();
        using var own = factory.WithToken(first!.Token);
        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me") { Content = JsonContent.Create(new { password = "Passw0rd!x" }) };
        (await own.SendAsync(request)).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "Passw0rd!x", null, "Fake cap club"))).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task AdminKey_DoesNotClaimEmailVerificationOrBypassAccountLockout()
    {
        var email = $"{Unique()}@example.com";
        var created = await Anon.PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Test organiser", email, "Passw0rd!x"));
        created.EnsureSuccessStatusCode();
        var auth = await created.ReadAsync<AuthResponse>();
        Assert.False(auth.User.EmailConfirmed);
        var again = await Anon.PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Test organiser", email, "Passw0rd!x"));
        again.EnsureSuccessStatusCode();
        Assert.False((await again.ReadAsync<AuthResponse>()).User.EmailConfirmed);
        await _f.InDbAsync(async db => { var user = await db.Users.SingleAsync(u => u.Id == auth.User.Id); user.LockoutEnabled = true; user.LockoutEnd = DateTimeOffset.UtcNow.AddMinutes(10); await db.SaveChangesAsync(); });
        var locked = await Anon.PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Test organiser", email, "Passw0rd!x"));
        Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);
    }

    private sealed class AccountCapFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("RateLimits:AccountsPerIp", "5");
        }
    }

    [Fact]
    public async Task Login_AcceptsLongPasswords_ForAdminCreatedAndSelfServiceAccounts()
    {
        var password = new string('a', 128) + "1!";
        var email = $"{Unique()}@example.com";
        var admin = await _f.AdminAsync();
        var registered = await admin.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest(email, password, "Test account", Roles.Member, null));
        Assert.Equal(HttpStatusCode.OK, registered.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Anon.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password))).StatusCode);

        var signup = await Anon.PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(Unique(), password, null, "Auth Test Club"));
        Assert.Equal(HttpStatusCode.OK, signup.StatusCode);
        var account = await signup.ReadAsync<AuthResponse>();
        Assert.Equal(HttpStatusCode.OK, (await Anon.PostAsJsonAsync("/api/auth/login", new LoginRequest(account.User.Email, password))).StatusCode);
    }

    [Fact]
    public async Task JoiningReportingAndUnsubscribing_HaveSeparateLimitsFromSigningIn()
    {
        using var factory = new ActionLimitedFactory();
        var trainer = await factory.TrainerAsync();
        var (other, _) = await factory.SignupAsync();
        var anonymous = factory.CreateClient();
        foreach (var client in new[] { trainer, other, anonymous })
            client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "198.51.100.44");

        var actions = new (HttpClient Client, string Url, object Body, HttpStatusCode Status)[]
        {
            (trainer, "/api/teams/join", new { key = "fake-unknown-key" }, HttpStatusCode.NotFound),
            (anonymous, "/api/shop/posts/99999999/report", new { reason = "Fake report" }, HttpStatusCode.NotFound),
            (anonymous, "/api/email/unsubscribe", new { token = "fake-unknown-token" }, HttpStatusCode.OK),
        };
        foreach (var action in actions)
        {
            for (var i = 0; i < 2; i++)
                Assert.Equal(action.Status, (await action.Client.PostAsJsonAsync(action.Url, action.Body)).StatusCode);
            var limited = await action.Client.PostAsJsonAsync(action.Url, action.Body);
            Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
            Assert.Equal("60", limited.Headers.GetValues("Retry-After").Single());
        }

        // Joining is per person, so another signed-in spectator at the same venue can still join.
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PostAsJsonAsync("/api/teams/join", new { key = "fake-unknown-key" })).StatusCode);
        // Neither these actions nor another person's joins have spent the venue's sign-in allowance.
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/auth/login",
                new LoginRequest(TestClients.TrainerEmail, TestClients.TrainerPassword))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await anonymous.PostAsJsonAsync("/api/auth/login",
            new LoginRequest(TestClients.TrainerEmail, TestClients.TrainerPassword))).StatusCode);
    }

    private sealed class ActionLimitedFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("RateLimits:AuthPerMinute", "2");
            builder.UseSetting("RateLimits:TeamJoinPerMinute", "2");
            builder.UseSetting("RateLimits:ShopReportsPerMinute", "2");
            builder.UseSetting("RateLimits:UnsubscribePerMinute", "2");
            builder.UseSetting("RateLimits:NearYouPerMinute", "2");
        }
    }

    [Fact]
    public async Task OneClickUnsubscribes_AreLimitedPerSignedTokenNotPerAddress_ButForgedOnesStillPerAddress()
    {
        using var factory = new ActionLimitedFactory();
        var mailApp = factory.CreateClient();
        mailApp.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "198.51.100.45"); // a big mail provider's shared server
        var configuration = factory.Services.GetRequiredService<IConfiguration>();

        // Many different people unsubscribe from the same address in one minute: none is lost.
        for (var id = 1; id <= 6; id++)
        {
            var token = Uri.EscapeDataString(EmailUnsubscribeTokens.Create(configuration, id));
            Assert.Equal(HttpStatusCode.OK, (await mailApp.PostAsync($"/api/email/unsubscribe-one-click?token={token}", null)).StatusCode);
        }
        // One token can't be hammered.
        var same = Uri.EscapeDataString(EmailUnsubscribeTokens.Create(configuration, 99));
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.OK, (await mailApp.PostAsync($"/api/email/unsubscribe-one-click?token={same}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await mailApp.PostAsync($"/api/email/unsubscribe-one-click?token={same}", null)).StatusCode);

        // Made-up tokens stay limited per address, however they vary.
        var guesser = factory.CreateClient();
        guesser.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "198.51.100.46");
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.OK, (await guesser.PostAsync($"/api/email/unsubscribe-one-click?token=n1.{i + 1}.forged{i}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await guesser.PostAsync("/api/email/unsubscribe-one-click?token=n1.9.forged9", null)).StatusCode);
    }

    [Fact]
    public async Task NearYou_IsLimitedPerAddress()
    {
        using var factory = new ActionLimitedFactory();
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "198.51.100.47");
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/competitions/picker/near-you")).StatusCode);
        var limited = await client.GetAsync("/api/competitions/picker/near-you");
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("60", limited.Headers.GetValues("Retry-After").Single());
        var elsewhere = factory.CreateClient();
        elsewhere.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "198.51.100.48");
        Assert.Equal(HttpStatusCode.OK, (await elsewhere.GetAsync("/api/competitions/picker/near-you")).StatusCode);
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
    public async Task SignupTrainer_CreatesPendingMember_WithSynthesisedEmail_ByDefault()
    {
        var name = Unique();

        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(name, "Passw0rd!x", null, "Auth Test Club"));

        var user = (await r.ReadAsync<AuthResponse>()).User;
        Assert.Equal(($"{name}@trainer.mg.local", name), (user.Email, user.FullName));
        Assert.Equal(new[] { Roles.Member, Roles.TrainerRequest }, user.Roles.Order());
    }

    [Fact]
    public async Task SignupTrainer_SanitisesUsernameIntoEmail()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest($"  Jo Bloggs!#{Unique()}  ", "Passw0rd!x", null, "Auth Test Club"));

        var email = (await r.ReadAsync<AuthResponse>()).User.Email;
        Assert.Matches(@"^jobloggs[a-z0-9]+@trainer\.mg\.local$", email);
    }

    [Fact]
    public async Task SignupTrainer_FallsBackToGenericName_WhenUsernameHasNoUsableCharacters()
    {
        // Distinct per run via the second sign-up colliding on the same synthesised address.
        var first = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest("!!!", "Passw0rd!x", null, "Auth Test Club"));
        var second = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest("???", "Passw0rd!x", null, "Auth Test Club"));

        Assert.Equal(
            ("user@trainer.mg.local", HttpStatusCode.Conflict),
            ((await first.ReadAsync<AuthResponse>()).User.Email, second.StatusCode));
    }

    [Fact]
    public async Task SignupTrainer_UsesEmailAsGiven_WhenUsernameContainsAt()
    {
        var local = Unique();

        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest($"{local}@Example.com", "Passw0rd!x", null, "Auth Test Club"));

        var user = (await r.ReadAsync<AuthResponse>()).User;
        Assert.Equal(($"{local}@example.com", local), (user.Email, user.FullName));
    }

    [Theory]
    [InlineData("Manager", new[] { Roles.ManagerRequest, Roles.Member })]
    [InlineData("member", new[] { Roles.Member })]
    [InlineData("Trainer", new[] { Roles.Member, Roles.TrainerRequest })]
    [InlineData(" trainer ", new[] { Roles.Member, Roles.TrainerRequest })]
    [InlineData("Admin", new[] { Roles.Member, Roles.TrainerRequest })]
    [InlineData("gibberish", new[] { Roles.Member, Roles.TrainerRequest })]
    [InlineData("TrainerRequest", new[] { Roles.Member, Roles.TrainerRequest })]
    public async Task SignupTrainer_MapsRequestedRole_NeverGrantingAdmin(string requested, string[] expected)
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "Passw0rd!x", requested, "Auth Test Club"));

        Assert.Equal(expected, (await r.ReadAsync<AuthResponse>()).User.Roles.Order());
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
    public async Task SignupTrainer_CreatesTheClub_WhenNameUnknown()
    {
        var unknown = $"No Such Club {Guid.NewGuid():N}";
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(Unique(), "Passw0rd!x", null, unknown));

        var user = (await r.ReadAsync<AuthResponse>()).User;
        Assert.NotNull(user.ClubId);
        Assert.Equal(unknown, user.ClubName);
    }

    [Fact]
    public async Task SignupTrainer_Returns400_WhenNoClubGiven()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "Passw0rd!x"));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Theory]
    [InlineData("", "Passw0rd!x")]
    [InlineData("   ", "Passw0rd!x")]
    [InlineData("someone", "")]
    public async Task SignupTrainer_Returns400_WhenUsernameOrPasswordMissing(string username, string password)
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(username, password, null, "Auth Test Club"));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task SignupTrainer_Returns409_WhenUsernameTaken()
    {
        var name = Unique();
        await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(name, "Passw0rd!x", null, "Auth Test Club"));

        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(name, "Passw0rd!x", null, "Auth Test Club"));

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    [Fact]
    public async Task SignupTrainer_Returns400_WithErrors_WhenPasswordTooWeak()
    {
        var r = await Anon.PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(Unique(), "weak", null, "Auth Test Club"));

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
