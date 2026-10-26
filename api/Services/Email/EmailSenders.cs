using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Email;

/// <summary>
/// Email settings (<c>Email:*</c>). Everything is off unless <see cref="Enabled"/> is true and the key and
/// sender address are both set; missing values never stop the app starting.
/// </summary>
public class EmailOptions
{
    public bool Enabled { get; set; }
    /// <summary>Resend API key. Environment/secret store only; never logged.</summary>
    public string? ApiKey { get; set; }
    /// <summary>Verified sender, e.g. <c>Mounted Games &lt;entries@example.org&gt;</c>.</summary>
    public string? From { get; set; }
    /// <summary>Optional reply-to address passed to Resend when set.</summary>
    public string? ReplyTo { get; set; }
    /// <summary>Website address (scheme and host) used for links in emails. Falls back to <c>Sharing:PublicBaseUrl</c>.</summary>
    public string? SiteUrl { get; set; }
    /// <summary>How long a send may take before it is given up as failed. The API scales to zero, so this stays short.</summary>
    public int TimeoutSeconds { get; set; } = 5;

    public bool IsConfigured => Enabled && !string.IsNullOrWhiteSpace(ApiKey) && !string.IsNullOrWhiteSpace(From);
}

/// <summary>
/// Used whenever real sending isn't configured (always in Development and Testing unless it is set up on purpose).
/// Logs that a message was handled, with a masked address and nothing else, and sends nothing.
/// </summary>
public class LoggingEmailSender(ILogger<LoggingEmailSender> log) : IEmailSender
{
    public Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        log.LogInformation("Email sending is off; a message for {Recipient} was not delivered.", EmailAddresses.Mask(message.To));
        return Task.FromResult(EmailDeliveryStatus.NotSent);
    }
}

/// <summary>
/// Resend's REST API (<c>POST https://api.resend.com/emails</c>). One attempt, a short timeout, no retries:
/// the caller records the outcome and the sign-up carries on either way.
/// </summary>
public class ResendEmailSender(IHttpClientFactory http, IOptions<EmailOptions> options, ILogger<ResendEmailSender> log) : IEmailSender
{
    public const string HttpClientName = "email";
    public const string Endpoint = "https://api.resend.com/emails";

    public async Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var o = options.Value;
        if (!o.IsConfigured) return EmailDeliveryStatus.NotSent;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(o.TimeoutSeconds, 1, 15)));
        try
        {
            var payload = new Dictionary<string, object?>
            {
                ["from"] = o.From,
                ["to"] = new[] { message.To },
                ["subject"] = message.Subject,
                ["text"] = message.TextBody,
            };
            if (message.HtmlBody is not null) payload["html"] = message.HtmlBody;
            if (message.Headers is { Count: > 0 }) payload["headers"] = message.Headers;
            if (!string.IsNullOrWhiteSpace(o.ReplyTo)) payload["reply_to"] = o.ReplyTo;
            using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint)
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", o.ApiKey);
            if (!string.IsNullOrEmpty(message.IdempotencyKey)) request.Headers.TryAddWithoutValidation("Idempotency-Key", message.IdempotencyKey);
            using var client = http.CreateClient(HttpClientName);
            using var response = await client.SendAsync(request, timeout.Token);
            if (response.IsSuccessStatusCode) return EmailDeliveryStatus.Sent;
            // Status code only: the response body can repeat the address.
            log.LogWarning("Email provider refused a message for {Recipient} with status {Status}.",
                EmailAddresses.Mask(message.To), (int)response.StatusCode);
            return EmailDeliveryStatus.Failed;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            log.LogWarning("Email provider could not be reached for {Recipient}: {Reason}.",
                EmailAddresses.Mask(message.To), ex.GetType().Name);
            return EmailDeliveryStatus.Failed;
        }
    }
}

/// <summary>Picks the real sender only when it is switched on and complete; otherwise the logging one.</summary>
public class ConfiguredEmailSender(IOptions<EmailOptions> options, ResendEmailSender resend, LoggingEmailSender logging) : IEmailSender
{
    public Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default)
        => (options.Value.IsConfigured ? (IEmailSender)resend : logging).SendAsync(message, ct);
}
