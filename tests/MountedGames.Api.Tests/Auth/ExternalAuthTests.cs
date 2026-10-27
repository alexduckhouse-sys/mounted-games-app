using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using MountedGames.Api.Auth;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

public class ExternalAuthTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ExternalAuthTests(ApiFactory f) => _f = f;

    private static string Unique(string prefix = "ext") => $"{prefix}-{Guid.NewGuid():N}"[..16];

    private sealed class FakeExternalValidator : IExternalTokenValidator
    {
        public List<ExternalProviderDto> Providers { get; } =
        [
            new ExternalProviderDto("google", "Google", "google-client-id", "https://accounts.google.com/o/oauth2/v2/auth", "openid email profile"),
            new ExternalProviderDto("apple", "Apple", "apple.client.id", "https://appleid.apple.com/auth/authorize", "openid email name"),
        ];

        public Dictionary<(string Provider, string Token), (ExternalIdentity Identity, string? ExpectedNonce)> Tokens { get; } = new();

        public void Register(string provider, string token, ExternalIdentity identity, string? expectedNonce = null)
            => Tokens[(provider.ToLowerInvariant(), token)] = (identity, expectedNonce);

        public IReadOnlyList<ExternalProviderDto> GetEnabledProviders() => Providers;

        public Task<ExternalIdentity?> ValidateIdTokenAsync(string provider, string idToken, string? expectedNonce, CancellationToken ct = default)
        {
            if (!Tokens.TryGetValue((provider.ToLowerInvariant(), idToken), out var entry))
                return Task.FromResult<ExternalIdentity?>(null);
            if (entry.ExpectedNonce is not null && entry.ExpectedNonce != expectedNonce)
                return Task.FromResult<ExternalIdentity?>(null);
            return Task.FromResult<ExternalIdentity?>(entry.Identity);
        }
    }

    private (Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> Factory, FakeExternalValidator Validator) WithFakeValidator(
        Action<IWebHostBuilder>? configure = null)
    {
        var validator = new FakeExternalValidator();
        var factory = _f.WithWebHostBuilder(b =>
        {
            configure?.Invoke(b);
            b.ConfigureServices(s =>
            {
                s.RemoveAll<IExternalTokenValidator>();
                s.AddSingleton<IExternalTokenValidator>(validator);
            });
        });
        return (factory, validator);
    }

    // ---- GET /api/auth/providers ----

    [Fact]
    public async Task GetProviders_ReturnsEmpty_WhenNoOAuthConfigured()
    {
        var client = _f.CreateClient();
        var res = await client.GetAsync("/api/auth/providers");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var providers = await res.ReadAsync<List<ExternalProviderDto>>();
        Assert.Empty(providers);
    }

    [Fact]
    public async Task GetProviders_ReturnsConfiguredProviders_WithDefaultsAndCustomOidc()
    {
        using var factory = _f.WithWebHostBuilder(b =>
        {
            b.UseSetting("OAuth:Google:ClientId", "g-client");
            b.UseSetting("OAuth:Apple:ClientId", "a-client");
            b.UseSetting("OAuth:Microsoft:ClientId", "m-client");
            b.UseSetting("OAuth:Oidc:ClientId", "o-client");
            b.UseSetting("OAuth:Oidc:Authority", "https://sso.example.org/");
            b.UseSetting("OAuth:Oidc:DisplayName", "Pony Club SSO");
        });
        var client = factory.CreateClient();

        var providers = await (await client.GetAsync("/api/auth/providers")).ReadAsync<List<ExternalProviderDto>>();

        Assert.Equal(4, providers.Count);
        Assert.Equal(("google", "Google", "g-client", "https://accounts.google.com/o/oauth2/v2/auth"),
            (providers[0].Id, providers[0].Name, providers[0].ClientId, providers[0].AuthorizeEndpoint));
        Assert.Equal(("apple", "Apple", "a-client", "https://appleid.apple.com/auth/authorize"),
            (providers[1].Id, providers[1].Name, providers[1].ClientId, providers[1].AuthorizeEndpoint));
        Assert.Equal(("microsoft", "Microsoft", "m-client", "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"),
            (providers[2].Id, providers[2].Name, providers[2].ClientId, providers[2].AuthorizeEndpoint));
        Assert.Equal(("oidc", "Pony Club SSO", "o-client", "https://sso.example.org/authorize"),
            (providers[3].Id, providers[3].Name, providers[3].ClientId, providers[3].AuthorizeEndpoint));
    }

    // ---- OidcExternalTokenValidator cryptographic validation ----

    [Fact]
    public async Task OidcValidator_ValidatesSignedIdTokens_Nonce_Issuers_AndRejectsInvalidTokens()
    {
        using var rsa = RSA.Create(2048);
        var key = new RsaSecurityKey(rsa) { KeyId = "test-key-1" };
        var jwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(key);
        var jwksJson = JsonSerializer.Serialize(new { keys = new[] { jwk } });

        _f.Http.RespondJson("accounts.google.com/.well-known/openid-configuration", JsonSerializer.Serialize(new
        {
            issuer = "https://accounts.google.com",
            authorization_endpoint = "https://accounts.google.com/o/oauth2/v2/auth",
            jwks_uri = "https://accounts.google.com/oauth2/v3/certs",
        }));
        _f.Http.RespondJson("accounts.google.com/oauth2/v3/certs", jwksJson);

        _f.Http.RespondJson("login.microsoftonline.com/common/v2.0/.well-known/openid-configuration", JsonSerializer.Serialize(new
        {
            issuer = "https://login.microsoftonline.com/{tenantid}/v2.0",
            authorization_endpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            jwks_uri = "https://login.microsoftonline.com/common/discovery/v2.0/keys",
        }));
        _f.Http.RespondJson("login.microsoftonline.com/common/discovery/v2.0/keys", jwksJson);

        using var factory = _f.WithWebHostBuilder(b =>
        {
            b.UseSetting("OAuth:Google:ClientId", "google-aud");
            b.UseSetting("OAuth:Microsoft:ClientId", "ms-aud");
        });
        var validator = factory.Services.GetRequiredService<IExternalTokenValidator>();

        string SignJwt(string issuer, string audience, IEnumerable<Claim> claims, DateTime? expires = null, SecurityKey? signingKey = null)
        {
            var exp = expires ?? DateTime.UtcNow.AddMinutes(10);
            var creds = new SigningCredentials(signingKey ?? key, SecurityAlgorithms.RsaSha256);
            var token = new JwtSecurityToken(
                issuer: issuer,
                audience: audience,
                claims: claims,
                notBefore: exp.AddMinutes(-15),
                expires: exp,
                signingCredentials: creds);
            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        // 1. Valid Google token with full name and nonce
        var validGoogle = SignJwt("https://accounts.google.com", "google-aud",
        [
            new Claim("sub", "g-sub-1"),
            new Claim("email", "rider@example.com"),
            new Claim("email_verified", "true"),
            new Claim("name", "Alex Rider"),
            new Claim("nonce", "n-123"),
        ]);
        var identity = await validator.ValidateIdTokenAsync("google", validGoogle, "n-123");
        Assert.NotNull(identity);
        Assert.Equal(("g-sub-1", "rider@example.com", true, "Alex Rider"),
            (identity!.Subject, identity.Email, identity.EmailVerified, identity.FullName));

        // 2. Wrong nonce is rejected
        Assert.Null(await validator.ValidateIdTokenAsync("google", validGoogle, "wrong-nonce"));

        // 3. Google alternate issuer ("accounts.google.com") + given_name / family_name fallback
        var altGoogle = SignJwt("accounts.google.com", "google-aud",
        [
            new Claim("sub", "g-sub-2"),
            new Claim("email", "sam@example.com"),
            new Claim("email_verified", "1"),
            new Claim("given_name", "Sam"),
            new Claim("family_name", "Taylor"),
        ]);
        var altIdentity = await validator.ValidateIdTokenAsync("google", altGoogle, null);
        Assert.NotNull(altIdentity);
        Assert.Equal("Sam Taylor", altIdentity!.FullName);
        Assert.True(altIdentity.EmailVerified);

        // 4. Microsoft multi-tenant issuer validation
        var validMs = SignJwt("https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0", "ms-aud",
        [
            new Claim("sub", "ms-sub-1"),
            new Claim("email", "coach@example.com"),
            new Claim("email_verified", "true"),
        ]);
        var msIdentity = await validator.ValidateIdTokenAsync("microsoft", validMs, null);
        Assert.NotNull(msIdentity);
        Assert.Equal("ms-sub-1", msIdentity!.Subject);
        Assert.Null(msIdentity.FullName);

        // 5. Invalid Microsoft issuer with extra slash in tenant segment
        var badMsIssuer = SignJwt("https://login.microsoftonline.com/evil/tenant/v2.0", "ms-aud",
        [
            new Claim("sub", "ms-sub-2"),
            new Claim("email", "coach@example.com"),
        ]);
        Assert.Null(await validator.ValidateIdTokenAsync("microsoft", badMsIssuer, null));

        // 6. Wrong audience, expired token, wrong signature, missing claims, unknown provider
        var wrongAud = SignJwt("https://accounts.google.com", "other-aud",
            [new Claim("sub", "s"), new Claim("email", "a@b.com")]);
        Assert.Null(await validator.ValidateIdTokenAsync("google", wrongAud, null));

        var expired = SignJwt("https://accounts.google.com", "google-aud",
            [new Claim("sub", "s"), new Claim("email", "a@b.com")], expires: DateTime.UtcNow.AddMinutes(-10));
        Assert.Null(await validator.ValidateIdTokenAsync("google", expired, null));

        using var otherRsa = RSA.Create(2048);
        var wrongKey = new RsaSecurityKey(otherRsa) { KeyId = "other-key" };
        var wrongSig = SignJwt("https://accounts.google.com", "google-aud",
            [new Claim("sub", "s"), new Claim("email", "a@b.com")], signingKey: wrongKey);
        Assert.Null(await validator.ValidateIdTokenAsync("google", wrongSig, null));

        var missingEmail = SignJwt("https://accounts.google.com", "google-aud", [new Claim("sub", "s")]);
        Assert.Null(await validator.ValidateIdTokenAsync("google", missingEmail, null));

        Assert.Null(await validator.ValidateIdTokenAsync("unknown", validGoogle, null));
        Assert.Null(await validator.ValidateIdTokenAsync("", validGoogle, null));
        Assert.Null(await validator.ValidateIdTokenAsync("google", "", null));
    }

    // ---- POST /api/auth/external ----

    [Fact]
    public async Task ExternalLogin_NewUser_ReturnsNeedsSignup_ThenCreatesAccountAndSignsInOnRepeat()
    {
        var (factory, validator) = WithFakeValidator();
        using var _ = factory;
        var email = $"{Unique()}@example.com";
        var sub = $"google-{Guid.NewGuid():N}";
        validator.Register("google", "valid-id-token", new ExternalIdentity(sub, email, true, "Jamie Carter"), "nonce-1");

        var client = factory.CreateClient();

        // Step 1: Initial sign-in without a club returns NeedsSignup = true
        var step1 = await client.PostAsJsonAsync("/api/auth/external",
            new ExternalAuthRequest("google", "valid-id-token", Nonce: "nonce-1"));
        Assert.Equal(HttpStatusCode.OK, step1.StatusCode);
        var res1 = await step1.ReadAsync<ExternalAuthResultDto>();
        Assert.True(res1.NeedsSignup);
        Assert.Null(res1.Auth);
        Assert.Equal(email, res1.Email);
        Assert.Equal("Jamie Carter", res1.SuggestedName);
        Assert.Equal("google", res1.Provider);

        // Step 2: Completing sign-up with Club & Role creates the account and links the login
        var clubName = $"OAuth Club {Guid.NewGuid():N}";
        var step2 = await client.PostAsJsonAsync("/api/auth/external",
            new ExternalAuthRequest("google", "valid-id-token", Nonce: "nonce-1", FullName: "Jamie Carter", ClubName: clubName, Role: Roles.Trainer));
        Assert.Equal(HttpStatusCode.OK, step2.StatusCode);
        var res2 = await step2.ReadAsync<ExternalAuthResultDto>();
        Assert.False(res2.NeedsSignup);
        Assert.NotNull(res2.Auth);
        Assert.Equal(email, res2.Auth!.User.Email);
        Assert.Equal("Jamie Carter", res2.Auth.User.FullName);
        Assert.Equal(clubName, res2.Auth.User.ClubName);
        Assert.True(res2.Auth.User.EmailConfirmed);
        Assert.Equal(new[] { Roles.Member, Roles.TrainerRequest }, res2.Auth.User.Roles.Order());

        // Step 3: Next sign-in with the same external account signs straight in without needing clubName
        var step3 = await client.PostAsJsonAsync("/api/auth/external",
            new ExternalAuthRequest("google", "valid-id-token", Nonce: "nonce-1"));
        Assert.Equal(HttpStatusCode.OK, step3.StatusCode);
        var res3 = await step3.ReadAsync<ExternalAuthResultDto>();
        Assert.False(res3.NeedsSignup);
        Assert.Equal(res2.Auth.User.Id, res3.Auth!.User.Id);
    }

    [Fact]
    public async Task ExternalLogin_LinksExistingPasswordAccount_WhenEmailIsVerified_AndConfirmsEmail()
    {
        var (factory, validator) = WithFakeValidator();
        using var _ = factory;
        var (_, signedUp) = await _f.SignupAsync(Roles.Member, "Warwickshire Hunt");
        var email = signedUp.User.Email;

        // Ensure the account starts with EmailConfirmed = false
        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == signedUp.User.Id);
            u.EmailConfirmed = false;
            await db.SaveChangesAsync();
        });

        validator.Register("apple", "apple-tok", new ExternalIdentity("apple-sub-1", email, EmailVerified: true, "Member Name"));
        var client = factory.CreateClient();

        var res = await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("apple", "apple-tok"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var dto = await res.ReadAsync<ExternalAuthResultDto>();
        Assert.False(dto.NeedsSignup);
        Assert.Equal(signedUp.User.Id, dto.Auth!.User.Id);
        Assert.True(dto.Auth.User.EmailConfirmed);

        // Verify the external login is now linked in AspNetUserLogins
        var logins = await _f.WithDbAsync(db => db.UserLogins.Where(l => l.UserId == signedUp.User.Id).ToListAsync());
        Assert.Single(logins);
        Assert.Equal(("apple", "apple-sub-1"), (logins[0].LoginProvider, logins[0].ProviderKey));
    }

    [Fact]
    public async Task ExternalLogin_RefusesToLinkExistingAccount_WhenExternalEmailIsNotVerified()
    {
        var (factory, validator) = WithFakeValidator();
        using var _ = factory;
        var (_, signedUp) = await _f.SignupAsync(Roles.Member, "Warwickshire Hunt");

        validator.Register("google", "unverified-tok",
            new ExternalIdentity("google-unverified-sub", signedUp.User.Email, EmailVerified: false, "Impostor"));
        var client = factory.CreateClient();

        var res = await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "unverified-tok"));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.UserLogins.Where(l => l.UserId == signedUp.User.Id).ToListAsync()));
    }

    [Fact]
    public async Task ExternalLogin_RefusesInvalidToken_UnverifiedNewUser_SharedAdmin_DisposableEmail_AndStoppedAccounts()
    {
        var (factory, validator) = WithFakeValidator();
        using var _ = factory;
        var client = factory.CreateClient();

        // 1. Missing/invalid token
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "bad-token"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("", "bad-token"))).StatusCode);

        // 2. Unverified new user
        validator.Register("google", "unverified-new", new ExternalIdentity("sub-u", $"{Unique()}@example.com", EmailVerified: false));
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "unverified-new"))).StatusCode);

        // 3. Shared admin email refused
        validator.Register("google", "admin-tok", new ExternalIdentity("sub-admin", "admin@mg.local", EmailVerified: true));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "admin-tok"))).StatusCode);

        // 4. Disposable email refused
        validator.Register("google", "disp-tok", new ExternalIdentity("sub-disp", "rider@mailinator.com", EmailVerified: true));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "disp-tok"))).StatusCode);

        // 5. Malformed email refused
        validator.Register("google", "bad-email-tok", new ExternalIdentity("sub-bad-email", "not-an-email", EmailVerified: true));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "bad-email-tok"))).StatusCode);

        // 6. Over-long clubName or fullName refused
        validator.Register("google", "valid-new", new ExternalIdentity("sub-valid-new", $"{Unique()}@example.com", EmailVerified: true));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/auth/external",
                new ExternalAuthRequest("google", "valid-new", ClubName: new string('C', 101)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/auth/external",
                new ExternalAuthRequest("google", "valid-new", ClubName: "Valid Club", FullName: new string('N', 101)))).StatusCode);

        // 7. Blocked / locked existing account refused both before and after linking
        var (_, stoppedUser) = await _f.SignupAsync(Roles.Member, "Warwickshire Hunt");
        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == stoppedUser.User.Id);
            u.BlockedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });
        validator.Register("google", "stopped-email-tok", new ExternalIdentity("sub-stopped-1", stoppedUser.User.Email, EmailVerified: true));
        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "stopped-email-tok"))).StatusCode);

        // Also when already linked via AspNetUserLogins:
        await _f.InDbAsync(async db =>
        {
            db.UserLogins.Add(new IdentityUserLogin<string>
            {
                LoginProvider = "google",
                ProviderKey = "sub-stopped-linked",
                ProviderDisplayName = "Google",
                UserId = stoppedUser.User.Id,
            });
            await db.SaveChangesAsync();
        });
        validator.Register("google", "stopped-linked-tok", new ExternalIdentity("sub-stopped-linked", stoppedUser.User.Email, EmailVerified: true));
        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "stopped-linked-tok"))).StatusCode);
    }

    [Fact]
    public async Task ExternalLogin_BlockedNetworkIp_Returns403()
    {
        var (factory, validator) = WithFakeValidator();
        using var _ = factory;
        var blockedIp = "198.51.100.199";
        await _f.InDbAsync(async db =>
        {
            var hash = MountedGames.Api.Services.IpRetention.HashFor(
                factory.Services.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>(), blockedIp);
            db.IpBlocks.Add(new IpBlock { IpAddress = hash, Reason = "Test block", CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, blockedIp);

        var res = await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "any"));
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task ExternalLogin_LinkedAccountWithUnconfirmedEmail_MarksConfirmedOnVerifiedLogin()
    {
        var (factory, validator) = WithFakeValidator();
        using var _ = factory;
        var (_, userAuth) = await _f.SignupAsync(Roles.Member, "Warwickshire Hunt");
        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == userAuth.User.Id);
            u.EmailConfirmed = false;
            db.UserLogins.Add(new IdentityUserLogin<string>
            {
                LoginProvider = "google",
                ProviderKey = "sub-confirm-on-login",
                ProviderDisplayName = "Google",
                UserId = u.Id,
            });
            await db.SaveChangesAsync();
        });

        validator.Register("google", "confirm-tok", new ExternalIdentity("sub-confirm-on-login", userAuth.User.Email, EmailVerified: true));
        var client = factory.CreateClient();

        var res = await client.PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", "confirm-tok"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var dto = await res.ReadAsync<ExternalAuthResultDto>();
        Assert.True(dto.Auth!.User.EmailConfirmed);
    }
}
