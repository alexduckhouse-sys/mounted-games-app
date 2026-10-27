using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// Facebook Login: the access token is checked with Facebook's Graph API (played by <see cref="FakeFacebookGraph"/>),
/// its email is never trusted for linking, and the data deletion callback only acts on a request signed with our secret.
/// </summary>
public class FacebookSignInTests : IClassFixture<ExternalAuthFactory>
{
    private const string Password = "Passw0rd!x";
    private readonly ExternalAuthFactory _f;

    public FacebookSignInTests(ExternalAuthFactory f) => _f = f;

    private string Token(string? email = null, string? id = null, string? name = "Sam Rider", Func<FakeFacebookGraph.User, FakeFacebookGraph.User>? change = null)
    {
        var user = new FakeFacebookGraph.User(id ?? FakeFacebookGraph.NewUserId(), name, email);
        return _f.Facebook.Issue(change is null ? user : change(user));
    }

    private Task<HttpResponseMessage> PostAsync(string token, HttpClient? client = null)
        => (client ?? _f.CreateClient()).PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("facebook", token));

    private Task<HttpResponseMessage> FinishAsync(string? ticket, string? email = null)
        => _f.CreateClient().PostAsJsonAsync("/api/auth/external/signup", new ExternalSignupRequest(ticket!, "Sam Rider", "Facebook Club", Roles.Member, email));

    private async Task<ExternalAuthResultDto> AskAsync(string token)
    {
        var response = await PostAsync(token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.ReadAsync<ExternalAuthResultDto>();
        Assert.True(result.NeedsSignup);
        return result;
    }

    private async Task<(AuthResponse Auth, string FacebookId)> CreateAsync(string email)
    {
        var id = FakeFacebookGraph.NewUserId();
        var asked = await AskAsync(Token(email, id));
        var created = await FinishAsync(asked.SignupTicket);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        return (await created.ReadAsync<AuthResponse>(), id);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private static string Email() => $"fb.{Guid.NewGuid():N}"[..16] + "@example.org";

    private Task<List<IdentityUserLogin<string>>> LoginsAsync(string userId)
        => _f.WithDbAsync(db => db.UserLogins.Where(l => l.UserId == userId).ToListAsync());

    [Fact]
    public async Task FacebookIsOfferedWithItsAppIdOnly_AndOnlyWhenTheSecretIsSetToo()
    {
        var response = await _f.CreateClient().GetAsync("/api/auth/providers");
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(new ExternalProviderDto("facebook", "Facebook", FakeFacebookGraph.AppId), await response.ReadAsync<List<ExternalProviderDto>>());
        Assert.DoesNotContain(FakeFacebookGraph.AppSecret, body);

        foreach (var missing in new[] { "Auth:Facebook:AppId", "Auth:Facebook:AppSecret" })
        {
            using var host = _f.WithWebHostBuilder(b => b.UseSetting(missing, ""));
            var list = await (await host.CreateClient().GetAsync("/api/auth/providers")).ReadAsync<List<ExternalProviderDto>>();
            Assert.DoesNotContain(list, p => p.Id == "facebook");
            Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(Token(Email()), host.CreateClient())).StatusCode);
        }
    }

    [Fact]
    public async Task ANewFacebookUserGetsAnUnconfirmedAccountAndTheUsualEmail()
    {
        var email = Email();
        var id = FakeFacebookGraph.NewUserId();
        var token = Token(email, id);

        var asked = await AskAsync(token);
        Assert.Equal((email, "Sam Rider", "facebook"), (asked.Email, asked.SuggestedName, asked.Provider));

        var created = await FinishAsync(asked.SignupTicket);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var auth = await created.ReadAsync<AuthResponse>();
        Assert.Equal((email, false), (auth.User.Email, auth.User.EmailConfirmed));
        Assert.Contains(_f.Sent, m => m.To == email && m.Subject == "Confirm your email address");
        Assert.Equal(("facebook", id, "Facebook"), (await LoginsAsync(auth.User.Id)).Select(l => (l.LoginProvider, l.ProviderKey, l.ProviderDisplayName)).Single());

        // Every Graph call carried the proof made with our secret (the fake refuses any that doesn't).
        var graphCalls = _f.Http.Requests.Where(r => r.Contains("graph.facebook.com/v23.0/", StringComparison.Ordinal)).ToList();
        Assert.Contains(graphCalls, r => r.Contains("/debug_token?") && r.Contains($"appsecret_proof={FacebookApp.Proof($"{FakeFacebookGraph.AppId}|{FakeFacebookGraph.AppSecret}", FakeFacebookGraph.AppSecret)}"));
        Assert.Contains(graphCalls, r => r.Contains("/me?") && r.Contains($"appsecret_proof={FacebookApp.Proof(token, FakeFacebookGraph.AppSecret)}"));

        // The same token works once; a new one signs straight in.
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(token)).StatusCode);
        var again = await (await PostAsync(Token(email, id))).ReadAsync<ExternalAuthResultDto>();
        Assert.Equal(auth.User.Id, again.Auth!.User.Id);
    }

    [Fact]
    public async Task WithoutAnEmailFromFacebookTheNewAccountAsksForOne()
    {
        var asked = await AskAsync(Token(email: null));
        Assert.Equal("", asked.Email ?? "");

        Assert.Equal("email_invalid", await CodeAsync(await FinishAsync(asked.SignupTicket)));
        Assert.Equal("email_disposable", await CodeAsync(await FinishAsync(asked.SignupTicket, "rider@mailinator.com")));
        _f.Domains.Set("no-mail.example", MountedGames.Api.Services.Email.DomainMail.NoMail);
        Assert.Equal("email_domain", await CodeAsync(await FinishAsync(asked.SignupTicket, "rider@no-mail.example")));
        var (_, taken) = await PasswordAccountAsync(Email());
        Assert.Equal("external_link_refused", await CodeAsync(await FinishAsync(asked.SignupTicket, taken)));

        var email = Email();
        var created = await FinishAsync(asked.SignupTicket, $"  {email.ToUpperInvariant()} ");
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var user = (await created.ReadAsync<AuthResponse>()).User;
        Assert.Equal((email, false), (user.Email, user.EmailConfirmed));
    }

    private async Task<(string Id, string Email)> PasswordAccountAsync(string email)
    {
        var response = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(email, Password, Roles.Member, "Password Club", "Pat Password"));
        response.EnsureSuccessStatusCode();
        var auth = await response.ReadAsync<AuthResponse>();
        await _f.InDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == auth.User.Id)).EmailConfirmed = true;
            await db.SaveChangesAsync();
        });
        return (auth.User.Id, email);
    }

    [Fact]
    public async Task AFacebookEmailNeverOpensAnExistingAccount()
    {
        var (id, email) = await PasswordAccountAsync(Email());
        var refused = await PostAsync(Token(email));
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("external_link_refused", await CodeAsync(refused));
        Assert.Contains("then add Facebook from My account", await refused.Content.ReadAsStringAsync());
        Assert.Empty(await LoginsAsync(id));

        // Signed in, the same person can add Facebook, and their address is told.
        var login = await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, Password));
        var client = _f.WithToken((await login.ReadAsync<AuthResponse>()).Token);
        var facebookId = FakeFacebookGraph.NewUserId();
        var connected = await client.PostAsJsonAsync("/api/auth/logins", new ExternalConnectRequest("facebook", Token(email, facebookId)));
        Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
        Assert.Contains(new LinkedSignInDto("facebook", "Facebook"), (await connected.ReadAsync<LinkedSignInsDto>()).Logins);
        Assert.Contains(_f.Sent, m => m.To == email && m.Subject == "Facebook sign-in added to your account");
        Assert.Equal(id, (await (await PostAsync(Token(email, facebookId))).ReadAsync<ExternalAuthResultDto>()).Auth!.User.Id);
    }

    public static TheoryData<string> BadTokens => ["unknown", "wrong-app", "invalid", "expired", "no-expiry", "page-token", "no-profile-scope", "me-mismatch", "outage", "unreachable", "empty", "spaces"];

    [Theory]
    [MemberData(nameof(BadTokens))]
    public async Task BadFacebookTokensAreRefusedWithOneAnswer(string kind)
    {
        var email = Email();
        var token = kind switch
        {
            "unknown" => "EAATnot-issued-by-facebook",
            "wrong-app" => Token(email, change: u => u with { AppId = "999" }),
            "invalid" => Token(email, change: u => u with { Valid = false }),
            "expired" => Token(email, change: u => u with { Expires = DateTimeOffset.UtcNow.AddMinutes(-1) }),
            "no-expiry" => Token(email, change: u => u with { Expires = DateTimeOffset.UnixEpoch }),
            "page-token" => Token(email, change: u => u with { Type = "PAGE" }),
            "no-profile-scope" => Token(email, change: u => u with { Scopes = ["email"] }),
            "me-mismatch" => Token(email, change: u => u with { MeId = "someone-else" }),
            "spaces" => "EAAT has spaces",
            "empty" => "",
            _ => Token(email),
        };
        if (kind == "outage") _f.Facebook.Outage = HttpStatusCode.ServiceUnavailable;
        _f.Facebook.Unreachable = kind == "unreachable";
        try
        {
            var response = await PostAsync(token);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal("external_token", await CodeAsync(response));
            Assert.Null(await _f.WithDbAsync(db => db.Users.SingleOrDefaultAsync(u => u.Email == email)));
        }
        finally
        {
            _f.Facebook.Outage = null;
            _f.Facebook.Unreachable = false;
        }
    }

    [Fact]
    public async Task AdminsAndStoppedAccountsAreRefusedThroughFacebookToo()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        using (var scope = _f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            await users.AddToRoleAsync((await users.FindByIdAsync(auth.User.Id))!, Roles.Admin);
        }
        var refused = await PostAsync(Token(auth.User.Email, facebookId));
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("admin_password_only", await CodeAsync(refused));

        var (blocked, blockedId) = await CreateAsync(Email());
        await _f.InDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == blocked.User.Id)).BlockedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });
        Assert.Equal("account_stopped", await CodeAsync(await PostAsync(Token(blocked.User.Email, blockedId))));
    }

    [Fact]
    public async Task AFacebookOnlyAccountIsDeletedByAFreshFacebookSignIn()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        var client = _f.WithToken(auth.Token);
        var request = new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me")
        {
            Content = JsonContent.Create(new DeleteAccountRequest(Provider: "facebook", IdToken: Token(auth.User.Email, facebookId))),
        };
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(request)).StatusCode);
        Assert.Empty(await LoginsAsync(auth.User.Id));
    }

    // ---- Data deletion callback ----

    private static string SignedRequest(object payload, string secret = FakeFacebookGraph.AppSecret)
    {
        var body = WebEncoders.Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(payload));
        var signature = WebEncoders.Base64UrlEncode(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.ASCII.GetBytes(body)));
        return $"{signature}.{body}";
    }

    private Task<HttpResponseMessage> DeletionAsync(string? signedRequest, HttpClient? client = null)
        => (client ?? _f.CreateClient()).PostAsync("/api/auth/facebook/data-deletion",
            new FormUrlEncodedContent(signedRequest is null ? [] : [new("signed_request", signedRequest)]));

    [Fact]
    public async Task ASignedDeletionRequestRemovesTheFacebookLinkAndAnswersAsFacebookAsks()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        var response = await DeletionAsync(SignedRequest(new { algorithm = "HMAC-SHA256", issued_at = 1_700_000_000, user_id = facebookId }));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var code = body.RootElement.GetProperty("confirmation_code").GetString()!;
        Assert.Matches("^[0-9a-f]{16}$", code);
        Assert.Equal($"{EmailApiFactory.SiteUrl}/data-deletion?code={code}", body.RootElement.GetProperty("url").GetString());
        Assert.Empty(await LoginsAsync(auth.User.Id));
        Assert.DoesNotContain(_f.Logs, line => line.Contains(facebookId, StringComparison.Ordinal));

        // Someone Facebook doesn't know us for gets the same kind of answer.
        Assert.Equal(HttpStatusCode.OK, (await DeletionAsync(SignedRequest(new { algorithm = "HMAC-SHA256", user_id = "424242" }))).StatusCode);
    }

    [Fact]
    public async Task AnUnsignedOrForgedDeletionRequestChangesNothing()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        var forged = new[]
        {
            SignedRequest(new { algorithm = "HMAC-SHA256", user_id = facebookId }, "not-our-secret-0123456789"),
            SignedRequest(new { algorithm = "none", user_id = facebookId }),
            SignedRequest(new { algorithm = "HMAC-SHA256" }),
            SignedRequest(new { algorithm = "HMAC-SHA256", user_id = facebookId }).Split('.')[1],
            "!!!." + SignedRequest(new { algorithm = "HMAC-SHA256", user_id = facebookId }).Split('.')[1],
            "",
        };
        foreach (var request in forged)
            Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(request)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(null)).StatusCode);
        Assert.Single(await LoginsAsync(auth.User.Id));

        using var off = _f.WithWebHostBuilder(b => b.UseSetting("Auth:Facebook:AppSecret", ""));
        Assert.Equal(HttpStatusCode.NotFound,
            (await DeletionAsync(SignedRequest(new { algorithm = "HMAC-SHA256", user_id = facebookId }), off.CreateClient())).StatusCode);
    }

    [Fact]
    public void SignedRequestsAndSettingsAreReadStrictly()
    {
        Assert.Null(FacebookSignedRequest.UserIdFrom(new string('a', 5000), "s"));
        Assert.Null(FacebookSignedRequest.UserIdFrom("a.b.c", "s"));
        Assert.Null(FacebookSignedRequest.UserIdFrom(".b", "s"));
        var notJson = WebEncoders.Base64UrlEncode("not json"u8.ToArray());
        var signature = WebEncoders.Base64UrlEncode(HMACSHA256.HashData("s"u8.ToArray(), Encoding.ASCII.GetBytes(notJson)));
        Assert.Null(FacebookSignedRequest.UserIdFrom($"{signature}.{notJson}", "s"));

        Assert.Equal("02afb56304902c656fcb737cdd03de6205bb6d401da2812efd9b2d36a08af159", FacebookApp.Proof("test", "key"));
        string Version(string? value) => new FacebookApp(new ConfigurationBuilder()
            .AddInMemoryCollection([new("Auth:Facebook:GraphVersion", value)]).Build()).GraphVersion;
        Assert.Equal("v24.0", Version("v24.0"));
        Assert.Equal(FacebookApp.DefaultGraphVersion, Version("v24.0/../evil"));
        Assert.Equal(FacebookApp.DefaultGraphVersion, Version(null));
    }
}
