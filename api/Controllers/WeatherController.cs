using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Json;
using System.Text.Json;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/weather")]
public class WeatherController : ControllerBase
{
    private readonly IHttpClientFactory _http;
    public WeatherController(IHttpClientFactory http) => _http = http;

    [HttpGet("current")]
    public async Task<ActionResult<object>> Current([FromQuery] double lat, [FromQuery] double lon)
    {
        var client = _http.CreateClient("weather");
        var url = $"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,is_day&timezone=auto";
        try
        {
            using var resp = await client.GetAsync(url);
            resp.EnsureSuccessStatusCode();
            await using var stream = await resp.Content.ReadAsStreamAsync();
            using var doc = await JsonDocument.ParseAsync(stream);
            return Ok(JsonSerializer.Deserialize<object>(doc.RootElement.GetRawText())!);
        }
        catch (Exception ex)
        {
            return Ok(new
            {
                error = "weather_unavailable",
                detail = ex.Message,
                fallback = new { temperature_2m = 15, weather_code = 3, wind_speed_10m = 8, is_day = 1 }
            });
        }
    }

    [HttpGet("at")]
    public async Task<ActionResult<object>> AtTime(
        [FromQuery] double lat,
        [FromQuery] double lon,
        [FromQuery] DateTime when)
    {
        var client = _http.CreateClient("weather");
        var day = when.ToString("yyyy-MM-dd");
        var url = $"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m,weather_code,is_day&start_date={day}&end_date={day}&timezone=auto";
        try
        {
            using var resp = await client.GetAsync(url);
            resp.EnsureSuccessStatusCode();
            await using var stream = await resp.Content.ReadAsStreamAsync();
            using var doc = await JsonDocument.ParseAsync(stream);
            var root = doc.RootElement;
            if (!root.TryGetProperty("hourly", out var hourly))
                return Ok(new { fallback = new { temperature_2m = 15, weather_code = 3, is_day = 1 } });
            var times = hourly.GetProperty("time").EnumerateArray().Select(t => t.GetString()).ToList();
            var temps = hourly.GetProperty("temperature_2m").EnumerateArray().Select(t => t.GetDouble()).ToList();
            var codes = hourly.GetProperty("weather_code").EnumerateArray().Select(t => t.GetInt32()).ToList();
            var days = hourly.GetProperty("is_day").EnumerateArray().Select(t => t.GetInt32()).ToList();
            var targetHour = when.Hour;
            var idx = 0;
            for (var i = 0; i < times.Count; i++)
            {
                if (times[i] is string s && s.Length >= 13 && int.TryParse(s.Substring(11, 2), out var h) && h == targetHour)
                { idx = i; break; }
            }
            return Ok(new
            {
                hour = times.ElementAtOrDefault(idx),
                temperature_2m = temps.ElementAtOrDefault(idx),
                weather_code = codes.ElementAtOrDefault(idx),
                is_day = days.ElementAtOrDefault(idx)
            });
        }
        catch (Exception ex)
        {
            return Ok(new
            {
                error = "weather_unavailable",
                detail = ex.Message,
                fallback = new { temperature_2m = 15, weather_code = 3, is_day = 1 }
            });
        }
    }

    [HttpGet("forecast")]
    public async Task<ActionResult<object>> Forecast(
        [FromQuery] double lat,
        [FromQuery] double lon,
        [FromQuery] DateTime date)
    {
        var client = _http.CreateClient("weather");
        var iso = date.ToString("yyyy-MM-dd");
        var url = $"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&start_date={iso}&end_date={iso}&timezone=auto";
        try
        {
            using var resp = await client.GetAsync(url);
            resp.EnsureSuccessStatusCode();
            await using var stream = await resp.Content.ReadAsStreamAsync();
            using var doc = await JsonDocument.ParseAsync(stream);
            return Ok(JsonSerializer.Deserialize<object>(doc.RootElement.GetRawText())!);
        }
        catch (Exception ex)
        {
            return Ok(new
            {
                error = "weather_unavailable",
                detail = ex.Message,
                fallback = new { weather_code = new[] { 3 }, temperature_2m_max = new[] { 15 }, temperature_2m_min = new[] { 8 } }
            });
        }
    }
}
