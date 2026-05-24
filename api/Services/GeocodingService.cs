using System.Globalization;
using System.Text.Json;

namespace MountedGames.Api.Services;

/// <summary>
/// Resolves a postcode (UK, via postcodes.io — no API key) or a what3words address
/// (via api.what3words.com — needs a key in config "What3Words:ApiKey") to latitude/longitude.
/// </summary>
public class GeocodingService
{
    private readonly HttpClient _http;
    private readonly IConfiguration _config;
    private readonly ILogger<GeocodingService> _log;

    public GeocodingService(IHttpClientFactory factory, IConfiguration config, ILogger<GeocodingService> log)
    {
        _http = factory.CreateClient("geocoding");
        _config = config;
        _log = log;
    }

    public async Task<(double? lat, double? lon, string? source)> ResolveAsync(
        string? postcode, string? what3Words, CancellationToken ct = default)
    {
        // Postcode first — fastest and most reliable for UK comps.
        if (!string.IsNullOrWhiteSpace(postcode))
        {
            var (la, lo) = await ResolvePostcodeAsync(postcode, ct);
            if (la is not null && lo is not null) return (la, lo, "postcode");
        }
        if (!string.IsNullOrWhiteSpace(what3Words))
        {
            var (la, lo) = await ResolveWhat3WordsAsync(what3Words, ct);
            if (la is not null && lo is not null) return (la, lo, "what3words");
        }
        return (null, null, null);
    }

    public async Task<(double? lat, double? lon)> ResolvePostcodeAsync(string postcode, CancellationToken ct = default)
    {
        var trimmed = postcode.Trim();
        if (trimmed.Length == 0) return (null, null);
        try
        {
            var url = $"https://api.postcodes.io/postcodes/{Uri.EscapeDataString(trimmed)}";
            using var resp = await _http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode) return (null, null);
            using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (!doc.RootElement.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Object)
                return (null, null);
            var lat = TryGetDouble(result, "latitude");
            var lon = TryGetDouble(result, "longitude");
            return (lat, lon);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Postcode lookup failed for {Postcode}", trimmed);
            return (null, null);
        }
    }

    public async Task<(double? lat, double? lon)> ResolveWhat3WordsAsync(string words, CancellationToken ct = default)
    {
        var key = _config["What3Words:ApiKey"];
        if (string.IsNullOrWhiteSpace(key))
        {
            _log.LogDebug("Skipping what3words lookup — no API key configured (set What3Words:ApiKey)");
            return (null, null);
        }
        var cleaned = words.Trim().TrimStart('/');
        if (cleaned.Length == 0) return (null, null);
        try
        {
            var url = $"https://api.what3words.com/v3/convert-to-coordinates?words={Uri.EscapeDataString(cleaned)}&key={Uri.EscapeDataString(key)}";
            using var resp = await _http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode) return (null, null);
            using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (!doc.RootElement.TryGetProperty("coordinates", out var coords) || coords.ValueKind != JsonValueKind.Object)
                return (null, null);
            var lat = TryGetDouble(coords, "lat");
            var lon = TryGetDouble(coords, "lng");
            return (lat, lon);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "what3words lookup failed for {Words}", cleaned);
            return (null, null);
        }
    }

    private static double? TryGetDouble(JsonElement el, string prop)
    {
        if (!el.TryGetProperty(prop, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.Number => v.GetDouble(),
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
            _ => null
        };
    }
}
