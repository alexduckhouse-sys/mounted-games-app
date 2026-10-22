using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Streaming;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{competitionId:int}/streams")]
public sealed class StreamsController(AppDbContext db, ISfuClient sfu, IOptions<StreamingOptions> options,
    CompetitionStreamLocks locks, ViewerRegistry viewers, StreamLifecycle lifecycle, ILiveBroadcaster live, TimeProvider time) : ControllerBase
{
    private readonly StreamingOptions _options = options.Value;
    private DateTime Now => time.GetUtcNow().UtcDateTime;

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<LiveStreamsResponse>> List(int competitionId, CancellationToken ct)
    {
        if (!_options.Enabled) return new LiveStreamsResponse(false, []);
        var streams = await db.LiveStreams.AsNoTracking().Where(s => s.CompetitionId == competitionId && s.Generation >= 1
            && (s.Status == LiveStreamStatus.Live || s.Status == LiveStreamStatus.Paused))
            .OrderBy(s => s.ArenaName).ThenBy(s => s.AngleName).ToListAsync(ct);
        var dtos = new List<LiveStreamDto>(streams.Count);
        foreach (var stream in streams) dtos.Add(stream.ToDto(await viewers.TotalAsync(stream.Id)));
        return new LiveStreamsResponse(true, dtos.ToArray());
    }

    [HttpGet("ice-servers")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IceServersResponse>> IceServers(int competitionId, CancellationToken ct)
    {
        if (!_options.Enabled) return Disabled();
        try { return new IceServersResponse(await sfu.IceServersAsync(ct)); }
        catch (SfuException) { return Upstream(); }
    }

    [HttpPost]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<PublishResponse>> Start(int competitionId, StartStreamRequest request, CancellationToken ct)
    {
        if (!_options.Enabled) return Disabled();
        ValidateName(nameof(request.ArenaName), request.ArenaName, 80);
        ValidateName(nameof(request.AngleName), request.AngleName, 60);
        ValidateOffer(request);
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        using var lease = await locks.AcquireAsync(competitionId, ct);
        var arena = request.ArenaName.Trim();
        var angle = request.AngleName.Trim();
        var active = db.LiveStreams.Where(s => s.CompetitionId == competitionId && s.Status != LiveStreamStatus.Ended);
        var arenaKey = arena.ToLower();
        var angleKey = angle.ToLower();
        var duplicate = await active.Where(s => s.ArenaName.ToLower() == arenaKey && s.AngleName.ToLower() == angleKey)
            .OrderByDescending(s => s.Id).FirstOrDefaultAsync(ct);
        if (duplicate is not null && !request.TakeOver) return ConflictProblem("This arena and angle are already broadcasting.");
        if (await active.CountAsync(ct) >= _options.MaxLivePerCompetition) return ConflictProblem("This competition has reached its stream limit.");
        SfuSession session;
        try { session = await sfu.PublishAsync(request, ct); }
        catch (SfuException) { return Upstream(); }
        var stream = new LiveStream
        {
            CompetitionId = competitionId, ArenaName = arena, AngleName = angle,
            StartedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "",
            StartedAt = Now, LastHeartbeatAt = Now, TakeOverStreamId = duplicate?.Id
        };
        SetPending(stream, session, request, 1);
        try
        {
            db.LiveStreams.Add(stream);
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            await sfu.CloseAsync(session.SessionId, session.Mids);
            throw;
        }
        return StatusCode(201, new PublishResponse(stream.Id, 1, session.Sdp));
    }

    [HttpPost("{streamId:int}/ready")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<LiveStreamDto>> Ready(int competitionId, int streamId, ReadyRequest request, CancellationToken ct)
    {
        if (!_options.Enabled) return Disabled();
        using var lease = await locks.AcquireAsync(competitionId, ct);
        var stream = await FindAsync(competitionId, streamId, ct);
        if (stream is null) return NotFound();
        if (stream.Status == LiveStreamStatus.Ended || stream.PendingAttempt != request.Attempt
            || stream.PendingSfuSessionId is null || stream.PendingSince is null
            || Now - stream.PendingSince.Value >= TimeSpan.FromSeconds(_options.PendingAttemptSeconds))
            return ConflictProblem("This publish attempt has expired or been replaced.");
        var oldSid = stream.SfuSessionId;
        var oldMids = stream.SfuTrackMids;
        stream.SfuSessionId = stream.PendingSfuSessionId;
        stream.SfuTrackMids = stream.PendingTrackMids;
        stream.HasAudio = stream.PendingHasAudio;
        stream.Simulcast = stream.PendingSimulcast;
        stream.Generation = request.Attempt;
        stream.LastHeartbeatAt = Now;
        StreamLifecycle.ClearPending(stream);
        if (stream.Status == LiveStreamStatus.Starting) stream.Status = LiveStreamStatus.Live;
        // Following a pending takeover chain also prevents two ready requests leaving duplicate live angles.
        var closures = new List<StreamLifecycle.Closure>();
        var takeover = stream.TakeOverStreamId;
        while (takeover is int previousId)
        {
            var previous = await FindAsync(competitionId, previousId, ct);
            if (previous is null) break;
            takeover = previous.TakeOverStreamId;
            var closure = lifecycle.MarkEnded(previous);
            if (closure is not null) closures.Add(closure);
        }
        // Promotion and takeover commit together; cancellation cannot leave two visible publishers.
        await db.SaveChangesAsync(ct);
        await sfu.CloseAsync(oldSid, StreamLifecycle.Mids(oldMids));
        foreach (var closure in closures) await lifecycle.CompleteEndAsync(closure);
        var dto = stream.ToDto(await viewers.TotalAsync(stream.Id));
        await live.StreamUpdated(competitionId, dto);
        return dto;
    }

    [HttpPost("{streamId:int}/republish")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<PublishResponse>> Republish(int competitionId, int streamId, PublishRequest request, CancellationToken ct)
    {
        if (!_options.Enabled) return Disabled();
        ValidateOffer(request);
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        using var lease = await locks.AcquireAsync(competitionId, ct);
        var stream = await FindAsync(competitionId, streamId, ct);
        if (stream is null) return NotFound();
        if (stream.Status == LiveStreamStatus.Ended) return ConflictProblem("This stream has ended.");
        SfuSession session;
        try { session = await sfu.PublishAsync(request, ct); }
        catch (SfuException) { return Upstream(); }
        var oldPending = stream.PendingSfuSessionId;
        var oldMids = stream.PendingTrackMids;
        var attempt = Math.Max(stream.Generation, stream.PendingAttempt ?? 0) + 1;
        SetPending(stream, session, request, attempt);
        try { await db.SaveChangesAsync(ct); }
        catch
        {
            await sfu.CloseAsync(session.SessionId, session.Mids);
            throw;
        }
        await sfu.CloseAsync(oldPending, StreamLifecycle.Mids(oldMids));
        return new PublishResponse(stream.Id, attempt, session.Sdp);
    }

    [HttpPatch("{streamId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<LiveStreamDto>> Update(int competitionId, int streamId, UpdateStreamRequest request, CancellationToken ct)
    {
        if (!_options.Enabled) return Disabled();
        if (request.Status is not null and not (LiveStreamStatus.Live or LiveStreamStatus.Paused))
            ModelState.AddModelError(nameof(request.Status), "Choose live or paused.");
        if (request.Caption.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null or JsonValueKind.String)
            || request.Caption.ValueKind == JsonValueKind.String && request.Caption.GetString()!.Trim().Length > 80)
            ModelState.AddModelError(nameof(request.Caption), "Use a caption of at most 80 characters.");
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        using var lease = await locks.AcquireAsync(competitionId, ct);
        var stream = await FindAsync(competitionId, streamId, ct);
        if (stream is null) return NotFound();
        if (stream.Status is LiveStreamStatus.Ended or LiveStreamStatus.Starting) return ConflictProblem("This stream is not live.");
        if (request.Status.HasValue) stream.Status = request.Status.Value;
        if (request.AudioMuted.HasValue) stream.AudioMuted = request.AudioMuted.Value;
        if (request.Caption.ValueKind != JsonValueKind.Undefined)
        {
            var caption = request.Caption.ValueKind == JsonValueKind.Null ? null : request.Caption.GetString()?.Trim();
            stream.Caption = string.IsNullOrEmpty(caption) ? null : caption;
        }
        await db.SaveChangesAsync(ct);
        var dto = stream.ToDto(await viewers.TotalAsync(streamId));
        await live.StreamUpdated(competitionId, dto);
        return dto;
    }

    [HttpPost("{streamId:int}/heartbeat")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IActionResult> Heartbeat(int competitionId, int streamId, CancellationToken ct)
    {
        if (!_options.Enabled) return Disabled();
        using var lease = await locks.AcquireAsync(competitionId, ct);
        var stream = await FindAsync(competitionId, streamId, ct);
        if (stream is null) return NotFound();
        if (stream.Status == LiveStreamStatus.Ended) return ConflictProblem("This stream has ended.");
        stream.LastHeartbeatAt = Now;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("{streamId:int}/end")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IActionResult> End(int competitionId, int streamId, CancellationToken ct)
    {
        if (!_options.Enabled) return Disabled();
        using var lease = await locks.AcquireAsync(competitionId, ct);
        var stream = await FindAsync(competitionId, streamId, ct);
        if (stream is null) return NotFound();
        await lifecycle.EndAsync(stream, ct);
        return NoContent();
    }

    private Task<LiveStream?> FindAsync(int competitionId, int streamId, CancellationToken ct) =>
        db.LiveStreams.SingleOrDefaultAsync(s => s.CompetitionId == competitionId && s.Id == streamId, ct);

    private ObjectResult Disabled() => Problem(statusCode: 503, title: "Streaming is not configured.");
    private ObjectResult Upstream() => Problem(statusCode: 502, title: "The streaming service is unavailable.");
    private ObjectResult ConflictProblem(string message) => Problem(statusCode: 409, title: message);

    private void ValidateName(string key, string? name, int maximum)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > maximum)
            ModelState.AddModelError(key, $"Use a name between 1 and {maximum} characters.");
    }

    private void ValidateOffer(PublishRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.SdpOffer) || Encoding.UTF8.GetByteCount(request.SdpOffer) > 20 * 1024)
            ModelState.AddModelError(nameof(request.SdpOffer), "Supply an offer of at most 20 KB.");
        if (string.IsNullOrWhiteSpace(request.VideoMid))
            ModelState.AddModelError(nameof(request.VideoMid), "A video mid is required.");
    }

    private void SetPending(LiveStream stream, SfuSession session, PublishRequest request, int attempt)
    {
        stream.PendingSfuSessionId = session.SessionId;
        stream.PendingTrackMids = JsonSerializer.Serialize(session.Mids);
        stream.PendingAttempt = attempt;
        stream.PendingHasAudio = !string.IsNullOrWhiteSpace(request.AudioMid);
        stream.PendingSimulcast = HasVideoSimulcast(request.SdpOffer);
        stream.PendingSince = Now;
    }

    internal static bool HasVideoSimulcast(string sdp)
    {
        var video = false;
        foreach (var line in sdp.Split('\n', StringSplitOptions.TrimEntries))
        {
            if (line.StartsWith("m=", StringComparison.Ordinal)) video = line.StartsWith("m=video ", StringComparison.Ordinal);
            if (video && line.StartsWith("a=simulcast:send ", StringComparison.Ordinal)) return true;
        }
        return false;
    }
}
