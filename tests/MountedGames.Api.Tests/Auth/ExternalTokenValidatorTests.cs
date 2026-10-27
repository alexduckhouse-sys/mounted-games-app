using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.Tokens;
using MountedGames.Api.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// The ID token checks on their own: signature, issuer, audience, expiry and nonce, plus the key cache. Tokens are signed
/// with local test keys and the providers' key addresses are answered by <see cref="StubHttp"/>.
/// </summary>
public sealed class ExternalTokenValidatorTests : IDisposable
{
    private const string Web = "web-client.apps.googleusercontent.com";
    private const string Ios = "ios-client.apps.googleusercontent.com";
    private const string AppleWeb = "uk.example.mountedgames.web";
    private const string GoogleKeys = "www.googleapis.com/oauth2/v3/certs";
    private const string AppleKeys = "appleid.apple.com/auth/keys";

    private readonly IdTokenSigner _google = new("g-1");
    private readonly IdTokenSigner _apple = new("a-1");
    private readonly StubHttp _http = new();
    private readonly ManualTimeProvider _clock = new();
    private string _googleJwks;
    private HttpStatusCode _googleStatus = HttpStatusCode.OK;

    public ExternalTokenValidatorTests()
    {
        _googleJwks = IdTokenSigner.Jwks(_google);
        _http.Respond(GoogleKeys, _ => new HttpResponseMessage(_googleStatus) { Content = new StringContent(_googleJwks, Encoding.UTF8, "application/json") });
        _http.Respond(AppleKeys, _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(IdTokenSigner.Jwks(_apple), Encoding.UTF8, "application/json") });
    }

    public void Dispose()
    {
        _google.Dispose();
        _apple.Dispose();
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private ExternalTokenValidator Validator(params (string Key, string? Value)[] settings)
    {
        var values = settings.Length > 0 ? settings : [("Auth:Google:ClientIds:0", Web), ("Auth:Google:ClientIds:1", Ios), ("Auth:Apple:ClientIds:0", AppleWeb)];
        var config = new ConfigurationBuilder().AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value))).Build();
        return new ExternalTokenValidator(config, new Factory(_http), _clock, NullLogger<ExternalTokenValidator>.Instance);
    }

    private int KeyFetches(string fragment) => _http.Requests.Count(r => r.Contains(fragment, StringComparison.OrdinalIgnoreCase));

    private string GoogleToken(string nonce, string email = "rider@gmail.com", string audience = Web, IDictionary<string, object>? extra = null)
        => _google.Sign(IdTokenSigner.GoogleIssuer, audience, "g-sub-1", email, nonce, emailVerified: true, extra: extra);

    [Fact]
    public async Task AValidGoogleTokenGivesTheIdentity()
    {
        var nonce = IdTokenSigner.NewNonce();
        var result = await Validator().ValidateAsync("google", GoogleToken(nonce, extra: new Dictionary<string, object> { ["name"] = "Alex Rider" }), nonce);

        Assert.Equal(ExternalTokenFailure.None, result.Failure);
        Assert.Equal(new ExternalIdentity("google", "g-sub-1", "rider@gmail.com", true, true, false, "Alex Rider"), result.Identity);
    }

    [Fact]
    public async Task AnyConfiguredAudienceIsAcceptedAndNoOther()
    {
        var validator = Validator();
        var nonce = IdTokenSigner.NewNonce();

        Assert.Equal(ExternalTokenFailure.None, (await validator.ValidateAsync("google", GoogleToken(nonce, audience: Ios), nonce)).Failure);
        Assert.Equal(ExternalTokenFailure.Audience, (await validator.ValidateAsync("google", GoogleToken(nonce, audience: "someone-else.apps.googleusercontent.com"), nonce)).Failure);
        // A Google token is never good for Apple, even signed by a key Apple might hold.
        Assert.Equal(ExternalTokenFailure.Audience, (await validator.ValidateAsync("google", GoogleToken(nonce, audience: AppleWeb), nonce)).Failure);
    }

    [Theory]
    [InlineData("https://accounts.google.com", ExternalTokenFailure.None)]
    [InlineData("accounts.google.com", ExternalTokenFailure.None)]
    [InlineData("https://accounts.google.com/", ExternalTokenFailure.Issuer)]
    [InlineData("https://appleid.apple.com", ExternalTokenFailure.Issuer)]
    [InlineData("https://evil.example.com", ExternalTokenFailure.Issuer)]
    public async Task OnlyGooglesOwnIssuersAreAccepted(string issuer, ExternalTokenFailure expected)
    {
        var nonce = IdTokenSigner.NewNonce();
        var token = _google.Sign(issuer, Web, "g-sub-1", "rider@gmail.com", nonce, emailVerified: true);
        Assert.Equal(expected, (await Validator().ValidateAsync("google", token, nonce)).Failure);
    }

    [Fact]
    public async Task AnExpiredTokenIsRefused()
    {
        var nonce = IdTokenSigner.NewNonce();
        var token = _google.Sign(IdTokenSigner.GoogleIssuer, Web, "g-sub-1", "rider@gmail.com", nonce, emailVerified: true, expires: DateTime.UtcNow.AddMinutes(-5));
        Assert.Equal(ExternalTokenFailure.Expired, (await Validator().ValidateAsync("google", token, nonce)).Failure);
    }

    [Fact]
    public async Task ATokenNotValidYetIsRefused()
    {
        var nonce = IdTokenSigner.NewNonce();
        // Valid from an hour from now (the signer starts validity an hour before expiry).
        var token = _google.Sign(IdTokenSigner.GoogleIssuer, Web, "g-sub-1", "rider@gmail.com", nonce, emailVerified: true, expires: DateTime.UtcNow.AddHours(2));
        Assert.Equal(ExternalTokenFailure.Invalid, (await Validator().ValidateAsync("google", token, nonce)).Failure);
    }

    [Fact]
    public async Task ATokenSignedWithAnotherKeyIsRefused()
    {
        var nonce = IdTokenSigner.NewNonce();
        // Same key id as Google's, different key: the signature can't verify.
        using var impostor = new IdTokenSigner("g-1");
        var token = impostor.Sign(IdTokenSigner.GoogleIssuer, Web, "g-sub-1", "rider@gmail.com", nonce, emailVerified: true);
        Assert.Equal(ExternalTokenFailure.Signature, (await Validator().ValidateAsync("google", token, nonce)).Failure);
    }

    [Fact]
    public async Task ASymmetricallySignedTokenIsRefused()
    {
        var nonce = IdTokenSigner.NewNonce();
        var hmac = new SigningCredentials(new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(32)) { KeyId = "g-1" }, SecurityAlgorithms.HmacSha256);
        var token = _google.Sign(IdTokenSigner.GoogleIssuer, Web, "g-sub-1", "rider@gmail.com", nonce, emailVerified: true, credentials: hmac);
        Assert.Equal(ExternalTokenFailure.Signature, (await Validator().ValidateAsync("google", token, nonce)).Failure);
    }

    [Fact]
    public async Task TheNonceMustBeTheHashOfTheRawValueSent()
    {
        var validator = Validator();
        var nonce = IdTokenSigner.NewNonce();
        var token = GoogleToken(nonce);

        Assert.Equal(ExternalTokenFailure.NonceMissing, (await validator.ValidateAsync("google", token, null)).Failure);
        Assert.Equal(ExternalTokenFailure.NonceMissing, (await validator.ValidateAsync("google", token, "")).Failure);
        Assert.Equal(ExternalTokenFailure.NonceMissing, (await validator.ValidateAsync("google", token, "too-short")).Failure);
        Assert.Equal(ExternalTokenFailure.NonceMissing, (await validator.ValidateAsync("google", token, new string('a', ExternalNonce.MaxLength + 1))).Failure);
        Assert.Equal(ExternalTokenFailure.NonceMissing, (await validator.ValidateAsync("google", token, "has a space in it, so no")).Failure);
        Assert.Equal(ExternalTokenFailure.NonceMismatch, (await validator.ValidateAsync("google", token, IdTokenSigner.NewNonce())).Failure);
        // Someone holding only the token knows the hash, not the raw value it came from.
        Assert.Equal(ExternalTokenFailure.NonceMismatch, (await validator.ValidateAsync("google", token, ExternalNonce.Hash(nonce))).Failure);

        var withoutNonce = _google.Sign(IdTokenSigner.GoogleIssuer, Web, "g-sub-1", "rider@gmail.com", nonce: null, emailVerified: true);
        Assert.Equal(ExternalTokenFailure.NonceMismatch, (await validator.ValidateAsync("google", withoutNonce, nonce)).Failure);
        var rawInToken = _google.Sign(IdTokenSigner.GoogleIssuer, Web, "g-sub-1", "rider@gmail.com", nonce, emailVerified: true, rawNonceClaim: true);
        Assert.Equal(ExternalTokenFailure.NonceMismatch, (await validator.ValidateAsync("google", rawInToken, nonce)).Failure);

        Assert.Equal(ExternalTokenFailure.None, (await validator.ValidateAsync("google", token, nonce)).Failure);
    }

    [Fact]
    public async Task MalformedTokensAndMissingClaimsAreRefused()
    {
        var validator = Validator();
        var nonce = IdTokenSigner.NewNonce();

        Assert.Equal(ExternalTokenFailure.Malformed, (await validator.ValidateAsync("google", "", nonce)).Failure);
        Assert.Equal(ExternalTokenFailure.Malformed, (await validator.ValidateAsync("google", "not-a-jwt", nonce)).Failure);
        Assert.Equal(ExternalTokenFailure.Malformed, (await validator.ValidateAsync("google", new string('a', ExternalTokenValidator.MaxTokenLength + 1), nonce)).Failure);
        var noEmail = _google.Sign(IdTokenSigner.GoogleIssuer, Web, "g-sub-1", email: null, nonce, emailVerified: true);
        Assert.Equal(ExternalTokenFailure.MissingClaims, (await validator.ValidateAsync("google", noEmail, nonce)).Failure);
        var noSubject = _google.Sign(IdTokenSigner.GoogleIssuer, Web, subject: null, "rider@gmail.com", nonce, emailVerified: true);
        Assert.Equal(ExternalTokenFailure.MissingClaims, (await validator.ValidateAsync("google", noSubject, nonce)).Failure);
        var longSubject = _google.Sign(IdTokenSigner.GoogleIssuer, Web, new string('1', 256), "rider@gmail.com", nonce, emailVerified: true);
        Assert.Equal(ExternalTokenFailure.MissingClaims, (await validator.ValidateAsync("google", longSubject, nonce)).Failure);
    }

    [Fact]
    public async Task OnlyConfiguredProvidersAreOfferedOrAccepted()
    {
        var nonce = IdTokenSigner.NewNonce();
        var googleOnly = Validator(("Auth:Google:ClientIds", $" {Web} , {Ios},"), ("Auth:Apple:ClientIds:0", "  "));

        var offered = Assert.Single(googleOnly.GetEnabledProviders());
        Assert.Equal(new ExternalProviderDto("google", "Google", Web), offered);
        Assert.Equal(ExternalTokenFailure.None, (await googleOnly.ValidateAsync("google", GoogleToken(nonce, audience: Ios), nonce)).Failure);

        var appleToken = _apple.Sign(IdTokenSigner.AppleIssuer, AppleWeb, "a-sub", "rider@icloud.com", nonce, emailVerified: true);
        Assert.Equal(ExternalTokenFailure.UnknownProvider, (await googleOnly.ValidateAsync("apple", appleToken, nonce)).Failure);
        Assert.Equal(ExternalTokenFailure.UnknownProvider, (await googleOnly.ValidateAsync("microsoft", appleToken, nonce)).Failure);
        Assert.Equal(0, KeyFetches(AppleKeys));

        var none = Validator(("Unrelated", "x"));
        Assert.Empty(none.GetEnabledProviders());
        Assert.Equal(ExternalTokenFailure.UnknownProvider, (await none.ValidateAsync("google", GoogleToken(nonce), nonce)).Failure);
        Assert.Equal(new[] { "google", "apple" }, Validator().GetEnabledProviders().Select(p => p.Id));
    }

    [Theory]
    [InlineData("rider@gmail.com", null, true)]
    [InlineData("rider@googlemail.com", null, true)]
    [InlineData("coach@ponyclub.example", "ponyclub.example", true)]
    [InlineData("parent@btinternet.example", null, false)]
    public async Task GoogleVouchesForAnAddressOnlyWhenItHostsIt(string email, string? hostedDomain, bool mayLink)
    {
        var nonce = IdTokenSigner.NewNonce();
        var extra = new Dictionary<string, object> { ["given_name"] = "Sam", ["family_name"] = "Taylor" };
        if (hostedDomain is not null) extra["hd"] = hostedDomain;
        var identity = (await Validator().ValidateAsync("google", GoogleToken(nonce, email, extra: extra), nonce)).Identity!;

        Assert.True(identity.EmailVerified);
        Assert.Equal(mayLink, identity.MayLinkByEmail);
        Assert.Equal("Sam Taylor", identity.Name);
    }

    [Fact]
    public async Task AnUnverifiedGoogleAddressIsNeitherVerifiedNorLinkable()
    {
        var nonce = IdTokenSigner.NewNonce();
        var token = _google.Sign(IdTokenSigner.GoogleIssuer, Web, "g-sub-1", "rider@gmail.com", nonce, emailVerified: false);
        var identity = (await Validator().ValidateAsync("google", token, nonce)).Identity!;
        Assert.False(identity.EmailVerified);
        Assert.False(identity.MayLinkByEmail);
        Assert.Null(identity.Name);
    }

    [Theory]
    [InlineData("rider@icloud.com", "true", null, true, false)]
    [InlineData("rider@icloud.com", true, false, true, false)]
    [InlineData("x7k2q9@privaterelay.appleid.com", "true", "true", false, true)]
    [InlineData("x7k2q9@privaterelay.appleid.com", true, null, false, true)]
    [InlineData("rider@icloud.com", "false", null, false, false)]
    [InlineData("rider@icloud.com", 1, null, false, false)]
    public async Task AppleAddressesAreLinkableUnlessHidden(string email, object verified, object? isPrivate, bool mayLink, bool relay)
    {
        var nonce = IdTokenSigner.NewNonce();
        var extra = new Dictionary<string, object> { ["name"] = "Never In Apple Tokens" };
        if (isPrivate is not null) extra["is_private_email"] = isPrivate;
        var token = _apple.Sign(IdTokenSigner.AppleIssuer, AppleWeb, "001234.abcdef.1234", email, nonce, emailVerified: verified, extra: extra);

        var identity = (await Validator().ValidateAsync("apple", token, nonce)).Identity!;
        Assert.Equal("apple", identity.Provider);
        Assert.Equal(mayLink, identity.MayLinkByEmail);
        Assert.Equal(relay, identity.IsPrivateRelay);
        // Apple's name never comes from the token.
        Assert.Null(identity.Name);
    }

    [Fact]
    public async Task AnAppleTokenSignedByGoogleOrForGoogleIsRefused()
    {
        var validator = Validator();
        var nonce = IdTokenSigner.NewNonce();
        var signedByGoogleKey = _google.Sign(IdTokenSigner.AppleIssuer, AppleWeb, "a-sub", "rider@icloud.com", nonce, emailVerified: true);
        Assert.Equal(ExternalTokenFailure.Signature, (await validator.ValidateAsync("apple", signedByGoogleKey, nonce)).Failure);
        var googleIssued = _apple.Sign(IdTokenSigner.GoogleIssuer, AppleWeb, "a-sub", "rider@icloud.com", nonce, emailVerified: true);
        Assert.Equal(ExternalTokenFailure.Issuer, (await validator.ValidateAsync("apple", googleIssued, nonce)).Failure);
    }

    [Fact]
    public async Task KeysAreCachedThenFetchedAgainWhenAnUnknownKeyAppearsButNotMoreThanOnceAMinute()
    {
        var validator = Validator();
        var nonce = IdTokenSigner.NewNonce();

        Assert.Equal(ExternalTokenFailure.None, (await validator.ValidateAsync("google", GoogleToken(nonce), nonce)).Failure);
        Assert.Equal(ExternalTokenFailure.None, (await validator.ValidateAsync("google", GoogleToken(nonce), nonce)).Failure);
        Assert.Equal(1, KeyFetches(GoogleKeys));

        // Google starts signing with a new key it hasn't published yet: one look, then no more for a minute.
        using var rotated = new IdTokenSigner("g-2");
        var withNewKey = rotated.Sign(IdTokenSigner.GoogleIssuer, Web, "g-sub-1", "rider@gmail.com", nonce, emailVerified: true);
        Assert.Equal(ExternalTokenFailure.Signature, (await validator.ValidateAsync("google", withNewKey, nonce)).Failure);
        Assert.Equal(2, KeyFetches(GoogleKeys));
        Assert.Equal(ExternalTokenFailure.Signature, (await validator.ValidateAsync("google", withNewKey, nonce)).Failure);
        Assert.Equal(2, KeyFetches(GoogleKeys));

        // Once published, the new key is picked up after the gap, and the old one still works.
        _googleJwks = IdTokenSigner.Jwks(_google, rotated);
        _clock.Advance(ExternalTokenValidator.RefetchGap);
        Assert.Equal(ExternalTokenFailure.None, (await validator.ValidateAsync("google", withNewKey, nonce)).Failure);
        Assert.Equal(ExternalTokenFailure.None, (await validator.ValidateAsync("google", GoogleToken(nonce), nonce)).Failure);
        Assert.Equal(3, KeyFetches(GoogleKeys));
    }

    [Fact]
    public async Task StaleKeysAreFetchedAgainAndNeverUsedWhenTheProviderCantBeReached()
    {
        var validator = Validator();
        var nonce = IdTokenSigner.NewNonce();
        Assert.Equal(ExternalTokenFailure.None, (await validator.ValidateAsync("google", GoogleToken(nonce), nonce)).Failure);

        _clock.Advance(ExternalTokenValidator.KeysFreshFor);
        _googleStatus = HttpStatusCode.InternalServerError;
        Assert.Equal(ExternalTokenFailure.KeysUnavailable, (await validator.ValidateAsync("google", GoogleToken(nonce), nonce)).Failure);

        _googleStatus = HttpStatusCode.OK;
        _googleJwks = "{ this is not json";
        Assert.Equal(ExternalTokenFailure.KeysUnavailable, (await validator.ValidateAsync("google", GoogleToken(nonce), nonce)).Failure);

        _googleJwks = IdTokenSigner.Jwks(_google);
        Assert.Equal(ExternalTokenFailure.None, (await validator.ValidateAsync("google", GoogleToken(nonce), nonce)).Failure);
        Assert.Equal(4, KeyFetches(GoogleKeys));
    }

    [Fact]
    public async Task ANetworkFailureFetchingKeysRefusesTheSignIn()
    {
        var http = new StubHttp();
        http.Throw(GoogleKeys);
        var config = new ConfigurationBuilder().AddInMemoryCollection([new("Auth:Google:ClientIds:0", Web)]).Build();
        var validator = new ExternalTokenValidator(config, new Factory(http), _clock, NullLogger<ExternalTokenValidator>.Instance);
        var nonce = IdTokenSigner.NewNonce();
        Assert.Equal(ExternalTokenFailure.KeysUnavailable, (await validator.ValidateAsync("google", GoogleToken(nonce), nonce)).Failure);
    }

    [Fact]
    public void NonceHashesAreLowerCaseHexSha256AndComparedExactly()
    {
        Assert.Equal("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", ExternalNonce.Hash("hello"));
        var raw = IdTokenSigner.NewNonce();
        Assert.True(ExternalNonce.Matches(ExternalNonce.Hash(raw), raw));
        Assert.False(ExternalNonce.Matches(ExternalNonce.Hash(raw).ToUpperInvariant(), raw));
        Assert.False(ExternalNonce.Matches(null, raw));
        Assert.False(ExternalNonce.Matches(ExternalNonce.Hash(raw), null));
    }
}
