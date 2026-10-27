using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

public class AccountDeletionModerationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DeletionRemovesPersonalBlocksAndReportText_AlsoForRetainedAccountShells(bool retainedShell)
    {
        var (client, owner) = await factory.SignupAsync();
        var (_, other) = await factory.SignupAsync();
        var (_, third) = await factory.SignupAsync();
        var arena = await factory.CreateArenaAsync(1);
        var messageIds = await factory.WithDbAsync(async db =>
        {
            if (retainedShell)
                db.Add(new Season { OwnerUserId = owner.User.Id, Title = "Synthetic season", Year = 2030 });
            var ownMessage = new ChatMessage
            {
                CompetitionId = arena.CompetitionId, UserId = owner.User.Id,
                AuthorName = "Synthetic owner", Body = "Synthetic removed message",
            };
            var otherMessage = new ChatMessage
            {
                CompetitionId = arena.CompetitionId, UserId = other.User.Id,
                AuthorName = "Synthetic other", Body = "Synthetic retained message",
            };
            db.AddRange(ownMessage, otherMessage);
            await db.SaveChangesAsync();
            db.AddRange(
                new ChatReport { MessageId = ownMessage.Id, ReporterUserId = other.User.Id, Reason = "Synthetic report on removed message" },
                new ChatReport { MessageId = otherMessage.Id, ReporterUserId = owner.User.Id, Reason = "Synthetic owner's report" },
                new ChatReport { MessageId = otherMessage.Id, ReporterUserId = third.User.Id, Reason = "Synthetic retained report" },
                new ChatUserBlock { UserId = owner.User.Id, BlockedUserId = other.User.Id },
                new ChatUserBlock { UserId = other.User.Id, BlockedUserId = owner.User.Id },
                new ChatUserBlock { UserId = other.User.Id, BlockedUserId = third.User.Id });
            await db.SaveChangesAsync();
            return (Own: ownMessage.Id, Other: otherMessage.Id);
        });

        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me")
        {
            Content = JsonContent.Create(new { password = "Passw0rd!x" }),
        };
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        await factory.WithDbAsync(async db =>
        {
            Assert.Equal(retainedShell, await db.Users.AnyAsync(u => u.Id == owner.User.Id));
            Assert.False(await db.ChatUserBlocks.AnyAsync(b => b.UserId == owner.User.Id || b.BlockedUserId == owner.User.Id));
            Assert.True(await db.ChatUserBlocks.AnyAsync(b => b.UserId == other.User.Id && b.BlockedUserId == third.User.Id));
            Assert.False(await db.ChatReports.AnyAsync(r => r.ReporterUserId == owner.User.Id || r.MessageId == messageIds.Own));
            var retained = await db.ChatReports.SingleAsync(r => r.MessageId == messageIds.Other);
            Assert.Equal(third.User.Id, retained.ReporterUserId);
            Assert.Equal("Synthetic retained report", retained.Reason);
            Assert.False(await db.ChatMessages.AnyAsync(m => m.Id == messageIds.Own));
            Assert.Equal("Synthetic retained message", (await db.ChatMessages.SingleAsync(m => m.Id == messageIds.Other)).Body);
        });
    }
}
