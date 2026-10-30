using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Weather;

public class WeatherEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public WeatherEndpointsTests(ApiFactory f) => _f = f;

    private const string Hourly = """
        {"hourly":{
          "time":["2030-06-01T00:00","2030-06-01T13:00","2030-06-01T14:00"],
          "temperature_2m":[10.5,18.2,19.9],
          "weather_code":[1,2,61],
          "is_day":[0,1,1]}}
        """;

    // The weather cache is per host and this class's tests share one host, so start each test cold.
    // (Caching itself is covered in WeatherCacheTests.)
    private void Reset()
    {
        _f.Http.Reset();
        _f.Services.GetRequiredService<WeatherCache>().Clear();
    }

    private async Task<(HttpStatusCode Status, JsonElement Body)> GetJsonAsync(string url)
    {
        var r = await _f.CreateClient().GetAsync(url);
        return (r.StatusCode, await r.ReadAsync<JsonElement>());
    }

    // ---- current ----

    [Theory]
    [InlineData("current?lat=1&lon=2")]
    [InlineData("forecast?lat=1&lon=2&date=2030-06-01")]
    [InlineData("at?lat=1&lon=2&when=2030-06-01T14:00:00Z")]
    public async Task WeatherFailuresKeepFallbacksWithoutExposingInternalDetails(string path)
    {
        Reset();
        _f.Http.Throw("open-meteo");
        var (_, body) = await GetJsonAsync($"/api/weather/{path}");
        Assert.False(body.TryGetProperty("detail", out _));
        Assert.True(body.TryGetProperty("fallback", out _));
        Assert.DoesNotContain("stubbed", body.GetRawText());
        var clients = _f.Services.GetRequiredService<IHttpClientFactory>();
        Assert.Equal(TimeSpan.FromSeconds(5), clients.CreateClient("weather").Timeout);
        Assert.Equal(TimeSpan.FromSeconds(5), clients.CreateClient("geocoding").Timeout);
    }

    [Fact]
    public async Task Current_PassesThroughUpstreamJson()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", """{"current":{"temperature_2m":21.5,"weather_code":0}}""");

        var (status, body) = await GetJsonAsync("/api/weather/current?lat=52.5&lon=-1.25");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(21.5, body.GetProperty("current").GetProperty("temperature_2m").GetDouble());
        var url = Assert.Single(_f.Http.Requests);
        Assert.Contains("latitude=52.5", url);
        Assert.Contains("longitude=-1.25", url);
        Assert.Contains("current=", url);
    }

    [Fact]
    public async Task Current_ReturnsFallback_WhenUpstreamFails()
    {
        Reset();
        _f.Http.Throw("open-meteo");

        var (status, body) = await GetJsonAsync("/api/weather/current?lat=1&lon=2");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("weather_unavailable", body.GetProperty("error").GetString());
        Assert.Equal(15, body.GetProperty("fallback").GetProperty("temperature_2m").GetInt32());
        Assert.False(body.TryGetProperty("detail", out _));
    }

    [Fact]
    public async Task Current_ReturnsFallback_WhenUpstreamReturnsErrorStatus()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", "{}", HttpStatusCode.InternalServerError);

        var (_, body) = await GetJsonAsync("/api/weather/current?lat=1&lon=2");

        Assert.Equal("weather_unavailable", body.GetProperty("error").GetString());
    }

    // ---- at ----

    [Fact]
    public async Task At_ReturnsTheMatchingHour()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", Hourly);

        var (status, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T14:30:00");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("2030-06-01T14:00", body.GetProperty("hour").GetString());
        Assert.Equal(19.9, body.GetProperty("temperature_2m").GetDouble());
        Assert.Equal(61, body.GetProperty("weather_code").GetInt32());
        Assert.Equal(1, body.GetProperty("is_day").GetInt32());
        Assert.Contains("start_date=2030-06-01&end_date=2030-06-01", Assert.Single(_f.Http.Requests));
    }

    [Fact]
    public async Task At_AsksForUtcHours_AndMatchesTheUtcHourOfAZonedTime()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", Hourly);

        var (_, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T14:30:00Z");

        Assert.Equal("2030-06-01T14:00", body.GetProperty("hour").GetString());
        Assert.Contains("timezone=UTC", Assert.Single(_f.Http.Requests));
    }

    [Fact]
    public async Task At_FallsBackToFirstHour_WhenNoHourMatches()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", Hourly);

        var (_, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T09:00:00");

        Assert.Equal("2030-06-01T00:00", body.GetProperty("hour").GetString());
        Assert.Equal(10.5, body.GetProperty("temperature_2m").GetDouble());
    }

    [Fact]
    public async Task At_IgnoresUnparseableTimeStrings()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", """
            {"hourly":{"time":["short",null,"2030-06-01Txx:00","2030-06-01T08:00"],
              "temperature_2m":[1,2,3,4],"weather_code":[1,2,3,4],"is_day":[1,1,1,1]}}
            """);

        var (_, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T08:00:00");

        Assert.Equal("2030-06-01T08:00", body.GetProperty("hour").GetString());
        Assert.Equal(4, body.GetProperty("temperature_2m").GetDouble());
    }

    [Fact]
    public async Task At_ReturnsFallback_WhenPayloadHasNoHourlyBlock()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", """{"reason":"nope"}""");

        var (status, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T08:00:00");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(15, body.GetProperty("fallback").GetProperty("temperature_2m").GetInt32());
        Assert.False(body.TryGetProperty("error", out _));
    }

    [Fact]
    public async Task At_ReturnsErrorFallback_WhenHourlyBlockIsMalformed()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", """{"hourly":{"time":[]}}""");

        var (_, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T08:00:00");

        Assert.Equal("weather_unavailable", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task At_ReturnsErrorFallback_WhenUpstreamFails()
    {
        Reset();
        _f.Http.Throw("open-meteo");

        var (status, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T08:00:00");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("weather_unavailable", body.GetProperty("error").GetString());
        Assert.Equal(3, body.GetProperty("fallback").GetProperty("weather_code").GetInt32());
    }

    // ---- forecast ----

    [Fact]
    public async Task Forecast_PassesThroughUpstreamJson()
    {
        Reset();
        _f.Http.RespondJson("open-meteo", """{"daily":{"temperature_2m_max":[22.1]}}""");

        var (status, body) = await GetJsonAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-07-04");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(22.1, body.GetProperty("daily").GetProperty("temperature_2m_max")[0].GetDouble());
        Assert.Contains("start_date=2030-07-03&end_date=2030-07-05", Assert.Single(_f.Http.Requests));
    }

    [Fact]
    public async Task Forecast_ReturnsFallback_WhenUpstreamFails()
    {
        Reset();
        _f.Http.Throw("open-meteo");

        var (status, body) = await GetJsonAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-07-04");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("weather_unavailable", body.GetProperty("error").GetString());
        Assert.Equal(15, body.GetProperty("fallback").GetProperty("temperature_2m_max")[0].GetInt32());
    }

    // ---- dual-provider (UK Met Office 1.5 km + MET Norway 9 km) ----

    private const string MetOfficeGeoJson = """
        {
          "type": "FeatureCollection",
          "features": [
            {
              "type": "Feature",
              "geometry": { "type": "Point", "coordinates": [-1.25, 52.5, 85.0] },
              "properties": {
                "modelRunDate": "2030-06-01T12:00Z",
                "timeSeries": [
                  {
                    "time": "2030-06-01T12:00Z",
                    "screenTemperature": 18.4,
                    "windSpeed10m": 5.0,
                    "screenRelativeHumidity": 68.2,
                    "probOfPrecipitation": 15,
                    "totalPrecipAmount": 0.0,
                    "significantWeatherCode": 3
                  },
                  {
                    "time": "2030-06-01T13:00Z",
                    "screenTemperature": 19.2,
                    "windSpeed10m": 6.5,
                    "screenRelativeHumidity": 64.0,
                    "probOfPrecipitation": 40,
                    "totalPrecipAmount": 0.5,
                    "significantWeatherCode": 12
                  },
                  {
                    "time": "2030-06-01T14:00Z",
                    "screenTemperature": 21.0,
                    "windSpeed10m": 7.0,
                    "screenRelativeHumidity": 72.0,
                    "probOfPrecipitation": 80,
                    "totalPrecipAmount": 4.2,
                    "significantWeatherCode": 29
                  },
                  {
                    "time": "2030-06-01T22:00Z",
                    "screenTemperature": 11.5,
                    "windSpeed10m": 3.0,
                    "screenRelativeHumidity": 85.0,
                    "probOfPrecipitation": 10,
                    "totalPrecipAmount": 0.0,
                    "significantWeatherCode": 0
                  }
                ]
              }
            }
          ]
        }
        """;

    private const string MetNorwayGeoJson = """
        {
          "type": "Feature",
          "geometry": { "type": "Point", "coordinates": [2.35, 48.85, 35.0] },
          "properties": {
            "timeseries": [
              {
                "time": "2030-06-01T12:00:00Z",
                "data": {
                  "instant": {
                    "details": {
                      "air_temperature": 22.6,
                      "wind_speed": 4.0,
                      "relative_humidity": 55.0
                    }
                  },
                  "next_1_hours": {
                    "summary": { "symbol_code": "partlycloudy_day" },
                    "details": {
                      "precipitation_amount": 0.0,
                      "probability_of_precipitation": 10.0
                    }
                  }
                }
              },
              {
                "time": "2030-06-01T14:00:00Z",
                "data": {
                  "instant": {
                    "details": {
                      "air_temperature": 24.1,
                      "wind_speed": 5.5,
                      "relative_humidity": 50.0
                    }
                  },
                  "next_1_hours": {
                    "summary": { "symbol_code": "heavyrainshowersandthunder_day" },
                    "details": {
                      "precipitation_amount": 5.4,
                      "probability_of_precipitation": 90.0
                    }
                  }
                }
              },
              {
                "time": "2030-06-05T12:00:00Z",
                "data": {
                  "instant": {
                    "details": {
                      "air_temperature": 17.5,
                      "wind_speed": 3.5,
                      "relative_humidity": 65.0
                    }
                  },
                  "next_6_hours": {
                    "summary": { "symbol_code": "rain_day" },
                    "details": {
                      "precipitation_amount": 6.0,
                      "probability_of_precipitation": 75.0
                    }
                  }
                }
              }
            ]
          }
        }
        """;

    [Fact]
    public async Task MetOffice_NormalisesGeoJson_ForCurrentAtAndForecast_InBst()
    {
        Reset();
        var clock = new ManualTimeProvider();
        var cache = _f.Services.GetRequiredService<WeatherCache>();
        cache.ConfigureProviders("test-metoffice-key", clock, useDualProviders: true);

        string? capturedApiKey = null;
        string? capturedUserAgent = null;
        _f.Http.Respond("data.hub.api.metoffice.gov.uk", req =>
        {
            capturedApiKey = req.Headers.TryGetValues("apikey", out var vals) ? vals.FirstOrDefault() : null;
            capturedUserAgent = req.Headers.UserAgent.ToString();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new System.Net.Http.StringContent(MetOfficeGeoJson, System.Text.Encoding.UTF8, "application/json")
            };
        });

        var (curStatus, curBody) = await GetJsonAsync("/api/weather/current?lat=52.5&lon=-1.25");
        Assert.Equal(HttpStatusCode.OK, curStatus);
        Assert.Equal("test-metoffice-key", capturedApiKey);
        Assert.Contains("MountedGamesApp/1.0", capturedUserAgent);
        Assert.Equal("met-office", curBody.GetProperty("provider").GetString());
        var current = curBody.GetProperty("current");
        Assert.Equal(18.4, current.GetProperty("temperature_2m").GetDouble());
        Assert.Equal(2, current.GetProperty("weather_code").GetInt32());
        Assert.Equal(18.0, current.GetProperty("wind_speed_10m").GetDouble()); // 5.0 m/s * 3.6 = 18.0 km/h
        Assert.Equal(68, current.GetProperty("relative_humidity_2m").GetInt32());
        Assert.Equal(1, current.GetProperty("is_day").GetInt32());

        var (atStatus, atBody) = await GetJsonAsync("/api/weather/at?lat=52.5&lon=-1.25&when=2030-06-01T14:30:00Z");
        Assert.Equal(HttpStatusCode.OK, atStatus);
        Assert.Equal("2030-06-01T14:00", atBody.GetProperty("hour").GetString());
        Assert.Equal(21.0, atBody.GetProperty("temperature_2m").GetDouble());
        Assert.Equal(95, atBody.GetProperty("weather_code").GetInt32());
        Assert.Equal(1, atBody.GetProperty("is_day").GetInt32());

        var (fcStatus, fcBody) = await GetJsonAsync("/api/weather/forecast?lat=52.5&lon=-1.25&date=2030-06-01");
        Assert.Equal(HttpStatusCode.OK, fcStatus);
        Assert.Equal("met-office", fcBody.GetProperty("provider").GetString());
        Assert.Equal(3600, fcBody.GetProperty("utc_offset_seconds").GetInt32()); // BST (UTC+1)

        var daily = fcBody.GetProperty("daily");
        Assert.Equal("2030-06-01", daily.GetProperty("time")[0].GetString());
        Assert.Equal(95, daily.GetProperty("weather_code")[0].GetInt32());
        Assert.Equal(21.0, daily.GetProperty("temperature_2m_max")[0].GetDouble());
        Assert.Equal(11.5, daily.GetProperty("temperature_2m_min")[0].GetDouble());
        Assert.Equal(80, daily.GetProperty("precipitation_probability_max")[0].GetDouble());
        Assert.Equal(25.2, daily.GetProperty("wind_speed_10m_max")[0].GetDouble()); // 7.0 m/s * 3.6 = 25.2 km/h

        var hourly = fcBody.GetProperty("hourly");
        Assert.Equal(4, hourly.GetProperty("time").GetArrayLength());
        Assert.Equal("2030-06-01T12:00:00Z", hourly.GetProperty("time")[0].GetString());
        Assert.Equal(4.2, hourly.GetProperty("precipitation")[2].GetDouble());

        // All three endpoints shared the single fresh 1.5 km Met Office venue series.
        Assert.Single(_f.Http.Requests);
        Assert.Equal(1, cache.GetMetOfficeCallCount(clock.GetUtcNow()));
    }

    [Fact]
    public async Task MetNorway_NormalisesGeoJson_AndExpandsSixHourBlocks()
    {
        Reset();
        var clock = new ManualTimeProvider();
        var cache = _f.Services.GetRequiredService<WeatherCache>();
        cache.ConfigureProviders(metOfficeApiKey: null, timeProvider: clock, useDualProviders: true);
        _f.Http.RespondJson("api.met.no", MetNorwayGeoJson);

        var (curStatus, curBody) = await GetJsonAsync("/api/weather/current?lat=48.85&lon=2.35");
        Assert.Equal(HttpStatusCode.OK, curStatus);
        Assert.Equal("met-norway", curBody.GetProperty("provider").GetString());
        Assert.Equal(22.6, curBody.GetProperty("current").GetProperty("temperature_2m").GetDouble());
        Assert.Equal(14.4, curBody.GetProperty("current").GetProperty("wind_speed_10m").GetDouble()); // 4.0 m/s * 3.6
        Assert.Equal(2, curBody.GetProperty("current").GetProperty("weather_code").GetInt32());

        var (atStatus, atBody) = await GetJsonAsync("/api/weather/at?lat=48.85&lon=2.35&when=2030-06-01T14:15:00Z");
        Assert.Equal(HttpStatusCode.OK, atStatus);
        Assert.Equal("2030-06-01T14:00", atBody.GetProperty("hour").GetString());
        Assert.Equal(95, atBody.GetProperty("weather_code").GetInt32());

        // Far-out forecast (>48h) with next_6_hours block expands into 6 hourly points (12:00Z..17:00Z).
        var (fcStatus, fcBody) = await GetJsonAsync("/api/weather/forecast?lat=48.85&lon=2.35&date=2030-06-05");
        Assert.Equal(HttpStatusCode.OK, fcStatus);
        var hourly = fcBody.GetProperty("hourly");
        Assert.Equal(6, hourly.GetProperty("time").GetArrayLength());
        Assert.Equal("2030-06-05T12:00:00Z", hourly.GetProperty("time")[0].GetString());
        Assert.Equal("2030-06-05T17:00:00Z", hourly.GetProperty("time")[5].GetString());
        Assert.Equal(61, hourly.GetProperty("weather_code")[0].GetInt32());
        Assert.Equal(1.0, hourly.GetProperty("precipitation")[0].GetDouble()); // 6.0 mm / 6 hours = 1.0 mm/h
        Assert.Equal(75.0, hourly.GetProperty("precipitation_probability")[0].GetDouble());

        // All three endpoints (/current, /at, and /forecast) shared the single cached MET Norway venue series!
        Assert.Single(_f.Http.Requests);
    }

    [Fact]
    public async Task EarlyMorning48HourTruncation_FallsThroughToMetNorwayWhenDaytimeHoursAreMissing()
    {
        Reset();
        var clock = new ManualTimeProvider(); // 2030-06-01T12:00:00Z
        var cache = _f.Services.GetRequiredService<WeatherCache>();
        cache.ConfigureProviders("test-metoffice-key", clock, useDualProviders: true);

        // Met Office returns a 48h tail that only reaches 2030-06-03T01:00Z (missing all daytime hours on 2030-06-03).
        const string truncatedMetOffice = """
            {
              "type": "FeatureCollection",
              "features": [{
                "type": "Feature",
                "properties": {
                  "timeSeries": [
                    { "time": "2030-06-03T00:00Z", "screenTemperature": 9.0, "windSpeed10m": 2.0, "significantWeatherCode": 0 },
                    { "time": "2030-06-03T01:00Z", "screenTemperature": 8.5, "windSpeed10m": 2.0, "significantWeatherCode": 0 }
                  ]
                }
              }]
            }
            """;
        const string fullMetNorway = """
            {
              "type": "Feature",
              "properties": {
                "timeseries": [
                  {
                    "time": "2030-06-03T12:00:00Z",
                    "data": {
                      "instant": { "details": { "air_temperature": 19.0, "wind_speed": 4.0, "relative_humidity": 60.0 } },
                      "next_6_hours": {
                        "summary": { "symbol_code": "clearsky_day" },
                        "details": { "precipitation_amount": 0.0, "probability_of_precipitation": 5.0 }
                      }
                    }
                  }
                ]
              }
            }
            """;

        _f.Http.RespondJson("data.hub.api.metoffice.gov.uk", truncatedMetOffice);
        _f.Http.RespondJson("api.met.no", fullMetNorway);

        var (status, body) = await GetJsonAsync("/api/weather/forecast?lat=52.5&lon=-1.25&date=2030-06-03");
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("met-norway", body.GetProperty("provider").GetString());
        Assert.Equal(19.0, body.GetProperty("daily").GetProperty("temperature_2m_max")[0].GetDouble());
    }

    [Fact]
    public async Task NonUkCoordinates_AndDatesBeyond48Hours_RouteDirectlyToMetNorwayWithoutSpendingMetOfficeQuota()
    {
        Reset();
        var clock = new ManualTimeProvider();
        var cache = _f.Services.GetRequiredService<WeatherCache>();
        cache.ConfigureProviders("test-metoffice-key", clock, useDualProviders: true);
        _f.Http.RespondJson("api.met.no", MetNorwayGeoJson);

        // 1. Non-UK venue (Paris: 48.85, 2.35)
        var (parisStatus, parisBody) = await GetJsonAsync("/api/weather/current?lat=48.85&lon=2.35");
        Assert.Equal(HttpStatusCode.OK, parisStatus);
        Assert.Equal("met-norway", parisBody.GetProperty("provider").GetString());

        // 2. UK venue (52.5, -1.25) but > 48h in the future (2030-06-05 vs now 2030-06-01)
        var (farStatus, farBody) = await GetJsonAsync("/api/weather/forecast?lat=52.5&lon=-1.25&date=2030-06-05");
        Assert.Equal(HttpStatusCode.OK, farStatus);
        Assert.Equal("met-norway", farBody.GetProperty("provider").GetString());

        Assert.Equal(0, cache.GetMetOfficeCallCount(clock.GetUtcNow()));
        Assert.All(_f.Http.Requests, url => Assert.Contains("api.met.no", url));
    }

    [Fact]
    public void Normalizer_MapsMetOfficeAndMetNorwayCodes_AndWinterGmtOffset()
    {
        var noonUtc = new DateTime(2030, 1, 15, 12, 0, 0, DateTimeKind.Utc);
        Assert.Equal((0, 0), WeatherProviderNormalizer.MapMetOfficeWeatherCode(0, noonUtc));
        Assert.Equal((0, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(1, noonUtc));
        Assert.Equal((2, 0), WeatherProviderNormalizer.MapMetOfficeWeatherCode(2, noonUtc));
        Assert.Equal((2, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(3, noonUtc));
        Assert.Equal((45, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(5, noonUtc));
        Assert.Equal((3, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(7, noonUtc));
        Assert.Equal((51, 0), WeatherProviderNormalizer.MapMetOfficeWeatherCode(9, noonUtc));
        Assert.Equal((51, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(10, noonUtc));
        Assert.Equal((51, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(11, noonUtc));
        Assert.Equal((61, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(12, noonUtc));
        Assert.Equal((80, 0), WeatherProviderNormalizer.MapMetOfficeWeatherCode(13, noonUtc));
        Assert.Equal((80, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(14, noonUtc));
        Assert.Equal((65, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(15, noonUtc));
        Assert.Equal((67, 0), WeatherProviderNormalizer.MapMetOfficeWeatherCode(16, noonUtc));
        Assert.Equal((67, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(17, noonUtc));
        Assert.Equal((67, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(18, noonUtc));
        Assert.Equal((67, 0), WeatherProviderNormalizer.MapMetOfficeWeatherCode(19, noonUtc));
        Assert.Equal((67, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(20, noonUtc));
        Assert.Equal((67, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(21, noonUtc));
        Assert.Equal((71, 0), WeatherProviderNormalizer.MapMetOfficeWeatherCode(22, noonUtc));
        Assert.Equal((71, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(23, noonUtc));
        Assert.Equal((71, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(24, noonUtc));
        Assert.Equal((85, 0), WeatherProviderNormalizer.MapMetOfficeWeatherCode(25, noonUtc));
        Assert.Equal((85, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(26, noonUtc));
        Assert.Equal((85, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(27, noonUtc));
        Assert.Equal((95, 0), WeatherProviderNormalizer.MapMetOfficeWeatherCode(28, noonUtc));
        Assert.Equal((95, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(29, noonUtc));
        Assert.Equal((95, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(30, noonUtc));
        Assert.Equal((3, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(99, noonUtc));

        Assert.Equal((0, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("clearsky_day", noonUtc));
        Assert.Equal((0, 0), WeatherProviderNormalizer.MapMetNorwaySymbolCode("clearsky_night", noonUtc));
        Assert.Equal((1, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("fair_polartwilight", noonUtc));
        Assert.Equal((2, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("partlycloudy_day", noonUtc));
        Assert.Equal((3, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("cloudy", noonUtc));
        Assert.Equal((45, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("fog", noonUtc));
        Assert.Equal((51, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("lightrain", noonUtc));
        Assert.Equal((61, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("rain", noonUtc));
        Assert.Equal((65, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("heavyrain", noonUtc));
        Assert.Equal((80, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("rainshowers_day", noonUtc));
        Assert.Equal((71, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("sleet", noonUtc));
        Assert.Equal((85, 0), WeatherProviderNormalizer.MapMetNorwaySymbolCode("snowshowers_night", noonUtc));
        Assert.Equal((95, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode("heavyrainandthunder", noonUtc));
        Assert.Equal((3, 1), WeatherProviderNormalizer.MapMetNorwaySymbolCode(null, noonUtc));

        var winterSeries = new VenueWeatherSeries(
            WeatherProviderNormalizer.MetOfficeProvider,
            52.5,
            -1.25,
            new[] { new NormalizedWeatherHour(noonUtc, 8.0, 3, 12.0, 80, 20, 0.0, 1) });
        var winterForecast = JsonSerializer.SerializeToElement(WeatherProviderNormalizer.BuildForecastResponse(winterSeries, noonUtc.Date));
        Assert.Equal(0, winterForecast.GetProperty("utc_offset_seconds").GetInt32());

        // Negative wind sentinel is clamped to 0.0 km/h.
        Assert.Equal(0.0, WeatherProviderNormalizer.MetersPerSecondToKmh(-99.0));

        // 05:00 UTC in June is 06:00 BST -> InferIsDay returns 1 (daytime).
        var bstSixAmUtc = new DateTime(2030, 6, 15, 5, 0, 0, DateTimeKind.Utc);
        Assert.Equal((3, 1), WeatherProviderNormalizer.MapMetOfficeWeatherCode(7, bstSixAmUtc));
    }

    [Fact]
    public async Task WeatherPolicy_EnforcesPerIpRateLimit()
    {
        using var limitedFactory = _f.WithWebHostBuilder(b => b.UseSetting("RateLimits:WeatherPerMinute", "2"));
        _f.Http.RespondJson("open-meteo", """{"current":{"temperature_2m":18.0,"weather_code":1}}""");
        var client = limitedFactory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Ip", "203.0.113.77");

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/weather/current?lat=52.5&lon=-1.25")).StatusCode);
    }
}
