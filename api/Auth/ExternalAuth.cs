using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace MountedGames.Api.Auth;

/// <summary>The verified identity claims extracted from an external OIDC provider's ID token.</summary>
public record ExternalIdentity(
    string Subject,
    string Email,
    bool EmailVerified,
    string? FullName = null);

/// <summary>Lists enabled OAuth/OIDC sign-in providers and validates their ID tokens.</summary>
public interface IExternalTokenValidator
{
    IReadOnlyList<ExternalProviderDto> GetEnabledProviders();
    Task<ExternalIdentity?> ValidateIdTokenAsync(string provider, string idToken, string? expectedNonce, CancellationToken ct = default);
}

/// <summary>Known external provider defaults and display names.</summary>
public static class ExternalProviders
{
    public const string Google = "google";
    public const string Apple = "apple";
    public const string Microsoft = "microsoft";
    public const string Oidc = "oidc";

    public static string DisplayNameFor(string providerId, IConfiguration? config = null) => providerId.ToLowerInvariant() switch
    {
        Google => "Google",
        Apple => "Apple",
        Microsoft => "Microsoft",
        Oidc => NonEmpty(config?["OAuth:Oidc:DisplayName"]) ?? "Single Sign-On",
        _ => providerId,
    };

    private static string? NonEmpty(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

/// <summary>
/// Validates OAuth/OIDC <c>id_token</c> JWTs against the provider's <c>.well-known/openid-configuration</c>
/// discovery document and JWKS signing keys.
/// </summary>
public sealed class OidcExternalTokenValidator : IExternalTokenValidator
{
    public const string HttpClientName = "oidc";

    private sealed record ProviderSpec(
        string Id,
        string Name,
        string ClientId,
        string Authority,
        string AuthorizeEndpoint,
        string Scope,
        string ResponseMode = "fragment");

    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<OidcExternalTokenValidator> _log;
    private readonly ConcurrentDictionary<string, IConfigurationManager<OpenIdConnectConfiguration>> _configManagers =
        new(StringComparer.OrdinalIgnoreCase);

    public OidcExternalTokenValidator(
        IConfiguration config,
        IHttpClientFactory httpClientFactory,
        ILogger<OidcExternalTokenValidator> log)
    {
        _config = config;
        _httpClientFactory = httpClientFactory;
        _log = log;
    }

    public IReadOnlyList<ExternalProviderDto> GetEnabledProviders()
        => GetConfiguredSpecs()
            .Select(p => new ExternalProviderDto(p.Id, p.Name, p.ClientId, p.AuthorizeEndpoint, p.Scope, p.ResponseMode))
            .ToList();

    public async Task<ExternalIdentity?> ValidateIdTokenAsync(
        string provider,
        string idToken,
        string? expectedNonce,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(provider) || string.IsNullOrWhiteSpace(idToken))
            return null;

        var spec = GetConfiguredSpecs().FirstOrDefault(p => string.Equals(p.Id, provider.Trim(), StringComparison.OrdinalIgnoreCase));
        if (spec is null)
            return null;

        try
        {
            var oidcConfig = await GetConfigManager(spec.Authority).GetConfigurationAsync(ct);
            var validationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                IssuerValidator = (issuer, _, _) => ValidateIssuer(issuer, spec, oidcConfig),
                ValidateAudience = true,
                ValidAudience = spec.ClientId,
                ValidateIssuerSigningKey = true,
                IssuerSigningKeys = oidcConfig.SigningKeys,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(2),
            };

            var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
            var principal = handler.ValidateToken(idToken, validationParameters, out _);

            if (!string.IsNullOrEmpty(expectedNonce))
            {
                var tokenNonce = principal.FindFirstValue("nonce");
                if (string.IsNullOrEmpty(tokenNonce) || !CryptographicOperations.FixedTimeEquals(
                        Encoding.UTF8.GetBytes(tokenNonce), Encoding.UTF8.GetBytes(expectedNonce)))
                    return null;
            }

            var sub = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
            var email = principal.FindFirstValue("email") ?? principal.FindFirstValue(ClaimTypes.Email);
            if (string.IsNullOrWhiteSpace(sub) || string.IsNullOrWhiteSpace(email))
                return null;

            var emailVerifiedRaw = principal.FindFirstValue("email_verified");
            var emailVerified = string.Equals(emailVerifiedRaw, "true", StringComparison.OrdinalIgnoreCase)
                || string.Equals(emailVerifiedRaw, "1", StringComparison.Ordinal);

            var fullName = principal.FindFirstValue("name") ?? principal.FindFirstValue(ClaimTypes.Name);
            if (string.IsNullOrWhiteSpace(fullName))
            {
                var given = principal.FindFirstValue("given_name") ?? principal.FindFirstValue(ClaimTypes.GivenName);
                var family = principal.FindFirstValue("family_name") ?? principal.FindFirstValue(ClaimTypes.Surname);
                fullName = string.Join(" ", new[] { given, family }.Where(s => !string.IsNullOrWhiteSpace(s)));
            }
            fullName = string.IsNullOrWhiteSpace(fullName) ? null : fullName.Trim();

            return new ExternalIdentity(sub.Trim(), email.Trim(), emailVerified, fullName);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            _log.LogWarning("External ID token validation failed for provider {Provider}: {Reason}", spec.Id, ex.GetType().Name);
            return null;
        }
    }

    private IConfigurationManager<OpenIdConnectConfiguration> GetConfigManager(string authority)
    {
        var trimmed = authority.TrimEnd('/');
        return _configManagers.GetOrAdd(trimmed, auth =>
        {
            var metadataAddress = $"{auth}/.well-known/openid-configuration";
            var httpClient = _httpClientFactory.CreateClient(HttpClientName);
            var retriever = new HttpDocumentRetriever(httpClient)
            {
                RequireHttps = auth.StartsWith("https://", StringComparison.OrdinalIgnoreCase),
            };
            return new ConfigurationManager<OpenIdConnectConfiguration>(
                metadataAddress,
                new OpenIdConnectConfigurationRetriever(),
                retriever);
        });
    }

    private static string ValidateIssuer(string issuer, ProviderSpec spec, OpenIdConnectConfiguration oidcConfig)
    {
        if (string.IsNullOrWhiteSpace(issuer))
            throw new SecurityTokenInvalidIssuerException("Missing issuer.");

        if (!string.IsNullOrWhiteSpace(oidcConfig.Issuer))
        {
            if (string.Equals(issuer, oidcConfig.Issuer, StringComparison.Ordinal))
                return issuer;

            // Microsoft multi-tenant discovery advertises "https://login.microsoftonline.com/{tenantid}/v2.0".
            if (oidcConfig.Issuer.Contains("{tenantid}", StringComparison.OrdinalIgnoreCase))
            {
                var parts = oidcConfig.Issuer.Split("{tenantid}", StringSplitOptions.None);
                if (parts.Length == 2
                    && issuer.StartsWith(parts[0], StringComparison.Ordinal)
                    && issuer.EndsWith(parts[1], StringComparison.Ordinal)
                    && issuer.Length > parts[0].Length + parts[1].Length)
                {
                    var tenantSegment = issuer[parts[0].Length..(issuer.Length - parts[1].Length)];
                    if (!tenantSegment.Contains('/'))
                        return issuer;
                }
            }
        }

        if (string.Equals(issuer.TrimEnd('/'), spec.Authority.TrimEnd('/'), StringComparison.Ordinal))
            return issuer;

        if (spec.Id == ExternalProviders.Google && string.Equals(issuer, "accounts.google.com", StringComparison.Ordinal))
            return issuer;

        throw new SecurityTokenInvalidIssuerException("Token issuer does not match the configured provider.");
    }

    private List<ProviderSpec> GetConfiguredSpecs()
    {
        var list = new List<ProviderSpec>(4);

        if (NonEmpty(_config["OAuth:Google:ClientId"]) is { } googleClient)
        {
            list.Add(new ProviderSpec(
                ExternalProviders.Google,
                "Google",
                googleClient,
                NonEmpty(_config["OAuth:Google:Authority"]) ?? "https://accounts.google.com",
                NonEmpty(_config["OAuth:Google:AuthorizeEndpoint"]) ?? "https://accounts.google.com/o/oauth2/v2/auth",
                NonEmpty(_config["OAuth:Google:Scope"]) ?? "openid email profile"));
        }

        if (NonEmpty(_config["OAuth:Apple:ClientId"]) is { } appleClient)
        {
            list.Add(new ProviderSpec(
                ExternalProviders.Apple,
                "Apple",
                appleClient,
                NonEmpty(_config["OAuth:Apple:Authority"]) ?? "https://appleid.apple.com",
                NonEmpty(_config["OAuth:Apple:AuthorizeEndpoint"]) ?? "https://appleid.apple.com/auth/authorize",
                NonEmpty(_config["OAuth:Apple:Scope"]) ?? "openid email name"));
        }

        if (NonEmpty(_config["OAuth:Microsoft:ClientId"]) is { } msClient)
        {
            list.Add(new ProviderSpec(
                ExternalProviders.Microsoft,
                "Microsoft",
                msClient,
                NonEmpty(_config["OAuth:Microsoft:Authority"]) ?? "https://login.microsoftonline.com/common/v2.0",
                NonEmpty(_config["OAuth:Microsoft:AuthorizeEndpoint"]) ?? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
                NonEmpty(_config["OAuth:Microsoft:Scope"]) ?? "openid email profile"));
        }

        if (NonEmpty(_config["OAuth:Oidc:ClientId"]) is { } oidcClient
            && NonEmpty(_config["OAuth:Oidc:Authority"]) is { } oidcAuthority)
        {
            var authorizeEndpoint = NonEmpty(_config["OAuth:Oidc:AuthorizeEndpoint"])
                ?? $"{oidcAuthority.TrimEnd('/')}/authorize";
            var displayName = NonEmpty(_config["OAuth:Oidc:DisplayName"]) ?? "Single Sign-On";
            var scope = NonEmpty(_config["OAuth:Oidc:Scope"]) ?? "openid email profile";
            list.Add(new ProviderSpec(
                ExternalProviders.Oidc,
                displayName,
                oidcClient,
                oidcAuthority,
                authorizeEndpoint,
                scope));
        }

        return list;
    }

    private static string? NonEmpty(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
