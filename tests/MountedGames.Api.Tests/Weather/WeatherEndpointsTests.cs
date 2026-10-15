using System.Net;
using System.Text.Json;
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

    private async Task<(HttpStatusCode Status, JsonElement Body)> GetJsonAsync(string url)
    {
        var r = await _f.CreateClient().GetAsync(url);
        return (r.StatusCode, await r.ReadAsync<JsonElement>());
    }

    // ---- current ----

    [Fact]
    public async Task Current_PassesThroughUpstreamJson()
    {
        _f.Http.Reset();
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
        _f.Http.Reset();
        _f.Http.Throw("open-meteo");

        var (status, body) = await GetJsonAsync("/api/weather/current?lat=1&lon=2");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("weather_unavailable", body.GetProperty("error").GetString());
        Assert.Equal(15, body.GetProperty("fallback").GetProperty("temperature_2m").GetInt32());
        Assert.Contains("stubbed network failure", body.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Current_ReturnsFallback_WhenUpstreamReturnsErrorStatus()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("open-meteo", "{}", HttpStatusCode.InternalServerError);

        var (_, body) = await GetJsonAsync("/api/weather/current?lat=1&lon=2");

        Assert.Equal("weather_unavailable", body.GetProperty("error").GetString());
    }

    // ---- at ----

    [Fact]
    public async Task At_ReturnsTheMatchingHour()
    {
        _f.Http.Reset();
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
    public async Task At_FallsBackToFirstHour_WhenNoHourMatches()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("open-meteo", Hourly);

        var (_, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T09:00:00");

        Assert.Equal("2030-06-01T00:00", body.GetProperty("hour").GetString());
        Assert.Equal(10.5, body.GetProperty("temperature_2m").GetDouble());
    }

    [Fact]
    public async Task At_IgnoresUnparseableTimeStrings()
    {
        _f.Http.Reset();
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
        _f.Http.Reset();
        _f.Http.RespondJson("open-meteo", """{"reason":"nope"}""");

        var (status, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T08:00:00");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(15, body.GetProperty("fallback").GetProperty("temperature_2m").GetInt32());
        Assert.False(body.TryGetProperty("error", out _));
    }

    [Fact]
    public async Task At_ReturnsErrorFallback_WhenHourlyBlockIsMalformed()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("open-meteo", """{"hourly":{"time":[]}}""");

        var (_, body) = await GetJsonAsync("/api/weather/at?lat=52&lon=-1&when=2030-06-01T08:00:00");

        Assert.Equal("weather_unavailable", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task At_ReturnsErrorFallback_WhenUpstreamFails()
    {
        _f.Http.Reset();
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
        _f.Http.Reset();
        _f.Http.RespondJson("open-meteo", """{"daily":{"temperature_2m_max":[22.1]}}""");

        var (status, body) = await GetJsonAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-07-04");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(22.1, body.GetProperty("daily").GetProperty("temperature_2m_max")[0].GetDouble());
        Assert.Contains("start_date=2030-07-04&end_date=2030-07-04", Assert.Single(_f.Http.Requests));
    }

    [Fact]
    public async Task Forecast_ReturnsFallback_WhenUpstreamFails()
    {
        _f.Http.Reset();
        _f.Http.Throw("open-meteo");

        var (status, body) = await GetJsonAsync("/api/weather/forecast?lat=52&lon=-1&date=2030-07-04");

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("weather_unavailable", body.GetProperty("error").GetString());
        Assert.Equal(15, body.GetProperty("fallback").GetProperty("temperature_2m_max")[0].GetInt32());
    }
}
