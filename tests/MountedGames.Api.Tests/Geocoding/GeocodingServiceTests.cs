using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using MountedGames.Api.Dtos;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Geocoding;

/// <summary>GeocodingService exercised through the public /api/geocode endpoint.</summary>
public class GeocodingServiceTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public GeocodingServiceTests(ApiFactory f) => _f = f;

    private async Task<GeocodeResult> ResolveAsync(string query, WebApplicationFactory<Program>? factory = null)
    {
        var r = await (factory ?? _f).CreateClient().GetAsync($"/api/geocode?{query}");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.ReadAsync<GeocodeResult>();
    }

    private WebApplicationFactory<Program> WithW3wKey(string? key = "test-key")
        => _f.WithWebHostBuilder(b => b.UseSetting("What3Words:ApiKey", key));

    private const string PostcodeOk = """{"result":{"latitude":52.1,"longitude":-1.2}}""";
    private const string W3wOk = """{"coordinates":{"lat":51.5,"lng":-0.12}}""";

    // ---- postcode ----

    [Fact]
    public async Task Postcode_ResolvesCoordinates_ForTrimmedPostcode()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", PostcodeOk);

        var g = await ResolveAsync("postcode=%20CV8%202LG%20");

        Assert.Equal((52.1, -1.2, "postcode"), (g.Latitude, g.Longitude, g.Source));
        Assert.EndsWith("/postcodes/CV8 2LG", Assert.Single(_f.Http.Requests));
    }

    [Fact]
    public async Task Postcode_AcceptsCoordinatesSentAsStrings()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", """{"result":{"latitude":"52.5","longitude":"-1.5"}}""");

        var g = await ResolveAsync("postcode=B1");

        Assert.Equal((52.5, -1.5), (g.Latitude, g.Longitude));
    }

    [Theory]
    [InlineData("""{"result":null}""")]
    [InlineData("""{"status":404}""")]
    [InlineData("""{"result":{"latitude":52.1}}""")]
    [InlineData("""{"result":{"latitude":"abc","longitude":true}}""")]
    public async Task Postcode_GivesNoResult_WhenPayloadLacksCoordinates(string json)
    {
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", json);

        var g = await ResolveAsync("postcode=B1");

        Assert.Null(g.Latitude);
        Assert.Null(g.Source);
    }

    [Fact]
    public async Task Postcode_GivesNoResult_WhenUpstreamReturnsErrorStatus()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", """{"error":"Invalid postcode"}""", HttpStatusCode.NotFound);

        var g = await ResolveAsync("postcode=ZZ99");

        Assert.Null(g.Latitude);
    }

    [Fact]
    public async Task Postcode_GivesNoResult_WhenNetworkFails()
    {
        _f.Http.Reset();
        _f.Http.Throw("postcodes.io");

        var g = await ResolveAsync("postcode=B1");

        Assert.Null(g.Latitude);
        Assert.Null(g.Source);
    }

    [Fact]
    public async Task Postcode_GivesNoResult_WhenBodyIsNotJson()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", "<html>oops</html>");

        var g = await ResolveAsync("postcode=B1");

        Assert.Null(g.Latitude);
    }

    [Fact]
    public async Task BlankPostcode_IsSkippedWithoutCallingTheNetwork()
    {
        _f.Http.Reset();

        var g = await ResolveAsync("postcode=%20%20");

        Assert.Null(g.Source);
        Assert.Empty(_f.Http.Requests);
    }

    // ---- what3words ----

    [Fact]
    public async Task What3Words_IsSkipped_WhenNoApiKeyConfigured()
    {
        _f.Http.Reset();

        var g = await ResolveAsync("w3w=filled.count.soap");

        Assert.Null(g.Latitude);
        Assert.Empty(_f.Http.Requests);
    }

    [Fact]
    public async Task What3Words_ResolvesCoordinates_StrippingLeadingSlashes()
    {
        using var factory = WithW3wKey();
        _f.Http.Reset();
        _f.Http.RespondJson("api.what3words.com", W3wOk);

        var g = await ResolveAsync("w3w=%2F%2F%2Ffilled.count.soap", factory);

        Assert.Equal((51.5, -0.12, "what3words"), (g.Latitude, g.Longitude, g.Source));
        var url = Assert.Single(_f.Http.Requests);
        Assert.Contains("words=filled.count.soap", url);
        Assert.Contains("key=test-key", url);
    }

    [Fact]
    public async Task What3Words_IsUsed_WhenPostcodeLookupFindsNothing()
    {
        using var factory = WithW3wKey();
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", """{"result":null}""");
        _f.Http.RespondJson("api.what3words.com", W3wOk);

        var g = await ResolveAsync("postcode=B1&w3w=a.b.c", factory);

        Assert.Equal("what3words", g.Source);
        Assert.Equal(2, _f.Http.Requests.Count);
    }

    [Fact]
    public async Task Postcode_WinsOverWhat3Words_WhenBothResolve()
    {
        using var factory = WithW3wKey();
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", PostcodeOk);
        _f.Http.RespondJson("api.what3words.com", W3wOk);

        var g = await ResolveAsync("postcode=B1&w3w=a.b.c", factory);

        Assert.Equal("postcode", g.Source);
        Assert.Single(_f.Http.Requests);
    }

    [Fact]
    public async Task What3Words_GivesNoResult_WhenWordsAreOnlySlashes()
    {
        using var factory = WithW3wKey();
        _f.Http.Reset();

        var g = await ResolveAsync("w3w=%2F%2F%2F", factory);

        Assert.Null(g.Source);
        Assert.Empty(_f.Http.Requests);
    }

    [Fact]
    public async Task What3Words_GivesNoResult_WhenUpstreamReturnsErrorStatus()
    {
        using var factory = WithW3wKey();
        _f.Http.Reset();
        _f.Http.RespondJson("api.what3words.com", """{"error":{}}""", HttpStatusCode.Unauthorized);

        var g = await ResolveAsync("w3w=a.b.c", factory);

        Assert.Null(g.Latitude);
    }

    [Theory]
    [InlineData("""{"coordinates":null}""")]
    [InlineData("""{"words":"a.b.c"}""")]
    [InlineData("""{"coordinates":{"lat":1}}""")]
    public async Task What3Words_GivesNoResult_WhenPayloadLacksCoordinates(string json)
    {
        using var factory = WithW3wKey();
        _f.Http.Reset();
        _f.Http.RespondJson("api.what3words.com", json);

        var g = await ResolveAsync("w3w=a.b.c", factory);

        Assert.Null(g.Latitude);
    }

    [Fact]
    public async Task What3Words_GivesNoResult_WhenNetworkFails()
    {
        using var factory = WithW3wKey();
        _f.Http.Reset();
        _f.Http.Throw("api.what3words.com");

        var g = await ResolveAsync("w3w=a.b.c", factory);

        Assert.Null(g.Latitude);
        Assert.Null(g.Source);
    }
}
