using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Chat;

public class ChatModerationTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static string Chat(int competitionId, string suffix = "") => $"/api/competitions/{competitionId}/chat{suffix}";
    private Task<int> Message(int competitionId, string? author, bool isPrivate = false, string? recipient = null)
        => f.WithDbAsync(async db =>
        {
            var m = new ChatMessage { CompetitionId = competitionId, UserId = author, AuthorName = "Synthetic author",
                Body = "Synthetic message", AdminOnly = isPrivate, RecipientUserId = recipient };
            db.ChatMessages.Add(m); await db.SaveChangesAsync(); return m.Id;
        });

    [Fact]
    public async Task Report_StoresTrimmedReasonOnce_WithoutCopyingMessage()
    {
        var a = await f.CreateArenaAsync(1);
        var (client, user) = await f.SignupAsync("Member");
        var message = await Message(a.CompetitionId, null);
        foreach (var reason in new[] { "  Please review this  ", "A replacement reason" })
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync(Chat(a.CompetitionId, $"/{message}/report"), new { reason })).StatusCode);
        var report = await f.WithDbAsync(db => db.ChatReports.SingleAsync(r => r.MessageId == message));
        Assert.Equal("Please review this", report.Reason);
        Assert.Equal(user.User.Id, report.ReporterUserId);
        Assert.Null(report.ResolvedAt);
        Assert.InRange(report.CreatedAt, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddMinutes(1));
    }

    [Theory]
    [InlineData("report")]
    [InlineData("block-user")]
    public async Task ConcurrentRetries_CreateOneRowAndAllAcknowledge(string action)
    {
        var a = await f.CreateArenaAsync(1);
        var (client, user) = await f.SignupAsync("Member");
        var (_, author) = await f.SignupAsync("Member");
        var id = await Message(a.CompetitionId, author.User.Id);
        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            client.PostAsJsonAsync(Chat(a.CompetitionId, $"/{id}/{action}"), new { reason = "Review" })));
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.NoContent, r.StatusCode));
        if (action == "report")
            Assert.Single(await f.WithDbAsync(db => db.ChatReports.Where(r => r.MessageId == id && r.ReporterUserId == user.User.Id).ToListAsync()));
        else
            Assert.Single(await f.WithDbAsync(db => db.ChatUserBlocks.Where(b => b.UserId == user.User.Id && b.BlockedUserId == author.User.Id).ToListAsync()));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Report_RejectsBlankReason(string? reason)
    {
        var client = (await f.SignupAsync("Member")).Client;
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Chat(1, "/1/report"), new { reason })).StatusCode);
    }

    [Fact]
    public async Task Report_BoundsTrimmedReason()
    {
        var a = await f.CreateArenaAsync(1);
        var client = (await f.SignupAsync("Member")).Client;
        var id = await Message(a.CompetitionId, null);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Chat(a.CompetitionId, $"/{id}/report"), new { reason = new string('x', 1001) })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync(Chat(a.CompetitionId, $"/{id}/report"), new { reason = " " + new string('x', 1000) + " " })).StatusCode);
    }

    [Theory]
    [InlineData("report")]
    [InlineData("block-user")]
    public async Task Mutations_HidePrivateAndWrongCompetitionMessages(string action)
    {
        var a = await f.CreateArenaAsync(1);
        var b = await f.CreateArenaAsync(1);
        var (client, _) = await f.SignupAsync("Member");
        var (_, other) = await f.SignupAsync("Member");
        var privateId = await Message(a.CompetitionId, other.User.Id, true);
        var publicId = await Message(a.CompetitionId, other.User.Id);
        foreach (var (competition, id) in new[] { (a.CompetitionId, privateId), (b.CompetitionId, publicId), (a.CompetitionId, int.MaxValue) })
            Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Chat(competition, $"/{id}/{action}"), new { reason = "Review" })).StatusCode);
    }

    [Fact]
    public async Task Report_PrivateAuthorRecipientAndAdminCanReport()
    {
        var a = await f.CreateArenaAsync(1);
        var (author, authorAuth) = await f.SignupAsync("Member");
        var (recipient, recipientAuth) = await f.SignupAsync("Member");
        var id = await Message(a.CompetitionId, authorAuth.User.Id, true, recipientAuth.User.Id);
        foreach (var client in new[] { author, recipient, await f.AdminAsync() })
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync(Chat(a.CompetitionId, $"/{id}/report"), new { reason = "Review" })).StatusCode);
        Assert.Equal(3, await f.WithDbAsync(db => db.ChatReports.CountAsync(r => r.MessageId == id)));
    }

    [Fact]
    public async Task Blocks_ArePersonalGlobalIdempotentAndReversible()
    {
        var a = await f.CreateArenaAsync(1);
        var b = await f.CreateArenaAsync(1);
        var (reader, _) = await f.SignupAsync("Member");
        var (otherReader, _) = await f.SignupAsync("Member");
        var (_, author) = await f.SignupAsync("Member");
        var message = await Message(a.CompetitionId, author.User.Id);
        var otherMessage = await Message(b.CompetitionId, author.User.Id);
        var systemMessage = await Message(b.CompetitionId, null);
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.NoContent, (await reader.PostAsync(Chat(a.CompetitionId, $"/{message}/block-user"), null)).StatusCode);
        var list = await (await reader.GetAsync("/api/chat/blocked-users")).ReadAsync<List<BlockedChatUserDto>>();
        Assert.Equal(author.User.Id, Assert.Single(list).UserId);
        Assert.Empty(await (await otherReader.GetAsync("/api/chat/blocked-users")).ReadAsync<List<BlockedChatUserDto>>());
        var ownFeed = await (await reader.GetAsync(Chat(b.CompetitionId))).ReadAsync<List<ChatMessageDto>>();
        Assert.Equal(systemMessage, Assert.Single(ownFeed).Id);
        foreach (var client in new[] { otherReader, f.CreateClient() })
            Assert.Contains(await (await client.GetAsync(Chat(b.CompetitionId))).ReadAsync<List<ChatMessageDto>>(), m => m.Id == otherMessage);
        // Reporting an already-rendered message after blocking remains possible.
        Assert.Equal(HttpStatusCode.NoContent, (await reader.PostAsJsonAsync(Chat(a.CompetitionId, $"/{message}/report"), new { reason = "Review" })).StatusCode);
        // Someone else cannot remove this reader's block.
        await otherReader.DeleteAsync($"/api/chat/blocked-users/{author.User.Id}");
        Assert.Single(await (await reader.GetAsync("/api/chat/blocked-users")).ReadAsync<List<BlockedChatUserDto>>());
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.NoContent, (await reader.DeleteAsync($"/api/chat/blocked-users/{author.User.Id}")).StatusCode);
        Assert.Contains(await (await reader.GetAsync(Chat(b.CompetitionId))).ReadAsync<List<ChatMessageDto>>(), m => m.Id == otherMessage);
    }

    [Fact]
    public async Task Block_RejectsSelfAndDeletedAuthor()
    {
        var a = await f.CreateArenaAsync(1);
        var (reader, auth) = await f.SignupAsync("Member");
        foreach (var author in new[] { auth.User.Id, null })
        {
            var id = await Message(a.CompetitionId, author);
            Assert.Equal(HttpStatusCode.BadRequest, (await reader.PostAsync(Chat(a.CompetitionId, $"/{id}/block-user"), null)).StatusCode);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DirectReplies_RespectBlocksInEitherDirection(bool adminBlocks)
    {
        var a = await f.CreateArenaAsync(1);
        var (member, user) = await f.SignupAsync("Member");
        var adminAuth = await f.AdminLoginAsync();
        var admin = f.WithToken(adminAuth.Token);
        var question = await (await member.PostAsJsonAsync(Chat(a.CompetitionId), new PostChatMessageRequest("Synthetic question"))).ReadAsync<ChatMessageDto>();
        var response = await (await admin.PostAsJsonAsync(Chat(a.CompetitionId), new PostChatMessageRequest("Synthetic reply", user.User.Id))).ReadAsync<ChatMessageDto>();
        var blocker = adminBlocks ? admin : member;
        var blockedMessage = adminBlocks ? question.Id : response.Id;
        (await blocker.PostAsync(Chat(a.CompetitionId, $"/{blockedMessage}/block-user"), null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync(Chat(a.CompetitionId), new PostChatMessageRequest("Blocked reply", user.User.Id))).StatusCode);
        Assert.False(await f.WithDbAsync(db => db.ChatMessages.AnyAsync(m => m.CompetitionId == a.CompetitionId && m.Body == "Blocked reply")));
        // A question to the shared organiser inbox has no individual recipient.
        Assert.Equal(HttpStatusCode.OK, (await member.PostAsJsonAsync(Chat(a.CompetitionId), new PostChatMessageRequest("Synthetic shared question"))).StatusCode);
    }

    [Fact]
    public async Task Reports_AdminReviewIgnoresPersonalHideAndResolvesIdempotently()
    {
        var a = await f.CreateArenaAsync(1);
        var b = await f.CreateArenaAsync(1);
        var (member, user) = await f.SignupAsync("Member");
        var admin = await f.AdminAsync();
        var id = await Message(a.CompetitionId, user.User.Id, true);
        (await member.PostAsJsonAsync(Chat(a.CompetitionId, $"/{id}/report"), new { reason = "Review" })).EnsureSuccessStatusCode();
        var reports = await (await admin.GetAsync(Chat(a.CompetitionId, "/reports"))).ReadAsync<List<ChatReportDto>>();
        var report = Assert.Single(reports);
        (await admin.PostAsync(Chat(a.CompetitionId, $"/{id}/block-user"), null)).EnsureSuccessStatusCode();
        Assert.Empty(await (await admin.GetAsync(Chat(a.CompetitionId))).ReadAsync<List<ChatMessageDto>>());
        var reviewed = await (await admin.GetAsync(Chat(a.CompetitionId, $"/reports/{report.Id}/message"))).ReadAsync<ChatMessageDto>();
        Assert.Equal(id, reviewed.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync(Chat(b.CompetitionId, $"/reports/{report.Id}/message"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync(Chat(b.CompetitionId, $"/reports/{report.Id}/resolve"), null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(Chat(a.CompetitionId, $"/reports/{report.Id}/resolve"), null)).StatusCode);
        var first = await f.WithDbAsync(db => db.ChatReports.Where(r => r.Id == report.Id).Select(r => r.ResolvedAt).SingleAsync());
        Assert.NotNull(first);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(Chat(a.CompetitionId, $"/reports/{report.Id}/resolve"), null)).StatusCode);
        Assert.Equal(first, await f.WithDbAsync(db => db.ChatReports.Where(r => r.Id == report.Id).Select(r => r.ResolvedAt).SingleAsync()));
        (await admin.DeleteAsync(Chat(a.CompetitionId, $"/{id}"))).EnsureSuccessStatusCode();
        Assert.False(await f.WithDbAsync(db => db.ChatReports.AnyAsync(r => r.Id == report.Id)));
    }

    [Fact]
    public async Task Reports_ArePagedNewestFirstAndScopedToCompetition()
    {
        var a = await f.CreateArenaAsync(1);
        var b = await f.CreateArenaAsync(1);
        var (_, user) = await f.SignupAsync("Member");
        await f.WithDbAsync(async db =>
        {
            for (var i = 0; i < 105; i++) db.ChatReports.Add(new ChatReport
            {
                Message = new ChatMessage { CompetitionId = a.CompetitionId, Body = "Synthetic", AuthorName = "Synthetic" },
                ReporterUserId = user.User.Id, Reason = "Synthetic report", CreatedAt = DateTime.UtcNow
            });
            db.ChatReports.Add(new ChatReport { Message = new ChatMessage { CompetitionId = b.CompetitionId, Body = "Other", AuthorName = "Synthetic" },
                ReporterUserId = user.User.Id, Reason = "Other event", CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });
        var admin = await f.AdminAsync();
        var first = await (await admin.GetAsync(Chat(a.CompetitionId, "/reports?take=999"))).ReadAsync<List<ChatReportDto>>();
        Assert.Equal(100, first.Count);
        Assert.Equal(first.OrderByDescending(r => r.Id), first);
        Assert.All(first, r => Assert.Equal("Synthetic report", r.Reason));
        var next = await (await admin.GetAsync(Chat(a.CompetitionId, $"/reports?beforeId={first[^1].Id}"))).ReadAsync<List<ChatReportDto>>();
        Assert.Equal(5, next.Count);
        Assert.Empty(first.Select(r => r.Id).Intersect(next.Select(r => r.Id)));
        Assert.Single(await (await admin.GetAsync(Chat(a.CompetitionId, "/reports?take=0"))).ReadAsync<List<ChatReportDto>>());
    }

    [Theory]
    [InlineData("emptied")]
    [InlineData("locked")]
    [InlineData("blocked")]
    [InlineData("deleted")]
    public async Task InactiveAccount_CannotRecreateModerationDataWhileAuthenticationIsCached(string state)
    {
        var a = await f.CreateArenaAsync(1);
        var (client, user) = await f.SignupAsync("Member");
        var (_, author) = await f.SignupAsync("Member");
        var id = await Message(a.CompetitionId, author.User.Id);
        // Give this synthetic account an admin token so the announcement route is exercised too.
        await f.WithDbAsync(async db =>
        {
            var role = await db.Roles.SingleAsync(r => r.Name == Roles.Admin);
            db.UserRoles.Add(new Microsoft.AspNetCore.Identity.IdentityUserRole<string> { UserId = user.User.Id, RoleId = role.Id });
            await db.SaveChangesAsync();
        });
        client = f.WithToken((await f.LoginAsync(user.User.Email, "Passw0rd!x")).Token);
        (await client.GetAsync("/api/chat/blocked-users")).EnsureSuccessStatusCode();
        await f.WithDbAsync(async db =>
        {
            if (state == "deleted") await db.Users.Where(u => u.Id == user.User.Id).ExecuteDeleteAsync();
            else
            {
                var account = await db.Users.SingleAsync(u => u.Id == user.User.Id);
                if (state == "emptied") account.LockoutEnd = DateTimeOffset.MaxValue;
                if (state == "locked") account.LockedAt = DateTime.UtcNow;
                if (state == "blocked") account.BlockedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }
        });
        // Token checks read the account on every request, so each change below holds at once.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(Chat(a.CompetitionId, $"/{id}/report"), new { reason = "Must not return after deletion" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync(Chat(a.CompetitionId, $"/{id}/block-user"), null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync(Chat(a.CompetitionId), new PostChatMessageRequest("Must not recreate chat"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync(Chat(a.CompetitionId, "/announcement"), new AnnouncementRequest("Must not recreate announcement", null))).StatusCode);
        Assert.False(await f.WithDbAsync(db => db.ChatReports.AnyAsync(r => r.ReporterUserId == user.User.Id)));
        Assert.False(await f.WithDbAsync(db => db.ChatUserBlocks.AnyAsync(b => b.UserId == user.User.Id)));
        Assert.False(await f.WithDbAsync(db => db.ChatMessages.AnyAsync(m => m.UserId == user.User.Id)));
    }

    [Theory]
    [InlineData("POST", "/api/competitions/1/chat/1/report", false)]
    [InlineData("POST", "/api/competitions/1/chat/1/block-user", false)]
    [InlineData("GET", "/api/chat/blocked-users", false)]
    [InlineData("DELETE", "/api/chat/blocked-users/synthetic", false)]
    [InlineData("GET", "/api/competitions/1/chat/reports", true)]
    [InlineData("GET", "/api/competitions/1/chat/reports/1/message", true)]
    [InlineData("POST", "/api/competitions/1/chat/reports/1/resolve", true)]
    public async Task Endpoints_RequireSignInAndReviewRequiresAdmin(string method, string url, bool adminOnly)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), url) { Content = JsonContent.Create(new { reason = "Review" }) };
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().SendAsync(request)).StatusCode);
        if (adminOnly)
        {
            foreach (var client in new[] { (await f.SignupAsync("Member")).Client, (await f.ApprovedTrainerAsync()).Client })
            {
                using var forbidden = new HttpRequestMessage(new HttpMethod(method), url);
                Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(forbidden)).StatusCode);
            }
        }
    }
}
