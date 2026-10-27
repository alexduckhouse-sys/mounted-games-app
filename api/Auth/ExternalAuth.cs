using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace MountedGames.Api.Auth;

/// <summary>
/// Who a provider says signed in, read from an ID token that passed every check in <see cref="ExternalTokenValidator"/>.
/// </summary>
/// <param name="Email">The address the provider gave. Google and Apple always give one; Facebook may not.</param>
/// <param name="EmailVerified">The provider says the person proved they own <paramref name="Email"/>.</param>
/// <param name="MayLinkByEmail">
/// The provider vouches for the address strongly enough to attach this sign-in to an existing account with the same
/// email, and for a new account to start with it confirmed: only when the provider hosts the mailbox itself. Google for
/// Gmail or a Google Workspace domain (<c>hd</c>); Apple for iCloud addresses (<c>icloud.com</c>, <c>me.com</c>,
/// <c>mac.com</c>), never a private relay one. Any other address was only verified once, and may have changed hands.
/// </param>
/// <param name="IsPrivateRelay">An Apple "Hide My Email" address, unique to this app and person.</param>
/// <param name="Name">The name inside the token (Google sends one; Apple never does). A suggestion only, never identity.</param>
public sealed record ExternalIdentity(
    string Provider,
    string Subject,
    string? Email,
    bool EmailVerified,
    bool MayLinkByEmail,
    bool IsPrivateRelay,
    string? Name);

/// <summary>Why a token was turned away. Callers see one message whatever the reason; this is for logs and tests.</summary>
public enum ExternalTokenFailure
{
    None,
    UnknownProvider,
    Malformed,
    NonceMissing,
    NonceMismatch,
    Signature,
    Issuer,
    Audience,
    Expired,
    MissingClaims,
    KeysUnavailable,
    /// <summary>The provider couldn't be asked about the token (Facebook checks tokens online).</summary>
    ProviderUnavailable,
    /// <summary>This token and nonce were used before.</summary>
    Replayed,
    Invalid,
}

/// <summary>What a provider token is being used for, which decides whether it may be presented again.</summary>
public enum ExternalTokenUse
{
    /// <summary>
    /// Confirming it's the owner (deleting the account, adding or removing a sign-in) or adding a provider: the token works
    /// once. The default.
    /// </summary>
    Confirm,
    /// <summary>
    /// Signing in. Google and Apple tokens still work once (each carries its own nonce). Facebook's SDK hands back the same
    /// access token for an hour or two, so a Facebook token may sign in again within its life.
    /// </summary>
    SignIn,
}

public sealed record ExternalTokenResult(ExternalIdentity? Identity, ExternalTokenFailure Failure)
{
    public static ExternalTokenResult Fail(ExternalTokenFailure failure) => new(null, failure);
}

/// <summary>Lists the sign-in providers that are switched on and checks their ID tokens.</summary>
public interface IExternalTokenValidator
{
    IReadOnlyList<ExternalProviderDto> GetEnabledProviders();

    /// <param name="rawNonce">
    /// The random value the browser (or app) made before asking the provider to sign the person in. The provider was given
    /// its SHA-256 (see <see cref="ExternalNonce"/>), so the token alone isn't enough to sign in: whoever presents it must
    /// also hold the raw value, which never leaves the page that asked.
    /// </param>
    /// <param name="use">Whether a Facebook token may be used again (<see cref="ExternalTokenUse.SignIn"/>) or only once.</param>
    Task<ExternalTokenResult> ValidateAsync(string provider, string idToken, string? rawNonce, ExternalTokenUse use = ExternalTokenUse.Confirm,
        CancellationToken ct = default);
}

/// <summary>
/// The providers we accept. Issuers and key addresses are fixed here rather than read from discovery or config, so a
/// setting can't point sign-in at someone else's keys. Each provider is on only when it has at least one client ID:
/// <c>Auth:Google:ClientIds</c> and <c>Auth:Apple:ClientIds</c>. The first ID is the web one sent to the browser; the
/// rest (an iOS client ID, an app's bundle ID) are only accepted as token audiences.
/// </summary>
public static class ExternalProviders
{
    public const string Google = "google";
    public const string Apple = "apple";
    /// <summary>Checked by <see cref="FacebookTokenVerifier"/>: an access token, not an ID token, and never linked by email.</summary>
    public const string Facebook = "facebook";

    internal sealed record Spec(string Id, string Name, string[] Issuers, string KeysUri, string ConfigKey);

    internal static readonly Spec[] All =
    [
        new(Google, "Google", ["https://accounts.google.com", "accounts.google.com"], "https://www.googleapis.com/oauth2/v3/certs", "Auth:Google:ClientIds"),
        new(Apple, "Apple", ["https://appleid.apple.com"], "https://appleid.apple.com/auth/keys", "Auth:Apple:ClientIds"),
    ];

    /// <summary>The configured client IDs: an array (<c>Auth__Google__ClientIds__0</c>) or one comma-separated value.</summary>
    internal static string[] ClientIds(IConfiguration config, Spec spec)
    {
        var section = config.GetSection(spec.ConfigKey);
        return section.GetChildren().Select(c => c.Value).Append(section.Value)
            .SelectMany(v => (v ?? string.Empty).Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    /// <summary>
    /// Whether the provider says if it checked the address (Google and Apple do). An address it hasn't confirmed never
    /// makes or opens an account through it.
    /// </summary>
    public static bool VerifiesEmail(string providerId) => providerId is Google or Apple;

    /// <summary>Apple's "Hide My Email" addresses.</summary>
    public static bool IsApplePrivateRelay(string email)
        => email.EndsWith("@privaterelay.appleid.com", StringComparison.OrdinalIgnoreCase);

    private static readonly string[] GoogleHosted = ["@gmail.com", "@googlemail.com"];
    private static readonly string[] AppleHosted = ["@icloud.com", "@me.com", "@mac.com"];

    /// <summary>Gmail, or a Google Workspace account (the token names its domain in <c>hd</c>).</summary>
    public static bool IsGoogleHosted(string email, string? hostedDomain)
        => GoogleHosted.Any(d => email.EndsWith(d, StringComparison.OrdinalIgnoreCase)) || !string.IsNullOrWhiteSpace(hostedDomain);

    /// <summary>An iCloud mailbox, which Apple itself runs.</summary>
    public static bool IsAppleHosted(string email) => AppleHosted.Any(d => email.EndsWith(d, StringComparison.OrdinalIgnoreCase));
}

/// <summary>
/// The nonce rule shared with the web (and a future iOS app): the client makes a random raw nonce, gives the provider its
/// lower-case hex SHA-256, and sends us the raw value with the token.
/// </summary>
public static class ExternalNonce
{
    public const int MinLength = 16;
    public const int MaxLength = 128;

    public static bool IsWellFormed(string? raw)
        => raw is not null && raw.Length is >= MinLength and <= MaxLength && raw.All(c => c is > ' ' and < '\u007f');

    public static string Hash(string raw) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));

    /// <summary>True when the token's nonce claim is the hash of the raw nonce. Compared in constant time.</summary>
    public static bool Matches(string? claim, string? raw)
    {
        if (string.IsNullOrEmpty(claim) || !IsWellFormed(raw)) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(claim), Encoding.UTF8.GetBytes(Hash(raw!)));
    }
}

/// <summary>
/// Checks Google and Apple ID tokens: an RS256 signature from the provider's published keys, the issuer, the audience
/// (any configured client ID), expiry and the nonce, then that this token and nonce haven't been used before
/// (<see cref="ExternalTokenReplayGuard"/>). Keys are cached for a few hours and fetched again when a token names a key
/// we don't have (providers rotate them), at most once a minute; a failed fetch is remembered for half a minute, so a
/// provider outage doesn't make every sign-in wait for its own timeout. Nothing from the token is logged.
/// </summary>
public sealed class ExternalTokenValidator : IExternalTokenValidator
{
    public const string HttpClientName = "external-auth";
    public const int MaxTokenLength = 8 * 1024;
    private const int MaxSubjectLength = 255;
    public static readonly TimeSpan ClockSkew = TimeSpan.FromMinutes(1);
    internal static readonly TimeSpan KeysFreshFor = TimeSpan.FromHours(6);
    internal static readonly TimeSpan RefetchGap = TimeSpan.FromMinutes(1);
    internal static readonly TimeSpan FailureMemory = TimeSpan.FromSeconds(30);

    /// <summary>Keys and when they were fetched, replaced together so a reader outside the lock never sees half of each.</summary>
    private sealed record KeySnapshot(IReadOnlyList<SecurityKey> Keys, DateTimeOffset FetchedAt);

    private sealed class KeyCache
    {
        public volatile KeySnapshot Snapshot = new([], DateTimeOffset.MinValue);
        /// <summary>Read and written only under <see cref="Lock"/>.</summary>
        public DateTimeOffset LastRefetch = DateTimeOffset.MinValue;
        /// <summary>When a fetch last failed. Read and written only under <see cref="Lock"/>.</summary>
        public DateTimeOffset LastFailure = DateTimeOffset.MinValue;
        public readonly SemaphoreSlim Lock = new(1, 1);
    }

    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _http;
    private readonly TimeProvider _time;
    private readonly ExternalTokenReplayGuard _replay;
    private readonly FacebookTokenVerifier _facebook;
    private readonly ILogger<ExternalTokenValidator> _log;
    private readonly JsonWebTokenHandler _handler = new();
    private readonly ConcurrentDictionary<string, KeyCache> _keys = new(StringComparer.Ordinal);

    public ExternalTokenValidator(IConfiguration config, IHttpClientFactory http, TimeProvider time, ExternalTokenReplayGuard replay,
        FacebookTokenVerifier facebook, ILogger<ExternalTokenValidator> log)
    {
        _config = config;
        _http = http;
        _time = time;
        _replay = replay;
        _facebook = facebook;
        _log = log;
    }

    /// <summary>Google and Apple when they have a client ID; Facebook when it has both its App ID and secret (only the ID is sent).</summary>
    public IReadOnlyList<ExternalProviderDto> GetEnabledProviders()
    {
        var list = ExternalProviders.All
            .Select(spec => (spec, ids: ExternalProviders.ClientIds(_config, spec)))
            .Where(p => p.ids.Length > 0)
            .Select(p => new ExternalProviderDto(p.spec.Id, p.spec.Name, p.ids[0]))
            .ToList();
        if (_facebook.App.IsConfigured) list.Add(new ExternalProviderDto(ExternalProviders.Facebook, "Facebook", _facebook.App.AppId!));
        return list;
    }

    /// <remarks>For Facebook, <paramref name="idToken"/> is the access token from its SDK and there is no nonce.</remarks>
    public async Task<ExternalTokenResult> ValidateAsync(string provider, string idToken, string? rawNonce, ExternalTokenUse use = ExternalTokenUse.Confirm,
        CancellationToken ct = default)
    {
        if (provider == ExternalProviders.Facebook) return await _facebook.VerifyAsync(idToken, singleUse: use != ExternalTokenUse.SignIn, ct);
        var spec = ExternalProviders.All.FirstOrDefault(s => s.Id == provider);
        var audiences = spec is null ? [] : ExternalProviders.ClientIds(_config, spec);
        if (spec is null || audiences.Length == 0) return ExternalTokenResult.Fail(ExternalTokenFailure.UnknownProvider);
        if (string.IsNullOrWhiteSpace(idToken) || idToken.Length > MaxTokenLength) return Refuse(spec, ExternalTokenFailure.Malformed);
        if (!ExternalNonce.IsWellFormed(rawNonce)) return Refuse(spec, ExternalTokenFailure.NonceMissing);

        JsonWebToken unverified;
        try { unverified = new JsonWebToken(idToken); }
        catch (Exception ex) when (ex is ArgumentException or SecurityTokenException) { return Refuse(spec, ExternalTokenFailure.Malformed); }

        var keys = await SigningKeysAsync(spec, unverified.Kid, ct);
        if (keys.Count == 0) return Refuse(spec, ExternalTokenFailure.KeysUnavailable);

        var checkedToken = await _handler.ValidateTokenAsync(idToken, new TokenValidationParameters
        {
            ValidIssuers = spec.Issuers,
            ValidAudiences = audiences,
            IssuerSigningKeys = keys,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            RequireAudience = true,
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = ClockSkew,
        });
        if (!checkedToken.IsValid || checkedToken.SecurityToken is not JsonWebToken token)
            return Refuse(spec, Classify(checkedToken.Exception));

        if (!ExternalNonce.Matches(Text(token, "nonce"), rawNonce)) return Refuse(spec, ExternalTokenFailure.NonceMismatch);

        var subject = Text(token, "sub");
        var email = Text(token, "email")?.Trim();
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > MaxSubjectLength || string.IsNullOrWhiteSpace(email))
            return Refuse(spec, ExternalTokenFailure.MissingClaims);

        var verified = Flag(token, "email_verified");
        var relay = spec.Id == ExternalProviders.Apple && (Flag(token, "is_private_email") || ExternalProviders.IsApplePrivateRelay(email));
        // A provider vouches for an address now only when it runs the mailbox. Any other address was verified once and
        // may have lost that mailbox since, so it never opens an existing account.
        var mayLink = verified && spec.Id switch
        {
            ExternalProviders.Google => ExternalProviders.IsGoogleHosted(email, Text(token, "hd")),
            _ => !relay && ExternalProviders.IsAppleHosted(email),
        };

        // Last, so a refused token never uses up its nonce: each token and nonce pair signs in once, on any instance.
        if (!await _replay.TryUseAsync(spec.Id, subject, Text(token, "nonce")!, new DateTimeOffset(token.ValidTo, TimeSpan.Zero)))
            return Refuse(spec, ExternalTokenFailure.Replayed);

        var name = spec.Id == ExternalProviders.Google ? GoogleName(token) : null;
        return new ExternalTokenResult(new ExternalIdentity(spec.Id, subject, email, verified, mayLink, relay, name), ExternalTokenFailure.None);
    }

    private ExternalTokenResult Refuse(ExternalProviders.Spec spec, ExternalTokenFailure failure)
    {
        if (failure == ExternalTokenFailure.KeysUnavailable)
            _log.LogWarning("Couldn't get {Provider}'s signing keys, so a sign-in was turned away.", spec.Name);
        else
            _log.LogInformation("Turned away a {Provider} ID token: {Reason}.", spec.Name, failure);
        return ExternalTokenResult.Fail(failure);
    }

    private static ExternalTokenFailure Classify(Exception? ex) => ex switch
    {
        SecurityTokenExpiredException => ExternalTokenFailure.Expired,
        SecurityTokenInvalidAudienceException => ExternalTokenFailure.Audience,
        SecurityTokenInvalidIssuerException => ExternalTokenFailure.Issuer,
        SecurityTokenInvalidSignatureException or SecurityTokenInvalidAlgorithmException => ExternalTokenFailure.Signature,
        // Anything else, such as a token not valid yet. (A malformed one never gets this far.)
        _ => ExternalTokenFailure.Invalid,
    };

    private static string? Text(JsonWebToken token, string claim)
        => token.TryGetPayloadValue<object>(claim, out var value) && value is string s ? s : null;

    /// <summary>Google sends JSON booleans; Apple has sent both <c>true</c> and <c>"true"</c>.</summary>
    private static bool Flag(JsonWebToken token, string claim)
    {
        if (!token.TryGetPayloadValue<object>(claim, out var value)) return false;
        return value switch
        {
            bool b => b,
            string s => string.Equals(s, "true", StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }

    private static string? GoogleName(JsonWebToken token)
    {
        var name = Text(token, "name");
        if (string.IsNullOrWhiteSpace(name))
            name = string.Join(' ', new[] { Text(token, "given_name"), Text(token, "family_name") }.Where(s => !string.IsNullOrWhiteSpace(s)));
        return string.IsNullOrWhiteSpace(name) ? null : name.Trim();
    }

    private async Task<IReadOnlyList<SecurityKey>> SigningKeysAsync(ExternalProviders.Spec spec, string? keyId, CancellationToken ct)
    {
        var cache = _keys.GetOrAdd(spec.Id, _ => new KeyCache());
        var snapshot = cache.Snapshot;
        if (Usable(snapshot, keyId)) return snapshot.Keys;
        await cache.Lock.WaitAsync(ct);
        try
        {
            snapshot = cache.Snapshot;
            if (Usable(snapshot, keyId)) return snapshot.Keys;
            var now = _time.GetUtcNow();
            var fresh = IsFresh(snapshot, now);
            // Fresh keys that don't include this token's key: the provider may have rotated, so look again, but only now
            // and then, or a stream of made-up key ids would have us fetching on every request.
            if (fresh && now - cache.LastRefetch < RefetchGap) return snapshot.Keys;
            // A fetch failed moments ago: answer at once rather than queue every sign-in behind another 10-second wait.
            if (now - cache.LastFailure < FailureMemory) return fresh ? snapshot.Keys : [];
            if (fresh) cache.LastRefetch = now;
            var fetched = await FetchKeysAsync(spec, ct);
            if (fetched.Count > 0)
                cache.Snapshot = snapshot = new KeySnapshot(fetched, now);
            else
                cache.LastFailure = _time.GetUtcNow();
            // Stale keys are never used once a fetch fails: a key the provider has withdrawn may be one that leaked.
            return IsFresh(snapshot, now) ? snapshot.Keys : [];
        }
        finally
        {
            cache.Lock.Release();
        }
    }

    private static bool IsFresh(KeySnapshot snapshot, DateTimeOffset now) => snapshot.Keys.Count > 0 && now - snapshot.FetchedAt < KeysFreshFor;

    private bool Usable(KeySnapshot snapshot, string? keyId)
        => IsFresh(snapshot, _time.GetUtcNow()) && (keyId is null || snapshot.Keys.Any(k => k.KeyId == keyId));

    private async Task<IReadOnlyList<SecurityKey>> FetchKeysAsync(ExternalProviders.Spec spec, CancellationToken ct)
    {
        try
        {
            using var response = await _http.CreateClient(HttpClientName).GetAsync(spec.KeysUri, ct);
            if (!response.IsSuccessStatusCode)
            {
                _log.LogWarning("{Provider}'s signing keys answered {Status}.", spec.Name, (int)response.StatusCode);
                return [];
            }
            return new JsonWebKeySet(await response.Content.ReadAsStringAsync(ct)).GetSigningKeys().ToList();
        }
        catch (Exception ex) when (!ct.IsCancellationRequested
                                   && ex is HttpRequestException or TaskCanceledException or ArgumentException or JsonException or InvalidOperationException)
        {
            _log.LogWarning("Fetching {Provider}'s signing keys failed: {Error}.", spec.Name, ex.GetType().Name);
            return [];
        }
    }
}
