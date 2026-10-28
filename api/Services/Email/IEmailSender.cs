using System.Net;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Email;

/// <summary>One outgoing email. <see cref="IdempotencyKey"/> lets the provider drop an accidental repeat.</summary>
public record EmailMessage(
    string To,
    string Subject,
    string TextBody,
    string? HtmlBody = null,
    string? IdempotencyKey = null,
    IReadOnlyDictionary<string, string>? Headers = null);

/// <summary>
/// Sends one email. Implementations never throw: a failure comes back as <see cref="EmailDeliveryStatus.Failed"/>
/// so a sign-up is never lost because the mail provider was down. <see cref="EmailDeliveryStatus.NotSent"/> means
/// sending is switched off or not configured.
/// </summary>
public interface IEmailSender
{
    Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default);
}

/// <summary>
/// Dependency-free HTML layout for outgoing emails. Every dynamic value goes through <see cref="Encode"/>
/// so user or competition strings can never inject markup.
/// </summary>
public static class EmailHtml
{
    public const string HeaderStyle = "background:#17385F;color:#ffffff;padding:16px 20px;font-family:system-ui,-apple-system,sans-serif;font-weight:700;font-size:18px;";
    public const string CardStyle = "background:#ffffff;border:1px solid #d8dee9;border-radius:10px;padding:20px;color:#0f172a;font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;";

    public static string Encode(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);

    /// <summary>Encodes a multi-line value and turns its line breaks into <c>&lt;br&gt;</c> so bank details keep their layout.</summary>
    public static string EncodeMultiline(string? value) =>
        Encode(value).Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "<br>");

    public static string Wrap(string innerHtml) =>
        $"""
        <!doctype html>
        <html lang="en">
        <body style="margin:0;padding:16px;background:#f8fafc;color:#0f172a;font-family:system-ui,-apple-system,sans-serif;">
        <div style="max-width:560px;margin:0 auto;">
        <div style="{HeaderStyle}">Mounted Games</div>
        <div style="{CardStyle}">
        {innerHtml}
        </div>
        </div>
        </body>
        </html>
        """;

    public static string Button(string href, string label) =>
        $"<p style=\"margin:16px 0;\"><a href=\"{Encode(href)}\" style=\"display:inline-block;background:#17385F;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px;\">{Encode(label)}</a></p>";

    public static string RowMultiline(string label, string value) =>
        $"<tr><td style=\"padding:6px 12px 6px 0;color:#475569;font-weight:600;vertical-align:top;white-space:nowrap;\">{Encode(label)}</td><td style=\"padding:6px 0;color:#0f172a;\">{EncodeMultiline(value)}</td></tr>";

    public static string Row(string label, string value) =>
        $"<tr><td style=\"padding:6px 12px 6px 0;color:#475569;font-weight:600;vertical-align:top;white-space:nowrap;\">{Encode(label)}</td><td style=\"padding:6px 0;color:#0f172a;\">{Encode(value)}</td></tr>";
}

public static class EmailAddresses
{
    public const int MaxLength = 254;

    /// <summary>Trims, lower-cases and checks a plain <c>name@host.tld</c> address. Names, comments and quoted forms are refused.</summary>
    public static bool TryNormalise(string? value, out string address)
    {
        address = string.Empty;
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v) || v.Length > MaxLength) return false;
        if (v.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || c is '<' or '>' or '"' or ',' or ';' or '(' or ')' or '\\')) return false;
        var at = v.IndexOf('@');
        if (at < 1 || at != v.LastIndexOf('@') || at == v.Length - 1) return false;
        var domain = v[(at + 1)..];
        if (domain.Length < 4 || !domain.Contains('.') || domain.StartsWith('.') || domain.EndsWith('.') || domain.Contains("..")
            || domain.StartsWith('-')) return false;
        if (v[..at].Length > 64) return false;
        address = v.ToLowerInvariant();
        return true;
    }

    /// <summary>"a***@e***.com": enough to recognise in a log, never enough to contact.</summary>
    public static string Mask(string? address)
    {
        if (string.IsNullOrEmpty(address)) return "(none)";
        var at = address.IndexOf('@');
        if (at < 1) return "***";
        var domain = address[(at + 1)..];
        var dot = domain.LastIndexOf('.');
        var tld = dot >= 0 ? domain[dot..] : string.Empty;
        return $"{address[0]}***@{(domain.Length > 0 ? domain[0] : '*')}***{tld}";
    }
}
