using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Hubs;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Hubs;

public class LiveHubTests : IClassFixture<ApiFactory>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);
    private readonly ApiFactory _f;
    public LiveHubTests(ApiFactory f) => _f = f;

    private async Task<HubConnection> ConnectAsync(string? token = null)
    {
        _f.CreateClient(); // starts the in-memory server
        var conn = new HubConnectionBuilder()
            .WithUrl(new Uri(_f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _f.Server.CreateHandler();
                o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
                if (token is not null) o.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();
        await conn.StartAsync();
        return conn;
    }

    private static Task<T> Next<T>(HubConnection conn, string method)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        conn.On<T>(method, tcs.SetResult);
        return tcs.Task.WaitAsync(Timeout);
    }

    private ILiveBroadcaster Broadcaster => _f.Services.GetRequiredService<ILiveBroadcaster>();

    [Fact]
    public void GroupName_IsPerCompetition()
    {
        Assert.Equal("comp:7", LiveHub.GroupName(7));
    }

    [Fact]
    public async Task Broadcasts_ReachOnlyClientsWhoJoinedThatCompetition()
    {
        await using var inComp = await ConnectAsync();
        await using var elsewhere = await ConnectAsync();
        await inComp.InvokeAsync("JoinCompetition", 5);
        await elsewhere.InvokeAsync("JoinCompetition", 6);
        var received = Next<System.Text.Json.JsonElement>(inComp, "chatMessage");
        var leaked = false;
        elsewhere.On<System.Text.Json.JsonElement>("chatMessage", _ => leaked = true);

        await Broadcaster.ChatMessage(5, new { text = "hello" });

        Assert.Equal(("hello", false), ((await received).GetProperty("text").GetString(), leaked));
    }

    [Fact]
    public async Task LeaveCompetition_StopsDelivery()
    {
        await using var conn = await ConnectAsync();
        await conn.InvokeAsync("JoinCompetition", 8);
        await conn.InvokeAsync("LeaveCompetition", 8);
        var got = false;
        conn.On<System.Text.Json.JsonElement>("announcement", _ => got = true);
        // A second, still-joined client proves the broadcast went out before we assert.
        await using var witness = await ConnectAsync();
        await witness.InvokeAsync("JoinCompetition", 8);
        var witnessGot = Next<System.Text.Json.JsonElement>(witness, "announcement");

        await Broadcaster.Announcement(8, new { text = "x" });
        await witnessGot;

        Assert.False(got);
    }

    [Fact]
    public async Task Connection_AcceptsJwtFromAccessTokenQuery()
    {
        var auth = await _f.LoginAsync(TestClients.AdminEmail, TestClients.AdminPassword);

        await using var conn = await ConnectAsync(auth.Token);

        Assert.Equal(HubConnectionState.Connected, conn.State);
    }

    [Fact]
    public async Task Every_BroadcastKind_ReachesTheGroup()
    {
        await using var conn = await ConnectAsync();
        await conn.InvokeAsync("JoinCompetition", 9);
        var chatDeleted = Next<System.Text.Json.JsonElement>(conn, "chatMessageDeleted");
        var session = Next<System.Text.Json.JsonElement>(conn, "sessionUpdated");
        var results = Next<System.Text.Json.JsonElement>(conn, "resultsUpdated");
        var announcement = Next<System.Text.Json.JsonElement>(conn, "announcement");

        await Broadcaster.ChatMessageDeleted(9, 11);
        await Broadcaster.SessionUpdated(9, new { id = 1 });
        await Broadcaster.ResultsUpdated(9, new { id = 2 });
        await Broadcaster.Announcement(9, new { id = 3 });

        Assert.Equal(
            new[] { 11, 1, 2, 3 },
            new[]
            {
                (await chatDeleted).GetProperty("id").GetInt32(),
                (await session).GetProperty("id").GetInt32(),
                (await results).GetProperty("id").GetInt32(),
                (await announcement).GetProperty("id").GetInt32(),
            });
    }
}
