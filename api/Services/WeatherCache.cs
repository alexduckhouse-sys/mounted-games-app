using System.Collections.Concurrent;
using System.Globalization;
using Microsoft.Extensions.Caching.Memory;

namespace MountedGames.Api.Services;

/// <summary>What one provider lookup produced. A null <see cref="Ttl"/> means "don't cache" (errors and fallbacks).</summary>
public sealed record WeatherOutcome(object Body, TimeSpan? Ttl);

/// <summary>
/// Server-side cache in front of the weather provider. Many phones at one venue ask for the
/// same place at the same time, often on weak signal, so each location is fetched at most once
/// per TTL and simultaneous misses share a single provider call.
/// </summary>
/// <remarks>
/// The cache lives in memory, so it is per API instance. If several instances run, each warms
/// its own copy; the worst case is one provider call per instance per period, which is fine.
/// Entries are sized (1 each) because <c>AddMemoryCache</c> in Program.cs sets a SizeLimit:
/// lat/lon come from the query string, so the number of keys must be bounded.
/// </remarks>
public sealed class WeatherCache(IMemoryCache cache)
{
    public static readonly TimeSpan CurrentTtl = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan NearForecastTtl = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan FarForecastTtl = TimeSpan.FromHours(3);
    public static readonly TimeSpan NearWindow = TimeSpan.FromHours(48);

    private readonly ConcurrentDictionary<string, Lazy<Task<WeatherOutcome>>> _inFlight = new();

    /// <summary>Rounds to 2 decimal places (about 1 km) so nearby phones share an entry.</summary>
    public static double RoundCoordinate(double value) => Math.Round(value, 2) + 0.0; // + 0.0 turns -0 into 0

    public static string Format(double rounded) => rounded.ToString("0.00", CultureInfo.InvariantCulture);

    public static string CurrentKey(double lat, double lon) => $"weather:current:{Format(lat)}:{Format(lon)}";

    /// <summary>The hourly lookup only depends on the date and hour, so the key rounds the time down to the hour.</summary>
    public static string AtKey(double lat, double lon, DateTime when) =>
        $"weather:at:{Format(lat)}:{Format(lon)}:{when.ToString("yyyy-MM-ddTHH", CultureInfo.InvariantCulture)}";

    public static string ForecastKey(double lat, double lon, DateTime date) =>
        $"weather:forecast:{Format(lat)}:{Format(lon)}:{date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}";

    /// <summary>
    /// Forecasts for the next two days move quickly, so they live for 30 minutes; further out (or
    /// further back) they change slowly and live for 3 hours. The requested time carries no zone, so
    /// it is compared as if UTC; a few hours of venue offset don't matter at this granularity.
    /// </summary>
    public static TimeSpan ForecastTtl(DateTime when, DateTimeOffset now) =>
        (DateTime.SpecifyKind(when, DateTimeKind.Utc) - now.UtcDateTime).Duration() <= NearWindow
            ? NearForecastTtl
            : FarForecastTtl;

    /// <summary>
    /// Returns the cached body, or runs <paramref name="fetch"/> once for all callers that miss at the
    /// same time. <c>Cacheable</c> is true when the body is a successful lookup, which is when the
    /// response may also be reused by browsers and the CDN.
    /// </summary>
    public async Task<(object Body, bool Cacheable)> GetOrFetchAsync(string key, Func<Task<WeatherOutcome>> fetch)
    {
        if (cache.TryGetValue(key, out object? hit) && hit is not null)
            return (hit, true);

        var lazy = _inFlight.GetOrAdd(key, k => new Lazy<Task<WeatherOutcome>>(() => FetchAndStoreAsync(k, fetch)));
        var outcome = await lazy.Value;
        return (outcome.Body, outcome.Ttl is not null);
    }

    private async Task<WeatherOutcome> FetchAndStoreAsync(string key, Func<Task<WeatherOutcome>> fetch)
    {
        try
        {
            // Another caller may have filled the entry between our miss and winning the in-flight slot.
            if (cache.TryGetValue(key, out object? hit) && hit is not null)
                return new WeatherOutcome(hit, CurrentTtl);

            var outcome = await fetch();
            if (outcome.Ttl is { } ttl)
                cache.Set(key, outcome.Body, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = ttl, Size = 1 });
            return outcome;
        }
        finally
        {
            // After the entry is stored, so a late arrival sees the cache rather than starting a second fetch.
            _inFlight.TryRemove(key, out _);
        }
    }
}
