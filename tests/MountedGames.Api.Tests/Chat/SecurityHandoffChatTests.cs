using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Chat;

public class SecurityHandoffChatTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private async Task<(HttpClient Owner, AuthResponse OwnerAuth, HttpClient Staff, AuthResponse StaffAuth, int Competition)> EventAsync()
    {
        var ownerAuth = await f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        var (staff, staffAuth) = await f.SignupAsync("Member");
        var competition = await f.SeedCompetitionAsync(ownerUserId: ownerAuth.User.Id);
        await f.InDbAsync(async db =>
        {
            db.CompetitionCollaborators.Add(new CompetitionCollaborator
            { CompetitionId = competition, UserId = staffAuth.User.Id, AddedByUserId = ownerAuth.User.Id });
            await db.SaveChangesAsync();
        });
        return (f.WithToken(ownerAuth.Token), ownerAuth, staff, staffAuth, competition);
    }

    [Fact]
    public async Task OwnersAndCollaboratorsCanReadReplyAnnouncePinAndModerateTheirOwnEvent()
    {
        var (owner, _, staff, _, competition) = await EventAsync();
        var (sender, senderAuth) = await f.SignupAsync("Member");
        var other = await f.SeedCompetitionAsync();
        var route = $"/api/competitions/{competition}/chat";
        var incoming = await (await sender.PostAsJsonAsync(route, new PostChatMessageRequest("Fake private question"))).ReadAsync<ChatMessageDto>();
        foreach (var manager in new[] { owner, staff })
        {
            var messages = await (await manager.GetAsync(route)).ReadAsync<List<ChatMessageDto>>();
            Assert.Contains(messages, m => m.Id == incoming.Id);
            var reply = await manager.PostAsJsonAsync(route, new PostChatMessageRequest("Fake private reply", senderAuth.User.Id));
            Assert.Equal(HttpStatusCode.OK, reply.StatusCode);
            Assert.True((await reply.ReadAsync<ChatMessageDto>()).AdminOnly);
            var announcement = await manager.PostAsJsonAsync(route + "/announcement", new AnnouncementRequest("Fake public update", null));
            Assert.Equal(HttpStatusCode.OK, announcement.StatusCode);
            var notice = await announcement.ReadAsync<ChatMessageDto>();
            Assert.Equal(HttpStatusCode.OK, (await manager.PostAsync(route + $"/{notice.Id}/pin", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await manager.DeleteAsync(route + $"/{notice.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await manager.PostAsJsonAsync($"/api/competitions/{other}/chat/announcement", new AnnouncementRequest("Fake foreign update", null))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await manager.PostAsJsonAsync(route + $"/{incoming.Id}/block-author", new { reason = "Fake reason" })).StatusCode);
        }
        (await sender.PostAsJsonAsync(route + $"/{incoming.Id}/report", new { reason = "Fake report" })).EnsureSuccessStatusCode();
        var reports = await (await staff.GetAsync(route + "/reports")).ReadAsync<List<ChatReportDto>>();
        var report = Assert.Single(reports);
        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync(route + $"/reports/{report.Id}/message")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await staff.PostAsync(route + $"/reports/{report.Id}/resolve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staff.GetAsync($"/api/competitions/{other}/chat/reports")).StatusCode);
        Assert.DoesNotContain(await (await f.CreateClient().GetAsync(route)).ReadAsync<List<ChatMessageDto>>(), m => m.AdminOnly);
        Assert.Equal(HttpStatusCode.NoContent, (await staff.DeleteAsync(route + $"/{incoming.Id}")).StatusCode);
    }

    [Fact]
    public async Task PinningReplacesLegacyBannerAndUnpinningLegacyBannerClearsIt()
    {
        var (_, _, staff, _, competition) = await EventAsync();
        var legacyId = await f.WithDbAsync(async db =>
        {
            var message = new ChatMessage { CompetitionId = competition, Body = "Fake legacy pin", AuthorName = "Fake staff", Type = ChatMessageType.Announcement, Tag = "banner" };
            db.ChatMessages.Add(message); await db.SaveChangesAsync(); return message.Id;
        });
        var route = $"/api/competitions/{competition}/chat";
        var unpinned = await (await staff.PostAsync(route + $"/{legacyId}/pin", null)).ReadAsync<ChatMessageDto>();
        Assert.Null(unpinned.Tag);
        await f.InDbAsync(db => db.ChatMessages.Where(m => m.Id == legacyId).ExecuteUpdateAsync(s => s.SetProperty(m => m.Tag, "banner")));
        var fresh = await (await staff.PostAsJsonAsync(route + "/announcement", new AnnouncementRequest("Fake new pin", "pinned"))).ReadAsync<ChatMessageDto>();
        Assert.Equal("pinned", fresh.Tag);
        Assert.Null(await f.WithDbAsync(db => db.ChatMessages.Where(m => m.Id == legacyId).Select(m => m.Tag).SingleAsync()));
    }

    private async Task<HubConnection> ConnectAsync(string token, string? ip = null)
    {
        var connection = new HubConnectionBuilder().WithUrl(new Uri(f.Server.BaseAddress, "/hubs/live"), options =>
        {
            options.HttpMessageHandlerFactory = _ => f.Server.CreateHandler();
            if (ip is not null) options.Headers.Add("X-Test-Ip", ip);
            options.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            options.AccessTokenProvider = () => Task.FromResult<string?>(token);
        }).Build();
        await connection.StartAsync();
        return connection;
    }

    [Fact]
    public async Task ANewManualNetworkBlockPreventsAnExistingConnectionJoiningAnEvent()
    {
        var (_, auth) = await f.SignupAsync("Member");
        var competition = await f.SeedCompetitionAsync();
        await using var connection = await ConnectAsync(auth.Token, "203.0.113.144");
        await f.InDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock { IpAddress = "203.0.113.144", Reason = "Fake manual block" });
            await db.SaveChangesAsync();
        });
        var error = await Assert.ThrowsAsync<HubException>(() => connection.InvokeAsync("JoinCompetition", competition));
        Assert.Contains("blocked", error.Message);
    }

    private static Task<JsonElement> Next(HubConnection connection, string method)
    {
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<JsonElement>(method, payload => completion.TrySetResult(payload));
        return completion.Task.WaitAsync(TimeSpan.FromSeconds(15));
    }

    [Fact]
    public async Task PrivateMessagesOnlyReachCurrentStaffAndParticipantsSubscribedToTheCorrectEvent()
    {
        var (_, ownerAuth, _, staffAuth, competition) = await EventAsync();
        var (_, participant) = await f.SignupAsync("Member");
        var (_, stranger) = await f.SignupAsync("Member");
        var other = await f.SeedCompetitionAsync();
        await using var owner = await ConnectAsync(ownerAuth.Token);
        await using var staff = await ConnectAsync(staffAuth.Token);
        await using var author = await ConnectAsync(participant.Token);
        await using var otherTab = await ConnectAsync(participant.Token);
        await using var outsider = await ConnectAsync(stranger.Token);
        foreach (var connection in new[] { owner, staff, author, outsider }) await connection.InvokeAsync("JoinCompetition", competition);
        await otherTab.InvokeAsync("JoinCompetition", other);
        var leaked = new ConcurrentQueue<JsonElement>();
        otherTab.On<JsonElement>("chatMessage", leaked.Enqueue);
        outsider.On<JsonElement>("chatMessage", leaked.Enqueue);
        var expected = new[] { Next(owner, "chatMessage"), Next(staff, "chatMessage"), Next(author, "chatMessage") };
        var broadcaster = f.Services.GetRequiredService<ILiveBroadcaster>();
        await broadcaster.AdminOnlyChatMessage(competition, participant.User.Id, new { text = "Fake private question" });
        foreach (var message in await Task.WhenAll(expected)) Assert.Equal("Fake private question", message.GetProperty("text").GetString());
        var outsiderMarker = Next(outsider, "announcement");
        var otherMarker = Next(otherTab, "announcement");
        await broadcaster.Announcement(competition, new { marker = true });
        await broadcaster.Announcement(other, new { marker = true });
        await Task.WhenAll(outsiderMarker, otherMarker);
        Assert.Empty(leaked);

        await f.InDbAsync(db => db.CompetitionCollaborators.Where(c => c.CompetitionId == competition && c.UserId == staffAuth.User.Id).ExecuteDeleteAsync());
        staff.On<JsonElement>("chatMessage", leaked.Enqueue);
        var authorReply = Next(author, "chatMessage");
        await broadcaster.AdminOnlyChatMessage(competition, ownerAuth.User.Id, new { text = "Fake private reply" }, participant.User.Id);
        await authorReply;
        var revokedMarker = Next(staff, "announcement");
        otherMarker = Next(otherTab, "announcement");
        await broadcaster.Announcement(competition, new { marker = true });
        await broadcaster.Announcement(other, new { marker = true });
        await Task.WhenAll(revokedMarker, otherMarker);
        Assert.Empty(leaked);
    }
}
