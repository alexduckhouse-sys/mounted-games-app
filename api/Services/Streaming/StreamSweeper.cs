using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Streaming;

public sealed class StreamSweeper(IServiceScopeFactory scopes, CompetitionStreamLocks locks, ISfuClient sfu,
    IOptions<StreamingOptions> options, TimeProvider time, ILogger<StreamSweeper> log) : BackgroundService
{
    private readonly DateTime _started = time.GetUtcNow().UtcDateTime;
    private readonly StreamingOptions _options = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30), time);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try { await SweepAsync(time.GetUtcNow().UtcDateTime, stoppingToken); }
                catch (Exception) when (!stoppingToken.IsCancellationRequested) { log.LogWarning("Stream sweep could not complete."); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    public async Task SweepAsync(DateTime now, CancellationToken ct = default)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<StreamLifecycle>();
        var competitions = await db.LiveStreams.Where(s => s.Status != LiveStreamStatus.Ended)
            .Select(s => s.CompetitionId).Distinct().ToListAsync(ct);
        foreach (var competitionId in competitions)
        {
            using var lease = await locks.AcquireAsync(competitionId, ct);
            var streams = await db.LiveStreams.Where(s => s.CompetitionId == competitionId && s.Status != LiveStreamStatus.Ended).ToListAsync(ct);
            foreach (var stream in streams)
            {
                if (stream.Status is LiveStreamStatus.Live or LiveStreamStatus.Paused
                    && ((now - _started >= TimeSpan.FromSeconds(_options.HeartbeatTimeoutSeconds)
                        && now - stream.LastHeartbeatAt > TimeSpan.FromSeconds(_options.HeartbeatTimeoutSeconds))
                        || (_options.MaxStreamDurationMinutes > 0
                            && now - stream.StartedAt > TimeSpan.FromMinutes(_options.MaxStreamDurationMinutes))))
                {
                    await lifecycle.EndAsync(stream, ct);
                    continue;
                }
                if (stream.PendingSince is null || now - stream.PendingSince < TimeSpan.FromSeconds(_options.PendingAttemptSeconds)) continue;
                var sid = stream.PendingSfuSessionId;
                var mids = StreamLifecycle.Mids(stream.PendingTrackMids);
                if (stream.Status == LiveStreamStatus.Starting)
                {
                    // A newer pending takeover may still depend on this row's predecessor.
                    foreach (var successor in streams.Where(s => s.TakeOverStreamId == stream.Id))
                        successor.TakeOverStreamId = stream.TakeOverStreamId;
                    db.LiveStreams.Remove(stream);
                }
                else StreamLifecycle.ClearPending(stream);
                await db.SaveChangesAsync(ct);
                await sfu.CloseAsync(sid, mids);
            }
            db.ChangeTracker.Clear();
        }
    }
}
