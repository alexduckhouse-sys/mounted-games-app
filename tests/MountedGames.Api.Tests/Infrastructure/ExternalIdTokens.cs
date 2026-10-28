using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using MountedGames.Api.Auth;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>
/// Plays Google or Apple in tests: an RSA key pair under a key id, its JWKS document, and ID tokens signed with it.
/// Nothing here talks to the real providers.
/// </summary>
public sealed class IdTokenSigner : IDisposable
{
    public const string GoogleIssuer = "https://accounts.google.com";
    public const string AppleIssuer = "https://appleid.apple.com";

    private readonly RSA _rsa = RSA.Create(2048);

    public IdTokenSigner(string keyId) => Key = new RsaSecurityKey(_rsa) { KeyId = keyId };

    public RsaSecurityKey Key { get; }

    /// <summary>The public half, as the provider publishes it.</summary>
    public JsonWebKey PublicJwk
    {
        get
        {
            var jwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(new RsaSecurityKey(_rsa.ExportParameters(false)) { KeyId = Key.KeyId });
            jwk.Use = "sig";
            jwk.Alg = SecurityAlgorithms.RsaSha256;
            return jwk;
        }
    }

    public static string Jwks(params IdTokenSigner[] signers)
        => JsonSerializer.Serialize(new
        {
            keys = signers.Select(s => s.PublicJwk).Select(k => new { kty = k.Kty, use = k.Use, alg = k.Alg, kid = k.Kid, n = k.N, e = k.E }),
        });

    /// <summary>A fresh raw nonce, as the browser makes one.</summary>
    public static string NewNonce() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));

    /// <summary>
    /// Signs a token. <paramref name="nonce"/> is the raw nonce: the token carries its hash unless
    /// <paramref name="rawNonceClaim"/> asks for the raw value (a client that forgot to hash). Pass <c>null</c> claims to leave them out.
    /// </summary>
    public string Sign(
        string issuer,
        string audience,
        string? subject,
        string? email,
        string? nonce,
        object? emailVerified = null,
        IDictionary<string, object>? extra = null,
        DateTime? expires = null,
        bool rawNonceClaim = false,
        SigningCredentials? credentials = null)
    {
        var claims = new Dictionary<string, object>();
        if (subject is not null) claims["sub"] = subject;
        if (email is not null) claims["email"] = email;
        if (emailVerified is not null) claims["email_verified"] = emailVerified;
        if (nonce is not null) claims["nonce"] = rawNonceClaim ? nonce : ExternalNonce.Hash(nonce);
        foreach (var (key, value) in extra ?? new Dictionary<string, object>()) claims[key] = value;
        var exp = expires ?? DateTime.UtcNow.AddMinutes(30);
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            Claims = claims,
            IssuedAt = exp.AddMinutes(-60),
            NotBefore = exp.AddMinutes(-60),
            Expires = exp,
            SigningCredentials = credentials ?? new SigningCredentials(Key, SecurityAlgorithms.RsaSha256),
        });
    }

    public void Dispose() => _rsa.Dispose();
}

/// <summary>
/// Plays Facebook's Graph API: <c>debug_token</c> and <c>/me</c> for the access tokens it has issued. Like the real one
/// with "Require App Secret" on, it refuses a call without the right <c>appsecret_proof</c>, and <c>debug_token</c>
/// without our app's own token. It reads the caller's token only from the <c>Authorization</c> header, so a token put in
/// the address is refused. The App ID and secret are made up.
/// </summary>
public sealed class FakeFacebookGraph
{
    public const string AppId = "1234567890123456";
    public const string AppSecret = "test-facebook-app-secret-0123456789";

    public sealed record User(string Id, string? Name, string? Email)
    {
        public string AppId { get; init; } = FakeFacebookGraph.AppId;
        public bool Valid { get; init; } = true;
        public string Type { get; init; } = "USER";
        public DateTimeOffset Expires { get; init; } = DateTimeOffset.UtcNow.AddHours(2);
        /// <summary>When Facebook says the token was issued; null leaves <c>issued_at</c> out of <c>debug_token</c>.</summary>
        public DateTimeOffset? IssuedAt { get; init; } = DateTimeOffset.UtcNow;
        public string[] Scopes { get; init; } = ["email", "public_profile"];
        public string? MeId { get; init; }
    }

    private readonly ConcurrentDictionary<string, User> _tokens = new();

    /// <summary>Set to make Graph fail like an outage.</summary>
    public HttpStatusCode? Outage { get; set; }

    /// <summary>Set to make Graph unreachable.</summary>
    public bool Unreachable { get; set; }

    public string Issue(User user)
    {
        var token = $"EAAT{Guid.NewGuid():N}";
        _tokens[token] = user;
        return token;
    }

    public static string NewUserId() => string.Concat(Enumerable.Range(0, 15).Select(_ => (char)('0' + Random.Shared.Next(10))));

    public HttpResponseMessage Answer(HttpRequestMessage request)
    {
        if (Unreachable) throw new HttpRequestException("stubbed network failure");
        if (Outage is { } status) return new HttpResponseMessage(status);
        var url = request.RequestUri!;
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(url.Query);
        string Q(string key) => query.TryGetValue(key, out var v) ? v.ToString() : "";
        if (query.ContainsKey("access_token")) return Error(400);
        var header = request.Headers.Authorization;
        if (header?.Scheme != "Bearer" || string.IsNullOrEmpty(header.Parameter)) return Error(400);
        var accessToken = header.Parameter;
        if (Q("appsecret_proof") != MountedGames.Api.Auth.FacebookApp.Proof(accessToken, AppSecret)) return Error(400);

        if (url.AbsolutePath.EndsWith("/debug_token", StringComparison.Ordinal))
        {
            if (accessToken != $"{AppId}|{AppSecret}") return Error(400);
            if (!_tokens.TryGetValue(Q("input_token"), out var user)) return Json(new { data = new { is_valid = false } });
            var data = new Dictionary<string, object>
            {
                ["app_id"] = user.AppId,
                ["type"] = user.Type,
                ["application"] = "Mounted Games test",
                ["expires_at"] = user.Expires.ToUnixTimeSeconds(),
                ["is_valid"] = user.Valid,
                ["scopes"] = user.Scopes,
                ["user_id"] = user.Id,
            };
            if (user.IssuedAt is { } issued) data["issued_at"] = issued.ToUnixTimeSeconds();
            return Json(new { data });
        }
        if (url.AbsolutePath.EndsWith("/me", StringComparison.Ordinal) && _tokens.TryGetValue(accessToken, out var me))
            return Json(new { id = me.MeId ?? me.Id, name = me.Name, email = me.Email });
        return Error(400);
    }

    private static HttpResponseMessage Json(object body)
        => new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(body), System.Text.Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Error(int status)
        => new((HttpStatusCode)status) { Content = new StringContent("{\"error\":{\"message\":\"Invalid OAuth access token.\",\"code\":190}}") };
}

/// <summary>
/// The API with Google (a web and an iOS client ID), Apple (a web Services ID) and Facebook switched on. Google's and
/// Apple's key addresses are answered by <see cref="StubHttp"/> from <see cref="Google"/> and <see cref="Apple"/>, and
/// Facebook's Graph API by <see cref="Facebook"/>. The IDs are made up. Email is on, pointed at the fake provider
/// (<see cref="EmailApiFactory.Sent"/>), so tests can read what was sent.
/// </summary>
public class ExternalAuthFactory : EmailApiFactory
{
    public const string GoogleWebClient = "test-web-client.apps.googleusercontent.com";
    public const string GoogleIosClient = "test-ios-client.apps.googleusercontent.com";
    public const string AppleServicesId = "uk.example.mountedgames.test";

    public IdTokenSigner Google { get; } = new("google-test-key");
    public IdTokenSigner Apple { get; } = new("apple-test-key");
    public FakeFacebookGraph Facebook { get; } = new();

    public ExternalAuthFactory()
    {
        Http.Respond("www.googleapis.com/oauth2/v3/certs", _ => Json(IdTokenSigner.Jwks(Google)));
        Http.Respond("appleid.apple.com/auth/keys", _ => Json(IdTokenSigner.Jwks(Apple)));
        Http.Respond("graph.facebook.com", Facebook.Answer);
    }

    private static HttpResponseMessage Json(string body)
        => new(System.Net.HttpStatusCode.OK) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

    /// <summary>A verified Google sign-in for the web client: its ID token, the raw nonce and the subject.</summary>
    public (string Token, string Nonce, string Subject) GoogleSignIn(string email, string? subject = null)
    {
        var nonce = IdTokenSigner.NewNonce();
        subject ??= $"g-{Guid.NewGuid():N}";
        return (Google.Sign(IdTokenSigner.GoogleIssuer, GoogleWebClient, subject, email, nonce, true), nonce, subject);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Auth:Google:ClientIds:0", GoogleWebClient);
        builder.UseSetting("Auth:Google:ClientIds:1", GoogleIosClient);
        builder.UseSetting("Auth:Apple:ClientIds:0", AppleServicesId);
        builder.UseSetting("Auth:Facebook:AppId", FakeFacebookGraph.AppId);
        builder.UseSetting("Auth:Facebook:AppSecret", FakeFacebookGraph.AppSecret);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing) return;
        Google.Dispose();
        Apple.Dispose();
    }
}
