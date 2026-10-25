using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using Microsoft.AspNetCore.SignalR;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services.Streaming;

namespace MountedGames.Api.Hubs;

public class LiveHub(ViewerRegistry viewers) : Hub
{
    public Task<WatchStreamResponse> WatchStream(int competitionId, int streamId) =>
        viewers.WatchAsync(Context.ConnectionId, competitionId, streamId, Context.ConnectionAborted, AnonymousViewerIp());

    public Task<WatchStreamResponse> WatchStreamTier(int competitionId, int streamId, string? preferredRid) =>
        viewers.WatchAsync(Context.ConnectionId, competitionId, streamId, Context.ConnectionAborted, AnonymousViewerIp(), preferredRid);

    // Signed-in viewers are accountable already; anonymous ones are capped per address.
    private string? AnonymousViewerIp() =>
        Context.User?.Identity?.IsAuthenticated == true ? null : Context.GetHttpContext()?.Connection.RemoteIpAddress?.ToString();

    public Task AnswerStream(string watchId, string sdpAnswer) =>
        viewers.AnswerAsync(Context.ConnectionId, watchId, sdpAnswer, Context.ConnectionAborted);

    public Task StopWatching(int streamId) => viewers.StopAsync(Context.ConnectionId, streamId);

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await viewers.DisconnectAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinCompetition(int competitionId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(competitionId));
        // Membership records the subscription, not a role that could be revoked while the socket stays open.
        if (Context.User?.Identity?.IsAuthenticated == true && Context.UserIdentifier is { } userId)
            await Groups.AddToGroupAsync(Context.ConnectionId, UserGroupName(competitionId, userId));
    }

    public async Task LeaveCompetition(int competitionId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(competitionId));
        if (Context.UserIdentifier is { } userId)
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, UserGroupName(competitionId, userId));
    }

    public static string GroupName(int competitionId) => $"comp:{competitionId}";
    public static string UserGroupName(int competitionId, string userId) => $"comp:{competitionId}:user:{userId}";
}

public interface ILiveBroadcaster
{
    Task ChatMessage(int competitionId, object message);
    /// <summary>Sends an admin-only message to the competition's admins and to its author.</summary>
    Task AdminOnlyChatMessage(int competitionId, string? authorUserId, object message, string? recipientUserId = null);
    Task ChatMessageDeleted(int competitionId, int messageId);
    Task SessionUpdated(int competitionId, object session);
    Task ResultsUpdated(int competitionId, object payload);
    Task Announcement(int competitionId, object announcement);
    Task StreamUpdated(int competitionId, LiveStreamDto stream);
    Task StreamViewers(int competitionId, int streamId, int count);
    Task OverlayUpdated(int competitionId, StreamOverlayDto overlay);
    Task ScoreCardControl(int competitionId, ScoreCardControlDto control);
    Task SponsorControl(int competitionId, SponsorControlDto control);
    Task StreamTelemetry(int competitionId, StreamTelemetryDto telemetry);
    Task StreamCommand(int competitionId, StreamCommandDto command);
}

public class LiveBroadcaster : ILiveBroadcaster
{
    public Task StreamUpdated(int competitionId, LiveStreamDto stream)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("streamUpdated", stream);

    public Task StreamViewers(int competitionId, int streamId, int count)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("streamViewers", new { streamId, count });

    public Task OverlayUpdated(int competitionId, StreamOverlayDto overlay)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("overlayUpdated", overlay);

    public Task ScoreCardControl(int competitionId, ScoreCardControlDto control)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("scoreCardControl", control);

    public Task SponsorControl(int competitionId, SponsorControlDto control)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("sponsorControl", control);

    public Task StreamTelemetry(int competitionId, StreamTelemetryDto telemetry)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("streamTelemetry", telemetry);

    public Task StreamCommand(int competitionId, StreamCommandDto command)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("streamCommand", command);

    private readonly IHubContext<LiveHub> _hub;
    private readonly IServiceScopeFactory _scopes;
    public LiveBroadcaster(IHubContext<LiveHub> hub, IServiceScopeFactory scopes)
    {
        _hub = hub;
        _scopes = scopes;
    }

    public Task ChatMessage(int competitionId, object message)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("chatMessage", message);

    public async Task AdminOnlyChatMessage(int competitionId, string? authorUserId, object message, string? recipientUserId = null)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var adminIds = await (from membership in db.UserRoles
                              join role in db.Roles on membership.RoleId equals role.Id
                              where role.Name == Roles.Admin
                              select membership.UserId).Distinct().ToListAsync();
        var groups = adminIds.Where(id => id != authorUserId && id != recipientUserId)
            .Select(id => LiveHub.UserGroupName(competitionId, id)).ToArray();
        if (groups.Length > 0)
            await _hub.Clients.Groups(groups).SendAsync("chatMessage", message);
        if (authorUserId is not null)
            await _hub.Clients.User(authorUserId).SendAsync("chatMessage", message);
        if (recipientUserId is not null && recipientUserId != authorUserId)
            await _hub.Clients.User(recipientUserId).SendAsync("chatMessage", message);
    }

    public Task ChatMessageDeleted(int competitionId, int messageId)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("chatMessageDeleted", new { id = messageId });

    public Task SessionUpdated(int competitionId, object session)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("sessionUpdated", session);

    public Task ResultsUpdated(int competitionId, object payload)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("resultsUpdated", payload);

    public Task Announcement(int competitionId, object announcement)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("announcement", announcement);
}
