using System.Globalization;

namespace MountedGames.Api.Services.Geo;

/// <summary>
/// A rough place: where a connection seems to be, or the middle of the venues someone has been to. Rough on purpose.
/// Values from outside are rounded to one decimal place (about 11 km) here, whatever precision they arrived with.
/// Never stored, never logged.
/// </summary>
public readonly record struct GeoPoint(double Latitude, double Longitude)
{
    private const double EarthRadiusMiles = 3958.8;

    /// <summary>Reads two decimal strings. Refuses anything that isn't a real place (not a number, not finite, off the globe).</summary>
    public static bool TryParse(string? latitude, string? longitude, out GeoPoint point)
    {
        point = default;
        if (!double.TryParse(latitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var lat)
            || !double.TryParse(longitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var lon)) return false;
        if (!double.IsFinite(lat) || !double.IsFinite(lon) || lat is < -90 or > 90 || lon is < -180 or > 180) return false;
        point = new GeoPoint(Math.Round(lat, 1), Math.Round(lon, 1));
        return true;
    }

    /// <summary>Great-circle distance in miles (haversine).</summary>
    public double MilesTo(double latitude, double longitude)
    {
        static double Rad(double degrees) => degrees * Math.PI / 180;
        var dLat = Rad(latitude - Latitude);
        var dLon = Rad(longitude - Longitude);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
            + Math.Cos(Rad(Latitude)) * Math.Cos(Rad(latitude)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * EarthRadiusMiles * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }
}

/// <summary>The rough position of the current visitor's connection, if the website's proxy vouched for one for this request.</summary>
public static class VisitorGeo
{
    public const string ItemKey = "mg.visitor-geo";

    public static GeoPoint? Get(HttpContext context)
        => context.Items.TryGetValue(ItemKey, out var value) && value is GeoPoint point ? point : null;
}
