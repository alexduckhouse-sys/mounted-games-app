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

    private Task<HttpResponseMessage> FinishAsync(string? ticket)
        => _f.CreateClient().PostAsJsonAsync("/api/auth/external/signup", new ExternalSignupRequest(ticket!, "Sam Rider", "Facebook Club", Roles.Member));

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

        // Every Graph call carried the proof made with our secret (the fake refuses any that doesn't), and its own
        // token went in the Authorization header (the fake reads it nowhere else), so no token is in an address.
        var graphCalls = _f.Http.Requests.Where(r => r.Contains("graph.facebook.com/v23.0/", StringComparison.Ordinal)).ToList();
        Assert.Contains(graphCalls, r => r.Contains("/debug_token?") && r.Contains($"appsecret_proof={FacebookApp.Proof($"{FakeFacebookGraph.AppId}|{FakeFacebookGraph.AppSecret}", FakeFacebookGraph.AppSecret)}"));
        Assert.Contains(graphCalls, r => r.Contains("/me?") && r.Contains($"appsecret_proof={FacebookApp.Proof(token, FakeFacebookGraph.AppSecret)}"));
        Assert.DoesNotContain(graphCalls, r => r.Contains("access_token=", StringComparison.Ordinal));
        Assert.DoesNotContain(graphCalls, r => r.Contains(FakeFacebookGraph.AppSecret, StringComparison.Ordinal));

        // Facebook's SDK hands back the token it already has, so the same one signs in again, as does a new one.
        Assert.Equal(auth.User.Id, (await (await PostAsync(token)).ReadAsync<ExternalAuthResultDto>()).Auth!.User.Id);
        Assert.Equal(auth.User.Id, (await (await PostAsync(token)).ReadAsync<ExternalAuthResultDto>()).Auth!.User.Id);
        var again = await (await PostAsync(Token(email, id))).ReadAsync<ExternalAuthResultDto>();
        Assert.Equal(auth.User.Id, again.Auth!.User.Id);
    }

    [Fact]
    public async Task WithoutAnEmailFromFacebookNoAccountIsMade_ButALinkedOneStillSignsIn()
    {
        var refused = await PostAsync(Token(email: null));
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal("external_email_missing", await CodeAsync(refused));
        var message = await refused.Content.ReadAsStringAsync();
        Assert.Contains("Sign up with your email and a password, then add Facebook from My account", message);
        Assert.DoesNotContain("signupTicket\":\"", message);

        // Someone already linked signs in even if Facebook stops sharing the address.
        var (auth, facebookId) = await CreateAsync(Email());
        var signedIn = await (await PostAsync(Token(email: null, id: facebookId))).ReadAsync<ExternalAuthResultDto>();
        Assert.Equal(auth.User.Id, signedIn.Auth!.User.Id);
        // An address Facebook gives that we wouldn't accept doesn't stop them either.
        Assert.Equal(auth.User.Id, (await (await PostAsync(Token(email: "not an address", id: facebookId))).ReadAsync<ExternalAuthResultDto>()).Auth!.User.Id);
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
        var facebookId = FakeFacebookGraph.NewUserId();
        var signInToken = Token(email, facebookId);
        var refused = await PostAsync(signInToken);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("external_link_refused", await CodeAsync(refused));
        Assert.Contains("then add Facebook from My account", await refused.Content.ReadAsStringAsync());
        Assert.Empty(await LoginsAsync(id));

        // Signed in, with their password again, the same person can add Facebook, and their address is told. Facebook's SDK
        // hands back the token it just used, and that's fine for adding: the password is the proof.
        var login = await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, Password));
        var client = _f.WithToken((await login.ReadAsync<AuthResponse>()).Token);
        var connected = await client.PostAsJsonAsync("/api/auth/logins", new ExternalConnectRequest("facebook", signInToken, Confirm: new ReauthRequest(Password)));
        Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
        var list = await connected.ReadAsync<LinkedSignInsDto>();
        Assert.Contains(new LinkedSignInDto("facebook", "Facebook"), list.Logins);
        Assert.NotNull(list.Auth);
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

    private static Task<HttpResponseMessage> DeleteMeAsync(HttpClient client, DeleteAccountRequest req)
        => client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me") { Content = JsonContent.Create(req) });

    [Fact]
    public async Task AFacebookOnlyAccountIsDeletedByAFreshFacebookSignIn()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        var client = _f.WithToken(auth.Token);
        Assert.Equal(HttpStatusCode.NoContent,
            (await DeleteMeAsync(client, new DeleteAccountRequest(Provider: "facebook", IdToken: Token(auth.User.Email, facebookId)))).StatusCode);
        Assert.Empty(await LoginsAsync(auth.User.Id));
    }

    [Fact]
    public async Task AFacebookTokenConfirmsItsTheOwnerOnlyOnce()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        var confirm = Token(auth.User.Email, facebookId);

        // Confirming adds Google, and ends this device's old session (it carries on with the new one).
        var (googleToken, googleNonce, _) = _f.GoogleSignIn($"rider.{Guid.NewGuid():N}"[..20] + "@gmail.com");
        var connected = await _f.WithToken(auth.Token).PostAsJsonAsync("/api/auth/logins",
            new ExternalConnectRequest("google", googleToken, googleNonce, new ReauthRequest(Provider: "facebook", IdToken: confirm)));
        Assert.Equal(HttpStatusCode.OK, connected.StatusCode);
        var client = _f.WithToken((await connected.ReadAsync<LinkedSignInsDto>()).Auth!.Token);

        // The same Facebook token can't confirm again, even for something else.
        var reused = await DeleteMeAsync(client, new DeleteAccountRequest(Provider: "facebook", IdToken: confirm));
        Assert.Equal(HttpStatusCode.BadRequest, reused.StatusCode);
        Assert.Equal("external_token", await CodeAsync(reused));
        Assert.NotEmpty(await LoginsAsync(auth.User.Id));
    }

    [Fact]
    public async Task ATokenSeenAtASignInOrIssuedLongAgoCantConfirmItsTheOwner()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        var client = _f.WithToken(auth.Token);

        // A token captured from an ordinary sign-in (still valid, and Facebook would hand it back again) can't confirm.
        var signedIn = Token(auth.User.Email, facebookId);
        Assert.Equal(auth.User.Id, (await (await PostAsync(signedIn)).ReadAsync<ExternalAuthResultDto>()).Auth!.User.Id);
        var captured = await DeleteMeAsync(client, new DeleteAccountRequest(Provider: "facebook", IdToken: signedIn));
        Assert.Equal(HttpStatusCode.BadRequest, captured.StatusCode);
        Assert.Equal("external_token", await CodeAsync(captured));

        // Nor can one Facebook says it issued more than ten minutes ago, or in the future.
        foreach (var issued in new[] { DateTimeOffset.UtcNow.AddMinutes(-11), DateTimeOffset.UtcNow.AddMinutes(5) })
        {
            var old = Token(auth.User.Email, facebookId, change: u => u with { IssuedAt = issued });
            Assert.Equal("external_token", await CodeAsync(await DeleteMeAsync(client, new DeleteAccountRequest(Provider: "facebook", IdToken: old))));
        }
        Assert.NotNull(await UserAsync(auth.User.Id));

        // A fresh one does, and so does one without issued_at (the sign-in rule still applies).
        var undated = Token(auth.User.Email, facebookId, change: u => u with { IssuedAt = null, Expires = DateTimeOffset.UtcNow.AddMinutes(50) });
        Assert.Equal(HttpStatusCode.NoContent, (await DeleteMeAsync(client, new DeleteAccountRequest(Provider: "facebook", IdToken: undated))).StatusCode);
        Assert.Null(await UserAsync(auth.User.Id));
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

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    private static string Deletion(string facebookId, long? issuedAt = null)
        => SignedRequest(new { algorithm = "HMAC-SHA256", issued_at = issuedAt ?? Now(), user_id = facebookId });

    private async Task<string> ConfirmationCodeAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var code = body.RootElement.GetProperty("confirmation_code").GetString()!;
        Assert.Matches("^[0-9a-f]{16}$", code);
        Assert.Equal($"{EmailApiFactory.SiteUrl}/data-deletion?code={code}", body.RootElement.GetProperty("url").GetString());
        return code;
    }

    /// <summary>The account, unless it has been deleted (removed, or emptied to a <c>deleted.invalid</c> shell).</summary>
    private Task<AppUser?> UserAsync(string id) => _f.WithDbAsync(db => db.Users.SingleOrDefaultAsync(u => u.Id == id && u.Email != null && !u.Email.EndsWith("@deleted.invalid")));

    [Fact]
    public async Task ADeletionRequestDeletesAnAccountThatCanOnlySignInWithFacebook()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        await ConfirmationCodeAsync(await DeletionAsync(Deletion(facebookId)));

        Assert.Empty(await LoginsAsync(auth.User.Id));
        Assert.Null(await UserAsync(auth.User.Id));
        // Its sessions ended with it.
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.WithToken(auth.Token).GetAsync("/api/auth/me")).StatusCode);
        Assert.DoesNotContain(_f.Logs, line => line.Contains(facebookId, StringComparison.Ordinal));

        // Someone Facebook doesn't know us for gets the same kind of answer.
        await ConfirmationCodeAsync(await DeletionAsync(Deletion("424242")));
    }

    [Fact]
    public async Task ADeletionRequestOnlyRemovesTheLinkFromAnAccountWithAnotherWayIn()
    {
        // A password account with Facebook added.
        var (id, email) = await PasswordAccountAsync(Email());
        var login = await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, Password));
        var facebookId = FakeFacebookGraph.NewUserId();
        var connected = await _f.WithToken((await login.ReadAsync<AuthResponse>()).Token).PostAsJsonAsync("/api/auth/logins",
            new ExternalConnectRequest("facebook", Token(email, facebookId), Confirm: new ReauthRequest(Password)));
        var session = (await connected.ReadAsync<LinkedSignInsDto>()).Auth!;

        await ConfirmationCodeAsync(await DeletionAsync(Deletion(facebookId)));
        Assert.Empty(await LoginsAsync(id));
        Assert.NotNull(await UserAsync(id));
        Assert.Equal(HttpStatusCode.OK, (await _f.WithToken(session.Token).GetAsync("/api/auth/me")).StatusCode);

        // A Facebook account with Google added too keeps Google.
        var (both, bothFacebookId) = await CreateAsync(Email());
        var (googleToken, googleNonce, _) = _f.GoogleSignIn($"rider.{Guid.NewGuid():N}"[..20] + "@gmail.com");
        Assert.Equal(HttpStatusCode.OK, (await _f.WithToken(both.Token).PostAsJsonAsync("/api/auth/logins",
            new ExternalConnectRequest("google", googleToken, googleNonce, new ReauthRequest(Provider: "facebook", IdToken: Token(both.User.Email, bothFacebookId))))).StatusCode);
        await ConfirmationCodeAsync(await DeletionAsync(Deletion(bothFacebookId)));
        Assert.Equal("google", Assert.Single(await LoginsAsync(both.User.Id)).LoginProvider);
        Assert.NotNull(await UserAsync(both.User.Id));
    }

    [Fact]
    public async Task ADeletionRequestWorksOnceAndOnlyWhileItIsFresh()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        foreach (var stale in new[] { Now() - (long)TimeSpan.FromHours(25).TotalSeconds, Now() + 600 })
            Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(Deletion(facebookId, stale))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(SignedRequest(new { algorithm = "HMAC-SHA256", user_id = facebookId }))).StatusCode);
        Assert.Single(await LoginsAsync(auth.User.Id));

        var request = Deletion(facebookId, Now() - 3600);
        await ConfirmationCodeAsync(await DeletionAsync(request));
        Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(request)).StatusCode);
    }

    [Fact]
    public async Task ABlockedOrLockedFacebookOnlyAccountLosesOnlyItsLink_SoItsBlockAndHistoryStay()
    {
        foreach (var stop in new Action<AppUser>[] { u => { u.BlockedAt = DateTime.UtcNow; u.BlockReason = "Abuse in chat"; }, u => u.LockedAt = DateTime.UtcNow })
        {
            var (auth, facebookId) = await CreateAsync(Email());
            await _f.InDbAsync(async db =>
            {
                stop(await db.Users.SingleAsync(u => u.Id == auth.User.Id));
                db.ChatMessages.Add(new ChatMessage { CompetitionId = (await db.Competitions.FirstAsync()).Id, UserId = auth.User.Id, AuthorName = "Sam Rider", Body = "Abuse", IpAddress = "203.0.113.9" });
                await db.SaveChangesAsync();
            });

            await ConfirmationCodeAsync(await DeletionAsync(Deletion(facebookId)));

            Assert.Empty(await LoginsAsync(auth.User.Id));
            var kept = await UserAsync(auth.User.Id);
            Assert.NotNull(kept);
            Assert.True(kept.IsAccessStopped);
            var chat = await _f.WithDbAsync(db => db.ChatMessages.SingleAsync(m => m.UserId == auth.User.Id));
            Assert.Equal(("Sam Rider", "203.0.113.9"), (chat.AuthorName, chat.IpAddress));
            Assert.Contains(_f.Logs, line => line.Contains("account stopped, link removed", StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task ADeletionRequestThatFailsPartWayCanBeSentAgain()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        await _f.InDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == auth.User.Id)).BlockedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            await db.Database.ExecuteSqlRawAsync(
                $"CREATE TRIGGER fail_facebook_unlink BEFORE DELETE ON AspNetUserLogins WHEN OLD.ProviderKey = '{facebookId}' BEGIN SELECT RAISE(ABORT, 'Synthetic failure'); END;");
        });
        var request = Deletion(facebookId);
        Assert.Equal(HttpStatusCode.InternalServerError, (await DeletionAsync(request)).StatusCode);
        Assert.Single(await LoginsAsync(auth.User.Id));

        await _f.InDbAsync(db => db.Database.ExecuteSqlRawAsync("DROP TRIGGER fail_facebook_unlink"));
        await ConfirmationCodeAsync(await DeletionAsync(request));
        Assert.Empty(await LoginsAsync(auth.User.Id));
        // Once it has worked, it is spent.
        Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(request)).StatusCode);
    }

    [Fact]
    public async Task AHandledDeletionRequestCantComeBackInAnotherSpelling()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        var request = Deletion(facebookId);
        var (signature, body) = (request.Split('.')[0], request.Split('.')[1]);
        // Same bytes to a lenient decoder: spaces, line breaks, padding, standard base64 characters, other spare bits.
        var spareBits = signature[..^1] + (char)(signature[^1] + 1);
        var variants = new[]
        {
            $"{signature[..10]}    {signature[10..]}.{body}",
            $"{signature[..10]}\n\n{signature[10..]}.{body}",
            $"{signature}=.{body}",
            $"{signature}  .{body}",
            $"{signature.Replace('-', '+').Replace('_', '/')}.{body}",
            $"{spareBits}.{body}",
            $"{signature}.{body}=",
            $"{signature}.{body[..5]} {body[5..]}",
        }.Where(v => v != request).ToArray();
        // Whichever characters the signature happens to have, a standard-base64 spelling is always tried.
        if (!signature.Contains('-') && !signature.Contains('_'))
            Assert.Null(FacebookSignedRequest.Read($"{signature[..^2]}+{signature[^1]}.{body}", FakeFacebookGraph.AppSecret, DateTimeOffset.UtcNow));
        foreach (var variant in variants)
            Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(variant)).StatusCode);
        Assert.Single(await LoginsAsync(auth.User.Id));

        await ConfirmationCodeAsync(await DeletionAsync(request));
        foreach (var variant in variants.Prepend(request))
            Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(variant)).StatusCode);
    }

    [Fact]
    public async Task AnUnsignedOrForgedDeletionRequestChangesNothing()
    {
        var (auth, facebookId) = await CreateAsync(Email());
        var good = Deletion(facebookId);
        var forged = new[]
        {
            SignedRequest(new { algorithm = "HMAC-SHA256", issued_at = Now(), user_id = facebookId }, "not-our-secret-0123456789"),
            SignedRequest(new { algorithm = "none", issued_at = Now(), user_id = facebookId }),
            SignedRequest(new { algorithm = "HMAC-SHA256", issued_at = Now() }),
            good.Split('.')[1],
            "!!!." + good.Split('.')[1],
            "",
        };
        foreach (var request in forged)
            Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(request)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await DeletionAsync(null)).StatusCode);
        Assert.Single(await LoginsAsync(auth.User.Id));

        using var off = _f.WithWebHostBuilder(b => b.UseSetting("Auth:Facebook:AppSecret", ""));
        Assert.Equal(HttpStatusCode.NotFound, (await DeletionAsync(good, off.CreateClient())).StatusCode);
    }

    [Fact]
    public void SignedRequestsAndSettingsAreReadStrictly()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Null(FacebookSignedRequest.Read(new string('a', 5000), "s", now));
        Assert.Null(FacebookSignedRequest.Read("a.b.c", "s", now));
        Assert.Null(FacebookSignedRequest.Read(".b", "s", now));
        var notJson = WebEncoders.Base64UrlEncode("not json"u8.ToArray());
        var signature = WebEncoders.Base64UrlEncode(HMACSHA256.HashData("s"u8.ToArray(), Encoding.ASCII.GetBytes(notJson)));
        Assert.Null(FacebookSignedRequest.Read($"{signature}.{notJson}", "s", now));

        // Up to 24 hours old, and no more than the clock skew ahead.
        var issued = now.AddHours(-23);
        var request = SignedRequest(new { algorithm = "HMAC-SHA256", issued_at = issued.ToUnixTimeSeconds(), user_id = "77" }, "s");
        var read = FacebookSignedRequest.Read(request, "s", now)!;
        Assert.Equal(("77", DateTimeOffset.FromUnixTimeSeconds(issued.ToUnixTimeSeconds())), (read.UserId, read.IssuedAt));
        Assert.Equal(Convert.ToHexStringLower(WebEncoders.Base64UrlDecode(request.Split('.')[0])), read.Signature);
        Assert.Null(FacebookSignedRequest.Read(request, "s", now.AddHours(2)));
        Assert.Null(FacebookSignedRequest.Read(request, "s", issued.AddMinutes(-2)));
        Assert.NotNull(FacebookSignedRequest.Read(request, "s", issued.AddSeconds(-30)));
        Assert.Null(FacebookSignedRequest.Read(SignedRequest(new { algorithm = "HMAC-SHA256", issued_at = long.MaxValue, user_id = "77" }, "s"), "s", now));

        Assert.Equal("02afb56304902c656fcb737cdd03de6205bb6d401da2812efd9b2d36a08af159", FacebookApp.Proof("test", "key"));
        string Version(string? value) => new FacebookApp(new ConfigurationBuilder()
            .AddInMemoryCollection([new("Auth:Facebook:GraphVersion", value)]).Build()).GraphVersion;
        Assert.Equal("v24.0", Version("v24.0"));
        Assert.Equal(FacebookApp.DefaultGraphVersion, Version("v24.0/../evil"));
        Assert.Equal(FacebookApp.DefaultGraphVersion, Version("v２4.0"));
        Assert.Equal(FacebookApp.DefaultGraphVersion, Version(null));
    }
}
