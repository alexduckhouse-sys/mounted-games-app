using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using DnsClient;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Email;

/// <summary>
/// The password rules, in friendly words. The rules themselves are set in <c>Program.cs</c> (Identity options);
/// <c>web/src/lib/passwordRules.ts</c> mirrors them and a test on each side pins the two together.
/// </summary>
public static class PasswordRules
{
    public const int MinLength = 8;

    /// <summary>Wording for Identity's error codes. "Non-alphanumeric" is never shown to anyone.</summary>
    public static string Friendly(IdentityError error) => error.Code switch
    {
        "PasswordTooShort" => $"Your password needs at least {MinLength} characters.",
        "PasswordRequiresDigit" => "Your password needs a number.",
        "PasswordRequiresLower" => "Your password needs a lowercase letter.",
        "PasswordRequiresUpper" => "Your password needs a capital letter.",
        "PasswordRequiresNonAlphanumeric" => "Your password needs a special character (like ! ? # @ £).",
        "PasswordRequiresUniqueChars" => "Your password needs a wider mix of characters.",
        _ => error.Description.Replace("non-alphanumeric", "special", StringComparison.OrdinalIgnoreCase),
    };
}

public enum EmailProblem { None, Format, Disposable, NoMailServer }

/// <summary>Strict address checks that need no network: the shape, and a short list of throwaway-inbox domains.</summary>
public static partial class EmailValidation
{
    // Dot-atom local part (no leading, trailing or doubled dots) and a dotted domain of letter/digit/hyphen labels
    // with an alphabetic top-level domain of at least two letters (or a punycode one).
    [GeneratedRegex(@"^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$")]
    private static partial Regex Shape();

    private static readonly string[] Disposable =
    [
        "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "sharklasers.com", "grr.la",
        "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "throwawaymail.com",
        "yopmail.com", "yopmail.net", "getnada.com", "nada.email", "trashmail.com", "trashmail.net", "maildrop.cc", "dispostable.com",
        "fakeinbox.com", "mailnesia.com", "mintemail.com", "spamgourmet.com", "tempinbox.com", "emailondeck.com", "mohmal.com",
        "burnermail.io", "discard.email", "mytemp.email", "tempr.email", "moakt.com", "mailcatch.com", "spambox.us", "getairmail.com",
    ];

    /// <summary>Trims, lower-cases and checks the shape. Length limits are the standard 64 (name) and 254 (whole address).</summary>
    public static bool TryNormalise(string? value, out string address)
    {
        address = string.Empty;
        var v = value?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(v) || v.Length > EmailAddresses.MaxLength || !Shape().IsMatch(v)) return false;
        if (v.IndexOf('@') > 64) return false;
        address = v;
        return true;
    }

    public static string DomainOf(string address) => address[(address.LastIndexOf('@') + 1)..];

    public static bool IsDisposable(string domain)
        => Disposable.Any(d => domain.Equals(d, StringComparison.OrdinalIgnoreCase) || domain.EndsWith("." + d, StringComparison.OrdinalIgnoreCase));

    public static string Message(EmailProblem problem) => problem switch
    {
        EmailProblem.Format => "That doesn't look like a valid email address. Check it and try again.",
        EmailProblem.Disposable => "Please use an email address you keep, not a temporary inbox.",
        EmailProblem.NoMailServer => "We couldn't find a mailbox for that address's domain. Check the spelling after the @.",
        _ => string.Empty,
    };
}

public enum DomainMail { HasMail, NoMail, Unknown }

/// <summary>Asks whether a domain can receive mail. Behind an interface so tests never touch DNS.</summary>
public interface IEmailDomainChecker
{
    Task<DomainMail> CheckAsync(string domain, CancellationToken ct = default);
}

/// <summary>
/// MX records, falling back to A/AAAA (the old implicit-MX rule). A name that doesn't exist, has no records, or only a
/// null MX ("."), is <see cref="DomainMail.NoMail"/>. Anything else that goes wrong (timeout, SERVFAIL, no network)
/// is <see cref="DomainMail.Unknown"/> so flaky DNS never blocks a sign-up.
/// </summary>
public class DnsEmailDomainChecker(ILookupClient dns, ILogger<DnsEmailDomainChecker> log) : IEmailDomainChecker
{
    public async Task<DomainMail> CheckAsync(string domain, CancellationToken ct = default)
    {
        try
        {
            var mx = await dns.QueryAsync(domain, QueryType.MX, cancellationToken: ct);
            if (mx.Header.ResponseCode == DnsHeaderResponseCode.NotExistentDomain) return DomainMail.NoMail;
            if (mx.HasError) return Inconclusive(domain, mx.Header.ResponseCode.ToString());
            var hosts = mx.Answers.MxRecords().Select(r => r.Exchange.Value.TrimEnd('.')).ToList();
            if (hosts.Any(h => h.Length > 0)) return DomainMail.HasMail;
            if (hosts.Count > 0) return DomainMail.NoMail; // a null MX: the domain says it takes no mail

            foreach (var type in new[] { QueryType.A, QueryType.AAAA })
            {
                var a = await dns.QueryAsync(domain, type, cancellationToken: ct);
                if (a.HasError && a.Header.ResponseCode != DnsHeaderResponseCode.NotExistentDomain)
                    return Inconclusive(domain, a.Header.ResponseCode.ToString());
                if (a.Answers.Any(r => r is DnsClient.Protocol.AddressRecord)) return DomainMail.HasMail;
            }
            return DomainMail.NoMail;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            return Inconclusive(domain, ex.GetType().Name);
        }
    }

    private DomainMail Inconclusive(string domain, string reason)
    {
        log.LogWarning("The mail check for {Domain} was inconclusive ({Reason}); letting it through.", domain, reason);
        return DomainMail.Unknown;
    }
}

/// <summary>
/// Signed, expiring email-confirmation tokens. Identity's own token provider relies on ASP.NET Data Protection keys,
/// which aren't shared between the API's scale-to-zero instances here, so a link issued by one instance could fail
/// on another. This signs with a key derived from <c>Jwt:Key</c> instead. A token holds the expiry and is bound to the
/// user id, their current email address and their security stamp (so a password reset or an address change kills it).
/// Confirming flips <c>EmailConfirmed</c>; using the link again is harmless.
/// </summary>
public class EmailConfirmationTokens(IConfiguration configuration, TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(3);

    private byte[] Key()
    {
        var jwt = configuration["Jwt:Key"] ?? "dev-only-secret-please-change-me-256-bit-min!!";
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(jwt), Encoding.UTF8.GetBytes("mg:email-confirmation:v1"));
    }

    private string Sign(AppUser user, long expires)
        => WebEncoders.Base64UrlEncode(HMACSHA256.HashData(Key(),
            Encoding.UTF8.GetBytes($"{user.Id}|{user.Email?.ToLowerInvariant()}|{user.SecurityStamp}|{expires}")));

    public string Create(AppUser user)
    {
        var expires = clock.GetUtcNow().Add(Lifetime).ToUnixTimeSeconds();
        return $"{expires}.{Sign(user, expires)}";
    }

    public bool IsValid(AppUser user, string? token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 200) return false;
        var dot = token.IndexOf('.');
        if (dot < 1 || !long.TryParse(token[..dot], out var expires)) return false;
        if (clock.GetUtcNow().ToUnixTimeSeconds() > expires) return false;
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(token[(dot + 1)..]), Encoding.ASCII.GetBytes(Sign(user, expires)));
    }
}

/// <summary>Builds and sends the "confirm your email address" message. Never throws and never logs the address or the link.</summary>
public class AccountEmailService(
    IEmailSender sender, IOptions<EmailOptions> options, IConfiguration configuration,
    EmailConfirmationTokens tokens, ILogger<AccountEmailService> log)
{
    public async Task<EmailDeliveryStatus> SendConfirmationAsync(AppUser user)
    {
        try
        {
            var site = EmailSite.Origin(options.Value, configuration);
            if (site is null || string.IsNullOrEmpty(user.Email)) return EmailDeliveryStatus.NotSent;
            var link = $"{site}/confirm-email?userId={Uri.EscapeDataString(user.Id)}&token={Uri.EscapeDataString(tokens.Create(user))}";
            var text = $"""
                Hello {user.FullName},

                Please confirm your email address so we can reach you about your Mounted Games account. This link works for {(int)EmailConfirmationTokens.Lifetime.TotalDays} days:

                {link}

                If you didn't create an account, you can ignore this email.

                Mounted Games
                """;
            return await sender.SendAsync(new EmailMessage(user.Email, "Confirm your email address", text, null, $"confirm-email-{user.Id}-{Guid.NewGuid():N}"));
        }
        catch (Exception ex)
        {
            log.LogWarning("Could not build the confirmation email: {Reason}", ex.GetType().Name);
            return EmailDeliveryStatus.Failed;
        }
    }
}
