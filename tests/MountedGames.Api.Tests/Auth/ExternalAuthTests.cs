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
/// Sign in with Google and Apple through the API, with the real token checks: tokens are signed by
/// <see cref="ExternalAuthFactory"/>'s local test keys, never by the providers. Covers sign-in, sign-up by ticket,
/// linking by email, Connect and Remove on My account, and deleting a passwordless account.
/// </summary>
public class ExternalAuthTests : IClassFixture<ExternalAuthFactory>
{
    private const string Password = "Passw0rd!x";
    private readonly ExternalAuthFactory _f;

    public ExternalAuthTests(ExternalAuthFactory f) => _f = f;

    private sealed record Attempt(string Provider, string Token, string Nonce, string Subject);

    private static string Gmail() => $"rider.{Guid.NewGuid():N}"[..20] + "@gmail.com";
    private static string ICloud() => $"{Guid.NewGuid():N}"[..12] + "@icloud.com";

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

    private Task<HttpResponseMessage> PostAsync(Attempt a, string? providerName = null, HttpClient? client = null)
        => (client ?? _f.CreateClient()).PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest(a.Provider, a.Token, a.Nonce, providerName));

    private Task<HttpResponseMessage> FinishAsync(string? ticket, string? club = "External Club", string? role = Roles.Member,
        string? fullName = "Alex Rider", HttpClient? client = null)
        => (client ?? _f.CreateClient()).PostAsJsonAsync("/api/auth/external/signup", new ExternalSignupRequest(ticket!, fullName, club, role));

    private async Task<ExternalAuthResultDto> AskAsync(Attempt a, string? providerName = null, HttpClient? client = null)
    {
        var response = await PostAsync(a, providerName, client);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.ReadAsync<ExternalAuthResultDto>();
        Assert.True(result.NeedsSignup);
        return result;
    }

    private async Task<AuthResponse> SignInAsync(Attempt a, string? providerName = null)
    {
        var response = await PostAsync(a, providerName);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.ReadAsync<ExternalAuthResultDto>();
        Assert.False(result.NeedsSignup);
        return result.Auth!;
    }

    private async Task<AuthResponse> CreateAsync(Attempt a, string role = Roles.Member, string? fullName = "Alex Rider", string? providerName = null)
    {
        var asked = await AskAsync(a, providerName);
        var response = await FinishAsync(asked.SignupTicket, $"External Club {Guid.NewGuid():N}"[..24], role, fullName);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<AuthResponse>();
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

    private async Task<HttpClient> PasswordClientAsync(string email)
    {
        var login = await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, Password));
        login.EnsureSuccessStatusCode();
        return _f.WithToken((await login.ReadAsync<AuthResponse>()).Token);
    }

    private Task SetAsync(string userId, Action<AppUser> change) => _f.InDbAsync(async db =>
    {
        change(await db.Users.SingleAsync(u => u.Id == userId));
        await db.SaveChangesAsync();
    });

    private Task<List<IdentityUserLogin<string>>> LoginsAsync(string userId)
        => _f.WithDbAsync(db => db.UserLogins.Where(l => l.UserId == userId).ToListAsync());

    private List<EmailApiFactory.SentMessage> SentTo(string email) => _f.Sent.Where(m => m.To == email).ToList();

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private static async Task AssertRefusedAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, await CodeAsync(response));
    }

    /// <summary>Connect, confirming with the test password unless told otherwise.</summary>
    private static Task<HttpResponseMessage> ConnectAsync(HttpClient client, Attempt a, ReauthRequest? confirm = null)
        => client.PostAsJsonAsync("/api/auth/logins", new ExternalConnectRequest(a.Provider, a.Token, a.Nonce, confirm ?? new ReauthRequest(Password)));

    private static Task<HttpResponseMessage> RemoveAsync(HttpClient client, string provider, ReauthRequest? confirm)
        => client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/auth/logins/{provider}")
        {
            Content = confirm is null ? null : JsonContent.Create(confirm),
        });

    /// <summary>Confirming with a fresh sign-in: the provider's token and raw nonce.</summary>
    private static ReauthRequest With(Attempt a) => new(Provider: a.Provider, IdToken: a.Token, Nonce: a.Nonce);

    /// <summary>A client carrying the new sign-in that Connect or Remove sent back. The old one has stopped working.</summary>
    private async Task<HttpClient> RenewedAsync(HttpResponseMessage changed)
    {
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        return _f.WithToken((await changed.ReadAsync<LinkedSignInsDto>()).Auth!.Token);
    }

    // ---- GET /api/auth/providers ----

    [Fact]
    public async Task ProvidersListsOnlyTheConfiguredOnesWithTheirWebClientId()
    {
        var providers = await (await _f.CreateClient().GetAsync("/api/auth/providers")).ReadAsync<List<ExternalProviderDto>>();
        Assert.Equal(
            new List<ExternalProviderDto>
            {
                new("google", "Google", ExternalAuthFactory.GoogleWebClient),
                new("apple", "Apple", ExternalAuthFactory.AppleServicesId),
                new("facebook", "Facebook", FakeFacebookGraph.AppId),
            },
            providers);

        // Apple stays off until it has a Services ID; with nothing configured, nothing is offered.
        using (var googleOnly = _f.WithWebHostBuilder(b => b.UseSetting("Auth:Apple:ClientIds:0", "").UseSetting("Auth:Facebook:AppId", "")))
        {
            var list = await (await googleOnly.CreateClient().GetAsync("/api/auth/providers")).ReadAsync<List<ExternalProviderDto>>();
            Assert.Equal("google", Assert.Single(list).Id);
            await AssertRefusedAsync(await PostAsync(Apple(ICloud()), client: googleOnly.CreateClient()), HttpStatusCode.Unauthorized, "external_token");
        }
        using var neither = _f.WithWebHostBuilder(b => b
            .UseSetting("Auth:Apple:ClientIds:0", "")
            .UseSetting("Auth:Google:ClientIds:0", "")
            .UseSetting("Auth:Google:ClientIds:1", "")
            .UseSetting("Auth:Facebook:AppSecret", ""));
        Assert.Empty(await (await neither.CreateClient().GetAsync("/api/auth/providers")).ReadAsync<List<ExternalProviderDto>>());
    }

    // ---- New accounts: ticket, then club and role ----

    [Fact]
    public async Task ANewGoogleUserGetsATicketThenTheSameRolesAsAnyOtherSignUp()
    {
        var email = Gmail();
        var attempt = Google(email, extra: new Dictionary<string, object> { ["name"] = "Jamie Carter" });

        var asked = await AskAsync(attempt);
        Assert.Equal((email, "Jamie Carter", "google"), (asked.Email, asked.SuggestedName, asked.Provider));
        Assert.False(string.IsNullOrEmpty(asked.SignupTicket));
        Assert.Null(await _f.WithDbAsync(db => db.Users.SingleOrDefaultAsync(u => u.Email == email)));

        // The token itself is spent: only the ticket finishes the account.
        await AssertRefusedAsync(await PostAsync(attempt), HttpStatusCode.Unauthorized, "external_token");

        var club = $"Google Club {Guid.NewGuid():N}"[..24];
        var created = await FinishAsync(asked.SignupTicket, club, Roles.Trainer, "Jamie Carter");
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var auth = await created.ReadAsync<AuthResponse>();
        Assert.Equal((email, "Jamie Carter", club, true), (auth.User.Email, auth.User.FullName, auth.User.ClubName, auth.User.EmailConfirmed));
        Assert.Equal(new[] { Roles.Member, Roles.TrainerRequest }, auth.User.Roles.Order());
        // Gmail is Google's own mailbox, so there's nothing to confirm and no email.
        Assert.Empty(SentTo(email));

        var login = Assert.Single(await LoginsAsync(auth.User.Id));
        Assert.Equal(("google", attempt.Subject, "Google"), (login.LoginProvider, login.ProviderKey, login.ProviderDisplayName));
        await _f.InDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == auth.User.Id);
            Assert.Null(user.PasswordHash);
            Assert.True(await db.UserClaims.AnyAsync(c => c.UserId == user.Id && c.ClaimType == "created_ip"));
        });

        // The ticket makes one account only.
        await AssertRefusedAsync(await FinishAsync(asked.SignupTicket), HttpStatusCode.Conflict, "external_account_exists");

        var again = await SignInAsync(Google(email, attempt.Subject));
        Assert.Equal(auth.User.Id, again.User.Id);
        (await _f.WithToken(again.Token).GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ANewAccountFromAnAddressTheProviderDoesntRunStartsUnconfirmedAndIsSentTheUsualEmail()
    {
        var email = $"{Guid.NewGuid():N}"[..12] + "@ponyclub.example";
        var auth = await CreateAsync(Google(email));
        Assert.False(auth.User.EmailConfirmed);
        Assert.Contains(SentTo(email), m => m.Subject == "Confirm your email address");
    }

    [Theory]
    [InlineData(Roles.Manager, new[] { Roles.ManagerRequest, Roles.Member })]
    [InlineData(Roles.Member, new[] { Roles.Member })]
    [InlineData(Roles.Admin, new[] { Roles.Member, Roles.TrainerRequest })]
    [InlineData("", new[] { Roles.Member, Roles.TrainerRequest })]
    public async Task NewExternalAccountsAskForRolesTheWaySignUpDoes(string role, string[] expected)
    {
        var asked = await AskAsync(Google(Gmail()));
        var response = await FinishAsync(asked.SignupTicket, "Role Club", role, "Role Tester");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(expected, (await response.ReadAsync<AuthResponse>()).User.Roles.Order());
    }

    [Fact]
    public async Task BadTicketsAndSignUpDetailsAreRefused()
    {
        await AssertRefusedAsync(await FinishAsync("not-a-ticket"), HttpStatusCode.Unauthorized, "external_ticket");
        Assert.Equal(HttpStatusCode.BadRequest, (await FinishAsync(null)).StatusCode);

        var asked = await AskAsync(Google(Gmail()));
        Assert.Equal(HttpStatusCode.BadRequest, (await FinishAsync(asked.SignupTicket, new string('C', 101))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await FinishAsync(asked.SignupTicket, club: " ")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await FinishAsync(asked.SignupTicket, fullName: new string('N', 101))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await FinishAsync(asked.SignupTicket)).StatusCode);

        // A ticket from a provider switched off since is no good.
        var apple = await AskAsync(Apple(ICloud()));
        using var appleOff = _f.WithWebHostBuilder(b => b.UseSetting("Auth:Apple:ClientIds:0", ""));
        await AssertRefusedAsync(await FinishAsync(apple.SignupTicket, client: appleOff.CreateClient()), HttpStatusCode.Unauthorized, "external_ticket");

        // The address was taken by someone else while the form was open.
        var email = Gmail();
        var late = await AskAsync(Google(email));
        await PasswordAccountAsync(email, confirmed: true);
        await AssertRefusedAsync(await FinishAsync(late.SignupTicket), HttpStatusCode.Conflict, "external_link_refused");
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

        var response = await _f.CreateClient().PostAsJsonAsync("/api/auth/external", request);
        await AssertRefusedAsync(response, HttpStatusCode.Unauthorized, "external_token");
        Assert.Contains("couldn't check that sign-in", await response.Content.ReadAsStringAsync());
        Assert.Null(await _f.WithDbAsync(db => db.Users.SingleOrDefaultAsync(u => u.Email == email)));
    }

    [Fact]
    public async Task ATokenAndNonceSignInOnce()
    {
        var email = Gmail();
        var first = Google(email);
        var created = await CreateAsync(first);
        var signIn = Google(email, first.Subject);

        Assert.Equal(created.User.Id, (await SignInAsync(signIn)).User.Id);
        await AssertRefusedAsync(await PostAsync(signIn), HttpStatusCode.Unauthorized, "external_token");
    }

    [Fact]
    public async Task BadAddressesAreRefusedBeforeAnyoneFillsInTheForm()
    {
        await AssertRefusedAsync(await PostAsync(Google("not-an-email")), HttpStatusCode.BadRequest, "email_invalid");
        var disposable = Google("rider@mailinator.com", extra: new Dictionary<string, object> { ["hd"] = "mailinator.com" });
        await AssertRefusedAsync(await PostAsync(disposable), HttpStatusCode.BadRequest, "email_disposable");
    }

    [Fact]
    public async Task ATokenForTheSecondConfiguredClientIdIsAccepted()
    {
        var email = Gmail();
        var first = Google(email);
        var created = await CreateAsync(first);
        var fromIos = await SignInAsync(Google(email, first.Subject, audience: ExternalAuthFactory.GoogleIosClient));
        Assert.Equal(created.User.Id, fromIos.User.Id);
    }

    [Fact]
    public async Task NewAccountsCountTowardsTheNetworksAccountLimit()
    {
        using var limited = _f.WithWebHostBuilder(b => b.UseSetting("RateLimits:AccountsPerIp", "1"));
        var client = limited.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "203.0.113.77");

        var firstEmail = Gmail();
        var first = Google(firstEmail);
        var firstTicket = (await AskAsync(first, client: client)).SignupTicket;
        Assert.Equal(HttpStatusCode.OK, (await FinishAsync(firstTicket, client: client)).StatusCode);
        var secondTicket = (await AskAsync(Google(Gmail()), client: client)).SignupTicket;
        Assert.Equal(HttpStatusCode.TooManyRequests, (await FinishAsync(secondTicket, client: client)).StatusCode);

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
        var withoutAccount = await PostAsync(Google(Gmail(), verified: false));
        await AssertRefusedAsync(withoutAccount, HttpStatusCode.Unauthorized, "external_email_unverified");
        Assert.Equal(await withAccount.Content.ReadAsStringAsync(), await withoutAccount.Content.ReadAsStringAsync());

        Assert.Empty(await LoginsAsync(id));
    }

    [Fact]
    public async Task AVerifiedGmailAddressLinksToTheConfirmedAccountAndTellsIt()
    {
        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: true);
        var attempt = Google(email);

        var auth = await SignInAsync(attempt, providerName: "Not Used");
        Assert.Equal((id, "Pat Password"), (auth.User.Id, auth.User.FullName));
        Assert.Equal(("google", attempt.Subject), (await LoginsAsync(id)).Select(l => (l.LoginProvider, l.ProviderKey)).Single());

        var notice = Assert.Single(SentTo(email), m => m.Subject == "Google sign-in added to your account");
        Assert.Contains("You can now sign in with Google", notice.Text);
        Assert.Contains($"{EmailApiFactory.SiteUrl}/me/account", notice.Text);
        Assert.DoesNotContain(_f.Logs, line => line.Contains(email, StringComparison.OrdinalIgnoreCase));

        // The password still works, and the link is used next time, with no second email.
        (await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, Password))).EnsureSuccessStatusCode();
        Assert.Equal(id, (await SignInAsync(Google(email, attempt.Subject))).User.Id);
        Assert.Single(SentTo(email), m => m.Subject == "Google sign-in added to your account");
    }

    [Fact]
    public async Task AnUnconfirmedAccountIsNeverLinked_SoSomeoneWhoRegisteredYourAddressCantKeepAWayIn()
    {
        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: false);

        var refused = await PostAsync(Google(email));
        await AssertRefusedAsync(refused, HttpStatusCode.Conflict, "external_link_refused");
        Assert.Contains("then add Google from My account", await refused.Content.ReadAsStringAsync());
        Assert.Empty(await LoginsAsync(id));
        Assert.False(await _f.WithDbAsync(db => db.Users.Where(u => u.Id == id).Select(u => u.EmailConfirmed).SingleAsync()));
    }

    [Fact]
    public async Task AGoogleAccountIsLinkedByEmailOnlyWhenGoogleRunsTheMailbox()
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
        var email = Gmail();
        var made = await _f.CreateClient().PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Show Secretary", email, Password));
        made.EnsureSuccessStatusCode();
        var admin = await made.ReadAsync<AuthResponse>();
        await SetAsync(admin.User.Id, u => u.EmailConfirmed = true);

        var byEmail = await PostAsync(Google(email));
        await AssertRefusedAsync(byEmail, HttpStatusCode.Forbidden, "admin_password_only");
        Assert.Contains("email and password", await byEmail.Content.ReadAsStringAsync());
        Assert.Empty(await LoginsAsync(admin.User.Id));

        // An admin can't add one from My account either.
        await AssertRefusedAsync(await ConnectAsync(_f.WithToken(admin.Token), Google(Gmail())), HttpStatusCode.Forbidden, "admin_password_only");

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
    [InlineData("locked")]
    [InlineData("blocked")]
    [InlineData("deleted")]
    public async Task StoppedAccountsAreRefusedWhetherFoundByEmailOrByAnExistingLink(string state)
    {
        Action<AppUser> stop = state switch
        {
            "locked" => u => u.LockedAt = DateTime.UtcNow,
            "blocked" => u => u.BlockedAt = DateTime.UtcNow,
            _ => u => u.LockoutEnd = DateTimeOffset.MaxValue,
        };

        var linkedEmail = Gmail();
        var linked = Google(linkedEmail);
        var created = await CreateAsync(linked);
        await SetAsync(created.User.Id, stop);
        await AssertRefusedAsync(await PostAsync(Google(linkedEmail, linked.Subject)), HttpStatusCode.Forbidden, "account_stopped");

        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: true);
        await SetAsync(id, stop);
        await AssertRefusedAsync(await PostAsync(Google(email)), HttpStatusCode.Forbidden, "account_stopped");
        Assert.Empty(await LoginsAsync(id));
    }

    [Fact]
    public async Task WrongPasswordsDontStopProviderSignIn_SoNobodyCanLockTheOwnerOut()
    {
        var linkedEmail = Gmail();
        var linked = Google(linkedEmail);
        var created = await CreateAsync(linked);
        await SetAsync(created.User.Id, u => u.LockoutEnd = DateTimeOffset.UtcNow.AddMinutes(15));
        Assert.Equal(created.User.Id, (await SignInAsync(Google(linkedEmail, linked.Subject))).User.Id);

        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: true);
        for (var i = 0; i < 5; i++)
            await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "wrong-password-1A!"));
        Assert.Equal(id, (await SignInAsync(Google(email))).User.Id);
        // The password itself stays locked.
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, Password))).StatusCode);
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
    public async Task ABlockedNetworkIsRefusedEvenWithAGoodTokenOrTicket()
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
        var ticket = (await AskAsync(Google(Gmail()))).SignupTicket;
        var client = _f.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, blockedIp);

        var response = await PostAsync(Google(Gmail()), client: client);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("network is blocked", await response.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Forbidden, (await FinishAsync(ticket, client: client)).StatusCode);
    }

    // ---- Apple ----

    [Fact]
    public async Task ApplesFirstSignInNameIsOnlyASuggestionForANewAccount()
    {
        var email = ICloud();
        var attempt = Apple(email);

        var asked = await AskAsync(attempt, providerName: "  Sam \n Taylor ");
        Assert.Equal("Sam Taylor", asked.SuggestedName);

        // Without a name typed in, the new account takes Apple's.
        var auth = await (await FinishAsync(asked.SignupTicket, fullName: null)).ReadAsync<AuthResponse>();
        Assert.Equal("Sam Taylor", auth.User.FullName);
        Assert.True(auth.User.EmailConfirmed);

        // Afterwards a name sent with the token changes nothing and never picks the account.
        var later = await SignInAsync(Apple(email, attempt.Subject), providerName: "Someone Else");
        Assert.Equal((auth.User.Id, "Sam Taylor"), (later.User.Id, later.User.FullName));
        Assert.Equal("Sam Taylor", await _f.WithDbAsync(db => db.Users.Where(u => u.Id == auth.User.Id).Select(u => u.FullName).SingleAsync()));
    }

    [Fact]
    public async Task AppleHiddenAddressesNeverLinkByEmailSuggestNoNameAndStartConfirmed()
    {
        var relay = $"{Guid.NewGuid():N}"[..10] + "@privaterelay.appleid.com";
        var (id, _) = await PasswordAccountAsync(relay, confirmed: true);
        await AssertRefusedAsync(await PostAsync(Apple(relay, relay: true)), HttpStatusCode.Conflict, "external_link_refused");
        Assert.Empty(await LoginsAsync(id));

        var freshRelay = $"{Guid.NewGuid():N}"[..10] + "@privaterelay.appleid.com";
        var asked = await AskAsync(Apple(freshRelay, relay: true));
        Assert.Equal("", asked.SuggestedName);
        Assert.Equal(HttpStatusCode.BadRequest, (await FinishAsync(asked.SignupTicket, fullName: "  ")).StatusCode);
        var created = await FinishAsync(asked.SignupTicket, fullName: "Robin Hidden");
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var user = (await created.ReadAsync<AuthResponse>()).User;
        // Apple runs the relay and made it for this person, so the new account starts confirmed and no email goes out.
        Assert.Equal(("Robin Hidden", true), (user.FullName, user.EmailConfirmed));
        Assert.DoesNotContain(SentTo(freshRelay), m => m.Subject == "Confirm your email address");
    }

    [Fact]
    public async Task AnICloudAddressLinksToTheConfirmedAccountThatUsesItButNoOtherAppleAddressDoes()
    {
        var (id, email) = await PasswordAccountAsync(ICloud(), confirmed: true);
        Assert.Equal(id, (await SignInAsync(Apple(email))).User.Id);
        Assert.Equal("apple", Assert.Single(await LoginsAsync(id)).LoginProvider);
        Assert.Single(SentTo(email), m => m.Subject == "Apple sign-in added to your account");

        // Apple only verified this one once; it doesn't run the mailbox.
        var (otherId, other) = await PasswordAccountAsync($"{Guid.NewGuid():N}"[..12] + "@btinternet.example", confirmed: true);
        var refused = await PostAsync(Apple(other));
        await AssertRefusedAsync(refused, HttpStatusCode.Conflict, "external_link_refused");
        Assert.Contains("then add Apple from My account", await refused.Content.ReadAsStringAsync());
        Assert.Empty(await LoginsAsync(otherId));
    }

    // ---- My account: list, connect, remove ----

    [Fact]
    public async Task ASignedInPersonCanConnectGoogleWhateverItsAddressAndIsTold()
    {
        var (id, email) = await PasswordAccountAsync($"{Guid.NewGuid():N}"[..12] + "@ponyclub.example", confirmed: true);
        var client = await PasswordClientAsync(email);
        var before = await (await client.GetAsync("/api/auth/logins")).ReadAsync<LinkedSignInsDto>();
        Assert.True(before.HasPassword);
        Assert.Empty(before.Logins);
        Assert.Null(before.Auth);

        var attempt = Google("someone.else@gmail.com");
        var connected = await ConnectAsync(client, attempt);
        Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
        var list = await connected.ReadAsync<LinkedSignInsDto>();
        Assert.True(list.HasPassword);
        Assert.Equal(new LinkedSignInDto("google", "Google"), Assert.Single(list.Logins));
        Assert.Equal(id, list.Auth!.User.Id);
        Assert.Single(SentTo(email), m => m.Subject == "Google sign-in added to your account");

        // Every older session ended; this device carries on with the sign-in that came back.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        client = _f.WithToken(list.Auth.Token);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/auth/me")).StatusCode);

        // It now signs in to this account, though the addresses differ.
        Assert.Equal(id, (await SignInAsync(Google("someone.else@gmail.com", attempt.Subject))).User.Id);

        // Connecting the same one again changes nothing; a used token, a second Google or someone else's is refused.
        var again = await ConnectAsync(client, Google("someone.else@gmail.com", attempt.Subject));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Null((await again.ReadAsync<LinkedSignInsDto>()).Auth);
        await AssertRefusedAsync(await ConnectAsync(client, attempt), HttpStatusCode.Unauthorized, "external_token");
        await AssertRefusedAsync(await ConnectAsync(client, Google(Gmail())), HttpStatusCode.Conflict, "external_other_login");
        var (_, otherEmail) = await PasswordAccountAsync(Gmail(), confirmed: true);
        await AssertRefusedAsync(await ConnectAsync(await PasswordClientAsync(otherEmail), Google("x@gmail.com", attempt.Subject)),
            HttpStatusCode.Conflict, "external_login_taken");
        Assert.Single(SentTo(email), m => m.Subject == "Google sign-in added to your account");

        Assert.Equal(HttpStatusCode.Unauthorized, (await ConnectAsync(_f.CreateClient(), Google(Gmail()))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync("/api/auth/logins")).StatusCode);
    }

    [Fact]
    public async Task ConnectingNeedsThePasswordOrAFreshSignInWithALinkedProvider_NotJustTheSession()
    {
        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: true);
        var client = await PasswordClientAsync(email);
        var attempt = Google(Gmail());
        await AssertRefusedAsync(await ConnectAsync(client, attempt, new ReauthRequest()), HttpStatusCode.BadRequest, "confirm_with_password");
        await AssertRefusedAsync(await client.PostAsJsonAsync("/api/auth/logins", new ExternalConnectRequest(attempt.Provider, attempt.Token, attempt.Nonce)),
            HttpStatusCode.BadRequest, "confirm_with_password");
        await AssertRefusedAsync(await ConnectAsync(client, attempt, new ReauthRequest("Wrong-passw0rd!")), HttpStatusCode.BadRequest, "wrong_password");
        // A password account can't confirm with a provider sign-in instead.
        await AssertRefusedAsync(await ConnectAsync(client, attempt, With(Google(Gmail()))), HttpStatusCode.BadRequest, "confirm_with_password");
        Assert.Empty(await LoginsAsync(id));
        Assert.DoesNotContain(SentTo(email), m => m.Subject.Contains("sign-in added"));
        // The refusals didn't use the token up.
        Assert.Equal(HttpStatusCode.OK, (await ConnectAsync(client, attempt)).StatusCode);

        // A passwordless account confirms with a fresh sign-in from a provider it already has, and only that.
        var first = Google(Gmail());
        var social = _f.WithToken((await CreateAsync(first)).Token);
        var apple = Apple(ICloud());
        await AssertRefusedAsync(await ConnectAsync(social, apple, new ReauthRequest(Password)), HttpStatusCode.BadRequest, "confirm_with_provider");
        await AssertRefusedAsync(await ConnectAsync(social, apple, With(Google(Gmail()))), HttpStatusCode.BadRequest, "external_wrong_account");
        await AssertRefusedAsync(await ConnectAsync(social, apple, With(Apple(ICloud()))), HttpStatusCode.BadRequest, "external_wrong_account");
        var confirm = Google(Gmail(), first.Subject);
        social = await RenewedAsync(await ConnectAsync(social, apple, With(confirm)));
        // That confirmation works once.
        await AssertRefusedAsync(await RemoveAsync(social, "apple", With(confirm)), HttpStatusCode.BadRequest, "external_token");
        Assert.Equal(2, (await (await social.GetAsync("/api/auth/logins")).ReadAsync<LinkedSignInsDto>()).Logins.Count);
    }

    [Fact]
    public async Task ALinkCanBeRemovedButNeverTheLastWayIn()
    {
        // A password account with Google: Google can go, with the password, and the address is told.
        var (id, email) = await PasswordAccountAsync(Gmail(), confirmed: true);
        var client = await RenewedAsync(await ConnectAsync(await PasswordClientAsync(email), Google(email)));
        await AssertRefusedAsync(await RemoveAsync(client, "google", null), HttpStatusCode.BadRequest, "confirm_with_password");
        await AssertRefusedAsync(await RemoveAsync(client, "google", new ReauthRequest()), HttpStatusCode.BadRequest, "confirm_with_password");
        await AssertRefusedAsync(await RemoveAsync(client, "google", new ReauthRequest("Wrong-passw0rd!")), HttpStatusCode.BadRequest, "wrong_password");
        Assert.Single(await LoginsAsync(id));
        Assert.DoesNotContain(SentTo(email), m => m.Subject == "Google sign-in removed from your account");

        var removed = await RemoveAsync(client, "google", new ReauthRequest(Password));
        Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        var afterRemove = await removed.ReadAsync<LinkedSignInsDto>();
        Assert.Empty(afterRemove.Logins);
        Assert.Empty(await LoginsAsync(id));
        Assert.Single(SentTo(email), m => m.Subject == "Google sign-in removed from your account");
        // Every older session ended; this device carries on with the sign-in that came back.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        client = _f.WithToken(afterRemove.Auth!.Token);
        Assert.Equal(HttpStatusCode.NotFound, (await RemoveAsync(client, "google", new ReauthRequest(Password))).StatusCode);

        // A Google-only account can't remove Google, but can once Apple is there too.
        var first = Google(Gmail());
        var googleOnly = await CreateAsync(first);
        var social = _f.WithToken(googleOnly.Token);
        Assert.False((await (await social.GetAsync("/api/auth/logins")).ReadAsync<LinkedSignInsDto>()).HasPassword);
        var last = await RemoveAsync(social, "google", With(Google(Gmail(), first.Subject)));
        await AssertRefusedAsync(last, HttpStatusCode.Conflict, "last_sign_in");
        Assert.Contains("only way you can sign in", await last.Content.ReadAsStringAsync());

        var apple = Apple(ICloud());
        social = await RenewedAsync(await ConnectAsync(social, apple, With(Google(Gmail(), first.Subject))));
        await AssertRefusedAsync(await RemoveAsync(social, "google", null), HttpStatusCode.BadRequest, "confirm_with_provider");
        // Confirmed with Apple, the other way in.
        var afterApple = await (await RemoveAsync(social, "google", With(Apple(ICloud(), apple.Subject)))).ReadAsync<LinkedSignInsDto>();
        Assert.Equal("apple", Assert.Single(afterApple.Logins).Provider);
        social = _f.WithToken(afterApple.Auth!.Token);
        await AssertRefusedAsync(await RemoveAsync(social, "apple", With(Apple(ICloud(), apple.Subject))), HttpStatusCode.Conflict, "last_sign_in");
    }

    // ---- Deleting a passwordless account ----

    private static Task<HttpResponseMessage> DeleteAsync(HttpClient client, DeleteAccountRequest req)
        => client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me") { Content = JsonContent.Create(req) });

    [Fact]
    public async Task APasswordlessAccountIsDeletedByAFreshSignInWithItsOwnProvider()
    {
        var email = Gmail();
        var first = Google(email);
        var auth = await CreateAsync(first);
        var client = _f.WithToken(auth.Token);

        await AssertRefusedAsync(await DeleteAsync(client, new DeleteAccountRequest()), HttpStatusCode.BadRequest, "confirm_with_provider");
        await AssertRefusedAsync(await DeleteAsync(client, new DeleteAccountRequest(Password: "anything")), HttpStatusCode.BadRequest, "confirm_with_provider");
        var stale = Google(email, first.Subject);
        await AssertRefusedAsync(await DeleteAsync(client, new DeleteAccountRequest(Provider: "google", IdToken: stale.Token, Nonce: IdTokenSigner.NewNonce())),
            HttpStatusCode.BadRequest, "external_token");
        // Someone else's Google account doesn't stand in for this one.
        var other = Google(Gmail());
        await AssertRefusedAsync(await DeleteAsync(client, new DeleteAccountRequest(Provider: "google", IdToken: other.Token, Nonce: other.Nonce)),
            HttpStatusCode.BadRequest, "external_wrong_account");
        Assert.NotNull(await _f.WithDbAsync(db => db.Users.SingleOrDefaultAsync(u => u.Id == auth.User.Id && u.Email == email)));

        var confirm = Google(email, first.Subject);
        Assert.Equal(HttpStatusCode.NoContent,
            (await DeleteAsync(client, new DeleteAccountRequest(Provider: "google", IdToken: confirm.Token, Nonce: confirm.Nonce))).StatusCode);
        Assert.Empty(await LoginsAsync(auth.User.Id));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task AnAccountWithAPasswordStillNeedsThePassword()
    {
        var (_, email) = await PasswordAccountAsync(Gmail(), confirmed: true);
        var client = await PasswordClientAsync(email);
        var google = Google(email);
        client = await RenewedAsync(await ConnectAsync(client, google));

        var confirm = Google(email, google.Subject);
        var refused = await DeleteAsync(client, new DeleteAccountRequest(Provider: "google", IdToken: confirm.Token, Nonce: confirm.Nonce));
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("current password", await refused.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteAsync(client, new DeleteAccountRequest(Password))).StatusCode);
    }
}
