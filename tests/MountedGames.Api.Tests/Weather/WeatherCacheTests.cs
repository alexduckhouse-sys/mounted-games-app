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
        _f.Services.GetRequiredService<WeatherCache>().Clear();
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

    // ---- dual-provider cadence (06:00-18:00 UK 30m / 18:00-06:00 UK 3h) & 30-120m grace window ----

    private static string BuildMetOfficeSeriesJson(double tempC) => $$"""
        {
          "type": "FeatureCollection",
          "features": [
            {
              "type": "Feature",
              "properties": {
                "timeSeries": [
                  {
                    "time": "2030-06-01T12:00Z",
                    "screenTemperature": {{tempC.ToString(System.Globalization.CultureInfo.InvariantCulture)}},
                    "windSpeed10m": 4.0,
                    "screenRelativeHumidity": 65.0,
                    "probOfPrecipitation": 10,
                    "totalPrecipAmount": 0.0,
                    "significantWeatherCode": 1
                  },
                  {
                    "time": "2030-06-01T21:00Z",
                    "screenTemperature": {{tempC.ToString(System.Globalization.CultureInfo.InvariantCulture)}},
                    "windSpeed10m": 3.0,
                    "screenRelativeHumidity": 75.0,
                    "probOfPrecipitation": 5,
                    "totalPrecipAmount": 0.0,
                    "significantWeatherCode": 0
                  },
                  {
                    "time": "2030-06-02T00:00Z",
                    "screenTemperature": {{tempC.ToString(System.Globalization.CultureInfo.InvariantCulture)}},
                    "windSpeed10m": 3.0,
                    "screenRelativeHumidity": 80.0,
                    "probOfPrecipitation": 5,
                    "totalPrecipAmount": 0.0,
                    "significantWeatherCode": 0
                  }
                ]
              }
            }
          ]
        }
        """;

    private const string MetNorwayFallbackJson = """
        {
          "type": "Feature",
          "properties": {
            "timeseries": [
              {
                "time": "2030-06-01T12:00:00Z",
                "data": {
                  "instant": {
                    "details": {
                      "air_temperature": 14.0,
                      "wind_speed": 6.0,
                      "relative_humidity": 80.0
                    }
                  },
                  "next_1_hours": {
                    "summary": { "symbol_code": "cloudy" },
                    "details": { "precipitation_amount": 0.2, "probability_of_precipitation": 30.0 }
                  }
                }
              },
              {
                "time": "2030-06-01T14:00:00Z",
                "data": {
                  "instant": {
                    "details": {
                      "air_temperature": 14.0,
                      "wind_speed": 6.0,
                      "relative_humidity": 80.0
                    }
                  },
                  "next_1_hours": {
                    "summary": { "symbol_code": "cloudy" },
                    "details": { "precipitation_amount": 0.2, "probability_of_precipitation": 30.0 }
                  }
                }
              }
            ]
          }
        }
        """;

    [Fact]
    public async Task DualProvider_DaytimeRefreshesEvery30Minutes_AndOvernightRefreshesEvery3Hours()
    {
        Reset();
        var clock = new ManualTimeProvider(); // Starts at 2030-06-01T12:00:00Z (13:00 BST -> daytime)
        var cache = _f.Services.GetRequiredService<WeatherCache>();
        cache.ConfigureProviders("test-metoffice-key", clock, useDualProviders: true);

        var metOfficeCalls = 0;
        _f.Http.Respond("data.hub.api.metoffice.gov.uk", _ =>
        {
            var n = Interlocked.Increment(ref metOfficeCalls);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(BuildMetOfficeSeriesJson(18.0 + n), Encoding.UTF8, "application/json")
            };
        });

        var client = _f.CreateClient();

        // 1. Daytime (13:00 BST): cached for 30 minutes
        await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25");
        Assert.Equal(1, metOfficeCalls);

        clock.Advance(TimeSpan.FromMinutes(29));
        await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25");
        Assert.Equal(1, metOfficeCalls); // still fresh at +29m

        clock.Advance(TimeSpan.FromMinutes(2)); // +31m total
        await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25");
        Assert.Equal(2, metOfficeCalls); // refreshed after 30m daytime TTL

        // 2. Advance to overnight window: 2030-06-01T20:00:00Z = 21:00 BST (inside 18:00-06:00 UK local time)
        clock.Advance(TimeSpan.FromHours(8));
        await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25");
        Assert.Equal(3, metOfficeCalls); // first overnight fetch caches for 3 hours (180m)

        clock.Advance(TimeSpan.FromMinutes(45));
        await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25");
        Assert.Equal(3, metOfficeCalls); // still cached at +45m overnight

        clock.Advance(TimeSpan.FromMinutes(130)); // +175m total overnight
        await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25");
        Assert.Equal(3, metOfficeCalls); // still cached at +175m overnight

        clock.Advance(TimeSpan.FromMinutes(6)); // +181m total overnight (> 3h)
        await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25");
        Assert.Equal(4, metOfficeCalls); // refreshed after 3h overnight TTL
    }

    [Fact]
    public async Task DualProvider_GraceWindow_Preserves45MinuteOld15kmMetOfficeWhenRefreshFails_AndFallsBackToMetNorwayAfter120Minutes()
    {
        Reset();
        var clock = new ManualTimeProvider(); // 2030-06-01T12:00:00Z (13:00 BST daytime)
        var cache = _f.Services.GetRequiredService<WeatherCache>();
        cache.ConfigureProviders("test-metoffice-key", clock, useDualProviders: true);

        var metOfficeShouldFail = false;
        var metNorwayCalls = 0;

        _f.Http.Respond("data.hub.api.metoffice.gov.uk", _ =>
        {
            if (metOfficeShouldFail)
                return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(BuildMetOfficeSeriesJson(19.5), Encoding.UTF8, "application/json")
            };
        });

        _f.Http.Respond("api.met.no", _ =>
        {
            Interlocked.Increment(ref metNorwayCalls);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(MetNorwayFallbackJson, Encoding.UTF8, "application/json")
            };
        });

        var client = _f.CreateClient();

        // t = 0: Initial UK Met Office 1.5 km fetch succeeds (19.5°C).
        var t0 = await (await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25")).ReadAsync<JsonElement>();
        Assert.Equal("met-office", t0.GetProperty("provider").GetString());
        Assert.Equal(19.5, t0.GetProperty("current").GetProperty("temperature_2m").GetDouble());
        Assert.Equal(0, metNorwayCalls);

        // t = +45m: Daytime 30m TTL expired, Met Office now fails (503).
        // Because 45m <= 120m grace window, controller MUST serve the 45m-old 1.5 km Met Office data and NOT call 9 km MET Norway!
        clock.Advance(TimeSpan.FromMinutes(45));
        metOfficeShouldFail = true;

        var t45 = await (await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25")).ReadAsync<JsonElement>();
        Assert.Equal("met-office", t45.GetProperty("provider").GetString());
        Assert.Equal(19.5, t45.GetProperty("current").GetProperty("temperature_2m").GetDouble());
        Assert.Equal(0, metNorwayCalls);

        // t = +130m (+85m later): > 120m grace window has expired and Met Office is still down -> falls back to MET Norway (14.0°C).
        clock.Advance(TimeSpan.FromMinutes(85));
        var t130 = await (await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25")).ReadAsync<JsonElement>();
        Assert.Equal("met-norway", t130.GetProperty("provider").GetString());
        Assert.Equal(14.0, t130.GetProperty("current").GetProperty("temperature_2m").GetDouble());
        Assert.Equal(1, metNorwayCalls);
    }

    [Fact]
    public async Task DualProvider_GraceWindow_Serves45MinuteOld15kmMetOfficeWhenDailyQuota350IsReached()
    {
        Reset();
        var clock = new ManualTimeProvider();
        var cache = _f.Services.GetRequiredService<WeatherCache>();
        cache.ConfigureProviders("test-metoffice-key", clock, useDualProviders: true);

        var metOfficeCalls = 0;
        var metNorwayCalls = 0;

        _f.Http.Respond("data.hub.api.metoffice.gov.uk", _ =>
        {
            Interlocked.Increment(ref metOfficeCalls);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(BuildMetOfficeSeriesJson(20.2), Encoding.UTF8, "application/json")
            };
        });

        _f.Http.Respond("api.met.no", _ =>
        {
            Interlocked.Increment(ref metNorwayCalls);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(MetNorwayFallbackJson, Encoding.UTF8, "application/json")
            };
        });

        var client = _f.CreateClient();

        // t = 0: Warm venue (52.5, -1.25) from UK Met Office.
        var initial = await (await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25")).ReadAsync<JsonElement>();
        Assert.Equal("met-office", initial.GetProperty("provider").GetString());
        Assert.Equal(1, metOfficeCalls);

        // Exhaust the 350/day soft ceiling and advance to t = +45m.
        cache.SetMetOfficeCallCount(clock.GetUtcNow(), WeatherCache.MaxDailyMetOfficeCalls);
        clock.Advance(TimeSpan.FromMinutes(45));

        // Warm venue at t = +45m serves 1.5 km Met Office grace data without calling Met Office or MET Norway.
        var graceResp = await (await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25")).ReadAsync<JsonElement>();
        Assert.Equal("met-office", graceResp.GetProperty("provider").GetString());
        Assert.Equal(20.2, graceResp.GetProperty("current").GetProperty("temperature_2m").GetDouble());
        Assert.Equal(1, metOfficeCalls);
        Assert.Equal(0, metNorwayCalls);

        // Cold UK venue (53.8, -1.5) with no grace entry falls back to MET Norway without exceeding the 350 Met Office quota.
        var coldResp = await (await client.GetAsync("/api/weather/current?lat=53.8&lon=-1.5")).ReadAsync<JsonElement>();
        Assert.Equal("met-norway", coldResp.GetProperty("provider").GetString());
        Assert.Equal(1, metOfficeCalls);
        Assert.Equal(1, metNorwayCalls);
    }

    [Fact]
    public async Task DualProvider_SimultaneousCurrentAndForecastForColdVenue_ShareSingleMetOfficeRequestAndSingleQuotaSlot()
    {
        Reset();
        var clock = new ManualTimeProvider();
        var cache = _f.Services.GetRequiredService<WeatherCache>();
        cache.ConfigureProviders("test-metoffice-key", clock, useDualProviders: true);

        using var release = new ManualResetEventSlim();
        var metOfficeCalls = 0;
        _f.Http.Respond("data.hub.api.metoffice.gov.uk", _ =>
        {
            Interlocked.Increment(ref metOfficeCalls);
            release.Wait(TimeSpan.FromSeconds(10));
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(BuildMetOfficeSeriesJson(19.0), Encoding.UTF8, "application/json")
            };
        });

        var client = _f.CreateClient();
        var currentTask = Task.Run(() => client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25"));
        var forecastTask = Task.Run(() => client.GetAsync("/api/weather/forecast?lat=52.5&lon=-1.25&date=2030-06-01"));
        var atTask = Task.Run(() => client.GetAsync("/api/weather/at?lat=52.5&lon=-1.25&when=2030-06-01T12:00:00Z"));

        for (var i = 0; i < 200 && Volatile.Read(ref metOfficeCalls) == 0; i++)
            await Task.Delay(20);
        await Task.Delay(150);
        release.Set();

        var responses = await Task.WhenAll(currentTask, forecastTask, atTask);
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(1, metOfficeCalls);
        Assert.Equal(1, cache.GetMetOfficeCallCount(clock.GetUtcNow()));
    }

    [Fact]
    public void CoordinateSweepGuard_LimitsNewMetOfficeVenuesPerMinute_WhileAllowingKnownVenueRefresh()
    {
        using var cache = new WeatherCache("key", useDualProviders: true);
        var now = new DateTimeOffset(2030, 6, 1, 12, 0, 0, TimeSpan.Zero);

        // 20 distinct new UK grid cells in the same minute are allowed.
        for (var i = 0; i < WeatherCache.MaxNewMetOfficeVenuesPerMinute; i++)
        {
            Assert.True(cache.TryConsumeMetOfficeQuota(51.0 + i * 0.05, -1.0, now));
        }
        Assert.Equal(20, cache.GetMetOfficeCallCount(now));

        // 21st distinct unknown UK grid cell in the same minute is blocked from burning Met Office quota.
        Assert.False(cache.TryConsumeMetOfficeQuota(55.0, -2.0, now));
        Assert.Equal(20, cache.GetMetOfficeCallCount(now));

        // Advancing to the next minute allows new venues again.
        Assert.True(cache.TryConsumeMetOfficeQuota(55.0, -2.0, now.AddMinutes(1)));
        Assert.Equal(21, cache.GetMetOfficeCallCount(now));
    }
}

/// <summary>The cache itself, without HTTP: keys, lifetimes and the single-flight guarantee.</summary>
public class WeatherCacheUnitTests
{
    private static readonly DateTimeOffset Now = new(2030, 6, 1, 12, 0, 0, TimeSpan.Zero);

    private static WeatherCache NewCache(TimeProvider? time = null)
    {
#pragma warning disable CS0618 // MemoryCacheOptions has no TimeProvider yet; ISystemClock is the only way to drive its clock.
        return new WeatherCache(new MemoryCacheOptions { SizeLimit = 100, Clock = time is null ? null : new ProviderClock(time) });
#pragma warning restore CS0618
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
        var cache = NewCache();
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
        var cache = NewCache();
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
        var cache = NewCache();
        var fetches = 0;
        Task<WeatherOutcome> Fetch() { fetches++; return Task.FromResult(new WeatherOutcome("fallback", null)); }

        var (body, cacheable) = await cache.GetOrFetchAsync("k", Fetch);
        await cache.GetOrFetchAsync("k", Fetch);

        Assert.Equal("fallback", body);
        Assert.False(cacheable);
        Assert.Equal(2, fetches);
        Assert.Equal(0, cache.Count);
    }

    [Fact]
    public async Task Entries_ExpireAfterTheirTtl()
    {
        var time = new ManualTimeProvider();
        var cache = NewCache(time);
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

    [Fact]
    public async Task Cache_IsBoundedAndCanBeCleared()
    {
        using var cache = new WeatherCache(new MemoryCacheOptions { SizeLimit = 2 });
        foreach (var key in new[] { "a", "b", "c" })
            await cache.GetOrFetchAsync(key, () => Task.FromResult(new WeatherOutcome(key, TimeSpan.FromMinutes(5))));
        Assert.Equal(2, cache.Count); // the third entry doesn't fit

        cache.Clear();
        Assert.Equal(0, cache.Count);
    }

    [Fact]
    public void DefaultCache_HoldsUpToTheLimit() => Assert.Equal(5_000, WeatherCache.MaxEntries);

    [Theory]
    [InlineData(5, 0, false, 180)]  // 05:00 UTC in Jan (05:00 GMT) -> overnight 3h
    [InlineData(6, 0, true, 30)]    // 06:00 UTC in Jan (06:00 GMT) -> daytime 30m
    [InlineData(17, 59, true, 30)]  // 17:59 UTC in Jan (17:59 GMT) -> daytime 30m
    [InlineData(18, 0, false, 180)] // 18:00 UTC in Jan (18:00 GMT) -> overnight 3h
    public void UkCadenceTtl_FollowsUkDaytimeWindowInWinterGmt(int utcHour, int utcMin, bool expectedDaytime, int expectedMinutes)
    {
        var winterInstant = new DateTimeOffset(2030, 1, 15, utcHour, utcMin, 0, TimeSpan.Zero);
        Assert.Equal(expectedDaytime, WeatherCache.IsUkDaytime(winterInstant));
        Assert.Equal(TimeSpan.FromMinutes(expectedMinutes), WeatherCache.UkCadenceTtl(winterInstant));
    }

    [Theory]
    [InlineData(4, 59, false, 180)] // 04:59 UTC in June (05:59 BST) -> overnight 3h
    [InlineData(5, 0, true, 30)]    // 05:00 UTC in June (06:00 BST) -> daytime 30m
    [InlineData(16, 59, true, 30)]  // 16:59 UTC in June (17:59 BST) -> daytime 30m
    [InlineData(17, 0, false, 180)] // 17:00 UTC in June (18:00 BST) -> overnight 3h
    public void UkCadenceTtl_FollowsUkDaytimeWindowInSummerBst(int utcHour, int utcMin, bool expectedDaytime, int expectedMinutes)
    {
        var summerInstant = new DateTimeOffset(2030, 6, 15, utcHour, utcMin, 0, TimeSpan.Zero);
        Assert.Equal(expectedDaytime, WeatherCache.IsUkDaytime(summerInstant));
        Assert.Equal(TimeSpan.FromMinutes(expectedMinutes), WeatherCache.UkCadenceTtl(summerInstant));
    }

    [Fact]
    public void DailyMetOfficeQuota_CapsAt350PerUtcDay_AndResetsOnNextUtcDay()
    {
        using var cache = new WeatherCache("key", useDualProviders: true);
        var day1 = new DateTimeOffset(2030, 6, 1, 12, 0, 0, TimeSpan.Zero);
        var day2 = day1.AddDays(1);

        cache.SetMetOfficeCallCount(day1, 349);
        Assert.True(cache.TryConsumeMetOfficeQuota(day1));
        Assert.Equal(350, cache.GetMetOfficeCallCount(day1));

        // 351st attempt is refused and keeps counter at 350.
        Assert.False(cache.TryConsumeMetOfficeQuota(day1));
        Assert.Equal(350, cache.GetMetOfficeCallCount(day1));

        // Next UTC day starts fresh at 0.
        Assert.Equal(0, cache.GetMetOfficeCallCount(day2));
        Assert.True(cache.TryConsumeMetOfficeQuota(day2));
        Assert.Equal(1, cache.GetMetOfficeCallCount(day2));
    }
}
