using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MountedGames.Api.Dtos;
namespace MountedGames.Api.Services.Apple;

public enum ApplePushResult { Accepted, Gone, Retry, Disabled }
public interface IApplePushProvider
{
    Task<ApplePushResult> LiveAsync(string token, bool sandbox, string payload, DateTime expires, CancellationToken ct);
    Task<ApplePushResult> WalletAsync(string token, CancellationToken ct);
}
public sealed class ApplePushProvider(IHttpClientFactory clients, AppleOptions options, TimeProvider clock) : IApplePushProvider
{
    public async Task<ApplePushResult> LiveAsync(string token, bool sandbox, string payload, DateTime expires, CancellationToken ct)
    {
        if (!options.LiveReady || sandbox != options.Sandbox) return ApplePushResult.Disabled;
        using var request = Request(token, sandbox, payload, options.BundleId + ".push-type.liveactivity", "liveactivity", expires);
        request.Headers.Authorization = new AuthenticationHeaderValue("bearer", ProviderToken());
        return await Send(clients.CreateClient("AppleLivePush"), request, ct);
    }
    public async Task<ApplePushResult> WalletAsync(string token, CancellationToken ct)
    {
        if (!options.WalletReady) return ApplePushResult.Disabled;
        // Wallet uses its Pass Type certificate, production APNs and an empty dictionary, not ActivityKit JSON.
        using var request = Request(token, false, "{}", options.PassTypeId!, "background", clock.GetUtcNow().AddHours(1).UtcDateTime);
        return await Send(clients.CreateClient("AppleWalletPush"), request, ct);
    }
    private static HttpRequestMessage Request(string token, bool sandbox, string payload, string topic, string pushType, DateTime expires)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"https://{(sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com")}/3/device/{token}")
            { Version = HttpVersion.Version20, VersionPolicy = HttpVersionPolicy.RequestVersionExact, Content = new StringContent(payload, Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("apns-topic", topic); request.Headers.TryAddWithoutValidation("apns-push-type", pushType);
        request.Headers.TryAddWithoutValidation("apns-priority", "5"); request.Headers.TryAddWithoutValidation("apns-expiration", new DateTimeOffset(DateTime.SpecifyKind(expires, DateTimeKind.Utc)).ToUnixTimeSeconds().ToString());
        return request;
    }
    private static async Task<ApplePushResult> Send(HttpClient client, HttpRequestMessage request, CancellationToken ct)
    {
        try {
            using var response = await client.SendAsync(request, ct);
            if (response.IsSuccessStatusCode) return ApplePushResult.Accepted;
            if (response.StatusCode == HttpStatusCode.Gone) return ApplePushResult.Gone;
            if (response.StatusCode == HttpStatusCode.BadRequest)
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                if (body.Contains("BadDeviceToken", StringComparison.Ordinal) || body.Contains("DeviceTokenNotForTopic", StringComparison.Ordinal)) return ApplePushResult.Gone;
            }
            return ApplePushResult.Retry;
        } catch (HttpRequestException) { return ApplePushResult.Retry; }
    }
    private string ProviderToken()
    {
        static string Encode(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var head = Encode(JsonSerializer.SerializeToUtf8Bytes(new { alg = "ES256", kid = options.KeyId }));
        var body = Encode(JsonSerializer.SerializeToUtf8Bytes(new { iss = options.TeamId, iat = clock.GetUtcNow().ToUnixTimeSeconds() }));
        using var key = ECDsa.Create(); key.ImportFromPem(options.PrivateKey);
        var input = head + "." + body;
        return input + "." + Encode(key.SignData(Encoding.ASCII.GetBytes(input), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }
    public static string LivePayload(TeamProgressSnapshotDto snapshot, long timestamp, bool end)
    {
        var p = snapshot.Progress;
        // Swift's synthesised Codable Date uses seconds since 2001-01-01, while APNs envelope dates are Unix seconds.
        var state = new { status = (int)p.Status, sessionId = p.SessionId, heatId = p.HeatId, laneIndex = p.LaneIndex,
            heatsUntil = p.HeatsUntil, arenaName = p.ArenaName, heatLabel = p.HeatLabel,
            observedAt = (snapshot.ObservedAt - new DateTimeOffset(2001, 1, 1, 0, 0, 0, TimeSpan.Zero)).TotalSeconds };
        var aps = new Dictionary<string, object> { ["timestamp"] = timestamp, ["event"] = end ? "end" : "update", ["content-state"] = state,
            ["stale-date"] = snapshot.ObservedAt.AddMinutes(5).ToUnixTimeSeconds() };
        if (end) aps["dismissal-date"] = snapshot.ObservedAt.AddMinutes(15).ToUnixTimeSeconds();
        return JsonSerializer.Serialize(new { aps });
    }
}
