using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Weather;

/// <summary>The weather endpoints through the real app: how many times the provider is called, and what the browser may keep.</summary>
public class WeatherCacheTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public WeatherCacheTests(ApiFactory f) => _f = f;

    private const string CurrentJson = """{"current":{"temperature_2m":21.5,"weather_code":0}}""";
    private const string Hourly = """
        {"hourly":{
          "time":["2030-06-01T13:00","2030-06-01T14:00"],
          "temperature_2m":[18.2,19.9],
          "weather_code":[2,61],
          "is_day":[1,1]}}
        """;

    private void Reset()
    {
        _f.Http.Reset();
        ((MemoryCache)_f.Services.GetRequiredService<IMemoryCache>()).Clear();
    }

    private int UpstreamCalls => _f.Http.Requests.Count;

    private static string? CacheControl(HttpResponseMessage r) => r.Headers.CacheControl?.ToString();

    // ---- repeat requests ----

    [Fact]
    public async Task Current_RepeatRequest_IsServedFromTheCache()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", CurrentJson);
        var client = _f.CreateClient();

        var first = await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25");
        var second = await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25");

        Assert.Equal(1, UpstreamCalls);
        Assert.Equal(await first.Content.ReadAsStringAsync(), await second.Content.ReadAsStringAsync());
        Assert.Equal(21.5, (await second.ReadAsync<JsonElement>()).GetProperty("current").GetProperty("temperature_2m").GetDouble());
    }

    [Theory]
    [InlineData("/api/weather/current?lat=52.5&lon=-1.25")]
    [InlineData("/api/weather/at?lat=52.5&lon=-1.25&when=2030-06-01T14:00:00")]
    [InlineData("/api/weather/forecast?lat=52.5&lon=-1.25&date=2030-06-01")]
    public async Task SuccessfulResponses_MayBeReusedByBrowsersAndTheCdn(string url)
    {
        Reset();
        _f.Http.RespondJson("open-meteo", url.Contains("/at?") ? Hourly : CurrentJson);

        var response = await _f.CreateClient().GetAsync(url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("public, max-age=600", CacheControl(response));
        // The ETag still goes out, so a revalidating browser gets a cheap 304.
        Assert.NotNull(response.Headers.ETag);
        // A cache hit carries the same header as the miss that filled it.
        Assert.Equal("public, max-age=600", CacheControl(await _f.CreateClient().GetAsync(url)));
        Assert.Equal(1, UpstreamCalls);
    }

    [Fact]
    public async Task Forecast_RepeatRequest_IsServedFromTheCache()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", """{"daily":{"temperature_2m_max":[22.1]}}""");
        var client = _f.CreateClient();

        await client.GetAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-07-04");
        await client.GetAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-07-04");
        await client.GetAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-07-05");

        Assert.Equal(2, UpstreamCalls); // the second date is a different key
    }

    // ---- keys ----

    [Fact]
    public async Task Current_CoordinatesThatRoundTogether_ShareOneEntry()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", CurrentJson);
        var client = _f.CreateClient();

        await client.GetAsync("/api/weather/current?lat=52.501&lon=-1.254");
        await client.GetAsync("/api/weather/current?lat=52.504&lon=-1.2549");
        await client.GetAsync("/api/weather/current?lat=52.496&lon=-1.246");

        var url = Assert.Single(_f.Http.Requests);
        // The provider is asked about the rounded point, so the answer doesn't depend on who asked first.
        Assert.Contains("latitude=52.50&", url);
        Assert.Contains("longitude=-1.25&", url);
    }

    [Fact]
    public async Task Current_CoordinatesThatRoundApart_GetTheirOwnEntries()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", CurrentJson);
        var client = _f.CreateClient();

        await client.GetAsync("/api/weather/current?lat=52.50&lon=-1.25");
        await client.GetAsync("/api/weather/current?lat=52.52&lon=-1.25");
        await client.GetAsync("/api/weather/current?lat=52.50&lon=-1.27");

        Assert.Equal(3, UpstreamCalls);
    }

    [Fact]
    public async Task At_SharesAnEntryWithinTheHour_ButNotAcrossHours()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", Hourly);
        var client = _f.CreateClient();

        await client.GetAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T14:05:00");
        await client.GetAsync("/api/weather/at?lat=52.004&lon=-1&when=2030-06-01T14:55:00");
        Assert.Equal(1, UpstreamCalls);

        await client.GetAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T13:30:00");
        await client.GetAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-02T14:05:00");
        Assert.Equal(3, UpstreamCalls);
    }

    [Fact]
    public async Task EndpointsDoNotShareEntries()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", CurrentJson);
        var client = _f.CreateClient();

        await client.GetAsync("/api/weather/current?lat=52&lon=-1");
        await client.GetAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-06-01");

        Assert.Equal(2, UpstreamCalls);
    }

    // ---- errors ----

    [Fact]
    public async Task Errors_AreNotCached_AndTheNextRequestTriesTheProviderAgain()
    {
        Reset();
        var calls = 0;
        _f.Http.Respond("open-meteo", _ => ++calls == 1
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(CurrentJson, Encoding.UTF8, "application/json") });
        var client = _f.CreateClient();

        var failed = await client.GetAsync("/api/weather/current?lat=40&lon=-3");
        var recovered = await client.GetAsync("/api/weather/current?lat=40&lon=-3");
        var cached = await client.GetAsync("/api/weather/current?lat=40&lon=-3");

        Assert.Equal("weather_unavailable", (await failed.ReadAsync<JsonElement>()).GetProperty("error").GetString());
        Assert.NotEqual("public, max-age=600", CacheControl(failed)); // the fallback must not be kept by browsers or the CDN
        Assert.True((await recovered.ReadAsync<JsonElement>()).TryGetProperty("current", out _));
        Assert.Equal("public, max-age=600", CacheControl(recovered));
        Assert.True((await cached.ReadAsync<JsonElement>()).TryGetProperty("current", out _));
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task At_PayloadWithoutHourlyData_IsNotCached()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", """{"reason":"nope"}""");
        var client = _f.CreateClient();

        var first = await client.GetAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T08:00:00");
        await client.GetAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T08:00:00");

        Assert.Equal(2, UpstreamCalls);
        Assert.NotEqual("public, max-age=600", CacheControl(first));
    }

    [Fact]
    public async Task Forecast_Errors_AreNotCached()
    {
        Reset();
        _f.Http.Throw("open-meteo");
        var client = _f.CreateClient();

        var first = await client.GetAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-07-04");
        await client.GetAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-07-04");

        Assert.Equal(2, UpstreamCalls);
        Assert.NotEqual("public, max-age=600", CacheControl(first));
    }

    // ---- concurrency ----

    [Fact]
    public async Task ConcurrentRequestsForTheSamePlace_MakeOneProviderCall()
    {
        Reset();
        using var release = new ManualResetEventSlim();
        _f.Http.Respond("open-meteo", _ =>
        {
            release.Wait(TimeSpan.FromSeconds(10)); // hold the provider until every phone has arrived
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(CurrentJson, Encoding.UTF8, "application/json") };
        });
        var client = _f.CreateClient();

        var requests = Enumerable.Range(0, 50)
            .Select(_ => Task.Run(() => client.GetAsync("/api/weather/current?lat=51.5&lon=-0.12")))
            .ToList();
        // The first request reaches the provider and parks there; give the rest time to queue behind it.
        for (var i = 0; i < 200 && UpstreamCalls == 0; i++) await Task.Delay(25);
        await Task.Delay(300);
        release.Set();
        var responses = await Task.WhenAll(requests);

        Assert.Equal(1, UpstreamCalls);
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        foreach (var r in responses)
            Assert.Equal(21.5, (await r.ReadAsync<JsonElement>()).GetProperty("current").GetProperty("temperature_2m").GetDouble());
    }
}

/// <summary>The cache itself, without HTTP: keys, lifetimes and the single-flight guarantee.</summary>
public class WeatherCacheUnitTests
{
    private static readonly DateTimeOffset Now = new(2030, 6, 1, 12, 0, 0, TimeSpan.Zero);

    private static WeatherCache NewCache(out MemoryCache memory, TimeProvider? time = null)
    {
#pragma warning disable CS0618 // MemoryCacheOptions has no TimeProvider yet; ISystemClock is the only way to drive its clock.
        memory = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100, Clock = time is null ? null : new ProviderClock(time) });
#pragma warning restore CS0618
        return new WeatherCache(memory);
    }

#pragma warning disable CS0618
    private sealed class ProviderClock(TimeProvider time) : Microsoft.Extensions.Internal.ISystemClock
    {
        public DateTimeOffset UtcNow => time.GetUtcNow();
    }
#pragma warning restore CS0618

    [Theory]
    [InlineData(52.504, 52.50)]
    [InlineData(52.506, 52.51)]
    [InlineData(-1.2549, -1.25)]
    [InlineData(-0.001, 0.0)]
    public void Coordinates_RoundToTwoDecimalPlaces(double input, double expected)
        => Assert.Equal(expected, WeatherCache.RoundCoordinate(input));

    [Fact]
    public void Keys_DoNotDependOnCultureOrNegativeZero()
    {
        var saved = Thread.CurrentThread.CurrentCulture;
        try
        {
            Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("de-DE");
            Assert.Equal("weather:current:0.00:-1.25",
                WeatherCache.CurrentKey(WeatherCache.RoundCoordinate(-0.001), WeatherCache.RoundCoordinate(-1.25)));
        }
        finally { Thread.CurrentThread.CurrentCulture = saved; }
    }

    [Fact]
    public void AtKey_RoundsTheTimeDownToTheHour()
        => Assert.Equal(WeatherCache.AtKey(52, -1, new DateTime(2030, 6, 1, 14, 5, 0)),
            WeatherCache.AtKey(52, -1, new DateTime(2030, 6, 1, 14, 59, 59)));

    [Theory]
    [InlineData(0, 30)]          // now
    [InlineData(47, 30)]         // within 48 hours
    [InlineData(48, 30)]         // exactly 48 hours
    [InlineData(49, 180)]        // further out
    [InlineData(24 * 10, 180)]   // a week and a half away
    [InlineData(-24 * 5, 180)]   // well in the past
    [InlineData(-6, 30)]         // a few hours ago
    public void ForecastTtl_IsThirtyMinutesWithinTwoDays_AndThreeHoursBeyond(int hoursFromNow, int expectedMinutes)
        => Assert.Equal(TimeSpan.FromMinutes(expectedMinutes), WeatherCache.ForecastTtl(Now.UtcDateTime.AddHours(hoursFromNow), Now));

    [Fact]
    public async Task ConcurrentMisses_ShareOneFetch()
    {
        var cache = NewCache(out _);
        var gate = new TaskCompletionSource();
        var fetches = 0;
        async Task<WeatherOutcome> Fetch()
        {
            Interlocked.Increment(ref fetches);
            await gate.Task;
            return new WeatherOutcome("sunny", TimeSpan.FromMinutes(30));
        }

        var callers = Enumerable.Range(0, 50).Select(_ => cache.GetOrFetchAsync("k", Fetch)).ToList();
        Assert.Equal(1, Volatile.Read(ref fetches)); // every caller is already waiting on the first fetch
        gate.SetResult();
        var results = await Task.WhenAll(callers);

        Assert.All(results, r => Assert.Equal(("sunny", true), (r.Body, r.Cacheable)));
        Assert.Equal(1, fetches);
        await cache.GetOrFetchAsync("k", Fetch); // and the result is now stored
        Assert.Equal(1, fetches);
    }

    [Fact]
    public async Task FailedFetch_ClearsTheSlot_SoTheNextCallerRetries()
    {
        var cache = NewCache(out _);
        var fetches = 0;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            cache.GetOrFetchAsync("k", () => { fetches++; throw new InvalidOperationException("boom"); }));
        var (body, cacheable) = await cache.GetOrFetchAsync("k", () => { fetches++; return Task.FromResult(new WeatherOutcome("ok", TimeSpan.FromMinutes(1))); });

        Assert.Equal("ok", body);
        Assert.True(cacheable);
        Assert.Equal(2, fetches);
    }

    [Fact]
    public async Task OutcomeWithoutTtl_IsServedButNeverStored()
    {
        var cache = NewCache(out var memory);
        var fetches = 0;
        Task<WeatherOutcome> Fetch() { fetches++; return Task.FromResult(new WeatherOutcome("fallback", null)); }

        var (body, cacheable) = await cache.GetOrFetchAsync("k", Fetch);
        await cache.GetOrFetchAsync("k", Fetch);

        Assert.Equal("fallback", body);
        Assert.False(cacheable);
        Assert.Equal(2, fetches);
        Assert.Equal(0, memory.Count);
    }

    [Fact]
    public async Task Entries_ExpireAfterTheirTtl()
    {
        var time = new ManualTimeProvider();
        var cache = NewCache(out _, time);
        var fetches = 0;
        Task<WeatherOutcome> Fetch() { fetches++; return Task.FromResult(new WeatherOutcome("sunny", TimeSpan.FromMinutes(30))); }

        await cache.GetOrFetchAsync("k", Fetch);
        time.Advance(TimeSpan.FromMinutes(29));
        await cache.GetOrFetchAsync("k", Fetch);
        Assert.Equal(1, fetches);

        time.Advance(TimeSpan.FromMinutes(2));
        await cache.GetOrFetchAsync("k", Fetch);
        Assert.Equal(2, fetches);
    }
}
