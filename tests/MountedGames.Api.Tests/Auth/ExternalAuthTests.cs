using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// Sign in with Google and Apple through <c>POST /api/auth/external</c>, with the real token checks: tokens are signed by
/// <see cref="ExternalAuthFactory"/>'s local test keys, never by the providers.
/// </summary>
public class ExternalAuthTests : IClassFixture<ExternalAuthFactory>
{
    private const string Password = "Passw0rd!x";
    private readonly ExternalAuthFactory _f;

    public ExternalAuthTests(ExternalAuthFactory f) => _f = f;

    private sealed record Attempt(string Provider, string Token, string Nonce, string Subject);

    private static string Gmail() => $"rider.{Guid.NewGuid():N}"[..20] + "@gmail.com";

    private Attempt Google(string email, string? subject = null, bool verified = true, string audience = ExternalAuthFactory.GoogleWebClient,
        IDictionary<string, object>? extra = null)
    {
        var nonce = IdTokenSigner.NewNonce();
        subject ??= $"g-{Guid.NewGuid():N}";
        return new("google", _f.Google.Sign(IdTokenSigner.GoogleIssuer, audience, subject, email, nonce, verified, extra), nonce, subject);
    }

    private Attempt Apple(string email, string? subject = null, bool relay = false)
    {
        var nonce = IdTokenSigner.NewNonce();
        subject ??= $"001{Guid.NewGuid():N}";
        var extra = new Dictionary<string, object> { ["is_private_email"] = relay ? "true" : "false" };
        return new("apple", _f.Apple.Sign(IdTokenSigner.AppleIssuer, ExternalAuthFactory.AppleServicesId, subject, email, nonce, "true", extra), nonce, subject);
    }

    private Task<HttpResponseMessage> PostAsync(Attempt a, string? club = null, string? role = null, string? fullName = null,
        string? providerName = null, HttpClient? client = null)
        => (client ?? _f.CreateClient()).PostAsJsonAsync("/api/auth/external",
            new ExternalAuthRequest(a.Provider, a.Token, a.Nonce, fullName, club, role, providerName));

    private async Task<AuthResponse> SignInAsync(Attempt a, string? providerName = null)
    {
        var response = await PostAsync(a, providerName: providerName);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.ReadAsync<ExternalAuthResultDto>();
        Assert.False(result.NeedsSignup);
        return result.Auth!;
    }

    private async Task<AuthResponse> CreateAsync(Attempt a, string role = Roles.Member, string? fullName = "Alex Rider", string? providerName = null)
    {
        var response = await PostAsync(a, $"External Club {Guid.NewGuid():N}"[..24], role, fullName, providerName);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.ReadAsync<ExternalAuthResultDto>()).Auth!;
    }

    private async Task<(string Id, string Email)> PasswordAccountAsync(string email, bool confirmed)
    {
        var response = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(email, Password, Roles.Member, "Password Club", "Pat Password"));
        response.EnsureSuccessStatusCode();
        var auth = await response.ReadAsync<AuthResponse>();
        await SetAsync(auth.User.Id, u => u.EmailConfirmed = confirmed);
        return (auth.User.Id, email);
    }

    private Task SetAsync(string userId, Action<AppUser> change) => _f.InDbAsync(async db =>
    {
        change(await db.Users.SingleAsync(u => u.Id == userId));
        await db.SaveChangesAsync();
    });

    private Task<List<IdentityUserLogin<string>>> LoginsAsync(string userId)
        => _f.WithDbAsync(db => db.UserLogins.Where(l => l.UserId == userId).ToListAsync());

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private async Task AssertRefusedAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, await CodeAsync(response));
    }

    // ---- GET /api/auth/providers ----

    [Fact]
    public async Task ProvidersListsOnlyTheConfiguredOnesWithTheirWebClientId()
    {
        var providers = await (await _f.CreateClient().GetAsync("/api/auth/providers")).ReadAsync<List<ExternalProviderDto>>();
        Assert.Equal(
            new List<ExternalProviderDto> { new("google", "Google", ExternalAuthFactory.GoogleWebClient), new("apple", "Apple", ExternalAuthFactory.AppleServicesId) },
            providers);

        // Apple stays off until it has a Services ID; with nothing configured, nothing is offered.
        using (var googleOnly = _f.WithWebHostBuilder(b => b.UseSetting("Auth:Apple:ClientIds:0", "")))
        {
            var list = await (await googleOnly.CreateClient().GetAsync("/api/auth/providers")).ReadAsync<List<ExternalProviderDto>>();
            Assert.Equal("google", Assert.Single(list).Id);
            var apple = Apple($"{Guid.NewGuid():N}@icloud.com");
            await AssertRefusedAsync(await PostAsync(apple, client: googleOnly.CreateClient()), HttpStatusCode.Unauthorized, "external_token");
        }
        using var neither = _f.WithWebHostBuilder(b => b
            .UseSetting("Auth:Apple:ClientIds:0", "")
            .UseSetting("Auth:Google:ClientIds:0", "")
            .UseSetting("Auth:Google:ClientIds:1", ""));
        Assert.Empty(await (await neither.CreateClient().GetAsync("/api/auth/providers")).ReadAsync<List<ExternalProviderDto>>());
    }

    // ---- New accounts ----

    [Fact]
    public async Task ANewGoogleUserPicksAClubThenGetsTheSameRolesAsAnyOtherSignUp()
    {
        var email = Gmail();
        var attempt = Google(email, extra: new Dictionary<string, object> { ["name"] = "Jamie Carter" });

        var first = await PostAsync(attempt);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var asked = await first.ReadAsync<ExternalAuthResultDto>();
        Assert.Equal((true, (AuthResponse?)null, email, "Jamie Carter", "google"), (asked.NeedsSignup, asked.Auth, asked.Email, asked.SuggestedName, asked.Provider));
        Assert.Null(await _f.WithDbAsync(db => db.Users.SingleOrDefaultAsync(u => u.Email == email)));

        var club = $"Google Club {Guid.NewGuid():N}"[..24];
        var created = await PostAsync(attempt, club, Roles.Trainer, "Jamie Carter");
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var auth = (await created.ReadAsync<ExternalAuthResultDto>()).Auth!;
        Assert.Equal((email, "Jamie Carter", club, true), (auth.User.Email, auth.User.FullName, auth.User.ClubName, auth.User.EmailConfirmed));
        Assert.Equal(new[] { Roles.Member, Roles.TrainerRequest }, auth.User.Roles.Order());

        var login = Assert.Single(await LoginsAsync(auth.User.Id));
        Assert.Equal(("google", attempt.Subject, "Google"), (login.LoginProvider, login.ProviderKey, login.ProviderDisplayName));
        await _f.InDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == auth.User.Id);
            Assert.Null(user.PasswordHash);
            // Counted by the per-network account limit like every other sign-up.
            Assert.True(await db.UserClaims.AnyAsync(c => c.UserId == user.Id && c.ClaimType == "created_ip"));
        });

        // Later sign-ins go straight in, and the token works like any other.
        var again = await SignInAsync(Google(email, attempt.Subject));
        Assert.Equal(auth.User.Id, again.User.Id);
        (await _f.WithToken(again.Token).GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
    }

    [Theory]
    [InlineData(Roles.Manager, new[] { Roles.ManagerRequest, Roles.Member })]
    [InlineData(Roles.Member, new[] { Roles.Member })]
    [InlineData(Roles.Admin, new[] { Roles.Member, Roles.TrainerRequest })]
    [InlineData(null, new[] { Roles.Member, Roles.TrainerRequest })]
    public async Task NewExternalAccountsAskForRolesTheWaySignUpDoes(string? role, string[] expected)
    {
        var attempt = Google(Gmail());
        var response = await PostAsync(attempt, "Role Club", role ?? "", "Role Tester");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(expected, (await response.ReadAsync<ExternalAuthResultDto>()).Auth!.User.Roles.Order());
    }

    [Fact]
    public async Task ATokenForTheSecondConfiguredClientIdIsAccepted()
    {
        var email = Gmail();
        var created = await CreateAsync(Google(email));
        var subject = (await LoginsAsync(created.User.Id)).Single().ProviderKey;

        var fromIos = await SignInAsync(Google(email, subject, audience: ExternalAuthFactory.GoogleIosClient));
        Assert.Equal(created.User.Id, fromIos.User.Id);
    }

    public static TheoryData<string> BadTokens => ["wrong-audience", "wrong-issuer", "expired", "bad-signature", "nonce-mismatch", "nonce-missing", "unknown-provider", "empty"];

    [Theory]
    [MemberData(nameof(BadTokens))]
    public async Task BadTokensAreRefusedWithOneAnswerAndCreateNothing(string kind)
    {
        var email = Gmail();
        var nonce = IdTokenSigner.NewNonce();
        using var impostor = new IdTokenSigner("google-test-key");
        string Sign(string issuer = IdTokenSigner.GoogleIssuer, string audience = ExternalAuthFactory.GoogleWebClient, DateTime? expires = null, IdTokenSigner? by = null)
            => (by ?? _f.Google).Sign(issuer, audience, "g-bad", email, nonce, true, expires: expires);
        var request = kind switch
        {
            "wrong-audience" => new ExternalAuthRequest("google", Sign(audience: "another-app.apps.googleusercontent.com"), nonce),
            "wrong-issuer" => new ExternalAuthRequest("google", Sign(issuer: "https://accounts.example.com"), nonce),
            "expired" => new ExternalAuthRequest("google", Sign(expires: DateTime.UtcNow.AddMinutes(-5)), nonce),
            "bad-signature" => new ExternalAuthRequest("google", Sign(by: impostor), nonce),
            "nonce-mismatch" => new ExternalAuthRequest("google", Sign(), IdTokenSigner.NewNonce()),
            "nonce-missing" => new ExternalAuthRequest("google", Sign(), null),
            "unknown-provider" => new ExternalAuthRequest("microsoft", Sign(), nonce),
            _ => new ExternalAuthRequest("google", "", nonce),
        };

        var response = await _f.CreateClient().PostAsJsonAsync("/api/auth/external", request with { ClubName = "Bad Token Club", Role = Roles.Member, FullName = "Bad" });
        await AssertRefusedAsync(response, HttpStatusCode.Unauthorized, "external_token");
        Assert.Contains("couldn't check that sign-in", await response.Content.ReadAsStringAsync());
        Assert.Null(await _f.WithDbAsync(db => db.Users.SingleOrDefaultAsync(u => u.Email == email)));
    }

    [Fact]
    public async Task BadAddressesAndSignUpDetailsAreRefused()
    {
        await AssertRefusedAsync(await PostAsync(Google("not-an-email")), HttpStatusCode.BadRequest, "email_invalid");
        // A throwaway inbox is refused before anyone fills in the form.
        var disposable = Google("rider@mailinator.com", extra: new Dictionary<string, object> { ["hd"] = "mailinator.com" });
        await AssertRefusedAsync(await PostAsync(disposable), HttpStatusCode.BadRequest, "email_disposable");

        var attempt = Google(Gmail());
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(attempt, new string('C', 101), Roles.Member, "Name")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(attempt, "Club", Roles.Member, new string('N', 101))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(attempt, "Club", Roles.Member, "Name")).StatusCode);
    }

    [Fact]
    public async Task NewAccountsCountTowardsTheNetworksAccountLimit()
    {
        using var limited = _f.WithWebHostBuilder(b => b.UseSetting("RateLimits:AccountsPerIp", "1"));
        var client = limited.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "203.0.113.77");

        var firstEmail = Gmail();
        var first = Google(firstEmail);
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(first, "Limit Club", Roles.Member, "First", client: client)).StatusCode);
        var second = Google(Gmail());
        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(second, "Limit Club", Roles.Member, "Second", client: client)).StatusCode);

        // Signing in to the account already made isn't a new account.
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(Google(firstEmail, first.Subject), client: client)).StatusCode);
    }

    // ---- Linking by email ----

    [Fact]
    public async Task AnUnverifiedAddressNeverLinksAndGetsTheSameAnswerWhetherOrNotAnAccountUsesIt()
    {
        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: true);

        var withAccount = await PostAsync(Google(email, verified: false));
        await AssertRefusedAsync(withAccount, HttpStatusCode.Unauthorized, "external_email_unverified");
        var withoutAccount = await PostAsync(Google(Gmail(), verified: false), "Club", Roles.Member, "Name");
        await AssertRefusedAsync(withoutAccount, HttpStatusCode.Unauthorized, "external_email_unverified");
        Assert.Equal(await withAccount.Content.ReadAsStringAsync(), await withoutAccount.Content.ReadAsStringAsync());

        Assert.Empty(await LoginsAsync(id));
    }

    [Fact]
    public async Task AVerifiedGmailAddressLinksToTheConfirmedAccountThatUsesIt()
    {
        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: true);
        var attempt = Google(email);

        var auth = await SignInAsync(attempt, providerName: "Not Used");
        Assert.Equal((id, "Pat Password"), (auth.User.Id, auth.User.FullName));
        Assert.Equal(("google", attempt.Subject), (await LoginsAsync(id)).Select(l => (l.LoginProvider, l.ProviderKey)).Single());

        // The password still works, and the link is used next time.
        (await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, Password))).EnsureSuccessStatusCode();
        Assert.Equal(id, (await SignInAsync(Google(email, attempt.Subject))).User.Id);
    }

    [Fact]
    public async Task AnUnconfirmedAccountIsNeverLinked_SoSomeoneWhoRegisteredYourAddressCantKeepAWayIn()
    {
        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: false);

        await AssertRefusedAsync(await PostAsync(Google(email)), HttpStatusCode.Conflict, "external_link_refused");
        await AssertRefusedAsync(await PostAsync(Google(email), "Club", Roles.Member, "Name"), HttpStatusCode.Conflict, "external_link_refused");
        Assert.Empty(await LoginsAsync(id));
        Assert.False(await _f.WithDbAsync(db => db.Users.Where(u => u.Id == id).Select(u => u.EmailConfirmed).SingleAsync()));
    }

    [Fact]
    public async Task AGoogleAccountIsLinkedByEmailOnlyWhenGoogleHostsTheAddress()
    {
        var (id, email) = await PasswordAccountAsync($"{Guid.NewGuid():N}"[..12] + "@ponyclub.example", confirmed: true);

        await AssertRefusedAsync(await PostAsync(Google(email)), HttpStatusCode.Conflict, "external_link_refused");
        Assert.Empty(await LoginsAsync(id));

        var workspace = Google(email, extra: new Dictionary<string, object> { ["hd"] = "ponyclub.example" });
        Assert.Equal(id, (await SignInAsync(workspace)).User.Id);
    }

    [Fact]
    public async Task ASecondGoogleIdentityWithTheSameAddressIsRefused()
    {
        var email = Gmail();
        var created = await CreateAsync(Google(email));

        await AssertRefusedAsync(await PostAsync(Google(email)), HttpStatusCode.Conflict, "external_other_login");
        Assert.Single(await LoginsAsync(created.User.Id));
    }

    [Fact]
    public async Task ALinkedAccountWithAnUnconfirmedAddressIsConfirmedByAGmailSignIn()
    {
        var email = Gmail();
        var attempt = Google(email);
        var created = await CreateAsync(attempt);
        await SetAsync(created.User.Id, u => u.EmailConfirmed = false);

        Assert.True((await SignInAsync(Google(email, attempt.Subject))).User.EmailConfirmed);
    }

    // ---- Accounts that may never sign in this way ----

    [Fact]
    public async Task AdminAccountsAreRefusedWhetherFoundByEmailOrByAnExistingLink()
    {
        // An organiser made through the admin key holds Admin.
        var email = Gmail();
        var made = await _f.CreateClient().PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Show Secretary", email, Password));
        made.EnsureSuccessStatusCode();
        var adminId = (await made.ReadAsync<AuthResponse>()).User.Id;
        await SetAsync(adminId, u => u.EmailConfirmed = true);

        var byEmail = await PostAsync(Google(email));
        await AssertRefusedAsync(byEmail, HttpStatusCode.Forbidden, "admin_password_only");
        Assert.Contains("email and password", await byEmail.Content.ReadAsStringAsync());
        Assert.Empty(await LoginsAsync(adminId));

        // The shared admin account is refused by its role, not by its address.
        var shared = Google(TestClients.AdminEmail, extra: new Dictionary<string, object> { ["hd"] = "mg.local" });
        await AssertRefusedAsync(await PostAsync(shared), HttpStatusCode.Forbidden, "admin_password_only");

        // An account linked before it became an admin can't use the link afterwards.
        var memberEmail = Gmail();
        var member = Google(memberEmail);
        var created = await CreateAsync(member);
        using (var scope = _f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var promoted = await users.AddToRolesAsync((await users.FindByIdAsync(created.User.Id))!, [Roles.Admin, Roles.MasterAdmin]);
            Assert.True(promoted.Succeeded);
        }
        await AssertRefusedAsync(await PostAsync(Google(memberEmail, member.Subject)), HttpStatusCode.Forbidden, "admin_password_only");
    }

    [Theory]
    [InlineData("locked", "account_stopped")]
    [InlineData("blocked", "account_stopped")]
    [InlineData("deleted", "account_stopped")]
    [InlineData("locked-out", "account_locked_out")]
    public async Task StoppedAccountsAreRefusedWhetherFoundByEmailOrByAnExistingLink(string state, string code)
    {
        Action<AppUser> stop = state switch
        {
            "locked" => u => u.LockedAt = DateTime.UtcNow,
            "blocked" => u => u.BlockedAt = DateTime.UtcNow,
            "deleted" => u => u.LockoutEnd = DateTimeOffset.MaxValue,
            _ => u => u.LockoutEnd = DateTimeOffset.UtcNow.AddMinutes(15),
        };

        var linkedEmail = Gmail();
        var linked = Google(linkedEmail);
        var created = await CreateAsync(linked);
        await SetAsync(created.User.Id, stop);
        await AssertRefusedAsync(await PostAsync(Google(linkedEmail, linked.Subject)), HttpStatusCode.Forbidden, code);

        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: true);
        await SetAsync(id, stop);
        await AssertRefusedAsync(await PostAsync(Google(email)), HttpStatusCode.Forbidden, code);
        Assert.Empty(await LoginsAsync(id));
    }

    [Fact]
    public async Task ATokenFromAProviderSignInStopsWorkingWhenTheAccountIsBlocked()
    {
        var auth = await CreateAsync(Google(Gmail()));
        var client = _f.WithToken(auth.Token);
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();

        await SetAsync(auth.User.Id, u => u.BlockedAt = DateTime.UtcNow);
        // Token checks read the account on every request, so the block holds at once.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task ABlockedNetworkIsRefusedEvenWithAGoodToken()
    {
        const string blockedIp = "198.51.100.199";
        await _f.InDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock
            {
                IpAddress = MountedGames.Api.Services.IpRetention.HashFor(_f.Services.GetRequiredService<IConfiguration>(), blockedIp),
                Reason = "Test block",
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        });
        var client = _f.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, blockedIp);

        var response = await PostAsync(Google(Gmail()), "Club", Roles.Member, "Name", client: client);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("network is blocked", await response.Content.ReadAsStringAsync());
    }

    // ---- Apple ----

    [Fact]
    public async Task ApplesFirstSignInNameIsOnlyASuggestionForANewAccount()
    {
        var email = $"{Guid.NewGuid():N}"[..12] + "@icloud.com";
        var attempt = Apple(email);

        var asked = await (await PostAsync(attempt, providerName: "  Sam \n Taylor ")).ReadAsync<ExternalAuthResultDto>();
        Assert.Equal((true, "Sam Taylor"), (asked.NeedsSignup, asked.SuggestedName));

        // Without a name typed in, the new account takes Apple's.
        var created = await PostAsync(attempt, "Apple Club", Roles.Member, fullName: null, providerName: "Sam Taylor");
        var auth = (await created.ReadAsync<ExternalAuthResultDto>()).Auth!;
        Assert.Equal("Sam Taylor", auth.User.FullName);

        // Afterwards a name sent with the token changes nothing and never picks the account.
        var later = await SignInAsync(Apple(email, attempt.Subject), providerName: "Someone Else");
        Assert.Equal((auth.User.Id, "Sam Taylor"), (later.User.Id, later.User.FullName));
        Assert.Equal("Sam Taylor", await _f.WithDbAsync(db => db.Users.Where(u => u.Id == auth.User.Id).Select(u => u.FullName).SingleAsync()));
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(Apple($"{Guid.NewGuid():N}"[..12] + "@icloud.com"), providerName: "Sam Taylor")).StatusCode);
    }

    [Fact]
    public async Task AppleHiddenAddressesNeverLinkByEmailAndSuggestNoName()
    {
        var relay = $"{Guid.NewGuid():N}"[..10] + "@privaterelay.appleid.com";
        var (id, _) = await PasswordAccountAsync(relay, confirmed: true);
        await AssertRefusedAsync(await PostAsync(Apple(relay, relay: true)), HttpStatusCode.Conflict, "external_link_refused");
        Assert.Empty(await LoginsAsync(id));

        var fresh = Apple($"{Guid.NewGuid():N}"[..10] + "@privaterelay.appleid.com", relay: true);
        var asked = await (await PostAsync(fresh)).ReadAsync<ExternalAuthResultDto>();
        Assert.Equal((true, ""), (asked.NeedsSignup, asked.SuggestedName));
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(fresh, "Relay Club", Roles.Member, fullName: "  ")).StatusCode);
        var created = await PostAsync(fresh, "Relay Club", Roles.Member, fullName: "Robin Hidden");
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        Assert.Equal("Robin Hidden", (await created.ReadAsync<ExternalAuthResultDto>()).Auth!.User.FullName);
    }

    [Fact]
    public async Task ARealAppleAddressLinksToTheConfirmedAccountThatUsesIt()
    {
        var (id, email) = await PasswordAccountAsync($"{Guid.NewGuid():N}"[..12] + "@icloud.com", confirmed: true);
        Assert.Equal(id, (await SignInAsync(Apple(email))).User.Id);
        Assert.Equal("apple", Assert.Single(await LoginsAsync(id)).LoginProvider);
    }
}
