using System.Collections.Concurrent;
using System.Globalization;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Caching.Memory;

namespace MountedGames.Api.Services;

/// <summary>What one provider lookup produced. A null <see cref="Ttl"/> means "don't cache" (errors and fallbacks).</summary>
public sealed record WeatherOutcome(object Body, TimeSpan? Ttl);

public sealed record MetOfficeGraceEntry(
    VenueWeatherSeries Series,
    DateTimeOffset FetchedAtUtc,
    DateTimeOffset FreshUntilUtc,
    DateTimeOffset GraceUntilUtc);

public sealed record MetNorwayVenueEntry(
    VenueWeatherSeries Series,
    DateTimeOffset FetchedAtUtc,
    DateTimeOffset FreshUntilUtc);

/// <summary>
/// Server-side cache in front of the weather provider. Many phones at one venue ask for the
/// same place at the same time, often on weak signal, so each location is fetched at most once
/// per TTL and simultaneous misses share a single provider call.
/// </summary>
/// <remarks>
/// The cache lives in memory, so it is per API instance. If several instances run, each warms
/// its own copy; the worst case is one provider call per instance per period, which is fine.
/// lat/lon come from the query string, so the number of keys must be bounded: this class owns a
/// private <see cref="MemoryCache"/> with a size limit (each entry counts as 1) instead of putting a
/// limit on the app-wide <c>IMemoryCache</c>, where it would make unsized entries from other code throw.
/// </remarks>
public sealed class WeatherCache : IDisposable
{
    public const int MaxEntries = 5_000;
    public const int MaxVenueEntries = 500;
    public const int MaxDailyMetOfficeCalls = 350;
    public const int MaxNewMetOfficeVenuesPerMinute = 20;

    private readonly MemoryCache cache;
    private readonly string? _initialMetOfficeApiKey;
    private readonly bool _initialUseDualProviders;

    public string? MetOfficeApiKey { get; private set; }
    public bool UseDualProviders { get; private set; }
    public TimeProvider? TimeProviderOverride { get; private set; }

    public WeatherCache() : this(new MemoryCacheOptions { SizeLimit = MaxEntries }) { }

    public WeatherCache(string? metOfficeApiKey, bool useDualProviders)
        : this(new MemoryCacheOptions { SizeLimit = MaxEntries })
    {
        _initialMetOfficeApiKey = metOfficeApiKey;
        _initialUseDualProviders = useDualProviders;
        MetOfficeApiKey = metOfficeApiKey;
        UseDualProviders = useDualProviders;
    }

    /// <summary>For tests that need a different limit or clock. Entries are always sized 1.</summary>
    public WeatherCache(MemoryCacheOptions options)
    {
#pragma warning disable CS0618
        options.Clock ??= new DynamicClock(this);
#pragma warning restore CS0618
        cache = new MemoryCache(options);
    }

#pragma warning disable CS0618
    private sealed class DynamicClock(WeatherCache owner) : Microsoft.Extensions.Internal.ISystemClock
    {
        public DateTimeOffset UtcNow => (owner.TimeProviderOverride ?? TimeProvider.System).GetUtcNow();
    }
#pragma warning restore CS0618

    /// <summary>Overrides provider settings or time provider for dual-provider integration tests.</summary>
    public void ConfigureProviders(string? metOfficeApiKey = null, TimeProvider? timeProvider = null, bool useDualProviders = true)
    {
        MetOfficeApiKey = metOfficeApiKey;
        TimeProviderOverride = timeProvider;
        UseDualProviders = useDualProviders;
    }

    public DateTimeOffset GetUtcNow(TimeProvider fallback) => (TimeProviderOverride ?? fallback).GetUtcNow();

    /// <summary>Number of stored entries.</summary>
    public int Count => cache.Count;

    /// <summary>Drops every stored entry (used by tests to start cold).</summary>
    public void Clear()
    {
        cache.Clear();
        _inFlight.Clear();
        _venueInFlight.Clear();
        _metOfficeGrace.Clear();
        _metNorwayCache.Clear();
        _dailyMetOfficeCalls.Clear();
        _minuteMetOfficeVenues.Clear();
        MetOfficeApiKey = _initialMetOfficeApiKey;
        UseDualProviders = _initialUseDualProviders;
        TimeProviderOverride = null;
    }

    public void Dispose() => cache.Dispose();

    public static readonly TimeSpan CurrentTtl = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan NearForecastTtl = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan FarForecastTtl = TimeSpan.FromHours(3);
    public static readonly TimeSpan NearWindow = TimeSpan.FromHours(48);
    public static readonly TimeSpan DaytimeTtl = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan OvernightTtl = TimeSpan.FromHours(3);
    public static readonly TimeSpan GraceTtl = TimeSpan.FromMinutes(120);

    private readonly ConcurrentDictionary<string, Lazy<Task<WeatherOutcome>>> _inFlight = new();
    private readonly ConcurrentDictionary<string, Lazy<Task<VenueWeatherSeries?>>> _venueInFlight = new();
    private readonly ConcurrentDictionary<string, MetOfficeGraceEntry> _metOfficeGrace = new();
    private readonly ConcurrentDictionary<string, MetNorwayVenueEntry> _metNorwayCache = new();
    private readonly ConcurrentDictionary<string, StrongBox<int>> _dailyMetOfficeCalls = new();
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> _minuteMetOfficeVenues = new();

    /// <summary>Rounds to 2 decimal places (about 1 km) so nearby phones share an entry.</summary>
    public static double RoundCoordinate(double value) => Math.Round(value, 2) + 0.0; // + 0.0 turns -0 into 0

    public static string Format(double rounded) => rounded.ToString("0.00", CultureInfo.InvariantCulture);

    public static string CurrentKey(double lat, double lon) => $"weather:current:{Format(lat)}:{Format(lon)}";

    /// <summary>The hourly lookup only depends on the date and hour, so the key rounds the time down to the hour.</summary>
    public static string AtKey(double lat, double lon, DateTime when) =>
        $"weather:at:{Format(lat)}:{Format(lon)}:{when.ToString("yyyy-MM-ddTHH", CultureInfo.InvariantCulture)}";

    public static string ForecastKey(double lat, double lon, DateTime date) =>
        $"weather:forecast:v2:{Format(lat)}:{Format(lon)}:{date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}";

    public static string VenueKey(double lat, double lon) => $"weather:venue:{Format(lat)}:{Format(lon)}";

    /// <summary>
    /// Forecasts for the next two days move quickly, so they live for 30 minutes; further out (or
    /// further back) they change slowly and live for 3 hours. The requested time carries no zone, so
    /// it is compared as if UTC; a few hours of venue offset don't matter at this granularity.
    /// </summary>
    public static TimeSpan ForecastTtl(DateTime when, DateTimeOffset now) =>
        (DateTime.SpecifyKind(when, DateTimeKind.Utc) - now.UtcDateTime).Duration() <= NearWindow
            ? NearForecastTtl
            : FarForecastTtl;

    /// <summary>True during the 06:00–18:00 UK local daytime competition window (GMT in winter, BST in summer).</summary>
    public static bool IsUkDaytime(DateTimeOffset now)
    {
        var ukHour = UkTime.ToUk(now.UtcDateTime).Hour;
        return ukHour >= 6 && ukHour < 18;
    }

    /// <summary>30 minutes during 06:00–18:00 UK local time; 3 hours overnight (18:00–06:00 UK local time).</summary>
    public static TimeSpan UkCadenceTtl(DateTimeOffset now) =>
        IsUkDaytime(now) ? DaytimeTtl : OvernightTtl;

    private static string UtcDayKey(DateTimeOffset now) =>
        now.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string UtcMinuteKey(DateTimeOffset now) =>
        now.UtcDateTime.ToString("yyyy-MM-ddTHH:mm", CultureInfo.InvariantCulture);

    /// <summary>Consumes one daily UK Met Office DataHub quota slot if under the 350/day soft ceiling.</summary>
    public bool TryConsumeMetOfficeQuota(DateTimeOffset now)
    {
        var box = _dailyMetOfficeCalls.GetOrAdd(UtcDayKey(now), _ => new StrongBox<int>(0));
        var count = Interlocked.Increment(ref box.Value);
        if (count <= MaxDailyMetOfficeCalls)
            return true;
        Interlocked.Decrement(ref box.Value);
        return false;
    }

    /// <summary>
    /// Consumes one daily UK Met Office DataHub quota slot for <paramref name="lat"/>/<paramref name="lon"/>,
    /// guarding against coordinate-sweeping bursts (>20 distinct new UK grid cells per minute) as well as the 350/day cap.
    /// </summary>
    public bool TryConsumeMetOfficeQuota(double lat, double lon, DateTimeOffset now)
    {
        var venueKey = VenueKey(lat, lon);
        // A venue already in the grace cache is a known competition venue refreshing its TTL, not a new coordinate sweep.
        if (!_metOfficeGrace.ContainsKey(venueKey))
        {
            var minuteKey = UtcMinuteKey(now);
            if (_minuteMetOfficeVenues.Count > 5)
            {
                foreach (var oldKey in _minuteMetOfficeVenues.Keys)
                {
                    if (oldKey != minuteKey)
                        _minuteMetOfficeVenues.TryRemove(oldKey, out _);
                }
            }
            var venuesThisMinute = _minuteMetOfficeVenues.GetOrAdd(minuteKey, _ => new ConcurrentDictionary<string, byte>());
            if (!venuesThisMinute.ContainsKey(venueKey) && venuesThisMinute.Count >= MaxNewMetOfficeVenuesPerMinute)
                return false;
            venuesThisMinute.TryAdd(venueKey, 0);
        }

        return TryConsumeMetOfficeQuota(now);
    }

    public int GetMetOfficeCallCount(DateTimeOffset now) =>
        _dailyMetOfficeCalls.TryGetValue(UtcDayKey(now), out var box) ? Volatile.Read(ref box.Value) : 0;

    public void SetMetOfficeCallCount(DateTimeOffset now, int count)
    {
        var box = _dailyMetOfficeCalls.GetOrAdd(UtcDayKey(now), _ => new StrongBox<int>(0));
        Interlocked.Exchange(ref box.Value, count);
    }

    /// <summary>Stores a 1.5 km UK Met Office series in the bounded 120-minute grace cache.</summary>
    public void StoreMetOfficeGrace(double lat, double lon, VenueWeatherSeries series, DateTimeOffset now)
    {
        if (_metOfficeGrace.Count >= MaxVenueEntries)
        {
            foreach (var kvp in _metOfficeGrace)
            {
                if (kvp.Value.GraceUntilUtc < now)
                    _metOfficeGrace.TryRemove(kvp.Key, out _);
            }
            if (_metOfficeGrace.Count >= MaxVenueEntries && _metOfficeGrace.Keys.FirstOrDefault() is { } firstKey)
                _metOfficeGrace.TryRemove(firstKey, out _);
        }

        var freshTtl = UkCadenceTtl(now);
        _metOfficeGrace[VenueKey(lat, lon)] = new MetOfficeGraceEntry(
            series,
            FetchedAtUtc: now,
            FreshUntilUtc: now + freshTtl,
            GraceUntilUtc: now + GraceTtl);
    }

    /// <summary>
    /// Looks up a UK Met Office series in the 120-minute grace store.
    /// <paramref name="isFresh"/> is true when still inside the Stage-1 fresh TTL (30m daytime / 3h overnight).
    /// </summary>
    public bool TryGetMetOfficeGrace(double lat, double lon, DateTimeOffset now, out MetOfficeGraceEntry? entry, out bool isFresh)
    {
        if (_metOfficeGrace.TryGetValue(VenueKey(lat, lon), out var found))
        {
            if (now <= found.GraceUntilUtc)
            {
                entry = found;
                isFresh = now < found.FreshUntilUtc;
                return true;
            }
            _metOfficeGrace.TryRemove(VenueKey(lat, lon), out _);
        }
        entry = null;
        isFresh = false;
        return false;
    }

    /// <summary>Stores a 9 km MET Norway series per venue so /current, /at, and multi-day /forecast share one upstream fetch.</summary>
    public void StoreMetNorwaySeries(double lat, double lon, VenueWeatherSeries series, DateTimeOffset now)
    {
        if (_metNorwayCache.Count >= MaxVenueEntries)
        {
            foreach (var kvp in _metNorwayCache)
            {
                if (kvp.Value.FreshUntilUtc <= now)
                    _metNorwayCache.TryRemove(kvp.Key, out _);
            }
            if (_metNorwayCache.Count >= MaxVenueEntries && _metNorwayCache.Keys.FirstOrDefault() is { } firstKey)
                _metNorwayCache.TryRemove(firstKey, out _);
        }

        var freshTtl = UkCadenceTtl(now);
        _metNorwayCache[VenueKey(lat, lon)] = new MetNorwayVenueEntry(
            series,
            FetchedAtUtc: now,
            FreshUntilUtc: now + freshTtl);
    }

    /// <summary>Looks up a fresh per-venue MET Norway series.</summary>
    public bool TryGetMetNorwaySeries(double lat, double lon, DateTimeOffset now, out MetNorwayVenueEntry? entry)
    {
        if (_metNorwayCache.TryGetValue(VenueKey(lat, lon), out var found))
        {
            if (now < found.FreshUntilUtc)
            {
                entry = found;
                return true;
            }
            _metNorwayCache.TryRemove(VenueKey(lat, lon), out _);
        }
        entry = null;
        return false;
    }

    /// <summary>
    /// Coalesces simultaneous upstream provider fetches for the same venue and stage (e.g., concurrent
    /// /current and /forecast calls on a cold venue), ensuring only one upstream HTTP request and one quota increment.
    /// </summary>
    public async Task<VenueWeatherSeries?> GetOrFetchVenueSeriesAsync(
        string venueStageKey,
        Func<Task<VenueWeatherSeries?>> fetch)
    {
        var lazy = _venueInFlight.GetOrAdd(
            venueStageKey,
            _ => new Lazy<Task<VenueWeatherSeries?>>(() => RunVenueFetchAsync(venueStageKey, fetch)));
        return await lazy.Value;
    }

    private async Task<VenueWeatherSeries?> RunVenueFetchAsync(
        string venueStageKey,
        Func<Task<VenueWeatherSeries?>> fetch)
    {
        try
        {
            return await fetch();
        }
        finally
        {
            _venueInFlight.TryRemove(venueStageKey, out _);
        }
    }

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
