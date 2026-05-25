using Microsoft.AspNetCore.SignalR;

namespace MountedGames.Api.Hubs;

public class LiveHub : Hub
{
    public Task JoinCompetition(int competitionId)
        => Groups.AddToGroupAsync(Context.ConnectionId, GroupName(competitionId));

    public Task LeaveCompetition(int competitionId)
        => Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(competitionId));

    public static string GroupName(int competitionId) => $"comp:{competitionId}";
}

public interface ILiveBroadcaster
{
    Task ChatMessage(int competitionId, object message);
    Task ChatMessageDeleted(int competitionId, int messageId);
    Task SessionUpdated(int competitionId, object session);
    Task ResultsUpdated(int competitionId, object payload);
    Task Announcement(int competitionId, object announcement);
    Task StewardCallCreated(int competitionId, object call);
    Task StewardCallResolved(int competitionId, int callId);
}

public class LiveBroadcaster : ILiveBroadcaster
{
    private readonly IHubContext<LiveHub> _hub;
    public LiveBroadcaster(IHubContext<LiveHub> hub) => _hub = hub;

    public Task ChatMessage(int competitionId, object message)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("chatMessage", message);

    public Task ChatMessageDeleted(int competitionId, int messageId)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("chatMessageDeleted", new { id = messageId });

    public Task SessionUpdated(int competitionId, object session)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("sessionUpdated", session);

    public Task ResultsUpdated(int competitionId, object payload)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("resultsUpdated", payload);

    public Task Announcement(int competitionId, object announcement)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("announcement", announcement);

    public Task StewardCallCreated(int competitionId, object call)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("stewardCall", call);

    public Task StewardCallResolved(int competitionId, int callId)
        => _hub.Clients.Group(LiveHub.GroupName(competitionId)).SendAsync("stewardCallResolved", new { id = callId });
}
