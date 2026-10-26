using System.Globalization;
using System.Text;

namespace MountedGames.Api.Services.Calendar;

/// <summary>One event in a calendar file. All times are UTC (a value of unspecified kind is taken as UTC).</summary>
public sealed record IcsEvent(
    string Uid,
    DateTime StartUtc,
    DateTime EndUtc,
    string Summary,
    DateTime StampUtc,
    string? Location = null,
    string? Description = null,
    string? Url = null,
    int? Sequence = null,
    DateTime? LastModifiedUtc = null,
    bool AllDay = false);

/// <summary>
/// A small writer for iCalendar (RFC 5545) files: CRLF line ends, text escaping, lines folded at 75 octets
/// without splitting a UTF-8 character, and UTC times with a trailing Z. It writes only what the app needs
/// (a VCALENDAR holding VEVENTs), so there is no dependency to keep patched.
/// </summary>
public sealed class IcsCalendar
{
    public const int MaxLineOctets = 75;

    private readonly List<IcsEvent> _events = [];

    public IcsCalendar(string productId) => ProductId = productId;

    public string ProductId { get; }
    /// <summary>Shown as the calendar's name when a person subscribes (X-WR-CALNAME).</summary>
    public string? Name { get; init; }
    /// <summary>How often a subscribed calendar should be fetched again (REFRESH-INTERVAL and X-PUBLISHED-TTL).</summary>
    public TimeSpan? RefreshInterval { get; init; }

    public IcsCalendar Add(IcsEvent calendarEvent)
    {
        _events.Add(calendarEvent);
        return this;
    }

    public string Build()
    {
        var lines = new List<string> { "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:" + EscapeText(ProductId), "CALSCALE:GREGORIAN", "METHOD:PUBLISH" };
        if (!string.IsNullOrWhiteSpace(Name)) lines.Add("X-WR-CALNAME:" + EscapeText(Name));
        if (RefreshInterval is { } refresh)
        {
            var duration = FormatDuration(refresh);
            lines.Add("REFRESH-INTERVAL;VALUE=DURATION:" + duration);
            lines.Add("X-PUBLISHED-TTL:" + duration);
        }
        foreach (var e in _events) AddEvent(lines, e);
        lines.Add("END:VCALENDAR");

        var builder = new StringBuilder();
        foreach (var line in lines) Fold(builder, line);
        return builder.ToString();
    }

    private static void AddEvent(List<string> lines, IcsEvent e)
    {
        lines.Add("BEGIN:VEVENT");
        lines.Add("UID:" + EscapeText(e.Uid));
        lines.Add("DTSTAMP:" + FormatUtc(e.StampUtc));
        if (e.AllDay)
        {
            lines.Add("DTSTART;VALUE=DATE:" + FormatDate(e.StartUtc));
            lines.Add("DTEND;VALUE=DATE:" + FormatDate(e.EndUtc));
        }
        else
        {
            lines.Add("DTSTART:" + FormatUtc(e.StartUtc));
            lines.Add("DTEND:" + FormatUtc(e.EndUtc));
        }
        if (e.Sequence is { } sequence) lines.Add("SEQUENCE:" + sequence.ToString(CultureInfo.InvariantCulture));
        if (e.LastModifiedUtc is { } modified) lines.Add("LAST-MODIFIED:" + FormatUtc(modified));
        lines.Add("SUMMARY:" + EscapeText(e.Summary));
        if (!string.IsNullOrWhiteSpace(e.Location)) lines.Add("LOCATION:" + EscapeText(e.Location));
        if (!string.IsNullOrWhiteSpace(e.Description)) lines.Add("DESCRIPTION:" + EscapeText(e.Description));
        if (!string.IsNullOrWhiteSpace(e.Url)) lines.Add("URL:" + EscapeUri(e.Url));
        lines.Add("STATUS:CONFIRMED");
        lines.Add("TRANSP:OPAQUE");
        lines.Add("END:VEVENT");
    }

    /// <summary>Basic ISO 8601 calendar date form, such as <c>20261017</c>.</summary>
    public static string FormatDate(DateTime value) =>
        value.ToString("yyyyMMdd", CultureInfo.InvariantCulture);

    /// <summary>Basic ISO 8601 UTC form, such as <c>20261017T093000Z</c>.</summary>
    public static string FormatUtc(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc);
        return utc.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Escapes a TEXT value: backslash, semicolon and comma get a backslash and line breaks become <c>\n</c>.
    /// Other control characters are dropped, so a value can never start a new property line.
    /// </summary>
    public static string EscapeText(string value)
    {
        var builder = new StringBuilder(value.Length + 8);
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            switch (c)
            {
                case '\\': builder.Append("\\\\"); break;
                case ';': builder.Append("\\;"); break;
                case ',': builder.Append("\\,"); break;
                case '\r':
                    builder.Append("\\n");
                    if (i + 1 < value.Length && value[i + 1] == '\n') i++;
                    break;
                case '\n': builder.Append("\\n"); break;
                default:
                    if (!char.IsControl(c)) builder.Append(c);
                    break;
            }
        }
        return builder.ToString();
    }

    // A URI value is not TEXT, so it is not backslash-escaped; it only must not hold control characters or spaces.
    private static string EscapeUri(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            if (char.IsControl(c) || char.IsWhiteSpace(c)) continue;
            builder.Append(c);
        }
        return builder.ToString();
    }

    private static string FormatDuration(TimeSpan span)
    {
        var minutes = Math.Max(1, (int)Math.Round(span.TotalMinutes));
        return minutes % 60 == 0 ? $"PT{minutes / 60}H" : $"PT{minutes}M";
    }

    /// <summary>Appends a line folded so that no physical line is over 75 octets, then a CRLF.</summary>
    public static void Fold(StringBuilder output, string line)
    {
        var octets = 0;
        for (var i = 0; i < line.Length; i++)
        {
            var length = char.IsHighSurrogate(line[i]) && i + 1 < line.Length ? 2 : 1;
            var size = Encoding.UTF8.GetByteCount(line.AsSpan(i, length));
            if (octets + size > MaxLineOctets)
            {
                // A continuation line starts with one space, and that space counts towards the 75.
                output.Append("\r\n ");
                octets = 1;
            }
            output.Append(line, i, length);
            octets += size;
            i += length - 1;
        }
        output.Append("\r\n");
    }
}
