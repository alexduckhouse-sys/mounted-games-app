using System.Globalization;

namespace MountedGames.Api.Services;

/// <summary>
/// UK civil time (Europe/London, so GMT in winter and BST in summer) for the places that must follow the clock people
/// live by: when the evening digest is due, and the dates in an email. The API runs in UTC. If the host has no time-zone
/// database the same rule is applied by hand (clocks go forward at 01:00 UTC on the last Sunday of March and back at
/// 01:00 UTC on the last Sunday of October).
/// </summary>
public static class UkTime
{
    private static readonly TimeZoneInfo? Zone = Find();

    private static TimeZoneInfo? Find()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Europe/London"); }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { return null; }
    }

    private static DateTime AsUtc(DateTime value) =>
        value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime ToUk(DateTime utc)
    {
        utc = AsUtc(utc);
        return Zone is null ? ToUkByRule(utc) : TimeZoneInfo.ConvertTimeFromUtc(utc, Zone);
    }

    /// <summary>The UTC instant of a UK wall-clock time (not for the hour that is skipped or repeated at a clock change).</summary>
    public static DateTime FromUk(DateTime ukLocal)
    {
        var local = DateTime.SpecifyKind(ukLocal, DateTimeKind.Unspecified);
        return Zone is null ? FromUkByRule(local) : DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeToUtc(local, Zone), DateTimeKind.Utc);
    }

    /// <summary>The UK calendar date of an instant, as <c>yyyy-MM-dd</c>.</summary>
    public static string DateKey(DateTime utc) => ToUk(utc).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    internal static DateTime ToUkByRule(DateTime utc) => IsBst(utc) ? utc.AddHours(1) : utc;

    internal static DateTime FromUkByRule(DateTime ukLocal)
    {
        // The offset in force an hour before is right for any time that isn't inside the change itself.
        var utc = DateTime.SpecifyKind(ukLocal, DateTimeKind.Utc);
        return IsBst(utc.AddHours(-1)) ? utc.AddHours(-1) : utc;
    }

    internal static bool IsBst(DateTime utc)
    {
        var start = LastSunday(utc.Year, 3).AddHours(1);
        var end = LastSunday(utc.Year, 10).AddHours(1);
        return utc >= start && utc < end;
    }

    private static DateTime LastSunday(int year, int month)
    {
        var last = new DateTime(year, month, DateTime.DaysInMonth(year, month), 0, 0, 0, DateTimeKind.Utc);
        return last.AddDays(-(int)last.DayOfWeek);
    }

    /// <summary>"6pm" or "6:30pm", for a UK wall-clock time.</summary>
    public static string ClockText(DateTime ukLocal)
    {
        var hour = ukLocal.Hour % 12 == 0 ? 12 : ukLocal.Hour % 12;
        var suffix = ukLocal.Hour < 12 ? "am" : "pm";
        return ukLocal.Minute == 0 ? $"{hour}{suffix}" : $"{hour}:{ukLocal.Minute:00}{suffix}";
    }
}
