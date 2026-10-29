using MountedGames.Api.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Services;
using System.Text.Json;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/weather")]
[EnableRateLimiting("public-read")]
public class WeatherController : ControllerBase
{
    // Successful lookups may be reused by browsers and the CDN for 10 minutes; the server cache holds
    // them for longer. SecurityHeadersMiddleware exempts these paths from "no-store", and
    // JsonEtagMiddleware only fills in Cache-Control when it is absent, so this header survives.
    private const string PublicCacheControl = "public, max-age=600";

    private readonly IHttpClientFactory _http;
    private readonly WeatherCache _cache;
    private readonly TimeProvider _time;
    private readonly ILogger<WeatherController> _log;

    public WeatherController(IHttpClientFactory http, WeatherCache cache, TimeProvider time, ILogger<WeatherController> log)
    {
        _http = http;
        _cache = cache;
        _time = time;
        _log = log;
    }

    private async Task<ActionResult<object>> ServeAsync(string key, Func<Task<WeatherOutcome>> fetch)
    {
        var (body, cacheable) = await _cache.GetOrFetchAsync(key, fetch);
        if (cacheable) Response.Headers.CacheControl = PublicCacheControl;
        return Ok(body);
    }

    // Lookups use the rounded coordinates (about 1 km) so the cached answer is the same whichever
    // phone asked first.
    [HttpGet("current")]
    [AllowAnonymous]
    [PublicRead]
    public Task<ActionResult<object>> Current([FromQuery] double lat, [FromQuery] double lon)
    {
        lat = WeatherCache.RoundCoordinate(lat);
        lon = WeatherCache.RoundCoordinate(lon);
        return ServeAsync(WeatherCache.CurrentKey(lat, lon), async () =>
        {
            var client = _http.CreateClient("weather");
            var url = $"https://api.open-meteo.com/v1/forecast?latitude={WeatherCache.Format(lat)}&longitude={WeatherCache.Format(lon)}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,is_day&timezone=auto";
            try
            {
                using var resp = await client.GetAsync(url);
                resp.EnsureSuccessStatusCode();
                await using var stream = await resp.Content.ReadAsStreamAsync();
                using var doc = await JsonDocument.ParseAsync(stream);
                return new WeatherOutcome(JsonSerializer.Deserialize<object>(doc.RootElement.GetRawText())!, WeatherCache.CurrentTtl);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Weather service request failed.");
                return new WeatherOutcome(new
                {
                    error = "weather_unavailable",
                    fallback = new { temperature_2m = 15, weather_code = 3, wind_speed_10m = 8, is_day = 1 }
                }, null);
            }
        });
    }

    [HttpGet("at")]
    [AllowAnonymous]
    [PublicRead]
    public Task<ActionResult<object>> AtTime(
        [FromQuery] double lat,
        [FromQuery] double lon,
        [FromQuery] DateTime when)
    {
        lat = WeatherCache.RoundCoordinate(lat);
        lon = WeatherCache.RoundCoordinate(lon);
        return ServeAsync(WeatherCache.AtKey(lat, lon, when), async () =>
        {
            var client = _http.CreateClient("weather");
            // The web sends a UTC instant, so ask Open-Meteo for UTC hours too (timezone=auto would answer in the
            // venue's local time, an hour out in BST). A time with no zone is read as UTC, as ForecastTtl does.
            var whenUtc = when.Kind == DateTimeKind.Unspecified ? when : when.ToUniversalTime();
            var day = whenUtc.ToString("yyyy-MM-dd");
            var url = $"https://api.open-meteo.com/v1/forecast?latitude={WeatherCache.Format(lat)}&longitude={WeatherCache.Format(lon)}&hourly=temperature_2m,weather_code,is_day&start_date={day}&end_date={day}&timezone=UTC";
            try
            {
                using var resp = await client.GetAsync(url);
                resp.EnsureSuccessStatusCode();
                await using var stream = await resp.Content.ReadAsStreamAsync();
                using var doc = await JsonDocument.ParseAsync(stream);
                var root = doc.RootElement;
                // A payload without hourly data isn't a real answer: serve the fallback but don't keep it.
                if (!root.TryGetProperty("hourly", out var hourly))
                    return new WeatherOutcome(new { fallback = new { temperature_2m = 15, weather_code = 3, is_day = 1 } }, null);
                var times = hourly.GetProperty("time").EnumerateArray().Select(t => t.GetString()).ToList();
                var temps = hourly.GetProperty("temperature_2m").EnumerateArray().Select(t => t.GetDouble()).ToList();
                var codes = hourly.GetProperty("weather_code").EnumerateArray().Select(t => t.GetInt32()).ToList();
                var days = hourly.GetProperty("is_day").EnumerateArray().Select(t => t.GetInt32()).ToList();
                var targetHour = whenUtc.Hour;
                var idx = 0;
                for (var i = 0; i < times.Count; i++)
                {
                    if (times[i] is string s && s.Length >= 13 && int.TryParse(s.Substring(11, 2), out var h) && h == targetHour)
                    { idx = i; break; }
                }
                return new WeatherOutcome(new
                {
                    hour = times.ElementAtOrDefault(idx),
                    temperature_2m = temps.ElementAtOrDefault(idx),
                    weather_code = codes.ElementAtOrDefault(idx),
                    is_day = days.ElementAtOrDefault(idx)
                }, WeatherCache.ForecastTtl(when, _time.GetUtcNow()));
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Weather service request failed.");
                return new WeatherOutcome(new
                {
                    error = "weather_unavailable",
                    fallback = new { temperature_2m = 15, weather_code = 3, is_day = 1 }
                }, null);
            }
        });
    }

    [HttpGet("forecast")]
    [AllowAnonymous]
    [PublicRead]
    public Task<ActionResult<object>> Forecast(
        [FromQuery] double lat,
        [FromQuery] double lon,
        [FromQuery] DateTime date)
    {
        lat = WeatherCache.RoundCoordinate(lat);
        lon = WeatherCache.RoundCoordinate(lon);
        return ServeAsync(WeatherCache.ForecastKey(lat, lon, date), async () =>
        {
            var client = _http.CreateClient("weather");
            var url = $"https://api.open-meteo.com/v1/forecast?latitude={WeatherCache.Format(lat)}&longitude={WeatherCache.Format(lon)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,is_day&start_date={date.AddDays(-1):yyyy-MM-dd}&end_date={date.AddDays(1):yyyy-MM-dd}&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh";
            try
            {
                using var resp = await client.GetAsync(url);
                resp.EnsureSuccessStatusCode();
                await using var stream = await resp.Content.ReadAsStreamAsync();
                using var doc = await JsonDocument.ParseAsync(stream);
                return new WeatherOutcome(WindForecast.Enrich(doc.RootElement, _time.GetUtcNow()), WeatherCache.ForecastTtl(date, _time.GetUtcNow()));
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Weather service request failed.");
                return new WeatherOutcome(new
                {
                    error = "weather_unavailable",
                    fallback = new { weather_code = new[] { 3 }, temperature_2m_max = new[] { 15 }, temperature_2m_min = new[] { 8 } }
                }, null);
            }
        });
    }
}
