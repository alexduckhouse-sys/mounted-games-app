using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Chat;

public class ChatModerationSchemaTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task ExistingSqliteUpgrade_PreservesRowsAndEnforcesKeysAndCascades()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var before = await db.Results.Select(r => new { r.Id, r.Points }).OrderBy(r => r.Id).ToListAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE ChatReports; DROP TABLE ChatUserBlocks;");
        await DbInitializer.SeedAsync(factory.Services);
        var comp = await db.Competitions.FirstAsync();
        var author = new AppUser { UserName = "synthetic-moderation-author" };
        var reporter = new AppUser { UserName = "synthetic-moderation-reporter" };
        db.AddRange(author, reporter);
        var message = new ChatMessage { CompetitionId = comp.Id, User = author, AuthorName = "Synthetic author", Body = "Synthetic message" };
        db.Add(message);
        await db.SaveChangesAsync();
        db.ChatReports.Add(new ChatReport { MessageId = message.Id, ReporterUserId = reporter.Id, Reason = "Synthetic reason", CreatedAt = DateTime.UtcNow });
        db.ChatUserBlocks.Add(new ChatUserBlock { UserId = reporter.Id, BlockedUserId = author.Id, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        await DbInitializer.SeedAsync(factory.Services);
        db.ChangeTracker.Clear();
        Assert.Equal("Synthetic reason", (await db.ChatReports.SingleAsync()).Reason);
        Assert.Equal(author.Id, (await db.ChatUserBlocks.SingleAsync()).BlockedUserId);
        Assert.Equal(before, await db.Results.Select(r => new { r.Id, r.Points }).OrderBy(r => r.Id).ToListAsync());
        db.ChatReports.Add(new ChatReport { MessageId = message.Id, ReporterUserId = reporter.Id, Reason = "Duplicate", CreatedAt = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        db.ChatUserBlocks.Add(new ChatUserBlock { UserId = reporter.Id, BlockedUserId = author.Id, CreatedAt = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        await db.ChatMessages.Where(m => m.Id == message.Id).ExecuteDeleteAsync();
        Assert.Empty(await db.ChatReports.ToListAsync());
        await db.Users.Where(u => u.Id == author.Id).ExecuteDeleteAsync();
        Assert.Empty(await db.ChatUserBlocks.ToListAsync());
    }

    [Fact]
    public async Task ReporterAndBlockOwnerDeletion_CascadesWithoutDeletingOthersMessages()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var comp = await db.Competitions.FirstAsync();
        var author = new AppUser { UserName = "synthetic-other-author" };
        var reporter = new AppUser { UserName = "synthetic-other-reporter" };
        db.AddRange(author, reporter);
        var message = new ChatMessage { CompetitionId = comp.Id, User = author, AuthorName = "Synthetic author", Body = "Keep this message" };
        db.Add(message); await db.SaveChangesAsync();
        db.ChatReports.Add(new ChatReport { MessageId = message.Id, ReporterUserId = reporter.Id, Reason = "Synthetic reason", CreatedAt = DateTime.UtcNow });
        db.ChatUserBlocks.Add(new ChatUserBlock { UserId = reporter.Id, BlockedUserId = author.Id, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        await db.Users.Where(u => u.Id == reporter.Id).ExecuteDeleteAsync();
        Assert.False(await db.ChatReports.AnyAsync(r => r.ReporterUserId == reporter.Id));
        Assert.False(await db.ChatUserBlocks.AnyAsync(b => b.UserId == reporter.Id));
        Assert.True(await db.ChatMessages.AnyAsync(m => m.Id == message.Id));
    }
}
