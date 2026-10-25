using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using MountedGames.Api.Dtos;

namespace MountedGames.Api.Services.Streaming;

public record SfuSession(string SessionId, string Sdp, IReadOnlyList<string> Mids);
public sealed class SfuException() : Exception("The streaming service is unavailable.");

public interface ISfuClient
{
    Task<SfuSession> PublishAsync(PublishRequest request, CancellationToken ct = default);
    Task<SfuSession> WatchAsync(string publisherSessionId, bool hasAudio, bool simulcast, CancellationToken ct = default, string? preferredRid = null);
    Task AnswerAsync(string sessionId, string sdp, CancellationToken ct = default);
    Task CloseAsync(string? sessionId, IReadOnlyList<string> mids);
    Task<IReadOnlyList<IceServer>> IceServersAsync(CancellationToken ct = default);
}

public sealed class CloudflareSfuClient(IHttpClientFactory clients, IOptions<StreamingOptions> options, TimeProvider time)
    : ISfuClient, IDisposable
{
    public const string HttpClientName = "streaming";
    private readonly CloudflareOptions _config = options.Value.Cloudflare;
    private readonly SemaphoreSlim _iceLock = new(1, 1);
    private IReadOnlyList<IceServer>? _iceServers;
    private DateTimeOffset _iceExpires;
    private string AppUrl => $"{_config.BaseUrl.TrimEnd('/')}/apps/{Uri.EscapeDataString(_config.AppId)}";

    public Task<SfuSession> PublishAsync(PublishRequest request, CancellationToken ct = default)
    {
        var tracks = new List<object> { new { location = "local", mid = request.VideoMid, trackName = "video" } };
        if (!string.IsNullOrWhiteSpace(request.AudioMid))
            tracks.Add(new { location = "local", mid = request.AudioMid, trackName = "audio" });
        return CreateAsync(new { sessionDescription = new { type = "offer", sdp = request.SdpOffer }, tracks },
            string.IsNullOrWhiteSpace(request.AudioMid) ? [request.VideoMid] : [request.VideoMid, request.AudioMid], "answer", ct);
    }

    public Task<SfuSession> WatchAsync(string publisherSessionId, bool hasAudio, bool simulcast, CancellationToken ct = default, string? preferredRid = null)
    {
        var rid = preferredRid is "f" or "h" or "q" ? preferredRid : "f";
        var video = new Dictionary<string, object>
        {
            ["location"] = "remote", ["sessionId"] = publisherSessionId, ["trackName"] = "video"
        };
        if (simulcast) video["simulcast"] = new { preferredRid = rid, priorityOrdering = "asciibetical", ridNotAvailable = "asciibetical" };
        var tracks = new List<object> { video };
        if (hasAudio) tracks.Add(new { location = "remote", sessionId = publisherSessionId, trackName = "audio" });
        return CreateAsync(new { tracks }, [], "offer", ct);
    }

    private async Task<SfuSession> CreateAsync(object body, IReadOnlyList<string> mids, string expectedType, CancellationToken ct)
    {
        // sessions/new takes no body: Cloudflare rejects even an empty JSON object.
        var created = await SendAsync(HttpMethod.Post, $"{AppUrl}/sessions/new", null, _config.AppToken, ct);
        CheckErrors(created);
        var sid = String(created, "sessionId");
        if (string.IsNullOrWhiteSpace(sid) || sid.Length > 100) throw new SfuException();
        try
        {
            var result = await SendAsync(HttpMethod.Post, $"{AppUrl}/sessions/{Uri.EscapeDataString(sid)}/tracks/new", body, _config.AppToken, ct);
            if (result.TryGetProperty("tracks", out var tracks) && tracks.ValueKind == JsonValueKind.Array)
            {
                var returnedMids = tracks.EnumerateArray().Select(t => String(t, "mid")).OfType<string>().ToArray();
                mids = mids.Concat(returnedMids).Distinct().ToArray();
            }
            CheckErrors(result);
            if (mids.Count == 0 || !result.TryGetProperty("sessionDescription", out var description)
                || String(description, "type") != expectedType || string.IsNullOrWhiteSpace(String(description, "sdp")))
                throw new SfuException();
            return new SfuSession(sid, String(description, "sdp")!, mids);
        }
        catch
        {
            await CloseAsync(sid, mids);
            throw;
        }
    }

    public async Task AnswerAsync(string sessionId, string sdp, CancellationToken ct = default)
    {
        var result = await SendAsync(HttpMethod.Put, $"{AppUrl}/sessions/{Uri.EscapeDataString(sessionId)}/renegotiate",
            new { sessionDescription = new { type = "answer", sdp } }, _config.AppToken, ct);
        CheckErrors(result);
    }

    public async Task CloseAsync(string? sessionId, IReadOnlyList<string> mids)
    {
        if (sessionId is null) return;
        try
        {
            await SendAsync(HttpMethod.Put, $"{AppUrl}/sessions/{Uri.EscapeDataString(sessionId)}/tracks/close",
                new { tracks = mids.Select(mid => new { mid }), force = true }, _config.AppToken, CancellationToken.None);
        }
        catch (Exception)
        {
            // Track closure is best-effort. Never log response bodies, tokens or SDP.
        }
    }

    public async Task<IReadOnlyList<IceServer>> IceServersAsync(CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_config.TurnKeyId) || string.IsNullOrWhiteSpace(_config.TurnKeyApiToken))
            return [new IceServer("stun:stun.cloudflare.com:3478")];
        await _iceLock.WaitAsync(ct);
        try
        {
            if (_iceServers is not null && time.GetUtcNow() < _iceExpires) return _iceServers;
            var result = await SendAsync(HttpMethod.Post,
                $"{_config.BaseUrl.TrimEnd('/')}/turn/keys/{Uri.EscapeDataString(_config.TurnKeyId)}/credentials/generate-ice-servers",
                new { ttl = 21600 }, _config.TurnKeyApiToken, ct);
            CheckErrors(result);
            if (!result.TryGetProperty("iceServers", out var servers) || servers.ValueKind != JsonValueKind.Array)
                throw new SfuException();
            var filtered = new List<IceServer>();
            foreach (var server in servers.EnumerateArray())
            {
                if (server.ValueKind != JsonValueKind.Object || !server.TryGetProperty("urls", out var raw)) throw new SfuException();
                var urls = raw.ValueKind == JsonValueKind.String ? new[] { raw.GetString()! }
                    : raw.ValueKind == JsonValueKind.Array ? raw.EnumerateArray().Select(u => u.ValueKind == JsonValueKind.String ? u.GetString()! : throw new SfuException()).ToArray()
                    : throw new SfuException();
                urls = urls.Where(u => !string.IsNullOrWhiteSpace(u) && !u.Contains(":53", StringComparison.Ordinal)).ToArray();
                if (urls.Length > 0) filtered.Add(new IceServer(raw.ValueKind == JsonValueKind.String ? urls[0] : urls,
                    String(server, "username"), String(server, "credential")));
            }
            _iceServers = filtered;
            _iceExpires = time.GetUtcNow().AddHours(1);
            return _iceServers;
        }
        finally { _iceLock.Release(); }
    }

    private async Task<JsonElement> SendAsync(HttpMethod method, string url, object? body, string token, CancellationToken ct)
    {
        try
        {
            using var client = clients.CreateClient(HttpClientName);
            using var request = new HttpRequestMessage(method, url) { Content = body is null ? null : JsonContent.Create(body) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode) throw new SfuException();
            var result = await response.Content.ReadFromJsonAsync<JsonElement>(ct);
            if (result.ValueKind != JsonValueKind.Object) throw new SfuException();
            return result;
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException || ex is OperationCanceledException && !ct.IsCancellationRequested)
        {
            throw new SfuException();
        }
    }

    private static string? String(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;

    private static void CheckErrors(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.Name == "errorCode") throw new SfuException();
                CheckErrors(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var child in element.EnumerateArray()) CheckErrors(child);
    }

    public void Dispose() => _iceLock.Dispose();
}
