using System.Data;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Payouts;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Receives Stripe Connect <c>account.updated</c> webhooks, verifies <c>Stripe-Signature</c> over the raw body
/// with a 300-second replay window, deduplicates by <c>evt_...</c> inside a serializable transaction, and
/// updates the matching <see cref="ClubPayoutAccount"/> or <see cref="UserPayoutAccount"/>.
/// </summary>
[ApiController]
[Route("api/webhooks/stripe-connect")]
[AllowAnonymous]
[DisableRateLimiting]
public class StripeConnectWebhookController(AppDbContext db, StripeConnectService stripe, TimeProvider time) : ControllerBase
{
    [HttpPost]
    [RequestSizeLimit(262_144)]
    public async Task<IActionResult> Handle(CancellationToken ct)
    {
        if (!stripe.IsWebhookConfigured)
            return BadRequest(new { message = "Stripe Connect webhook secret is not configured." });

        string rawBody;
        using (var reader = new StreamReader(Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true))
        {
            rawBody = await reader.ReadToEndAsync(ct);
        }

        var signature = Request.Headers["Stripe-Signature"].ToString();
        if (!stripe.VerifyWebhookSignature(rawBody, signature))
            return BadRequest(new { message = "Invalid Stripe-Signature header." });

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(rawBody);
        }
        catch (JsonException)
        {
            return BadRequest(new { message = "Invalid JSON payload." });
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (!root.TryGetProperty("id", out var idProp) || idProp.GetString() is not { Length: > 0 and <= 100 } eventId
                || !root.TryGetProperty("type", out var typeProp) || typeProp.GetString() is not { Length: > 0 and <= 100 } eventType)
            {
                return BadRequest(new { message = "Missing event id or type." });
            }

            if (root.TryGetProperty("livemode", out var liveProp)
                && (liveProp.ValueKind == JsonValueKind.True || liveProp.ValueKind == JsonValueKind.False)
                && stripe.IsLivemodeMismatch(liveProp.GetBoolean()))
            {
                return BadRequest(new { message = "Webhook livemode mismatch." });
            }

            DateTime? eventCreatedUtc = null;
            if (root.TryGetProperty("created", out var createdProp)
                && createdProp.ValueKind == JsonValueKind.Number
                && createdProp.TryGetInt64(out var createdUnix)
                && createdUnix > 0)
            {
                eventCreatedUtc = DateTimeOffset.FromUnixTimeSeconds(createdUnix).UtcDateTime;
            }

            var topAccountId = root.TryGetProperty("account", out var acctProp) && acctProp.ValueKind == JsonValueKind.String
                ? acctProp.GetString()
                : null;

            StripeAccountStatus? parsedStatus = null;
            if (root.TryGetProperty("data", out var dataEl)
                && dataEl.ValueKind == JsonValueKind.Object
                && dataEl.TryGetProperty("object", out var objEl)
                && objEl.ValueKind == JsonValueKind.Object)
            {
                if (eventType == "account.updated")
                {
                    parsedStatus = StripeConnectService.ParseAccountObject(objEl, topAccountId);
                    if (!string.IsNullOrWhiteSpace(parsedStatus.AccountId))
                        topAccountId ??= parsedStatus.AccountId;
                }
                else if (eventType == "account.application.deauthorized" && string.IsNullOrWhiteSpace(topAccountId))
                {
                    if (objEl.TryGetProperty("account", out var objAcct) && objAcct.ValueKind == JsonValueKind.String)
                        topAccountId = objAcct.GetString();
                }
            }

            var now = time.GetUtcNow().UtcDateTime;
            var targetAccountId = parsedStatus?.AccountId ?? topAccountId;
            return await db.Database.CreateExecutionStrategy().ExecuteAsync<IActionResult>(async () =>
            {
                db.ChangeTracker.Clear();
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                if (await db.StripeWebhookEvents.AnyAsync(e => e.EventId == eventId, ct))
                    return Ok(new { received = true, duplicate = true });

                var isStaleEvent = false;
                if (!string.IsNullOrWhiteSpace(targetAccountId) && eventCreatedUtc is { } createdUtc)
                {
                    isStaleEvent = await db.StripeWebhookEvents.AnyAsync(
                        e => e.AccountId == targetAccountId
                            && (e.EventType == "account.updated" || e.EventType == "account.application.deauthorized")
                            && e.ProcessedAtUtc > createdUtc,
                        ct);
                }

                db.StripeWebhookEvents.Add(new StripeWebhookEvent
                {
                    EventId = eventId,
                    AccountId = targetAccountId is { Length: > 64 } ? targetAccountId[..64] : targetAccountId,
                    EventType = eventType,
                    ProcessedAtUtc = eventCreatedUtc ?? now,
                });

                if (!isStaleEvent)
                {
                    if (parsedStatus is not null && !string.IsNullOrWhiteSpace(parsedStatus.AccountId))
                    {
                        var clubAccount = await db.ClubPayoutAccounts
                            .FirstOrDefaultAsync(a => a.StripeAccountId == parsedStatus.AccountId, ct);
                        if (clubAccount is not null)
                            StripeConnectService.ApplyStatus(clubAccount, parsedStatus, now);

                        var userAccount = await db.UserPayoutAccounts
                            .FirstOrDefaultAsync(a => a.StripeAccountId == parsedStatus.AccountId, ct);
                        if (userAccount is not null)
                            StripeConnectService.ApplyStatus(userAccount, parsedStatus, now);
                    }
                    else if (eventType == "account.application.deauthorized" && !string.IsNullOrWhiteSpace(targetAccountId))
                    {
                        var clubAccount = await db.ClubPayoutAccounts
                            .FirstOrDefaultAsync(a => a.StripeAccountId == targetAccountId, ct);
                        if (clubAccount is not null)
                            StripeConnectService.ApplyDeauthorized(clubAccount, now);

                        var userAccount = await db.UserPayoutAccounts
                            .FirstOrDefaultAsync(a => a.StripeAccountId == targetAccountId, ct);
                        if (userAccount is not null)
                            StripeConnectService.ApplyDeauthorized(userAccount, now);
                    }
                }

                try
                {
                    await db.SaveChangesAsync(ct);
                    await tx.CommitAsync(ct);
                }
                catch (DbUpdateException)
                {
                    await tx.RollbackAsync(ct);
                    if (await db.StripeWebhookEvents.AsNoTracking().AnyAsync(e => e.EventId == eventId, ct))
                        return Ok(new { received = true, duplicate = true });
                    throw;
                }

                return Ok(new { received = true });
            });
        }
    }
}
