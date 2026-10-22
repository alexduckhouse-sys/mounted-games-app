using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Email;

/// <summary>One outgoing email. <see cref="IdempotencyKey"/> lets the provider drop an accidental repeat.</summary>
public record EmailMessage(
    string To,
    string Subject,
    string TextBody,
    string? HtmlBody = null,
    string? IdempotencyKey = null);

/// <summary>
/// Sends one email. Implementations never throw: a failure comes back as <see cref="EmailDeliveryStatus.Failed"/>
/// so a sign-up is never lost because the mail provider was down. <see cref="EmailDeliveryStatus.NotSent"/> means
/// sending is switched off or not configured.
/// </summary>
public interface IEmailSender
{
    Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default);
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
