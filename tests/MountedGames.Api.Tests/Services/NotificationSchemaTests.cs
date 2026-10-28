using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Services;

public class NotificationSchemaTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task ExistingSqliteUpgrade_PreservesExistingDataAndDurableClaimsOnRestart()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var comp = await db.Competitions.FirstAsync();
        var before = await db.Results.Select(r => new { r.Id, r.Points }).OrderBy(r => r.Id).ToListAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE NotificationDeliveries; DROP TABLE ScheduledNotifications;");
        await DbInitializer.SeedAsync(factory.Services);
        var sub = new PushSubscription { UserId = await db.Users.Select(u => u.Id).FirstAsync(), Endpoint = "https://fcm.googleapis.com/fcm/send/synthetic-schema" };
        var reminder = new ScheduledNotification { ReminderKey = "synthetic-schema", CompetitionId = comp.Id, DueAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddMinutes(5), TimetableVersion = "v1" };
        db.NotificationDeliveries.Add(new() { Subscription = sub, Notification = reminder, TimetableVersion = "v1", Attempts = 2,
            Status = NotificationDeliveryStatus.Claimed, ClaimToken = "synthetic-token", ClaimedUntil = DateTime.UtcNow.AddMinutes(2),
            NextAttemptAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        await DbInitializer.SeedAsync(factory.Services);
        db.ChangeTracker.Clear();
        var row = await db.NotificationDeliveries.SingleAsync();
        Assert.Equal("synthetic-token", row.ClaimToken);
        Assert.Equal(2, row.Attempts);
        Assert.Equal("v1", row.TimetableVersion);
        Assert.Equal(before, await db.Results.Select(r => new { r.Id, r.Points }).OrderBy(r => r.Id).ToListAsync());
    }
}
