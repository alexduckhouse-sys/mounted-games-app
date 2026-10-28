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
/// Resend's REST API (<c>POST https://api.resend.com/emails</c>). Sends are spaced out to stay under Resend's default
/// limit of 2 requests a second, and a 429 (rate limited) answer is retried a couple of times after a short, bounded wait
/// (honouring <c>Retry-After</c>). Other failures, 5xx included, are not retried here: callers such as the entries digest
/// keep their own attempt counts and waits. The caller records the final outcome and the sign-up carries on either way.
/// </summary>
public class ResendEmailSender(IHttpClientFactory http, IOptions<EmailOptions> options, ILogger<ResendEmailSender> log,
    Func<TimeSpan, CancellationToken, Task>? delay = null) : IEmailSender
{
    public const string HttpClientName = "email";
    public const string Endpoint = "https://api.resend.com/emails";
    /// <summary>Gap between request starts: a little over half a second keeps us under 2 a second.</summary>
    public static readonly TimeSpan MinimumGap = TimeSpan.FromMilliseconds(550);
    public const int MaxRetries = 2;
    public static readonly TimeSpan MaxRetryWait = TimeSpan.FromSeconds(3);

    private readonly Func<TimeSpan, CancellationToken, Task> _delay = delay ?? Task.Delay;
    private readonly SemaphoreSlim _pace = new(1, 1);
    private long _lastStartTicks = long.MinValue;

    // One send at a time may start; each waits until MinimumGap has passed since the previous one started.
    private async Task PaceAsync(CancellationToken ct)
    {
        await _pace.WaitAsync(ct);
        try
        {
            if (_lastStartTicks != long.MinValue)
            {
                var wait = MinimumGap - System.Diagnostics.Stopwatch.GetElapsedTime(_lastStartTicks);
                if (wait > TimeSpan.Zero) await _delay(wait, ct);
            }
            _lastStartTicks = System.Diagnostics.Stopwatch.GetTimestamp();
        }
        finally { _pace.Release(); }
    }

    private static TimeSpan RetryWait(HttpResponseMessage response, int attempt)
    {
        var header = response.Headers.RetryAfter;
        var wait = header?.Delta ?? (header?.Date is { } date ? date - DateTimeOffset.UtcNow : TimeSpan.FromSeconds(attempt));
        if (wait < TimeSpan.FromSeconds(1)) wait = TimeSpan.FromSeconds(1);
        return wait > MaxRetryWait ? MaxRetryWait : wait;
    }

    public async Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var o = options.Value;
        if (!o.IsConfigured) return EmailDeliveryStatus.NotSent;
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
            var json = JsonSerializer.Serialize(payload);
            for (var attempt = 1; ; attempt++)
            {
                await PaceAsync(ct);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(o.TimeoutSeconds, 1, 15)));
                using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json"),
                };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", o.ApiKey);
                if (!string.IsNullOrEmpty(message.IdempotencyKey)) request.Headers.TryAddWithoutValidation("Idempotency-Key", message.IdempotencyKey);
                using var client = http.CreateClient(HttpClientName);
                using var response = await client.SendAsync(request, timeout.Token);
                if (response.IsSuccessStatusCode) return EmailDeliveryStatus.Sent;
                var status = (int)response.StatusCode;
                if (status == 429 && attempt <= MaxRetries)
                {
                    await _delay(RetryWait(response, attempt), ct);
                    continue;
                }
                // Status code only: the response body can repeat the address.
                log.LogWarning("Email provider refused a message for {Recipient} with status {Status}.",
                    EmailAddresses.Mask(message.To), status);
                return EmailDeliveryStatus.Failed;
            }
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
