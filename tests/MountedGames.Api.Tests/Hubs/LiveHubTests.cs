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
    public async Task AdminOnlyChat_ReachesAdminsAndTheAuthor_NotThePublic()
    {
        var adminAuth = await _f.LoginAsync(TestClients.AdminEmail, TestClients.AdminPassword);
        var trainerAuth = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        await using var admin = await ConnectAsync(adminAuth.Token);
        await using var author = await ConnectAsync(trainerAuth.Token);
        await using var publicViewer = await ConnectAsync();
        foreach (var c in new[] { admin, author, publicViewer }) await c.InvokeAsync("JoinCompetition", 12);
        var adminGot = Next<System.Text.Json.JsonElement>(admin, "chatMessage");
        var authorGot = Next<System.Text.Json.JsonElement>(author, "chatMessage");
        var leaked = false;
        publicViewer.On<System.Text.Json.JsonElement>("chatMessage", _ => leaked = true);

        await Broadcaster.AdminOnlyChatMessage(12, trainerAuth.User.Id, new { text = "psst" });

        Assert.Equal("psst", (await adminGot).GetProperty("text").GetString());
        Assert.Equal("psst", (await authorGot).GetProperty("text").GetString());
        // A public broadcast sent afterwards proves the public client was listening and saw nothing before it.
        var publicGot = Next<System.Text.Json.JsonElement>(publicViewer, "announcement");
        await Broadcaster.Announcement(12, new { text = "after" });
        await publicGot;
        Assert.False(leaked);
    }

    [Fact]
    public async Task LeaveCompetition_StopsAdminOnlyDelivery()
    {
        var adminAuth = await _f.LoginAsync(TestClients.AdminEmail, TestClients.AdminPassword);
        await using var left = await ConnectAsync(adminAuth.Token);
        await using var witness = await ConnectAsync(adminAuth.Token);
        await left.InvokeAsync("JoinCompetition", 13);
        await witness.InvokeAsync("JoinCompetition", 13);
        await left.InvokeAsync("LeaveCompetition", 13);
        var got = false;
        left.On<System.Text.Json.JsonElement>("chatMessage", _ => got = true);
        var witnessGot = Next<System.Text.Json.JsonElement>(witness, "chatMessage");

        await Broadcaster.AdminOnlyChatMessage(13, null, new { text = "x" });
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
