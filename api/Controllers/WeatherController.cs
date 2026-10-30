using MountedGames.Api.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Services;
using System.Text.Json;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/weather")]
[EnableRateLimiting(RequestLimits.WeatherPolicy)]
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
            if (_cache.UseDualProviders)
            {
                var now = _cache.GetUtcNow(_time);
                var (series, ttl) = await ResolveProviderSeriesAsync(lat, lon, now.UtcDateTime, now, s => s.CoversInstant(now.UtcDateTime));
                if (series is not null)
                    return new WeatherOutcome(WeatherProviderNormalizer.BuildCurrentResponse(series, now), ttl);

                return new WeatherOutcome(new
                {
                    error = "weather_unavailable",
                    fallback = new { temperature_2m = 15, weather_code = 3, wind_speed_10m = 8, is_day = 1 }
                }, null);
            }

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
            var whenUtc = when.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(when, DateTimeKind.Utc)
                : when.ToUniversalTime();

            if (_cache.UseDualProviders)
            {
                var now = _cache.GetUtcNow(_time);
                var (series, ttl) = await ResolveProviderSeriesAsync(lat, lon, whenUtc, now, s => s.CoversInstant(whenUtc));
                if (series is not null)
                    return new WeatherOutcome(WeatherProviderNormalizer.BuildAtResponse(series, whenUtc), ttl);

                return new WeatherOutcome(new
                {
                    error = "weather_unavailable",
                    fallback = new { temperature_2m = 15, weather_code = 3, is_day = 1 }
                }, null);
            }

            var client = _http.CreateClient("weather");
            // The web sends a UTC instant, so ask Open-Meteo for UTC hours too (timezone=auto would answer in the
            // venue's local time, an hour out in BST). A time with no zone is read as UTC, as ForecastTtl does.
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
                }, WeatherCache.ForecastTtl(when, _cache.GetUtcNow(_time)));
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
            var dateUtc = DateTime.SpecifyKind(date.Date, DateTimeKind.Utc);

            if (_cache.UseDualProviders)
            {
                var now = _cache.GetUtcNow(_time);
                var (series, ttl) = await ResolveProviderSeriesAsync(lat, lon, dateUtc, now, s => s.CoversDate(dateUtc));
                if (series is not null)
                    return new WeatherOutcome(WeatherProviderNormalizer.BuildForecastResponse(series, dateUtc), ttl);

                return new WeatherOutcome(new
                {
                    error = "weather_unavailable",
                    fallback = new { weather_code = new[] { 3 }, temperature_2m_max = new[] { 15 }, temperature_2m_min = new[] { 8 } }
                }, null);
            }

            var client = _http.CreateClient("weather");
            var url = $"https://api.open-meteo.com/v1/forecast?latitude={WeatherCache.Format(lat)}&longitude={WeatherCache.Format(lon)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,is_day&start_date={date.AddDays(-1):yyyy-MM-dd}&end_date={date.AddDays(1):yyyy-MM-dd}&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh";
            try
            {
                using var resp = await client.GetAsync(url);
                resp.EnsureSuccessStatusCode();
                await using var stream = await resp.Content.ReadAsStreamAsync();
                using var doc = await JsonDocument.ParseAsync(stream);
                return new WeatherOutcome(WindForecast.Enrich(doc.RootElement, _cache.GetUtcNow(_time)), WeatherCache.ForecastTtl(date, _cache.GetUtcNow(_time)));
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

    private async Task<(VenueWeatherSeries? Series, TimeSpan? Ttl)> ResolveProviderSeriesAsync(
        double lat,
        double lon,
        DateTime targetUtc,
        DateTimeOffset now,
        Func<VenueWeatherSeries, bool> coversTarget)
    {
        var client = _http.CreateClient("weather");
        var eligibleForMetOffice = WeatherProviderNormalizer.IsUkVenue(lat, lon)
            && !string.IsNullOrWhiteSpace(_cache.MetOfficeApiKey)
            && WeatherProviderNormalizer.IsWithinMetOfficeHorizon(targetUtc, now);

        if (eligibleForMetOffice)
        {
            _cache.TryGetMetOfficeGrace(lat, lon, now, out var graceEntry, out var isFresh);

            // Stage 1: Fresh UK Met Office series already in memory (<30m daytime / <3h overnight).
            if (isFresh && graceEntry is not null && coversTarget(graceEntry.Series))
            {
                var remainingFresh = graceEntry.FreshUntilUtc - now;
                return (graceEntry.Series, remainingFresh > TimeSpan.Zero ? remainingFresh : WeatherCache.UkCadenceTtl(now));
            }

            if (!isFresh)
            {
                // Coalesce concurrent /current, /at, and /forecast misses for the same venue so they share one Met Office call and quota slot.
                var metSeries = await _cache.GetOrFetchVenueSeriesAsync($"metoffice:{WeatherCache.VenueKey(lat, lon)}", async () =>
                {
                    if (_cache.TryGetMetOfficeGrace(lat, lon, now, out var recheckEntry, out var recheckFresh) && recheckFresh && recheckEntry is not null)
                        return recheckEntry.Series;

                    // Attempt refresh from UK Met Office DataHub (1.5 km UKV) if daily quota (<350) and per-minute sweep guard permit.
                    if (!_cache.TryConsumeMetOfficeQuota(lat, lon, now))
                        return null;

                    var metOfficeUrl = $"https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly?latitude={WeatherCache.Format(lat)}&longitude={WeatherCache.Format(lon)}";
                    try
                    {
                        using var req = new HttpRequestMessage(HttpMethod.Get, metOfficeUrl);
                        req.Headers.TryAddWithoutValidation("apikey", _cache.MetOfficeApiKey);
                        using var resp = await client.SendAsync(req);
                        resp.EnsureSuccessStatusCode();
                        await using var stream = await resp.Content.ReadAsStreamAsync();
                        using var doc = await JsonDocument.ParseAsync(stream);
                        if (WeatherProviderNormalizer.TryParseSeries(doc.RootElement, lat, lon, WeatherProviderNormalizer.MetOfficeProvider, out var parsedMetSeries)
                            && parsedMetSeries is not null)
                        {
                            _cache.StoreMetOfficeGrace(lat, lon, parsedMetSeries, now);
                            return parsedMetSeries;
                        }
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "UK Met Office DataHub request failed; checking 120-minute 1.5 km grace cache before falling back.");
                    }
                    return null;
                });

                if (metSeries is not null && coversTarget(metSeries))
                    return (metSeries, WeatherCache.UkCadenceTtl(now));
            }

            // Stage 2: 30–120 minute Grace Window. Do NOT overwrite a valid <=120m 1.5 km Met Office series with 9 km MET Norway!
            _cache.TryGetMetOfficeGrace(lat, lon, now, out graceEntry, out isFresh);
            if (graceEntry is not null && coversTarget(graceEntry.Series))
            {
                var remainingGrace = graceEntry.GraceUntilUtc - now;
                var graceTtl = remainingGrace > TimeSpan.FromMinutes(5)
                    ? TimeSpan.FromMinutes(5)
                    : (remainingGrace > TimeSpan.Zero ? remainingGrace : TimeSpan.FromSeconds(1));
                return (graceEntry.Series, graceTtl);
            }
        }

        // Stage 3: Fallback / Non-UK / >48h lead time -> MET Norway Locationforecast 2.0 (9 km ECMWF).
        var norwayTtl = WeatherProviderNormalizer.IsWithinMetOfficeHorizon(targetUtc, now)
            ? WeatherCache.UkCadenceTtl(now)
            : WeatherCache.FarForecastTtl;

        if (_cache.TryGetMetNorwaySeries(lat, lon, now, out var cachedNorway) && cachedNorway is not null && coversTarget(cachedNorway.Series))
        {
            var remaining = cachedNorway.FreshUntilUtc - now;
            return (cachedNorway.Series, remaining > TimeSpan.Zero && remaining < norwayTtl ? remaining : norwayTtl);
        }

        var norwaySeries = await _cache.GetOrFetchVenueSeriesAsync($"metnorway:{WeatherCache.VenueKey(lat, lon)}", async () =>
        {
            if (_cache.TryGetMetNorwaySeries(lat, lon, now, out var recheckNorway) && recheckNorway is not null)
                return recheckNorway.Series;

            var metNorwayUrl = $"https://api.met.no/weatherapi/locationforecast/2.0/complete?lat={WeatherCache.Format(lat)}&lon={WeatherCache.Format(lon)}";
            try
            {
                using var resp = await client.GetAsync(metNorwayUrl);
                resp.EnsureSuccessStatusCode();
                await using var stream = await resp.Content.ReadAsStreamAsync();
                using var doc = await JsonDocument.ParseAsync(stream);
                if (WeatherProviderNormalizer.TryParseSeries(doc.RootElement, lat, lon, WeatherProviderNormalizer.MetNorwayProvider, out var parsedNorwaySeries)
                    && parsedNorwaySeries is not null)
                {
                    _cache.StoreMetNorwaySeries(lat, lon, parsedNorwaySeries, now);
                    return parsedNorwaySeries;
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "MET Norway weather service request failed.");
            }
            return null;
        });

        if (norwaySeries is not null && coversTarget(norwaySeries))
            return (norwaySeries, norwayTtl);

        return (null, null);
    }
}
