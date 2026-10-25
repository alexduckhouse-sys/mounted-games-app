using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;

namespace MountedGames.Api.Services.Streaming;

/// <summary>One API instance owns reservations, viewer signalling and trailing count notifications.</summary>
public sealed class ViewerRegistry : IDisposable
{
    private sealed class Connection
    {
        public Queue<DateTimeOffset> Calls { get; } = new();
        public Dictionary<int, Watch> Streams { get; } = new();
        /// <summary>The caller's address when it was capped by IP (anonymous viewers); null otherwise.</summary>
        public string? Ip { get; set; }
    }

    private sealed class Watch(string connectionId, int competitionId, int streamId)
    {
        public string Id { get; } = Guid.NewGuid().ToString();
        public string ConnectionId { get; } = connectionId;
        public int CompetitionId { get; } = competitionId;
        public int StreamId { get; } = streamId;
        public DateTimeOffset Deadline { get; set; } = DateTimeOffset.MaxValue;
        public SfuSession? Session { get; set; }
        public bool Answered { get; set; }
        public bool Answering { get; set; }
        public SemaphoreSlim Operation { get; } = new(1, 1);
    }

    private sealed class CountChange(int competitionId, DateTimeOffset due)
    {
        public int CompetitionId { get; } = competitionId;
        public DateTimeOffset Due { get; set; } = due;
        public int Sent { get; set; }
        public bool Pending { get; set; } = true;
        /// <summary>When this instance last shared its count (only matters with Redis).</summary>
        public DateTimeOffset Reported { get; set; } = DateTimeOffset.MinValue;
    }

    private readonly object _gate = new();
    private readonly Dictionary<string, Connection> _connections = new();
    private readonly Dictionary<string, Watch> _watches = new();
    private readonly Dictionary<int, CountChange> _counts = new();
    private readonly IServiceScopeFactory _scopes;
    private readonly ISfuClient _sfu;
    private readonly ILiveBroadcaster _live;
    private readonly StreamingOptions _options;
    private readonly TimeProvider _time;
    private readonly ILogger<ViewerRegistry> _log;
    private readonly SharedViewerCounts _shared;
    private readonly ITimer _timer;
    private readonly SemaphoreSlim _tick = new(1, 1);
    private double _tokens = 40;
    private DateTimeOffset _refilled;

    public ViewerRegistry(IServiceScopeFactory scopes, ISfuClient sfu, ILiveBroadcaster live,
        IOptions<StreamingOptions> options, TimeProvider time, ILogger<ViewerRegistry> log, SharedViewerCounts shared)
    {
        _scopes = scopes; _sfu = sfu; _live = live; _options = options.Value; _time = time; _log = log; _shared = shared;
        _refilled = time.GetUtcNow();
        _timer = time.CreateTimer(_ => _ = TickSafelyAsync(), null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
    }

    public int Count(int streamId)
    {
        lock (_gate) return CountLocked(streamId);
    }

    /// <summary>Viewers across every API instance (this instance's own count without Redis).</summary>
    public Task<int> TotalAsync(int streamId) => _shared.TotalAsync(streamId, Count(streamId));

    private int CountLocked(int streamId) => _watches.Values.Count(w => w.StreamId == streamId && w.Answered);

    /// <param name="clientIp">
    /// The viewer's address for anonymous viewers, so one address can't hold a lot of the stream's capacity.
    /// Null means no per-address cap (signed-in viewers, or an address that isn't known).
    /// </param>
    public async Task<WatchStreamResponse> WatchAsync(string connectionId, int competitionId, int streamId,
        CancellationToken ct = default, string? clientIp = null, string? preferredRid = null)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stream = await db.LiveStreams.AsNoTracking().SingleOrDefaultAsync(s => s.Id == streamId && s.CompetitionId == competitionId
            && (s.Status == LiveStreamStatus.Live || s.Status == LiveStreamStatus.Paused) && s.Generation >= 1, ct);
        if (stream?.SfuSessionId is null) throw Error("STREAM_NOT_FOUND", "This stream is no longer available.");
        if (!_options.Enabled) throw Error("UPSTREAM_UNAVAILABLE", "Streaming is unavailable.");

        Watch watch;
        Watch? replaced;
        lock (_gate)
        {
            ct.ThrowIfCancellationRequested();
            var now = _time.GetUtcNow();
            if (!_connections.TryGetValue(connectionId, out var connection))
                _connections[connectionId] = connection = new Connection();
            while (connection.Calls.TryPeek(out var call) && now - call >= TimeSpan.FromMinutes(1)) connection.Calls.Dequeue();
            if (connection.Calls.Count >= 10) throw Error("RATE_LIMITED", "Please wait before watching again.");
            connection.Calls.Enqueue(now);
            _tokens = Math.Min(40, _tokens + Math.Max(0, (now - _refilled).TotalSeconds) * _options.ViewerSessionsPerSecond);
            _refilled = now;
            if (_tokens < 1) throw Error("RATE_LIMITED", "Please wait before watching again.");
            connection.Streams.TryGetValue(streamId, out replaced);
            if (clientIp is not null && _options.MaxViewersPerIp > 0)
            {
                connection.Ip = clientIp;
                var open = _connections.Values.Where(c => c.Ip == clientIp).Sum(c => c.Streams.Count) - (replaced is null ? 0 : 1);
                if (open >= _options.MaxViewersPerIp)
                    throw Error("RATE_LIMITED", "Too many streams are open from your connection. Close one and try again.");
            }
            if (_watches.Count - (replaced is null ? 0 : 1) >= _options.MaxViewerSessions)
                throw Error("STREAM_FULL", "The stream is full. Please try again shortly.");
            _tokens--;
            if (replaced is not null) RemoveLocked(replaced);
            watch = new Watch(connectionId, competitionId, streamId);
            _watches.Add(watch.Id, watch);
            connection.Streams[streamId] = watch;
        }
        using var setupTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(30), _time);
        using var setupCancellation = CancellationTokenSource.CreateLinkedTokenSource(ct, setupTimeout.Token);
        var setupToken = setupCancellation.Token;
        try
        {
            if (replaced is not null) await CloseAsync(replaced);
            var session = await _sfu.WatchAsync(stream.SfuSessionId, stream.HasAudio, stream.Simulcast, setupToken, preferredRid);
            bool active;
            lock (_gate)
            {
                active = _watches.ContainsKey(watch.Id);
                if (active) watch.Session = session;
            }
            if (!active)
            {
                await _sfu.CloseAsync(session.SessionId, session.Mids);
                throw Error("WATCH_EXPIRED", "Please reconnect to the stream.");
            }
            var ice = await _sfu.IceServersAsync(setupToken);
            // A publisher may have ended or republished while the SFU call was in flight.
            var stillLive = await db.LiveStreams.AnyAsync(s => s.Id == streamId && s.Generation == stream.Generation
                && (s.Status == LiveStreamStatus.Live || s.Status == LiveStreamStatus.Paused), setupToken);
            if (!stillLive) throw Error("STREAM_NOT_FOUND", "This stream has changed. Please reconnect.");
            lock (_gate)
            {
                if (!_watches.ContainsKey(watch.Id))
                    throw Error("WATCH_EXPIRED", "Please reconnect to the stream.");
                // The browser gets the full answer window after an offer is available.
                watch.Deadline = _time.GetUtcNow().AddSeconds(20);
            }
            return new WatchStreamResponse(watch.Id, session.Sdp, stream.Generation, ice);
        }
        catch (Exception ex)
        {
            lock (_gate) RemoveLocked(watch);
            await CloseAsync(watch);
            if (ex is SfuException || ex is OperationCanceledException && !ct.IsCancellationRequested)
                throw Error("UPSTREAM_UNAVAILABLE", "The stream could not connect. Please try again.");
            throw;
        }
    }

    public async Task AnswerAsync(string connectionId, string watchId, string sdp, CancellationToken ct = default)
    {
        if (!Guid.TryParse(watchId, out _)) throw Error("WATCH_EXPIRED", "Please reconnect to the stream.");
        if (string.IsNullOrWhiteSpace(sdp) || Encoding.UTF8.GetByteCount(sdp) > 20 * 1024)
            throw Error("INVALID_REQUEST", "The stream answer is invalid.");
        Watch watch;
        lock (_gate)
        {
            if (!_watches.TryGetValue(watchId, out var found) || found.ConnectionId != connectionId)
                throw Error("WATCH_EXPIRED", "Please reconnect to the stream.");
            watch = found;
        }
        await watch.Operation.WaitAsync(ct);
        try
        {
            lock (_gate)
            {
                if (!_watches.ContainsKey(watch.Id) || (!watch.Answered && _time.GetUtcNow() >= watch.Deadline))
                    throw Error("WATCH_EXPIRED", "Please reconnect to the stream.");
                if (watch.Answered) return;
                watch.Answering = true;
            }
            if (watch.Session is null) throw Error("INVALID_REQUEST", "The stream offer is not ready.");
            await _sfu.AnswerAsync(watch.Session.SessionId, sdp, ct);
            lock (_gate)
            {
                if (!_watches.ContainsKey(watch.Id))
                    throw Error("WATCH_EXPIRED", "Please reconnect to the stream.");
                watch.Answered = true;
                ChangedLocked(watch);
            }
        }
        catch (Exception ex)
        {
            lock (_gate) RemoveLocked(watch);
            if (watch.Session is not null) await _sfu.CloseAsync(watch.Session.SessionId, watch.Session.Mids);
            if (ex is SfuException) throw Error("UPSTREAM_UNAVAILABLE", "The stream could not connect. Please try again.");
            throw;
        }
        finally { watch.Operation.Release(); }
    }

    public Task StopAsync(string connectionId, int streamId) => RemoveWhereAsync(w => w.ConnectionId == connectionId && w.StreamId == streamId);

    public async Task DisconnectAsync(string connectionId)
    {
        await RemoveWhereAsync(w => w.ConnectionId == connectionId);
        lock (_gate) _connections.Remove(connectionId);
    }

    public Task EndStreamAsync(int streamId) => RemoveWhereAsync(w => w.StreamId == streamId);

    private async Task RemoveWhereAsync(Func<Watch, bool> predicate)
    {
        Watch[] removed;
        lock (_gate)
        {
            removed = _watches.Values.Where(predicate).ToArray();
            foreach (var watch in removed) RemoveLocked(watch);
        }
        await Task.WhenAll(removed.Select(CloseAsync));
    }

    private void RemoveLocked(Watch watch)
    {
        if (!_watches.Remove(watch.Id)) return;
        if (_connections.TryGetValue(watch.ConnectionId, out var connection)) connection.Streams.Remove(watch.StreamId);
        if (watch.Answered) ChangedLocked(watch);
    }

    private void ChangedLocked(Watch watch)
    {
        if (!_counts.TryGetValue(watch.StreamId, out var change))
            _counts[watch.StreamId] = new CountChange(watch.CompetitionId, _time.GetUtcNow().AddSeconds(5));
        else if (!change.Pending)
        {
            change.Pending = true;
            change.Due = _time.GetUtcNow().AddSeconds(5);
        }
    }

    private async Task CloseAsync(Watch watch)
    {
        await watch.Operation.WaitAsync();
        try
        {
            if (watch.Session is not null) await _sfu.CloseAsync(watch.Session.SessionId, watch.Session.Mids);
        }
        finally { watch.Operation.Release(); }
    }

    public async Task TickAsync()
    {
        await _tick.WaitAsync();
        try
        {
            await RemoveWhereAsync(w => !w.Answered && !w.Answering && _time.GetUtcNow() >= w.Deadline);
            List<(CountChange Change, int StreamId, int Local)> due = new();
            var now = _time.GetUtcNow();
            var shared = _shared.Shared;
            lock (_gate)
            {
                foreach (var (streamId, change) in _counts.ToArray())
                {
                    var local = CountLocked(streamId);
                    var changed = change.Pending && now >= change.Due;
                    // With Redis, an unchanged count is re-shared now and then so other instances keep counting it.
                    var refresh = shared && local > 0 && now - change.Reported >= SharedViewerCounts.Refresh;
                    if (!changed && !refresh) continue;
                    change.Pending = false;
                    change.Reported = now;
                    if (local == 0) _counts.Remove(streamId);
                    due.Add((change, streamId, local));
                }
            }
            foreach (var (change, streamId, local) in due)
            {
                var total = await _shared.ReportAsync(streamId, local);
                if (total == change.Sent) continue;
                change.Sent = total;
                await _live.StreamViewers(change.CompetitionId, streamId, total);
            }
        }
        finally { _tick.Release(); }
    }

    private async Task TickSafelyAsync()
    {
        try { await TickAsync(); }
        catch (Exception) { _log.LogWarning("Viewer cleanup could not complete."); }
    }

    private static HubException Error(string code, string message) => new($"{code}: {message}");
    public void Dispose() => _timer.Dispose();
}
