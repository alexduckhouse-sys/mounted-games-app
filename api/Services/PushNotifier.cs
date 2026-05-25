using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using WebPush;

namespace MountedGames.Api.Services;

/// <summary>Payload pushed to the service worker — used for notification UI.</summary>
public record PushPayload(
    string Title,
    string Body,
    string? Tag = null,
    string? Url = null);

public class PushNotifier
{
    private readonly AppDbContext _db;
    private readonly VapidKeyService _vapid;
    private readonly ILogger<PushNotifier> _log;

    public PushNotifier(AppDbContext db, VapidKeyService vapid, ILogger<PushNotifier> log)
    {
        _db = db;
        _vapid = vapid;
        _log = log;
    }

    /// <summary>Pushes to every endpoint registered for the given user ids.</summary>
    public async Task SendToUsersAsync(IReadOnlyCollection<string> userIds, PushPayload payload)
    {
        if (userIds.Count == 0) return;
        var subs = await _db.PushSubscriptions
            .Where(s => userIds.Contains(s.UserId))
            .ToListAsync();
        await SendAsync(subs, payload);
    }

    private async Task SendAsync(IReadOnlyList<Entities.PushSubscription> subs, PushPayload payload)
    {
        if (subs.Count == 0) return;
        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });
        var client = new WebPushClient();
        var vapid = _vapid.Details();
        var stale = new List<int>();
        foreach (var s in subs)
        {
            var subscription = new WebPush.PushSubscription(s.Endpoint, s.P256dh, s.Auth);
            try
            {
                await client.SendNotificationAsync(subscription, json, vapid);
            }
            catch (WebPushException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Gone
                                            || ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                // Subscription has expired / been revoked — purge it so we
                // don't keep hammering it on every fire.
                stale.Add(s.Id);
                _log.LogInformation("Removing expired push subscription {Id}", s.Id);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Push send failed for subscription {Id}", s.Id);
            }
        }
        if (stale.Count > 0)
        {
            _db.PushSubscriptions.RemoveRange(subs.Where(s => stale.Contains(s.Id)));
            await _db.SaveChangesAsync();
        }
    }
}
