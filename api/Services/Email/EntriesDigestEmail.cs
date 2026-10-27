using System.Text;

namespace MountedGames.Api.Services.Email;

/// <summary>
/// The "entries are open" email: a plain list of the competitions that have just opened, in the order given (nearest first
/// when we know roughly where the person is; the email itself never says so). Text first, with a simple HTML copy. Every
/// value from an organiser goes through <see cref="EmailHtml.Encode"/> and is stripped of line breaks in the subject.
/// </summary>
public static class EntriesDigestEmail
{
    public static EmailMessage Build(
        string to, IReadOnlyList<OpenCompetition> competitions, string site, string unsubscribeUrl, string oneClickUrl, string idempotencyKey)
    {
        var many = competitions.Count > 1;
        var subject = many
            ? $"{competitions.Count} new competitions are open for entries"
            : $"Entries are open for {OneLine(competitions[0].Name)}";

        var text = new StringBuilder();
        text.AppendLine("Hello,").AppendLine();
        text.AppendLine(many ? $"{competitions.Count} new competitions have opened for entries." : "A new competition has opened for entries.");

        var html = new StringBuilder();
        html.Append("<p style=\"margin:0 0 12px;\">Hello,</p>");
        html.Append($"<p style=\"margin:0 0 16px;\">{EmailHtml.Encode(many ? $"{competitions.Count} new competitions have opened for entries." : "A new competition has opened for entries.")}</p>");

        foreach (var c in competitions)
        {
            var dates = SignupConfirmationEmail.FormatDates(c.StartDate, c.EndDate);
            var venue = c.Location?.Trim();
            var closes = c.EntriesCloseAt is { } close ? CloseText(close) : null;
            var url = $"{site}/competitions/{c.Id}";

            text.AppendLine().AppendLine(OneLine(c.Name)).AppendLine(dates);
            if (!string.IsNullOrEmpty(venue)) text.AppendLine($"Where: {OneLine(venue)}");
            if (closes is not null) text.AppendLine($"Entries close: {closes}");
            text.AppendLine(url);

            html.Append("<div style=\"margin:0 0 18px;padding:0 0 4px;\">");
            html.Append($"<p style=\"margin:0 0 4px;font-weight:700;font-size:16px;\">{EmailHtml.Encode(OneLine(c.Name))}</p>");
            html.Append("<table role=\"presentation\" style=\"border-collapse:collapse;margin:0 0 4px;\">");
            html.Append(EmailHtml.Row("When", dates));
            if (!string.IsNullOrEmpty(venue)) html.Append(EmailHtml.Row("Where", OneLine(venue)));
            if (closes is not null) html.Append(EmailHtml.Row("Entries close", closes));
            html.Append("</table>");
            html.Append($"<p style=\"margin:0;\"><a href=\"{EmailHtml.Encode(url)}\" style=\"color:#17385F;font-weight:600;\">See the event</a></p>");
            html.Append("</div>");
        }

        text.AppendLine().AppendLine("You're getting this because you asked us to email you when new competitions open. You can stop these emails here:");
        text.AppendLine(unsubscribeUrl).AppendLine().AppendLine("Mounted Games");
        html.Append($"<p style=\"margin:16px 0 0;color:#475569;font-size:13px;\">You're getting this because you asked us to email you when new competitions open. <a href=\"{EmailHtml.Encode(unsubscribeUrl)}\" style=\"color:#17385F;\">Stop these emails</a>.</p>");

        // RFC 8058 one-click: a mail app POSTs to the first address without opening a page.
        var headers = new Dictionary<string, string>
        {
            ["List-Unsubscribe"] = $"<{oneClickUrl}>, <{unsubscribeUrl}>",
            ["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click",
        };
        return new EmailMessage(to, subject, text.ToString(), EmailHtml.Wrap(html.ToString()), idempotencyKey, headers);
    }

    /// <summary>"Friday 6 March 2026, 6pm" in UK time.</summary>
    public static string CloseText(DateTime closeUtc)
    {
        var uk = UkTime.ToUk(closeUtc);
        return $"{uk.ToString("dddd d MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture)}, {UkTime.ClockText(uk)}";
    }

    private static string OneLine(string value)
    {
        var cleaned = new string(value.Select(ch => char.IsControl(ch) ? ' ' : ch).ToArray()).Trim();
        return cleaned.Length > 200 ? cleaned[..200] : cleaned;
    }
}
