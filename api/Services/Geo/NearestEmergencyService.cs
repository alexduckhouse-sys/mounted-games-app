using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using MountedGames.Api.Dtos;

namespace MountedGames.Api.Services.Geo;

/// <summary>
/// Finds the nearest hospital with an emergency department (OpenStreetMap <c>amenity=hospital</c> + <c>emergency=yes</c>,
/// through the Overpass API) for the organiser's emergency poster. Minor injuries units don't carry <c>emergency=yes</c>, which
/// is why the filter is that tag. The answer is a suggestion for the organiser to check, so every failure is a quiet
/// "not available" and never an error. Successful answers are cached by position (rounded to about 100 m) for a week.
/// </summary>
public class NearestEmergencyService
{
    public const string HttpClientName = "overpass";
    public const string OverpassUrl = "https://overpass-api.de/api/interpreter";
    public const double SearchRadiusMetres = 40_000;
    public static readonly TimeSpan CacheFor = TimeSpan.FromDays(7);
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(8);

    private const int MaxText = 200;
    private static readonly NearestEmergencyDto Unavailable = new(false, null);

    private readonly HttpClient _http;
    private readonly GeocodingService _geocode;
    private readonly IMemoryCache _cache;
    private readonly ILogger<NearestEmergencyService> _log;

    public NearestEmergencyService(IHttpClientFactory factory, GeocodingService geocode, IMemoryCache cache, ILogger<NearestEmergencyService> log)
    {
        _http = factory.CreateClient(HttpClientName);
        _geocode = geocode;
        _cache = cache;
        _log = log;
    }

    /// <summary>
    /// The nearest emergency hospital to a venue. Uses its stored position, or its postcode when there is no position.
    /// </summary>
    public async Task<NearestEmergencyDto> FindAsync(double? latitude, double? longitude, string? postcode, CancellationToken ct = default)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        budget.CancelAfter(Timeout);
        try
        {
            if ((latitude is null || longitude is null) && !string.IsNullOrWhiteSpace(postcode))
                (latitude, longitude) = await _geocode.ResolvePostcodeAsync(postcode, budget.Token);
            if (latitude is not { } lat || longitude is not { } lon || !IsPlace(lat, lon)) return Unavailable;

            // One rounded position is used for the cache key, the search and the distances, so a cached answer is the same whoever asked.
            var origin = new GeoPoint(Math.Round(lat, 3), Math.Round(lon, 3));
            var key = string.Create(CultureInfo.InvariantCulture, $"nearest-ae:{origin.Latitude:F3}:{origin.Longitude:F3}");
            if (_cache.TryGetValue(key, out NearestEmergencyDto? cached) && cached is not null) return cached;

            var found = await QueryAsync(origin, budget.Token);
            if (found is null) return Unavailable;
            _cache.Set(key, found, CacheFor);
            return found;
        }
        catch (Exception ex)
        {
            // The type only: an exception's message can carry the address that was asked for.
            _log.LogWarning("Nearest A&E lookup failed ({Reason})", ex.GetType().Name);
            return Unavailable;
        }
    }

    private static bool IsPlace(double lat, double lon) => double.IsFinite(lat) && double.IsFinite(lon) && lat is >= -90 and <= 90 && lon is >= -180 and <= 180;

    /// <summary>Asks Overpass. Null when it didn't give a usable answer; a DTO with no hospital when it answered and nothing is in range.</summary>
    private async Task<NearestEmergencyDto?> QueryAsync(GeoPoint origin, CancellationToken ct)
    {
        var query = string.Create(CultureInfo.InvariantCulture,
            $"[out:json][timeout:7];nwr[\"amenity\"=\"hospital\"][\"emergency\"=\"yes\"](around:{SearchRadiusMetres:0},{origin.Latitude:F3},{origin.Longitude:F3});out center tags;");
        // POST so the position stays out of the address (and out of the HTTP client's request logging).
        using var request = new HttpRequestMessage(HttpMethod.Post, OverpassUrl)
        {
            Content = new FormUrlEncodedContent([new KeyValuePair<string, string>("data", query)]),
        };
        using var resp = await _http.SendAsync(request, ct);
        if (!resp.IsSuccessStatusCode)
        {
            _log.LogWarning("Overpass answered {Status}", (int)resp.StatusCode);
            return null;
        }
        using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        var root = doc.RootElement;
        // Overpass adds a "remark" when it ran out of time or memory; what it did return may be partial.
        if (root.ValueKind != JsonValueKind.Object || root.TryGetProperty("remark", out _)
            || !root.TryGetProperty("elements", out var elements) || elements.ValueKind != JsonValueKind.Array)
        {
            _log.LogWarning("Overpass gave no usable answer");
            return null;
        }

        (JsonElement Tags, double Lat, double Lon, double Miles)? best = null;
        foreach (var element in elements.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty("tags", out var tags) || tags.ValueKind != JsonValueKind.Object) continue;
            if (Tag(tags, "name") is null) continue;
            var position = element.TryGetProperty("center", out var center) && center.ValueKind == JsonValueKind.Object ? center : element;
            if (!TryNumber(position, "lat", out var lat) || !TryNumber(position, "lon", out var lon) || !IsPlace(lat, lon)) continue;
            var miles = origin.MilesTo(lat, lon);
            if (best is null || miles < best.Value.Miles) best = (tags, lat, lon, miles);
        }
        if (best is not { } nearest) return new NearestEmergencyDto(true, null);

        var postcode = Tag(nearest.Tags, "addr:postcode")?.ToUpperInvariant()
            ?? await _geocode.ReversePostcodeAsync(nearest.Lat, nearest.Lon, ct);
        var hospital = new NearestHospitalDto(
            Tag(nearest.Tags, "name")!,
            Address(nearest.Tags),
            postcode,
            Phone(nearest.Tags),
            Math.Round(nearest.Lat, 5),
            Math.Round(nearest.Lon, 5),
            Math.Round(nearest.Miles, 1));
        return new NearestEmergencyDto(true, hospital);
    }

    private static bool TryNumber(JsonElement el, string name, out double value)
    {
        value = 0;
        return el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out value);
    }

    private static string? Tag(JsonElement tags, string name)
    {
        if (!tags.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return null;
        var text = v.GetString()?.Trim();
        if (string.IsNullOrEmpty(text)) return null;
        return text.Length > MaxText ? text[..MaxText] : text;
    }

    private static string? Address(JsonElement tags)
    {
        var full = Tag(tags, "addr:full");
        if (full is not null) return full;
        var street = string.Join(' ', new[] { Tag(tags, "addr:housenumber"), Tag(tags, "addr:street") }.Where(p => p is not null));
        var town = Tag(tags, "addr:city") ?? Tag(tags, "addr:town") ?? Tag(tags, "addr:village") ?? Tag(tags, "addr:suburb");
        var parts = new[] { street.Length > 0 ? street : null, town }.Where(p => p is not null);
        var joined = string.Join(", ", parts);
        return joined.Length > 0 ? joined : null;
    }

    /// <summary>The first number when several are listed (OpenStreetMap separates them with a semicolon).</summary>
    private static string? Phone(JsonElement tags)
    {
        var raw = Tag(tags, "phone") ?? Tag(tags, "contact:phone");
        var first = raw?.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return string.IsNullOrEmpty(first) ? null : first;
    }
}
