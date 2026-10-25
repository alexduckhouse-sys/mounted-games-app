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
    int? CompetitionId = null, string? CompetitionName = null, string? CompetitionDates = null, string? CompetitionVenue = null);

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
                    foreach (var paragraph in Paragraphs(block.Text!))
                    {
                        html.Append("<p style=\"margin:0 0 14px;\">")
                            .Append(EmailHtml.Encode(paragraph).Replace("\r\n", "<br>").Replace("\n", "<br>")).Append("</p>");
                        text.AppendLine(paragraph).AppendLine();
                    }
                    break;
                case EmailBlockType.Picture:
                    html.Append($"<img src=\"{EmailHtml.Encode($"{site}/api/email-images/{block.ImageId:D}")}\" alt=\"{EmailHtml.Encode(block.Alt)}\" ")
                        .Append("style=\"display:block;max-width:100%;height:auto;margin:0 0 14px;border-radius:8px;\">");
                    text.AppendLine(string.IsNullOrWhiteSpace(block.Alt) ? "[Picture]" : $"[Picture: {block.Alt}]").AppendLine();
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

        if (audience == CustomEmailAudience.News)
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
        text.AppendLine().Append("Mounted Games");
        return new Rendered(EmailHtml.Wrap(html.ToString()), text.ToString());
    }

    /// <summary>Fills in one person's unsubscribe link.</summary>
    public static string ForRecipient(string body, string? unsubscribeUrl)
        => body.Replace(UnsubscribePlaceholder, unsubscribeUrl ?? string.Empty, StringComparison.Ordinal);

    private static IEnumerable<string> Paragraphs(string text)
        => Regex.Split(text.Trim().Replace("\r\n", "\n"), @"\n{2,}").Select(p => p.Trim()).Where(p => p.Length > 0);
}
