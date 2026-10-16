using System.Text.Json;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;

namespace MountedGames.Api.Services.Streaming;

public sealed class StreamLifecycle(AppDbContext db, ISfuClient sfu, ViewerRegistry viewers, ILiveBroadcaster live, TimeProvider time)
{
    public sealed record Closure(LiveStream Stream, string? SessionId, string Mids, string? PendingSessionId, string PendingMids);

    public async Task EndAsync(LiveStream stream, CancellationToken ct = default)
    {
        var closure = MarkEnded(stream);
        if (closure is null) return;
        await db.SaveChangesAsync(ct);
        await CompleteEndAsync(closure);
    }

    public Closure? MarkEnded(LiveStream stream)
    {
        if (stream.Status == LiveStreamStatus.Ended) return null;
        var closure = new Closure(stream, stream.SfuSessionId, stream.SfuTrackMids, stream.PendingSfuSessionId, stream.PendingTrackMids);
        stream.Status = LiveStreamStatus.Ended;
        stream.EndedAt = time.GetUtcNow().UtcDateTime;
        stream.SfuSessionId = null;
        stream.SfuTrackMids = "[]";
        ClearPending(stream);
        return closure;
    }

    public async Task CompleteEndAsync(Closure closure)
    {
        var stream = closure.Stream;
        await sfu.CloseAsync(closure.SessionId, Mids(closure.Mids));
        await sfu.CloseAsync(closure.PendingSessionId, Mids(closure.PendingMids));
        await viewers.EndStreamAsync(stream.Id);
        if (stream.Generation >= 1) await live.StreamUpdated(stream.CompetitionId, stream.ToDto(0));
    }

    public static IReadOnlyList<string> Mids(string json) => JsonSerializer.Deserialize<string[]>(json) ?? [];

    public static void ClearPending(LiveStream stream)
    {
        stream.PendingSfuSessionId = null;
        stream.PendingAttempt = null;
        stream.PendingSince = null;
        stream.PendingHasAudio = false;
        stream.PendingSimulcast = false;
        stream.PendingTrackMids = "[]";
    }
}
