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

    [GeneratedRegex(@"^v\d{1,2}\.\d$")]
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
/// verified). Both calls go to the fixed <c>graph.facebook.com</c> at a pinned version, carry <c>appsecret_proof</c>, and
/// use the <c>external-auth</c> client (short timeout, small replies, no redirects, no request logging). A token works
/// once (<see cref="ExternalTokenReplayGuard"/>). Nothing from either reply is logged.
/// </summary>
public sealed class FacebookTokenVerifier(
    FacebookApp app, IHttpClientFactory http, ExternalTokenReplayGuard replay, TimeProvider time, ILogger<FacebookTokenVerifier> log)
{
    public const string GraphHost = "https://graph.facebook.com";
    private const int MaxUserIdLength = 64;

    public FacebookApp App => app;

    private sealed record DebugData(
        [property: System.Text.Json.Serialization.JsonPropertyName("is_valid")] bool IsValid,
        [property: System.Text.Json.Serialization.JsonPropertyName("app_id")] string? AppId,
        [property: System.Text.Json.Serialization.JsonPropertyName("type")] string? Type,
        [property: System.Text.Json.Serialization.JsonPropertyName("user_id")] string? UserId,
        [property: System.Text.Json.Serialization.JsonPropertyName("expires_at")] long ExpiresAt,
        [property: System.Text.Json.Serialization.JsonPropertyName("scopes")] string[]? Scopes);

    private sealed record DebugReply([property: System.Text.Json.Serialization.JsonPropertyName("data")] DebugData? Data);

    private sealed record Me(
        [property: System.Text.Json.Serialization.JsonPropertyName("id")] string? Id,
        [property: System.Text.Json.Serialization.JsonPropertyName("name")] string? Name,
        [property: System.Text.Json.Serialization.JsonPropertyName("email")] string? Email);

    public async Task<ExternalTokenResult> VerifyAsync(string accessToken, CancellationToken ct)
    {
        if (!app.IsConfigured) return ExternalTokenResult.Fail(ExternalTokenFailure.UnknownProvider);
        if (string.IsNullOrWhiteSpace(accessToken) || accessToken.Length > ExternalTokenValidator.MaxTokenLength || accessToken.Any(char.IsWhiteSpace))
            return Refuse(ExternalTokenFailure.Malformed);

        var appToken = $"{app.AppId}|{app.AppSecret}";
        var debug = await GetAsync<DebugReply>(
            $"debug_token?input_token={Uri.EscapeDataString(accessToken)}&access_token={Uri.EscapeDataString(appToken)}&appsecret_proof={FacebookApp.Proof(appToken, app.AppSecret!)}",
            ct);
        if (debug.Failure is { } debugFailure) return Refuse(debugFailure);
        var data = debug.Value?.Data;
        if (data is null || !data.IsValid) return Refuse(ExternalTokenFailure.Invalid);
        if (data.AppId != app.AppId) return Refuse(ExternalTokenFailure.Audience);
        var expires = DateTimeOffset.FromUnixTimeSeconds(Math.Max(0, data.ExpiresAt));
        if (data.ExpiresAt <= 0 || expires <= time.GetUtcNow()) return Refuse(ExternalTokenFailure.Expired);
        if (!string.Equals(data.Type, "USER", StringComparison.Ordinal) || string.IsNullOrEmpty(data.UserId) || data.UserId.Length > MaxUserIdLength
            || data.Scopes?.Contains("public_profile") != true)
            return Refuse(ExternalTokenFailure.MissingClaims);

        var me = await GetAsync<Me>(
            $"me?fields=id,name,email&access_token={Uri.EscapeDataString(accessToken)}&appsecret_proof={FacebookApp.Proof(accessToken, app.AppSecret!)}",
            ct);
        if (me.Failure is { } meFailure) return Refuse(meFailure);
        if (me.Value?.Id != data.UserId) return Refuse(ExternalTokenFailure.MissingClaims);

        // There's no nonce in this flow, so the token itself (hashed) is what can't be used twice.
        if (!await replay.TryUseAsync(ExternalProviders.Facebook, data.UserId, Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(accessToken))), expires))
            return Refuse(ExternalTokenFailure.Replayed);

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
    private async Task<(T? Value, ExternalTokenFailure? Failure)> GetAsync<T>(string pathAndQuery, CancellationToken ct) where T : class
    {
        try
        {
            using var response = await http.CreateClient(ExternalTokenValidator.HttpClientName)
                .GetAsync($"{GraphHost}/{app.GraphVersion}/{pathAndQuery}", ct);
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
/// Facebook's data deletion callback request: <c>signed_request</c> is two base64url parts, the HMAC-SHA256 of the second
/// (keyed with the app secret) and a JSON payload naming the Facebook user. Anything not signed by our secret is refused.
/// </summary>
public static class FacebookSignedRequest
{
    private const int MaxLength = 4096;

    private sealed record Payload(
        [property: System.Text.Json.Serialization.JsonPropertyName("algorithm")] string? Algorithm,
        [property: System.Text.Json.Serialization.JsonPropertyName("user_id")] string? UserId);

    /// <summary>The Facebook user id, or null when the request isn't one Facebook signed for our app.</summary>
    public static string? UserIdFrom(string? signedRequest, string appSecret)
    {
        if (string.IsNullOrEmpty(signedRequest) || signedRequest.Length > MaxLength) return null;
        var parts = signedRequest.Split('.');
        if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0) return null;
        try
        {
            var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(appSecret), Encoding.ASCII.GetBytes(parts[1]));
            if (!CryptographicOperations.FixedTimeEquals(WebEncoders.Base64UrlDecode(parts[0]), expected)) return null;
            var payload = JsonSerializer.Deserialize<Payload>(WebEncoders.Base64UrlDecode(parts[1]));
            if (!string.Equals(payload?.Algorithm, "HMAC-SHA256", StringComparison.OrdinalIgnoreCase)) return null;
            return string.IsNullOrWhiteSpace(payload.UserId) ? null : payload.UserId;
        }
        catch (Exception ex) when (ex is FormatException or JsonException)
        {
            return null;
        }
    }
}
