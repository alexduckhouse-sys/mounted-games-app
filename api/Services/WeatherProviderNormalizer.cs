using System.Globalization;
using System.Text.Json;

namespace MountedGames.Api.Services;

public sealed record NormalizedWeatherHour(
    DateTime TimeUtc,
    double Temperature2m,
    int WeatherCode,
    double WindSpeed10m,
    int RelativeHumidity2m,
    double PrecipitationProbability,
    double Precipitation,
    int IsDay);

public sealed record VenueWeatherSeries(
    string Provider,
    double Latitude,
    double Longitude,
    IReadOnlyList<NormalizedWeatherHour> Hours)
{
    public bool CoversInstant(DateTime whenUtc)
    {
        if (Hours.Count == 0) return false;
        var target = new DateTime(whenUtc.Year, whenUtc.Month, whenUtc.Day, whenUtc.Hour, 0, 0, DateTimeKind.Utc);
        var min = Hours[0].TimeUtc.AddHours(-1);
        var max = Hours[^1].TimeUtc.AddHours(1);
        return target >= min && target <= max;
    }

    public bool CoversDate(DateTime dateUtc)
    {
        if (Hours.Count == 0) return false;
        var dayStart = DateTime.SpecifyKind(dateUtc.Date, DateTimeKind.Utc);
        var dayEnd = dayStart.AddDays(1);
        return Hours.Any(h => h.TimeUtc >= dayStart && h.TimeUtc < dayEnd)
            && Hours[^1].TimeUtc >= dayStart.AddHours(12);
    }
}

/// <summary>
/// Normalises UK Met Office Weather DataHub (1.5 km UKV GeoJSON) and MET Norway Locationforecast 2.0 (9 km ECMWF GeoJSON)
/// responses into the Open-Meteo-compatible JSON shapes expected by the web client.
/// </summary>
public static class WeatherProviderNormalizer
{
    public const string MetOfficeProvider = "met-office";
    public const string MetNorwayProvider = "met-norway";

    /// <summary>Bounding box covering the UK and Ireland covered by the UK Met Office UKV 1.5 km grid.</summary>
    public static bool IsUkVenue(double lat, double lon) =>
        lat >= 49.0 && lat <= 61.0 && lon >= -10.5 && lon <= 2.5;

    /// <summary>True when the requested UTC time or date falls within the 48-hour UK Met Office hourly horizon.</summary>
    public static bool IsWithinMetOfficeHorizon(DateTime targetUtc, DateTimeOffset now)
    {
        var utc = targetUtc.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(targetUtc, DateTimeKind.Utc)
            : targetUtc.ToUniversalTime();
        var hoursAhead = (utc - now.UtcDateTime).TotalHours;
        return hoursAhead >= -24.0 && hoursAhead <= 48.0;
    }

    /// <summary>Converts metres per second (m/s) to kilometres per hour (km/h) rounded to 1 decimal place, clamping negative sentinels to 0.</summary>
    public static double MetersPerSecondToKmh(double metersPerSecond) =>
        Math.Round(Math.Max(0.0, metersPerSecond) * 3.6, 1, MidpointRounding.AwayFromZero);

    /// <summary>Maps UK Met Office significantWeatherCode (0..30) to WMO weather_code and is_day (0 or 1).</summary>
    public static (int WeatherCode, int IsDay) MapMetOfficeWeatherCode(int significantCode, DateTime timeUtc)
    {
        var defaultIsDay = InferIsDay(timeUtc);
        return significantCode switch
        {
            0 => (0, 0),   // Clear night
            1 => (0, 1),   // Sunny day
            2 => (2, 0),   // Partly cloudy (night)
            3 => (2, 1),   // Sunny intervals (day)
            5 or 6 => (45, defaultIsDay), // Mist / Fog
            7 or 8 => (3, defaultIsDay),  // Cloudy / Overcast
            9 => (51, 0),  // Light rain shower (night)
            10 => (51, 1), // Light rain shower (day)
            11 => (51, defaultIsDay), // Drizzle
            12 => (61, defaultIsDay), // Light rain
            13 => (80, 0), // Heavy rain shower (night)
            14 => (80, 1), // Heavy rain shower (day)
            15 => (65, defaultIsDay), // Heavy rain
            16 => (67, 0), // Sleet shower (night)
            17 => (67, 1), // Sleet shower (day)
            18 => (67, defaultIsDay), // Sleet
            19 => (67, 0), // Hail shower (night)
            20 => (67, 1), // Hail shower (day)
            21 => (67, defaultIsDay), // Hail
            22 => (71, 0), // Light snow shower (night)
            23 => (71, 1), // Light snow shower (day)
            24 => (71, defaultIsDay), // Light snow
            25 => (85, 0), // Heavy snow shower (night)
            26 => (85, 1), // Heavy snow shower (day)
            27 => (85, defaultIsDay), // Heavy snow
            28 => (95, 0), // Thunder shower (night)
            29 => (95, 1), // Thunder shower (day)
            30 => (95, defaultIsDay), // Thunder
            _ => (3, defaultIsDay)
        };
    }

    /// <summary>Maps MET Norway Locationforecast 2.0 symbol_code to WMO weather_code and is_day (0 or 1).</summary>
    public static (int WeatherCode, int IsDay) MapMetNorwaySymbolCode(string? symbolCode, DateTime timeUtc)
    {
        if (string.IsNullOrWhiteSpace(symbolCode))
            return (3, InferIsDay(timeUtc));

        var raw = symbolCode.Trim().ToLowerInvariant();
        int isDay;
        string baseCode;

        if (raw.EndsWith("_night", StringComparison.Ordinal))
        {
            isDay = 0;
            baseCode = raw[..^"_night".Length];
        }
        else if (raw.EndsWith("_day", StringComparison.Ordinal))
        {
            isDay = 1;
            baseCode = raw[..^"_day".Length];
        }
        else if (raw.EndsWith("_polartwilight", StringComparison.Ordinal))
        {
            isDay = 1;
            baseCode = raw[..^"_polartwilight".Length];
        }
        else
        {
            isDay = InferIsDay(timeUtc);
            baseCode = raw;
        }

        int wmo = baseCode switch
        {
            "clearsky" => 0,
            "fair" => 1,
            "partlycloudy" => 2,
            "cloudy" => 3,
            "fog" => 45,
            _ when baseCode.Contains("thunder", StringComparison.Ordinal) => 95,
            _ when baseCode.Contains("snowshowers", StringComparison.Ordinal) || baseCode.Contains("heavysnow", StringComparison.Ordinal) => 85,
            _ when baseCode.Contains("snow", StringComparison.Ordinal) || baseCode.Contains("sleet", StringComparison.Ordinal) => 71,
            _ when baseCode.Contains("rainshowers", StringComparison.Ordinal) => 80,
            "lightrain" or "drizzle" or _ when baseCode.Contains("lightrain", StringComparison.Ordinal) => 51,
            "heavyrain" or _ when baseCode.Contains("heavyrain", StringComparison.Ordinal) => 65,
            "rain" or _ when baseCode.Contains("rain", StringComparison.Ordinal) => 61,
            _ => 3
        };

        return (wmo, isDay);
    }

    public static bool TryParseSeries(
        JsonElement root,
        double lat,
        double lon,
        string defaultProvider,
        out VenueWeatherSeries? series)
    {
        series = null;
        if (root.ValueKind != JsonValueKind.Object)
            return false;

        // 1. UK Met Office GeoJSON: FeatureCollection -> features[0].properties.timeSeries
        if (TryGetMetOfficeTimeSeries(root, out var metOfficeArray))
        {
            var hours = ParseMetOfficeHours(metOfficeArray);
            if (hours.Count == 0) return false;
            series = new VenueWeatherSeries(MetOfficeProvider, lat, lon, hours);
            return true;
        }

        // 2. MET Norway GeoJSON: Feature -> properties.timeseries
        if (TryGetMetNorwayTimeSeries(root, out var metNorwayArray))
        {
            var hours = ParseMetNorwayHours(metNorwayArray);
            if (hours.Count == 0) return false;
            series = new VenueWeatherSeries(MetNorwayProvider, lat, lon, hours);
            return true;
        }

        return false;
    }

    public static object BuildCurrentResponse(VenueWeatherSeries series, DateTimeOffset now)
    {
        var nowUtc = now.UtcDateTime;
        var chosen = series.Hours
            .FirstOrDefault(h => h.TimeUtc <= nowUtc && nowUtc < h.TimeUtc.AddHours(1))
            ?? series.Hours.MinBy(h => Math.Abs((h.TimeUtc - nowUtc).Ticks))!;

        return new
        {
            provider = series.Provider,
            current = new
            {
                temperature_2m = chosen.Temperature2m,
                weather_code = chosen.WeatherCode,
                wind_speed_10m = chosen.WindSpeed10m,
                relative_humidity_2m = chosen.RelativeHumidity2m,
                is_day = chosen.IsDay
            }
        };
    }

    public static object BuildAtResponse(VenueWeatherSeries series, DateTime when)
    {
        var whenUtc = when.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(when, DateTimeKind.Utc)
            : when.ToUniversalTime();
        var targetHour = new DateTime(whenUtc.Year, whenUtc.Month, whenUtc.Day, whenUtc.Hour, 0, 0, DateTimeKind.Utc);

        var chosen = series.Hours.FirstOrDefault(h => h.TimeUtc == targetHour)
            ?? series.Hours.FirstOrDefault(h => h.TimeUtc.Date == targetHour.Date && h.TimeUtc.Hour == targetHour.Hour)
            ?? series.Hours[0];

        return new
        {
            hour = chosen.TimeUtc.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture),
            temperature_2m = chosen.Temperature2m,
            weather_code = chosen.WeatherCode,
            is_day = chosen.IsDay
        };
    }

    public static object BuildForecastResponse(VenueWeatherSeries series, DateTime date)
    {
        var dayStartUtc = DateTime.SpecifyKind(date.Date, DateTimeKind.Utc);
        var isUk = IsUkVenue(series.Latitude, series.Longitude);
        var utcOffsetSeconds = isUk
            && UkTime.IsBst(new DateTime(dayStartUtc.Year, dayStartUtc.Month, dayStartUtc.Day, 12, 0, 0, DateTimeKind.Utc))
                ? 3600
                : 0;

        // Emit hours within [date - 2h, date + 26h] with 'Z' suffixes so BST & GMT local day filtering works cleanly.
        var windowStart = dayStartUtc.AddHours(-2);
        var windowEnd = dayStartUtc.AddDays(1).AddHours(2);
        var windowHours = series.Hours
            .Where(h => h.TimeUtc >= windowStart && h.TimeUtc <= windowEnd)
            .OrderBy(h => h.TimeUtc)
            .ToList();

        if (windowHours.Count == 0)
            windowHours = series.Hours.OrderBy(h => h.TimeUtc).ToList();

        var localDayStartUtc = isUk
            ? UkTime.FromUk(DateTime.SpecifyKind(date.Date, DateTimeKind.Unspecified))
            : dayStartUtc;
        var localDayEndUtc = isUk
            ? UkTime.FromUk(DateTime.SpecifyKind(date.Date.AddDays(1), DateTimeKind.Unspecified))
            : dayStartUtc.AddDays(1);
        var dayHours = windowHours
            .Where(h => h.TimeUtc >= localDayStartUtc && h.TimeUtc < localDayEndUtc)
            .ToList();
        if (dayHours.Count == 0)
            dayHours = windowHours;

        var dateIso = dayStartUtc.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        return new
        {
            provider = series.Provider,
            utc_offset_seconds = utcOffsetSeconds,
            daily = new
            {
                time = new[] { dateIso },
                weather_code = new[] { dayHours.Max(h => h.WeatherCode) },
                temperature_2m_max = new[] { dayHours.Max(h => h.Temperature2m) },
                temperature_2m_min = new[] { dayHours.Min(h => h.Temperature2m) },
                precipitation_probability_max = new[] { dayHours.Max(h => h.PrecipitationProbability) },
                wind_speed_10m_max = new[] { dayHours.Max(h => h.WindSpeed10m) }
            },
            hourly = new
            {
                time = windowHours.Select(h => h.TimeUtc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture)).ToArray(),
                temperature_2m = windowHours.Select(h => h.Temperature2m).ToArray(),
                weather_code = windowHours.Select(h => h.WeatherCode).ToArray(),
                precipitation_probability = windowHours.Select(h => h.PrecipitationProbability).ToArray(),
                precipitation = windowHours.Select(h => h.Precipitation).ToArray(),
                wind_speed_10m = windowHours.Select(h => h.WindSpeed10m).ToArray(),
                is_day = windowHours.Select(h => h.IsDay).ToArray()
            }
        };
    }

    private static bool TryGetMetOfficeTimeSeries(JsonElement root, out JsonElement timeSeries)
    {
        if (root.TryGetProperty("features", out var features)
            && features.ValueKind == JsonValueKind.Array
            && features.GetArrayLength() > 0)
        {
            var first = features[0];
            if (first.ValueKind == JsonValueKind.Object
                && first.TryGetProperty("properties", out var props)
                && props.ValueKind == JsonValueKind.Object
                && props.TryGetProperty("timeSeries", out timeSeries)
                && timeSeries.ValueKind == JsonValueKind.Array)
            {
                return true;
            }
        }

        if (root.TryGetProperty("properties", out var directProps)
            && directProps.ValueKind == JsonValueKind.Object
            && directProps.TryGetProperty("timeSeries", out timeSeries)
            && timeSeries.ValueKind == JsonValueKind.Array)
        {
            return true;
        }

        timeSeries = default;
        return false;
    }

    private static bool TryGetMetNorwayTimeSeries(JsonElement root, out JsonElement timeSeries)
    {
        if (root.TryGetProperty("properties", out var props)
            && props.ValueKind == JsonValueKind.Object
            && props.TryGetProperty("timeseries", out timeSeries)
            && timeSeries.ValueKind == JsonValueKind.Array)
        {
            return true;
        }

        timeSeries = default;
        return false;
    }

    private static List<NormalizedWeatherHour> ParseMetOfficeHours(JsonElement timeSeries)
    {
        var list = new List<NormalizedWeatherHour>();
        foreach (var item in timeSeries.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            if (!TryParseUtcTime(item, "time", out var timeUtc)) continue;

            var temp = GetDoubleOrDefault(item, "screenTemperature",
                GetDoubleOrDefault(item, "maxScreenAirTemp", 15.0));
            var windMs = GetDoubleOrDefault(item, "windSpeed10m", 0.0);
            var humidity = (int)Math.Round(GetDoubleOrDefault(item, "screenRelativeHumidity", 70.0));
            var precipProb = GetDoubleOrDefault(item, "probOfPrecipitation", 0.0);
            var precipMm = GetDoubleOrDefault(item, "totalPrecipAmount",
                GetDoubleOrDefault(item, "precipitationRate", 0.0));
            var sigCode = GetIntOrDefault(item, "significantWeatherCode", 3);

            var (wmoCode, isDay) = MapMetOfficeWeatherCode(sigCode, timeUtc);

            list.Add(new NormalizedWeatherHour(
                TimeUtc: timeUtc,
                Temperature2m: Math.Round(temp, 1),
                WeatherCode: wmoCode,
                WindSpeed10m: MetersPerSecondToKmh(windMs),
                RelativeHumidity2m: Math.Clamp(humidity, 0, 100),
                PrecipitationProbability: Math.Clamp(Math.Round(precipProb, 0), 0, 100),
                Precipitation: Math.Max(0.0, Math.Round(precipMm, 2)),
                IsDay: isDay));
        }
        return list.OrderBy(h => h.TimeUtc).ToList();
    }

    private sealed record RawMetNorwayPoint(
        DateTime TimeUtc,
        double Temperature2m,
        double WindSpeedKmh,
        int RelativeHumidity,
        bool HasNext1Hour,
        string? SymbolCode,
        double PrecipAmount,
        double PrecipProbability,
        bool IsSixHourBlock);

    private static List<NormalizedWeatherHour> ParseMetNorwayHours(JsonElement timeSeries)
    {
        var rawPoints = new List<RawMetNorwayPoint>();
        foreach (var item in timeSeries.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            if (!TryParseUtcTime(item, "time", out var timeUtc)) continue;
            if (!item.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) continue;

            double temp = 15.0;
            double windMs = 0.0;
            int humidity = 70;

            if (data.TryGetProperty("instant", out var instant)
                && instant.ValueKind == JsonValueKind.Object
                && instant.TryGetProperty("details", out var instDetails)
                && instDetails.ValueKind == JsonValueKind.Object)
            {
                temp = GetDoubleOrDefault(instDetails, "air_temperature", 15.0);
                windMs = GetDoubleOrDefault(instDetails, "wind_speed", 0.0);
                humidity = (int)Math.Round(GetDoubleOrDefault(instDetails, "relative_humidity", 70.0));
            }

            string? symbolCode = null;
            double precipAmount = 0.0;
            double precipProb = 0.0;
            bool hasNext1Hour = false;
            bool isSixHourBlock = false;

            if (data.TryGetProperty("next_1_hours", out var next1) && next1.ValueKind == JsonValueKind.Object)
            {
                hasNext1Hour = true;
                ExtractPeriod(next1, out symbolCode, out precipAmount, out precipProb);
            }
            else if (data.TryGetProperty("next_6_hours", out var next6) && next6.ValueKind == JsonValueKind.Object)
            {
                isSixHourBlock = true;
                ExtractPeriod(next6, out symbolCode, out precipAmount, out precipProb);
            }
            else if (data.TryGetProperty("next_12_hours", out var next12) && next12.ValueKind == JsonValueKind.Object)
            {
                ExtractPeriod(next12, out symbolCode, out precipAmount, out precipProb);
            }

            rawPoints.Add(new RawMetNorwayPoint(
                TimeUtc: timeUtc,
                Temperature2m: Math.Round(temp, 1),
                WindSpeedKmh: MetersPerSecondToKmh(windMs),
                RelativeHumidity: Math.Clamp(humidity, 0, 100),
                HasNext1Hour: hasNext1Hour,
                SymbolCode: symbolCode,
                PrecipAmount: Math.Max(0.0, precipAmount),
                PrecipProbability: Math.Clamp(Math.Round(precipProb, 0), 0, 100),
                IsSixHourBlock: isSixHourBlock));
        }

        rawPoints.Sort((a, b) => a.TimeUtc.CompareTo(b.TimeUtc));

        var hours = new List<NormalizedWeatherHour>();
        for (var i = 0; i < rawPoints.Count; i++)
        {
            var pt = rawPoints[i];
            if (pt.IsSixHourBlock && !pt.HasNext1Hour)
            {
                var nextTime = i + 1 < rawPoints.Count ? rawPoints[i + 1].TimeUtc : pt.TimeUtc.AddHours(6);
                var spanHours = (int)Math.Clamp(Math.Round((nextTime - pt.TimeUtc).TotalHours), 1, 6);
                var hourlyPrecip = Math.Round(pt.PrecipAmount / spanHours, 2);

                for (var h = 0; h < spanHours; h++)
                {
                    var slotTime = pt.TimeUtc.AddHours(h);
                    var (wmoCode, isDay) = MapMetNorwaySymbolCode(pt.SymbolCode, slotTime);
                    hours.Add(new NormalizedWeatherHour(
                        TimeUtc: slotTime,
                        Temperature2m: pt.Temperature2m,
                        WeatherCode: wmoCode,
                        WindSpeed10m: pt.WindSpeedKmh,
                        RelativeHumidity2m: pt.RelativeHumidity,
                        PrecipitationProbability: pt.PrecipProbability,
                        Precipitation: hourlyPrecip,
                        IsDay: isDay));
                }
            }
            else
            {
                var (wmoCode, isDay) = MapMetNorwaySymbolCode(pt.SymbolCode, pt.TimeUtc);
                hours.Add(new NormalizedWeatherHour(
                    TimeUtc: pt.TimeUtc,
                    Temperature2m: pt.Temperature2m,
                    WeatherCode: wmoCode,
                    WindSpeed10m: pt.WindSpeedKmh,
                    RelativeHumidity2m: pt.RelativeHumidity,
                    PrecipitationProbability: pt.PrecipProbability,
                    Precipitation: Math.Round(pt.PrecipAmount, 2),
                    IsDay: isDay));
            }
        }

        return hours;
    }

    private static void ExtractPeriod(JsonElement period, out string? symbolCode, out double precipAmount, out double precipProb)
    {
        symbolCode = null;
        precipAmount = 0.0;
        precipProb = 0.0;

        if (period.TryGetProperty("summary", out var summary)
            && summary.ValueKind == JsonValueKind.Object
            && summary.TryGetProperty("symbol_code", out var symProp)
            && symProp.ValueKind == JsonValueKind.String)
        {
            symbolCode = symProp.GetString();
        }

        if (period.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Object)
        {
            precipAmount = GetDoubleOrDefault(details, "precipitation_amount", 0.0);
            precipProb = GetDoubleOrDefault(details, "probability_of_precipitation", 0.0);
        }
    }

    private static bool TryParseUtcTime(JsonElement obj, string propName, out DateTime timeUtc)
    {
        if (obj.TryGetProperty(propName, out var prop)
            && prop.ValueKind == JsonValueKind.String
            && prop.GetString() is { } raw
            && DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto))
        {
            timeUtc = DateTime.SpecifyKind(dto.UtcDateTime, DateTimeKind.Utc);
            return true;
        }
        timeUtc = default;
        return false;
    }

    private static double GetDoubleOrDefault(JsonElement obj, string propName, double fallback)
    {
        if (obj.TryGetProperty(propName, out var prop) && prop.ValueKind == JsonValueKind.Number && prop.TryGetDouble(out var v) && double.IsFinite(v))
            return v;
        return fallback;
    }

    private static int GetIntOrDefault(JsonElement obj, string propName, int fallback)
    {
        if (obj.TryGetProperty(propName, out var prop) && prop.ValueKind == JsonValueKind.Number)
        {
            if (prop.TryGetInt32(out var i)) return i;
            if (prop.TryGetDouble(out var d) && double.IsFinite(d)) return (int)Math.Round(d);
        }
        return fallback;
    }

    private static int InferIsDay(DateTime timeUtc)
    {
        var ukHour = UkTime.ToUk(timeUtc).Hour;
        return ukHour >= 6 && ukHour < 20 ? 1 : 0;
    }
}
