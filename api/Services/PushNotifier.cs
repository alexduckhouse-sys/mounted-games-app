using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using WebPush;
using MountedGames.Api.Security;

namespace MountedGames.Api.Services;

/// <summary>Payload pushed to the service worker — used for notification UI.</summary>
public record PushPayload(
    string Title,
    string Body,
    string? Tag = null,
    string? Url = null);

public enum PushSendOutcome { Accepted, RetryableFailure, PermanentFailure, Expired }

public class PushNotifier
{
    private readonly AppDbContext _db;
    private readonly VapidKeyService _vapid;
    private readonly ILogger<PushNotifier> _log;
    private readonly IHttpClientFactory _http;

    /// <summary>Named HttpClient for push services: no redirects, short timeout (see Program.cs).</summary>
    public const string HttpClientName = "push";

    public PushNotifier(AppDbContext db, VapidKeyService vapid, ILogger<PushNotifier> log, IHttpClientFactory http)
    {
        _http = http;
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

    /// <summary>Sends a tailored push to the trainer and accepted supporters of each team in <paramref name="messages"/>.</summary>
    public async Task NotifyPerTeamAsync(IEnumerable<(int TeamId, PushPayload Payload)> messages, CancellationToken ct = default)
    {
        var list = messages.ToList();
        if (list.Count == 0) return;
        var teamIds = list.Select(m => m.TeamId).Distinct().ToList();
        var teams = await _db.Teams.AsNoTracking()
            .Where(t => teamIds.Contains(t.Id))
            .Select(t => new { t.Id, t.TrainerUserId })
            .ToListAsync(ct);
        var supporters = await _db.TeamSupporters.AsNoTracking()
            .Where(s => teamIds.Contains(s.TeamId) && s.Status == TeamSupporterStatus.Accepted)
            .Select(s => new { s.TeamId, s.UserId })
            .ToListAsync(ct);

        var usersByTeam = new Dictionary<int, HashSet<string>>();
        foreach (var t in teams)
        {
            var set = new HashSet<string>();
            if (!string.IsNullOrEmpty(t.TrainerUserId)) set.Add(t.TrainerUserId);
            usersByTeam[t.Id] = set;
        }
        foreach (var s in supporters)
        {
            if (!usersByTeam.TryGetValue(s.TeamId, out var set))
                usersByTeam[s.TeamId] = set = new HashSet<string>();
            set.Add(s.UserId);
        }

        foreach (var (teamId, payload) in list)
        {
            if (usersByTeam.TryGetValue(teamId, out var users) && users.Count > 0)
                await SendToUsersAsync(users, payload);
        }
    }

    /// <summary>Sends the same push payload to the trainer and accepted supporters of all <paramref name="teamIds"/>.</summary>
    public async Task NotifyTeamsAsync(IReadOnlyCollection<int> teamIds, PushPayload payload, CancellationToken ct = default)
    {
        if (teamIds.Count == 0) return;
        var trainers = await _db.Teams.AsNoTracking()
            .Where(t => teamIds.Contains(t.Id) && t.TrainerUserId != null && t.TrainerUserId != "")
            .Select(t => t.TrainerUserId!)
            .ToListAsync(ct);
        var supporters = await _db.TeamSupporters.AsNoTracking()
            .Where(s => teamIds.Contains(s.TeamId) && s.Status == TeamSupporterStatus.Accepted)
            .Select(s => s.UserId)
            .ToListAsync(ct);
        var users = trainers.Concat(supporters).Distinct().ToList();
        if (users.Count > 0)
            await SendToUsersAsync(users, payload);
    }

    public static string Ordinal(int n)
    {
        if (n <= 0) return n.ToString();
        var rem100 = n % 100;
        if (rem100 is 11 or 12 or 13) return $"{n}th";
        return (n % 10) switch
        {
            1 => $"{n}st",
            2 => $"{n}nd",
            3 => $"{n}rd",
            _ => $"{n}th",
        };
    }

    /// <summary>One durable delivery attempt; acceptance is not evidence that anyone saw it.</summary>
    internal async Task<PushSendOutcome> SendDestinationAsync(Entities.PushSubscription subscription,
        PushPayload payload, string reminderKey, DateTime expiresAt, DateTime now, CancellationToken ct)
    {
        if (expiresAt <= now) return PushSendOutcome.Expired;
        if (!PushEndpointPolicy.IsAllowed(subscription.Endpoint)) return PushSendOutcome.PermanentFailure;
        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        // Web Push Topic is at most 32 URL-safe characters; the public notification tag stays unchanged.
        var topic = Convert.ToBase64String(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(reminderKey)))
            .Replace('+', '-').Replace('/', '_')[..32];
        var options = new Dictionary<string, object>
        {
            ["headers"] = new Dictionary<string, object> { ["Topic"] = topic },
            ["vapidDetails"] = _vapid.Details(),
            ["TTL"] = Math.Max(0, (int)(expiresAt - now).TotalSeconds),
        };
        using var client = new WebPushClient(_http.CreateClient(HttpClientName));
        try
        {
            await client.SendNotificationAsync(new WebPush.PushSubscription(subscription.Endpoint, subscription.P256dh, subscription.Auth),
                json, options, ct);
            return PushSendOutcome.Accepted;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (WebPushException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Gone or System.Net.HttpStatusCode.NotFound)
        {
            await _db.PushSubscriptions.Where(s => s.Id == subscription.Id).ExecuteDeleteAsync(ct);
            return PushSendOutcome.PermanentFailure;
        }
        catch (Exception)
        {
            // Provider exception text can contain an endpoint/token. Record only a non-identifying error category.
            _log.LogWarning("Reminder provider attempt failed for subscription {Id}", subscription.Id);
            return PushSendOutcome.RetryableFailure;
        }
    }

    private async Task SendAsync(IReadOnlyList<Entities.PushSubscription> subs, PushPayload payload)
    {
        if (subs.Count == 0) return;
        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });
        using var client = new WebPushClient(_http.CreateClient(HttpClientName));
        var vapid = _vapid.Details();
        var stale = new List<int>();
        foreach (var s in subs)
        {
            if (!PushEndpointPolicy.IsAllowed(s.Endpoint)) continue;
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
