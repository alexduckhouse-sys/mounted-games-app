using System.Text;
using System.Text.RegularExpressions;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Email;

/// <summary>A custom email that can't be made or sent. <c>Problems</c> lists what to fix, for a 400.</summary>
public sealed class CustomEmailException(string message, int statusCode, IReadOnlyList<string>? problems = null) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public IReadOnlyList<string> Problems { get; } = problems ?? [];
}

/// <summary>A block after checking, with a competition's details read once, so what is sent is what was previewed.</summary>
public sealed record ResolvedBlock(
    EmailBlockType Type, string? Text = null, Guid? ImageId = null, string? Alt = null, string? Label = null, string? Url = null,
    int? CompetitionId = null, string? CompetitionName = null, string? CompetitionDates = null, string? CompetitionVenue = null,
    IReadOnlyList<ResolvedLink>? Links = null);

/// <summary>Words in a text block and the https address they open.</summary>
public sealed record ResolvedLink(string Words, string Url);

/// <summary>
/// Turns blocks into the email's HTML and plain text. Every typed value is HTML-encoded; no markup is ever read from text,
/// and links are https only (checked before this runs). The unsubscribe link is a placeholder, filled in for each person.
/// </summary>
public static class CustomEmailRenderer
{
    /// <summary>Control characters are refused in anything typed, so no one can write this and have it replaced.</summary>
    public const string UnsubscribePlaceholder = "\u0001UNSUB\u0001";

    public sealed record Rendered(string Html, string Text);

    public static Rendered Render(IReadOnlyList<ResolvedBlock> blocks, string site, CustomEmailAudience audience)
    {
        var html = new StringBuilder();
        var text = new StringBuilder();
        foreach (var block in blocks)
        {
            switch (block.Type)
            {
                case EmailBlockType.Text:
                    foreach (var paragraph in LinkedParagraphs(block.Text!, block.Links))
                    {
                        html.Append("<p style=\"margin:0 0 14px;\">");
                        var plain = new StringBuilder();
                        foreach (var part in paragraph)
                        {
                            var encoded = EmailHtml.Encode(part.Text).Replace("\r\n", "<br>").Replace("\n", "<br>");
                            if (part.Url is null) html.Append(encoded);
                            else html.Append($"<a href=\"{EmailHtml.Encode(part.Url)}\" style=\"color:#1f5fbf;text-decoration:underline;\">{encoded}</a>");
                            plain.Append(part.Text);
                            if (part.Url is not null) plain.Append(" (").Append(part.Url).Append(')');
                        }
                        html.Append("</p>");
                        text.AppendLine(plain.ToString()).AppendLine();
                    }
                    break;
                case EmailBlockType.Picture:
                    var image = $"<img src=\"{EmailHtml.Encode($"{site}/api/email-images/{block.ImageId:D}")}\" alt=\"{EmailHtml.Encode(block.Alt)}\" "
                        + "style=\"display:block;max-width:100%;height:auto;margin:0 0 14px;border:0;\">";
                    html.Append(block.Url is null ? image : $"<a href=\"{EmailHtml.Encode(block.Url)}\">{image}</a>");
                    text.AppendLine(string.IsNullOrWhiteSpace(block.Alt) ? "[Picture]" : $"[Picture: {block.Alt}]");
                    if (block.Url is not null) text.AppendLine(block.Url);
                    text.AppendLine();
                    break;
                case EmailBlockType.Button:
                    html.Append(EmailHtml.Button(block.Url!, block.Label!));
                    text.AppendLine($"{block.Label}: {block.Url}").AppendLine();
                    break;
                case EmailBlockType.Competition:
                    var enter = $"{site}/competitions/{block.CompetitionId}/enter";
                    html.Append("<table role=\"presentation\" style=\"width:100%;border:1px solid #d8dee9;border-radius:10px;margin:0 0 14px;\"><tr><td style=\"padding:14px 16px;\">")
                        .Append($"<div style=\"font-weight:700;font-size:16px;\">{EmailHtml.Encode(block.CompetitionName)}</div>")
                        .Append($"<div style=\"color:#475569;margin-top:4px;\">{EmailHtml.Encode(block.CompetitionDates)}</div>");
                    if (!string.IsNullOrWhiteSpace(block.CompetitionVenue))
                        html.Append($"<div style=\"color:#475569;\">{EmailHtml.Encode(block.CompetitionVenue)}</div>");
                    html.Append(EmailHtml.Button(enter, "Enter")).Append("</td></tr></table>");
                    text.AppendLine(block.CompetitionName).AppendLine(block.CompetitionDates);
                    if (!string.IsNullOrWhiteSpace(block.CompetitionVenue)) text.AppendLine(block.CompetitionVenue);
                    text.AppendLine($"Enter: {enter}").AppendLine();
                    break;
            }
        }

        var footer = blocks.LastOrDefault(b => b.Type == EmailBlockType.Footer);
        if (footer?.ImageId is { } footerImage)
            html.Append($"<img src=\"{EmailHtml.Encode($"{site}/api/email-images/{footerImage:D}")}\" alt=\"{EmailHtml.Encode(footer.Alt)}\" ")
                .Append("style=\"display:block;max-width:100%;height:auto;margin:20px 0 0;border:0;\">");
        if (footer?.Text is { Length: > 0 } footerText)
        {
            html.Append("<p style=\"margin:20px 0 0;color:#475569;font-size:13px;\">").Append(EmailHtml.Encode(footerText).Replace("\r\n", "<br>").Replace("\n", "<br>"));
            text.AppendLine(footerText);
            if (audience == CustomEmailAudience.News)
            {
                html.Append($" <a href=\"{UnsubscribePlaceholder}\" style=\"color:#475569;\">Unsubscribe</a>");
                text.AppendLine("Unsubscribe:").AppendLine(UnsubscribePlaceholder);
            }
            html.Append("</p>");
        }
        else if (audience == CustomEmailAudience.News)
        {
            html.Append("<p style=\"margin:20px 0 0;color:#475569;font-size:13px;\">You're getting this because you asked to hear about new competitions. ")
                .Append($"<a href=\"{UnsubscribePlaceholder}\" style=\"color:#475569;\">Unsubscribe</a> at any time.</p>");
            text.AppendLine("You're getting this because you asked to hear about new competitions. Unsubscribe at any time:")
                .AppendLine(UnsubscribePlaceholder);
        }
        else
        {
            html.Append("<p style=\"margin:20px 0 0;color:#475569;font-size:13px;\">You're getting this because you run or help run competitions on Mounted Games.</p>");
            text.AppendLine("You're getting this because you run or help run competitions on Mounted Games.");
        }
        return new Rendered(Plain(html.ToString()), text.ToString().TrimEnd());
    }

    /// <summary>Fills in one person's unsubscribe link.</summary>
    public static string ForRecipient(string body, string? unsubscribeUrl)
        => body.Replace(UnsubscribePlaceholder, unsubscribeUrl ?? string.Empty, StringComparison.Ordinal);

    /// <summary>An ordinary email: no banner or card of ours, just the writing and pictures.</summary>
    private static string Plain(string inner) =>
        $"""
        <!doctype html>
        <html lang="en">
        <body style="margin:0;padding:16px;background:#ffffff;color:#0f172a;font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;">
        <div style="max-width:560px;margin:0 auto;">
        {inner}
        </div>
        </body>
        </html>
        """;

    public sealed record Part(string Text, string? Url);

    /// <summary>
    /// Each paragraph as pieces of plain text, some of them links. A link goes on the first place its words appear (ignoring
    /// case) that isn't already part of another link. Returns false for a link whose words can't be found.
    /// </summary>
    public static List<List<Part>> LinkedParagraphs(string text, IReadOnlyList<ResolvedLink>? links, bool strict = false)
    {
        var paragraphs = Paragraphs(text).ToList();
        var marks = paragraphs.Select(_ => new List<(int At, int Len, string Url)>()).ToList();
        foreach (var link in links ?? [])
        {
            var placed = false;
            for (var p = 0; p < paragraphs.Count && !placed; p++)
            {
                var from = 0;
                while (from <= paragraphs[p].Length - link.Words.Length)
                {
                    var at = paragraphs[p].IndexOf(link.Words, from, StringComparison.OrdinalIgnoreCase);
                    if (at < 0) break;
                    if (marks[p].Any(m => at < m.At + m.Len && at + link.Words.Length > m.At)) { from = at + 1; continue; }
                    marks[p].Add((at, link.Words.Length, link.Url));
                    placed = true;
                    break;
                }
            }
            if (!placed && strict) throw new KeyNotFoundException(link.Words);
        }
        var result = new List<List<Part>>();
        for (var p = 0; p < paragraphs.Count; p++)
        {
            var parts = new List<Part>();
            var pos = 0;
            foreach (var (at, len, url) in marks[p].OrderBy(m => m.At))
            {
                if (at > pos) parts.Add(new Part(paragraphs[p][pos..at], null));
                parts.Add(new Part(paragraphs[p].Substring(at, len), url));
                pos = at + len;
            }
            if (pos < paragraphs[p].Length) parts.Add(new Part(paragraphs[p][pos..], null));
            result.Add(parts);
        }
        return result;
    }

    private static IEnumerable<string> Paragraphs(string text)
        => Regex.Split(text.Trim().Replace("\r\n", "\n"), @"\n{2,}").Select(p => p.Trim()).Where(p => p.Length > 0);
}
