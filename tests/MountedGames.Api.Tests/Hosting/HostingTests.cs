using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using MountedGames.Api.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Hosting;

/// <summary>Cross-cutting host behaviour: health, CORS, compression, ETags.</summary>
public class HostingTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public HostingTests(ApiFactory f) => _f = f;

    // Anonymous JSON GET on SecurityHeadersMiddleware's public-cacheable list; other /api paths are no-store.
    private const string Cacheable = "/api/competitions";

    [Fact]
    public async Task Healthz_ReportsOk()
    {
        var r = await _f.CreateClient().GetAsync("/healthz");

        Assert.Equal((HttpStatusCode.OK, "{\"ok\":true}"), (r.StatusCode, await r.Content.ReadAsStringAsync()));
    }

    [Fact]
    public async Task OpenApiDocument_IsNotExposed_OutsideDevelopment()
    {
        var r = await _f.CreateClient().GetAsync("/openapi/v1.json");

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Cors_AllowsTheViteDevOrigin()
    {
        var req = new HttpRequestMessage(HttpMethod.Options, Cacheable);
        req.Headers.Add("Origin", "http://localhost:5173");
        req.Headers.Add("Access-Control-Request-Method", "GET");

        var r = await _f.CreateClient().SendAsync(req);

        Assert.Equal("http://localhost:5173", r.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task Cors_DoesNotAllowUnknownOrigins()
    {
        var req = new HttpRequestMessage(HttpMethod.Options, Cacheable);
        req.Headers.Add("Origin", "https://evil.example");
        req.Headers.Add("Access-Control-Request-Method", "GET");

        var r = await _f.CreateClient().SendAsync(req);

        Assert.False(r.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task ApiGet_CarriesWeakEtagAndNoCacheHeader()
    {
        var r = await _f.CreateClient().GetAsync(Cacheable);

        Assert.Equal(
            (true, "no-cache, private"),
            (r.Headers.ETag!.IsWeak, r.Headers.CacheControl!.ToString()));
    }

    [Fact]
    public async Task ApiGet_Returns304_WhenEtagMatches()
    {
        var c = _f.CreateClient();
        var etag = (await c.GetAsync(Cacheable)).Headers.ETag!;
        var req = new HttpRequestMessage(HttpMethod.Get, Cacheable);
        req.Headers.IfNoneMatch.Add(etag);

        var r = await c.SendAsync(req);

        Assert.Equal((HttpStatusCode.NotModified, ""), (r.StatusCode, await r.Content.ReadAsStringAsync()));
    }

    [Fact]
    public async Task ApiGet_Returns304_ForWildcardIfNoneMatch()
    {
        var req = new HttpRequestMessage(HttpMethod.Get, Cacheable);
        req.Headers.IfNoneMatch.Add(EntityTagHeaderValue.Any);

        var r = await _f.CreateClient().SendAsync(req);

        Assert.Equal(HttpStatusCode.NotModified, r.StatusCode);
    }

    [Fact]
    public async Task ApiGet_ReturnsBody_WhenEtagIsStale()
    {
        var req = new HttpRequestMessage(HttpMethod.Get, Cacheable);
        req.Headers.IfNoneMatch.Add(new EntityTagHeaderValue("\"stale\"", isWeak: true));

        var r = await _f.CreateClient().SendAsync(req);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task ApiGet_Etag_ChangesWhenContentChanges()
    {
        var c = _f.CreateClient();
        var before = (await c.GetAsync(Cacheable)).Headers.ETag!.Tag;
        await _f.SeedCompetitionAsync();

        var after = (await c.GetAsync(Cacheable)).Headers.ETag!.Tag;

        Assert.NotEqual(before, after);
    }

    [Fact]
    public async Task ApiGet_PrivatePath_IsNoStore_WithoutEtag()
    {
        var r = await _f.CreateClient().GetAsync("/api/shop/posts");

        Assert.Equal((HttpStatusCode.OK, "no-store", null), (r.StatusCode, r.Headers.CacheControl!.ToString(), r.Headers.ETag));
    }

    [Fact]
    public async Task ApiError_IsNotGivenAnEtag()
    {
        var r = await _f.CreateClient().GetAsync("/api/shop/posts/999999");

        Assert.Null(r.Headers.ETag);
    }

    [Fact]
    public async Task ApiPost_IsNotGivenAnEtag()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(TestClients.TrainerEmail, TestClients.TrainerPassword));

        Assert.Null(r.Headers.ETag);
    }

    [Fact]
    public async Task ApiGet_IsCompressed_WhenClientAcceptsGzip()
    {
        var req = new HttpRequestMessage(HttpMethod.Get, Cacheable);
        req.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));

        var r = await _f.CreateClient().SendAsync(req);

        Assert.Contains("gzip", r.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task SignInResponses_AreNeverCompressed()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login")
        {
            Content = JsonContent.Create(new LoginRequest(TestClients.TrainerEmail, TestClients.TrainerPassword)),
        };
        req.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));

        var r = await _f.CreateClient().SendAsync(req);

        Assert.Empty(r.Content.Headers.ContentEncoding);
    }
}

public class SpaHostingTests : IClassFixture<SpaApiFactory>
{
    private readonly SpaApiFactory _f;
    public SpaHostingTests(SpaApiFactory f) => _f = f;

    [Fact]
    public async Task Root_ServesTheSpaShell()
    {
        var r = await _f.CreateClient().GetAsync("/");

        Assert.Equal("<html>spa-shell</html>", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ClientSideRoutes_FallBackToTheSpaShell()
    {
        var r = await _f.CreateClient().GetAsync("/competitions/3/arena");

        Assert.Equal("<html>spa-shell</html>", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task FingerprintedAssets_AreCachedForAYear()
    {
        var r = await _f.CreateClient().GetAsync("/assets/app.js");

        Assert.Equal("public, max-age=31536000, immutable", r.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task OtherStaticFiles_GetNoImmutableCacheHeader()
    {
        var r = await _f.CreateClient().GetAsync("/index.html");

        Assert.NotEqual("public, max-age=31536000, immutable", r.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task ApiRoutes_StillReachControllers_NotTheShell()
    {
        var r = await _f.CreateClient().GetAsync("/api/shop/posts");

        Assert.Equal("application/json", r.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task OpenApiDocument_IsExposed_InDevelopment()
    {
        var r = await _f.CreateClient().GetAsync("/openapi/v1.json");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public void SqliteFolder_IsCreatedOnStartup()
    {
        _f.CreateClient();

        Assert.True(Directory.Exists(_f.DbFolder));
    }
}
