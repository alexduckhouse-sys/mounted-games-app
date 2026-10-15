using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Chat;

public class ChatEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ChatEndpointsTests(ApiFactory f) => _f = f;

    private static string Url(Arena a, string suffix = "") => $"/api/competitions/{a.CompetitionId}/chat{suffix}";

    private static HttpClient WithIp(HttpClient c, string ip)
    {
        c.DefaultRequestHeaders.Remove(TestIpStartupFilter.Header);
        c.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, ip);
        return c;
    }

    private Task<int> SeedMessageAsync(Arena a, string body, DateTime createdAt, string? ip = null, string author = "Someone")
        => _f.WithDbAsync(async db =>
        {
            var m = new ChatMessage { CompetitionId = a.CompetitionId, AuthorName = author, Body = body, CreatedAt = createdAt, IpAddress = ip };
            db.ChatMessages.Add(m);
            await db.SaveChangesAsync();
            return m.Id;
        });

    // ---- Recent ----

    [Fact]
    public async Task Recent_ReturnsOldestFirst_ForThisCompetitionOnly()
    {
        var a = await _f.CreateArenaAsync(1);
        var other = await _f.CreateArenaAsync(1);
        var now = DateTime.UtcNow;
        await SeedMessageAsync(a, "second", now.AddMinutes(-1));
        await SeedMessageAsync(a, "first", now.AddMinutes(-2));
        await SeedMessageAsync(other, "elsewhere", now);

        var list = await (await _f.CreateClient().GetAsync(Url(a))).ReadAsync<List<ChatMessageDto>>();

        Assert.Equal(new[] { "first", "second" }, list.Select(m => m.Body));
    }

    [Fact]
    public async Task Recent_Take_LimitsToNewestMessages_AndClampsToAtLeastOne()
    {
        var a = await _f.CreateArenaAsync(1);
        var now = DateTime.UtcNow;
        for (var i = 0; i < 4; i++) await SeedMessageAsync(a, $"m{i}", now.AddMinutes(-10 + i));
        var client = _f.CreateClient();

        var two = await (await client.GetAsync(Url(a, "?take=2"))).ReadAsync<List<ChatMessageDto>>();
        var zero = await (await client.GetAsync(Url(a, "?take=0"))).ReadAsync<List<ChatMessageDto>>();

        Assert.Equal(new[] { "m2", "m3" }, two.Select(m => m.Body));
        Assert.Equal(new[] { "m3" }, zero.Select(m => m.Body));
    }

    [Fact]
    public async Task Recent_Take_IsCappedAt500()
    {
        var a = await _f.CreateArenaAsync(1);
        await _f.WithDbAsync(async db =>
        {
            var start = DateTime.UtcNow.AddHours(-2);
            db.ChatMessages.AddRange(Enumerable.Range(0, 505).Select(i => new ChatMessage
            {
                CompetitionId = a.CompetitionId, AuthorName = "x", Body = $"m{i}", CreatedAt = start.AddSeconds(i)
            }));
            await db.SaveChangesAsync();
        });

        var list = await (await _f.CreateClient().GetAsync(Url(a, "?take=9999"))).ReadAsync<List<ChatMessageDto>>();

        Assert.Equal(500, list.Count);
        Assert.Equal("m504", list[^1].Body);
    }

    // ---- Post ----

    [Fact]
    public async Task Post_Anonymous_AuthorsAsGuest_AndStoresTrimmedBodyAndIp()
    {
        var a = await _f.CreateArenaAsync(1);
        var client = WithIp(_f.CreateClient(), "10.1.2.3");

        var r = await client.PostAsJsonAsync(Url(a), new PostChatMessageRequest("  hello  ", null));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<ChatMessageDto>();
        Assert.Equal("Guest", dto.AuthorName);
        Assert.Equal("hello", dto.Body);
        Assert.Equal(ChatMessageType.Chat, dto.Type);
        Assert.Null(dto.UserId);
        var stored = await _f.WithDbAsync(db => db.ChatMessages.SingleAsync(m => m.Id == dto.Id));
        Assert.Equal("10.1.2.3", stored.IpAddress);
    }

    [Fact]
    public async Task Post_WithoutKnownIp_StillSucceeds()
    {
        var a = await _f.CreateArenaAsync(1);

        var r = await _f.CreateClient().PostAsJsonAsync(Url(a), new PostChatMessageRequest("hi", null));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var id = (await r.ReadAsync<ChatMessageDto>()).Id;
        Assert.Null((await _f.WithDbAsync(db => db.ChatMessages.SingleAsync(m => m.Id == id))).IpAddress);
    }

    [Fact]
    public async Task Post_UsesSuppliedAuthorName_TrimmedAndCappedAt60()
    {
        var a = await _f.CreateArenaAsync(1);
        var client = _f.CreateClient();

        var named = await (await client.PostAsJsonAsync(Url(a), new PostChatMessageRequest("hi", "  Pat  "))).ReadAsync<ChatMessageDto>();
        var longName = await (await client.PostAsJsonAsync(Url(a), new PostChatMessageRequest("hi", new string('n', 80)))).ReadAsync<ChatMessageDto>();

        Assert.Equal("Pat", named.AuthorName);
        Assert.Equal(60, longName.AuthorName.Length);
    }

    [Fact]
    public async Task Post_SignedInUser_IsLinkedToAccount_AndUsesTheirName()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await _f.TrainerAsync();

        var dto = await (await trainer.PostAsJsonAsync(Url(a), new PostChatMessageRequest("from coach", " "))).ReadAsync<ChatMessageDto>();

        var user = await _f.WithDbAsync(db => db.Users.SingleAsync(u => u.Email == TestClients.TrainerEmail));
        Assert.Equal(user.Id, dto.UserId);
        Assert.Equal(user.FullName, dto.AuthorName);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Post_Returns400_WhenBodyBlank(string body)
    {
        var a = await _f.CreateArenaAsync(1);
        var r = await _f.CreateClient().PostAsJsonAsync(Url(a), new PostChatMessageRequest(body, null));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Post_Returns404_WhenCompetitionMissing()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/competitions/999999/chat", new PostChatMessageRequest("hi", null));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Post_Returns403_WhenIpIsBlocked()
    {
        var a = await _f.CreateArenaAsync(1);
        await _f.WithDbAsync(async db => { db.IpBlocks.Add(new IpBlock { IpAddress = "10.9.9.9" }); await db.SaveChangesAsync(); });

        var r = await WithIp(_f.CreateClient(), "10.9.9.9").PostAsJsonAsync(Url(a), new PostChatMessageRequest("spam", null));

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        Assert.Equal("Posting from this network is blocked.", doc.RootElement.GetProperty("message").GetString());
        Assert.False(await _f.WithDbAsync(db => db.ChatMessages.AnyAsync(m => m.Body == "spam")));
    }

    [Fact]
    public async Task Post_AllowsOtherIps_WhenOneIsBlocked()
    {
        var a = await _f.CreateArenaAsync(1);
        await _f.WithDbAsync(async db => { db.IpBlocks.Add(new IpBlock { IpAddress = "10.8.8.8" }); await db.SaveChangesAsync(); });

        var r = await WithIp(_f.CreateClient(), "10.8.8.9").PostAsJsonAsync(Url(a), new PostChatMessageRequest("fine", null));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Post_AdminBypassesIpBlock()
    {
        var a = await _f.CreateArenaAsync(1);
        await _f.WithDbAsync(async db => { db.IpBlocks.Add(new IpBlock { IpAddress = "10.7.7.7" }); await db.SaveChangesAsync(); });
        var admin = WithIp(await _f.AdminAsync(), "10.7.7.7");

        var r = await admin.PostAsJsonAsync(Url(a), new PostChatMessageRequest("admin here", null));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    // ---- Delete ----

    [Fact]
    public async Task Delete_RemovesMessage()
    {
        var a = await _f.CreateArenaAsync(1);
        var id = await SeedMessageAsync(a, "bye", DateTime.UtcNow);
        var admin = await _f.AdminAsync();

        var r = await admin.DeleteAsync(Url(a, $"/{id}"));

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.ChatMessages.AnyAsync(m => m.Id == id)));
    }

    [Fact]
    public async Task Delete_Returns404_WhenMessageBelongsToOtherCompetition()
    {
        var a = await _f.CreateArenaAsync(1);
        var b = await _f.CreateArenaAsync(1);
        var id = await SeedMessageAsync(a, "mine", DateTime.UtcNow);
        var admin = await _f.AdminAsync();

        var r = await admin.DeleteAsync(Url(b, $"/{id}"));

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.True(await _f.WithDbAsync(db => db.ChatMessages.AnyAsync(m => m.Id == id)));
    }

    [Fact]
    public async Task Delete_Returns401_WhenAnonymous_And403_WhenTrainer()
    {
        var a = await _f.CreateArenaAsync(1);
        var id = await SeedMessageAsync(a, "x", DateTime.UtcNow);

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().DeleteAsync(Url(a, $"/{id}"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await _f.TrainerAsync()).DeleteAsync(Url(a, $"/{id}"))).StatusCode);
    }

    // ---- BlockAuthor ----

    [Fact]
    public async Task BlockAuthor_BlocksMessageIp_WithDefaultReason_AndEnforcesIt()
    {
        var a = await _f.CreateArenaAsync(1);
        var id = await SeedMessageAsync(a, "rude", DateTime.UtcNow, ip: "10.5.5.5", author: "Troll");
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsync(Url(a, $"/{id}/block-author"), null);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        Assert.False(doc.RootElement.GetProperty("alreadyBlocked").GetBoolean());
        Assert.Equal("10.5.5.5", doc.RootElement.GetProperty("ipAddress").GetString());
        var block = await _f.WithDbAsync(db => db.IpBlocks.SingleAsync(b => b.IpAddress == "10.5.5.5"));
        Assert.Equal($"Blocked via chat message #{id} from Troll", block.Reason);
        Assert.NotNull(block.CreatedByUserId);

        var after = await WithIp(_f.CreateClient(), "10.5.5.5").PostAsJsonAsync(Url(a), new PostChatMessageRequest("again", null));
        Assert.Equal(HttpStatusCode.Forbidden, after.StatusCode);
    }

    [Fact]
    public async Task BlockAuthor_UsesSuppliedReason()
    {
        var a = await _f.CreateArenaAsync(1);
        var id = await SeedMessageAsync(a, "rude", DateTime.UtcNow, ip: "10.5.5.6");
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync(Url(a, $"/{id}/block-author"), new BlockAuthorRequest("abusive"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("abusive", (await _f.WithDbAsync(db => db.IpBlocks.SingleAsync(b => b.IpAddress == "10.5.5.6"))).Reason);
    }

    [Fact]
    public async Task BlockAuthor_ReportsAlreadyBlocked_WithoutDuplicating()
    {
        var a = await _f.CreateArenaAsync(1);
        var id = await SeedMessageAsync(a, "rude", DateTime.UtcNow, ip: "10.5.5.7");
        var admin = await _f.AdminAsync();
        await admin.PostAsync(Url(a, $"/{id}/block-author"), null);

        var r = await admin.PostAsync(Url(a, $"/{id}/block-author"), null);

        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.GetProperty("alreadyBlocked").GetBoolean());
        Assert.Equal(1, await _f.WithDbAsync(db => db.IpBlocks.CountAsync(b => b.IpAddress == "10.5.5.7")));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task BlockAuthor_Returns400_WhenMessageHasNoIp(string? ip)
    {
        var a = await _f.CreateArenaAsync(1);
        var id = await SeedMessageAsync(a, "old", DateTime.UtcNow, ip: ip);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsync(Url(a, $"/{id}/block-author"), null);

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        Assert.Contains("No IP recorded", doc.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public async Task BlockAuthor_Returns404_WhenMessageMissing()
    {
        var a = await _f.CreateArenaAsync(1);
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync(Url(a, "/999999/block-author"), null)).StatusCode);
    }

    [Fact]
    public async Task BlockAuthor_Returns401_WhenAnonymous_And403_WhenTrainer()
    {
        var a = await _f.CreateArenaAsync(1);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsync(Url(a, "/1/block-author"), null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await _f.TrainerAsync()).PostAsync(Url(a, "/1/block-author"), null)).StatusCode);
    }

    // ---- Announce ----

    [Fact]
    public async Task Announce_PostsAnnouncement_AsAdmin()
    {
        var a = await _f.CreateArenaAsync(1);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync(Url(a, "/announcement"), new AnnouncementRequest("  Lunch at 12  ", "info"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<ChatMessageDto>();
        Assert.Equal(ChatMessageType.Announcement, dto.Type);
        Assert.Equal("Lunch at 12", dto.Body);
        Assert.Equal("info", dto.Tag);
        var adminUser = await _f.WithDbAsync(db => db.Users.SingleAsync(u => u.Email == TestClients.AdminEmail));
        Assert.Equal(adminUser.Id, dto.UserId);
        Assert.Equal(adminUser.FullName, dto.AuthorName);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public async Task Announce_Returns400_WhenBodyBlank(string body)
    {
        var a = await _f.CreateArenaAsync(1);
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync(Url(a, "/announcement"), new AnnouncementRequest(body, null));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Announce_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions/999999/chat/announcement", new AnnouncementRequest("x", null));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Announce_Returns401_WhenAnonymous_And403_WhenTrainer()
    {
        var a = await _f.CreateArenaAsync(1);
        var body = new AnnouncementRequest("x", null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(Url(a, "/announcement"), body)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(a, "/announcement"), body)).StatusCode);
    }
}
