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
/// The API with Google (a web and an iOS client ID) and Apple (a web Services ID) switched on, their key addresses
/// answered by <see cref="StubHttp"/> from <see cref="Google"/> and <see cref="Apple"/>. The IDs are made up.
/// </summary>
public class ExternalAuthFactory : ApiFactory
{
    public const string GoogleWebClient = "test-web-client.apps.googleusercontent.com";
    public const string GoogleIosClient = "test-ios-client.apps.googleusercontent.com";
    public const string AppleServicesId = "uk.example.mountedgames.test";

    public IdTokenSigner Google { get; } = new("google-test-key");
    public IdTokenSigner Apple { get; } = new("apple-test-key");

    public ExternalAuthFactory()
    {
        Http.Respond("www.googleapis.com/oauth2/v3/certs", _ => Json(IdTokenSigner.Jwks(Google)));
        Http.Respond("appleid.apple.com/auth/keys", _ => Json(IdTokenSigner.Jwks(Apple)));
    }

    private static HttpResponseMessage Json(string body)
        => new(System.Net.HttpStatusCode.OK) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Auth:Google:ClientIds:0", GoogleWebClient);
        builder.UseSetting("Auth:Google:ClientIds:1", GoogleIosClient);
        builder.UseSetting("Auth:Apple:ClientIds:0", AppleServicesId);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing) return;
        Google.Dispose();
        Apple.Dispose();
    }
}
