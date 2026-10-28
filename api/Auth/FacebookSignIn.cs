using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.WebUtilities;

namespace MountedGames.Api.Auth;

/// <summary>
/// The Facebook app's settings. Facebook is on only when both <c>Auth:Facebook:AppId</c> and <c>Auth:Facebook:AppSecret</c>
/// are set. The App ID is public (the browser's SDK needs it); the secret never leaves the API. <c>Auth:Facebook:GraphVersion</c>
/// pins the Graph API version (default <see cref="DefaultGraphVersion"/>); anything that isn't a plain version is ignored.
/// </summary>
public sealed partial class FacebookApp(IConfiguration config)
{
    public const string DefaultGraphVersion = "v23.0";

    [GeneratedRegex("^v[0-9]{1,2}\\.[0-9]$")]
    private static partial Regex VersionShape();

    public string? AppId => NonEmpty(config["Auth:Facebook:AppId"]);
    public string? AppSecret => NonEmpty(config["Auth:Facebook:AppSecret"]);
    public bool IsConfigured => AppId is not null && AppSecret is not null;

    public string GraphVersion
    {
        get
        {
            var version = NonEmpty(config["Auth:Facebook:GraphVersion"]);
            return version is not null && VersionShape().IsMatch(version) ? version : DefaultGraphVersion;
        }
    }

    /// <summary>Facebook's <c>appsecret_proof</c>: the HMAC-SHA256 of an access token, keyed with the app secret, in hex.</summary>
    public static string Proof(string accessToken, string appSecret)
        => Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(appSecret), Encoding.UTF8.GetBytes(accessToken)));

    private static string? NonEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

/// <summary>
/// Checks a Facebook Login access token. Web Facebook Login gives no ID token to check offline, so the API asks Facebook:
/// <c>debug_token</c> (with our app's own token) must say it is valid, for our app, for a user, unexpired and with
/// <c>public_profile</c>; then <c>/me</c> gives the id, name and email (which may be missing, and is never treated as
/// verified). Both calls go to the fixed <c>graph.facebook.com</c> at a pinned version, carry <c>appsecret_proof</c>, send
/// their own access token in the <c>Authorization</c> header rather than the address (only the token being checked is a
/// parameter, as <c>debug_token</c> requires), and use the <c>external-auth</c> client (short timeout, small replies, no
/// redirects, no request logging). Nothing from either reply is logged.
/// <para>Signing in may present the same token again, because Facebook's SDK keeps handing back the one it has; each
/// sign-in records the token as seen. Confirming it's the owner needs a token never seen at a sign-in, used once, and
/// (when <c>debug_token</c> gives <c>issued_at</c>) issued in the last <see cref="ConfirmFreshFor"/>, so a token captured
/// from an ordinary sign-in can't stand in for a fresh log-in. Adding Facebook to an account uses a token once. All of it
/// is kept in <see cref="ExternalTokenReplayGuard"/>; see <see cref="ExternalTokenUse"/>.</para>
/// </summary>
public sealed class FacebookTokenVerifier(
    FacebookApp app, IHttpClientFactory http, ExternalTokenReplayGuard replay, TimeProvider time, ILogger<FacebookTokenVerifier> log)
{
    public const string GraphHost = "https://graph.facebook.com";
    private const int MaxUserIdLength = 64;
    /// <summary>How recently a token used to confirm it's the owner must have been issued, when Facebook says.</summary>
    public static readonly TimeSpan ConfirmFreshFor = TimeSpan.FromMinutes(10);
    /// <summary>The replay store's name for tokens seen at a sign-in, apart from those used once.</summary>
    private const string SeenAtSignIn = "facebook-signin";

    public FacebookApp App => app;

    private sealed record DebugData(
        [property: System.Text.Json.Serialization.JsonPropertyName("is_valid")] bool IsValid,
        [property: System.Text.Json.Serialization.JsonPropertyName("app_id")] string? AppId,
        [property: System.Text.Json.Serialization.JsonPropertyName("type")] string? Type,
        [property: System.Text.Json.Serialization.JsonPropertyName("user_id")] string? UserId,
        [property: System.Text.Json.Serialization.JsonPropertyName("expires_at")] long ExpiresAt,
        [property: System.Text.Json.Serialization.JsonPropertyName("issued_at")] long? IssuedAt,
        [property: System.Text.Json.Serialization.JsonPropertyName("scopes")] string[]? Scopes);

    private sealed record DebugReply([property: System.Text.Json.Serialization.JsonPropertyName("data")] DebugData? Data);

    private sealed record Me(
        [property: System.Text.Json.Serialization.JsonPropertyName("id")] string? Id,
        [property: System.Text.Json.Serialization.JsonPropertyName("name")] string? Name,
        [property: System.Text.Json.Serialization.JsonPropertyName("email")] string? Email);

    /// <param name="use">Signing in, confirming it's the owner, or adding Facebook (<see cref="ExternalTokenUse"/>).</param>
    public async Task<ExternalTokenResult> VerifyAsync(string accessToken, ExternalTokenUse use, CancellationToken ct)
    {
        if (!app.IsConfigured) return ExternalTokenResult.Fail(ExternalTokenFailure.UnknownProvider);
        if (string.IsNullOrWhiteSpace(accessToken) || accessToken.Length > ExternalTokenValidator.MaxTokenLength || accessToken.Any(char.IsWhiteSpace))
            return Refuse(ExternalTokenFailure.Malformed);

        var appToken = $"{app.AppId}|{app.AppSecret}";
        var debug = await GetAsync<DebugReply>(
            $"debug_token?input_token={Uri.EscapeDataString(accessToken)}&appsecret_proof={FacebookApp.Proof(appToken, app.AppSecret!)}", appToken, ct);
        if (debug.Failure is { } debugFailure) return Refuse(debugFailure);
        var data = debug.Value?.Data;
        if (data is null || !data.IsValid) return Refuse(ExternalTokenFailure.Invalid);
        if (data.AppId != app.AppId) return Refuse(ExternalTokenFailure.Audience);
        var expires = DateTimeOffset.FromUnixTimeSeconds(Math.Max(0, data.ExpiresAt));
        if (data.ExpiresAt <= 0 || expires <= time.GetUtcNow()) return Refuse(ExternalTokenFailure.Expired);
        if (!string.Equals(data.Type, "USER", StringComparison.Ordinal) || string.IsNullOrEmpty(data.UserId) || data.UserId.Length > MaxUserIdLength
            || data.Scopes?.Contains("public_profile") != true)
            return Refuse(ExternalTokenFailure.MissingClaims);

        var me = await GetAsync<Me>($"me?fields=id,name,email&appsecret_proof={FacebookApp.Proof(accessToken, app.AppSecret!)}", accessToken, ct);
        if (me.Failure is { } meFailure) return Refuse(meFailure);
        if (me.Value?.Id != data.UserId) return Refuse(ExternalTokenFailure.MissingClaims);

        // There's no nonce in this flow, so the token itself (hashed) is what is remembered.
        var tokenHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(accessToken)));
        if (use == ExternalTokenUse.SignIn)
        {
            // Recorded, never refused: Facebook's SDK reuses its token. This bars it from confirming later.
            await replay.TryUseAsync(SeenAtSignIn, data.UserId, tokenHash, expires);
        }
        else
        {
            if (use == ExternalTokenUse.Confirm)
            {
                if (await replay.IsUsedAsync(SeenAtSignIn, data.UserId, tokenHash)) return Refuse(ExternalTokenFailure.Replayed);
                var now = time.GetUtcNow();
                if (data.IssuedAt is { } issuedSeconds)
                {
                    var issued = DateTimeOffset.FromUnixTimeSeconds(Math.Clamp(issuedSeconds, 0, DateTimeOffset.MaxValue.ToUnixTimeSeconds()));
                    if (issued < now - ConfirmFreshFor || issued > now + ExternalTokenValidator.ClockSkew) return Refuse(ExternalTokenFailure.NotFresh);
                }
            }
            if (!await replay.TryUseAsync(ExternalProviders.Facebook, data.UserId, tokenHash, expires))
                return Refuse(ExternalTokenFailure.Replayed);
        }

        var email = string.IsNullOrWhiteSpace(me.Value.Email) ? null : me.Value.Email.Trim();
        var name = string.IsNullOrWhiteSpace(me.Value.Name) ? null : me.Value.Name.Trim();
        return new ExternalTokenResult(
            new ExternalIdentity(ExternalProviders.Facebook, data.UserId, email, EmailVerified: false, MayLinkByEmail: false, IsPrivateRelay: false, name),
            ExternalTokenFailure.None);
    }

    private ExternalTokenResult Refuse(ExternalTokenFailure failure)
    {
        if (failure == ExternalTokenFailure.ProviderUnavailable)
            log.LogWarning("Couldn't reach Facebook to check a sign-in, so it was turned away.");
        else
            log.LogInformation("Turned away a Facebook sign-in: {Reason}.", failure);
        return ExternalTokenResult.Fail(failure);
    }

    /// <summary>
    /// One Graph call. Facebook answers a bad token with a 4xx, which is a refusal; no answer, a 5xx or a garbled reply
    /// means Facebook couldn't be asked.
    /// </summary>
    private async Task<(T? Value, ExternalTokenFailure? Failure)> GetAsync<T>(string pathAndQuery, string accessToken, CancellationToken ct) where T : class
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{GraphHost}/{app.GraphVersion}/{pathAndQuery}");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await http.CreateClient(ExternalTokenValidator.HttpClientName).SendAsync(request, ct);
            if ((int)response.StatusCode is >= 400 and < 500) return (null, ExternalTokenFailure.Invalid);
            if (!response.IsSuccessStatusCode) return (null, ExternalTokenFailure.ProviderUnavailable);
            return (JsonSerializer.Deserialize<T>(await response.Content.ReadAsStringAsync(ct)), null);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested && ex is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException)
        {
            return (null, ExternalTokenFailure.ProviderUnavailable);
        }
    }
}

/// <summary>
/// A data deletion request Facebook signed for our app: who it is about, when Facebook made it, and its signature (the
/// HMAC bytes, in hex), which identifies the request however it was encoded.
/// </summary>
public sealed record FacebookDeletionRequest(string UserId, DateTimeOffset IssuedAt, string Signature);

/// <summary>
/// Facebook's data deletion callback request: <c>signed_request</c> is two base64url parts, the HMAC-SHA256 of the second
/// (keyed with the app secret) and a JSON payload naming the Facebook user and when it was issued. Anything not signed
/// by our secret is refused, and so is one issued more than <see cref="MaxAge"/> ago or in the future (allowing
/// <see cref="ExternalTokenValidator.ClockSkew"/>), so an old request can't be sent again later. Both parts must be plain
/// unpadded base64url and the signature exactly its canonical 43 characters: the decoder would otherwise accept the same
/// bytes with spaces, padding or different spare bits, which would let one request pass as a new one.
/// </summary>
public static partial class FacebookSignedRequest
{
    private const int MaxLength = 4096;
    public static readonly TimeSpan MaxAge = TimeSpan.FromHours(24);

    [GeneratedRegex("^[A-Za-z0-9_-]{43}$")]
    private static partial Regex SignatureShape();

    [GeneratedRegex("^[A-Za-z0-9_-]+$")]
    private static partial Regex PayloadShape();

    private sealed record Payload(
        [property: System.Text.Json.Serialization.JsonPropertyName("algorithm")] string? Algorithm,
        [property: System.Text.Json.Serialization.JsonPropertyName("issued_at")] long? IssuedAt,
        [property: System.Text.Json.Serialization.JsonPropertyName("user_id")] string? UserId);

    /// <summary>The request, or null when it isn't one Facebook signed for our app, or it is too old or from the future.</summary>
    public static FacebookDeletionRequest? Read(string? signedRequest, string appSecret, DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(signedRequest) || signedRequest.Length > MaxLength) return null;
        var parts = signedRequest.Split('.');
        if (parts.Length != 2 || !SignatureShape().IsMatch(parts[0]) || !PayloadShape().IsMatch(parts[1])) return null;
        try
        {
            var signature = WebEncoders.Base64UrlDecode(parts[0]);
            // The one spelling of these bytes: no other set of spare bits in the last character.
            if (!string.Equals(WebEncoders.Base64UrlEncode(signature), parts[0], StringComparison.Ordinal)) return null;
            var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(appSecret), Encoding.ASCII.GetBytes(parts[1]));
            if (!CryptographicOperations.FixedTimeEquals(signature, expected)) return null;
            var payload = JsonSerializer.Deserialize<Payload>(WebEncoders.Base64UrlDecode(parts[1]));
            if (payload is null || !string.Equals(payload.Algorithm, "HMAC-SHA256", StringComparison.OrdinalIgnoreCase)) return null;
            if (string.IsNullOrWhiteSpace(payload.UserId) || payload.IssuedAt is not { } seconds) return null;
            if (seconds < now.Add(-MaxAge).ToUnixTimeSeconds() || seconds > now.Add(ExternalTokenValidator.ClockSkew).ToUnixTimeSeconds()) return null;
            return new FacebookDeletionRequest(payload.UserId, DateTimeOffset.FromUnixTimeSeconds(seconds), Convert.ToHexStringLower(signature));
        }
        catch (Exception ex) when (ex is FormatException or JsonException or ArgumentOutOfRangeException)
        {
            return null;
        }
    }
}
