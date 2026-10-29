using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Notifications;
using MountedGames.Api.Tests.Infrastructure;
using MountedGames.Api.Tests.Push;

namespace MountedGames.Api.Tests.Services;

public class DurableNotificationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Current { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Current;
        public DateTime Now => Current.UtcDateTime;
    }
    private sealed record Scenario(Clock Clock, int SessionId, int TeamId, int SubscriptionId, int CompetitionId, string Endpoint);

    private async Task<Scenario> ArrangeAsync(Func<HttpRequestMessage, HttpResponseMessage>? respond = null)
    {
        var clock = new Clock();
        var endpoint = PushTests.AllowedEndpoint();
        factory.Http.Respond(endpoint, respond ?? (_ => new(HttpStatusCode.Created)));
        var (client, auth) = await factory.SignupAsync();
        (await client.PostAsJsonAsync("/api/push/subscribe", FakePushService.Subscription(endpoint))).EnsureSuccessStatusCode();
        var section = await factory.NewSectionAsync();
        return await factory.InDbAsync(async db =>
        {
            var team = new Team { CompetitionId = section.CompetitionId, CompetitionSectionId = section.Id,
                Club = new Club { Name = $"Example club {Guid.NewGuid():N}" }, DisplayName = "Example team", TrainerUserId = auth.User.Id };
            var session = new Session { CompetitionId = section.CompetitionId, CompetitionSectionId = section.Id,
                Name = "Example briefing", Kind = SessionKind.Briefing, ScheduledStart = clock.Now.AddMinutes(29) };
            db.AddRange(team, session);
            await db.SaveChangesAsync();
            return new Scenario(clock, session.Id, team.Id, await db.PushSubscriptions.Where(s => s.Endpoint == endpoint).Select(s => s.Id).SingleAsync(), section.CompetitionId, endpoint);
        });
    }

    private async Task<T> WithRunner<T>(Clock clock, Func<ReminderRunner, AppDbContext, Task<T>> action)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await action(new ReminderRunner(db, scope.ServiceProvider.GetRequiredService<PushNotifier>(), clock), db);
    }
    private Task<ReminderRunResult> Run(Scenario s) => WithRunner(s.Clock, (r, _) => r.RunAsync(default));
    private Task<NotificationDelivery> Delivery(Scenario s) => factory.InDbAsync(db => db.NotificationDeliveries.AsNoTracking().SingleAsync(d => d.PushSubscriptionId == s.SubscriptionId));
    private Task<int> Prepare(Scenario s) => WithRunner(s.Clock, async (r, db) =>
    {
        await r.ReconcileAsync(s.Clock.Now, default);
        return await db.NotificationDeliveries.Where(d => d.PushSubscriptionId == s.SubscriptionId).Select(d => d.Id).SingleAsync();
    });

    [Fact]
    public async Task RestartAndDuplicateInvocation_DoNotResendAcceptedDestination()
    {
        var calls = 0;
        var s = await ArrangeAsync(_ => { calls++; return new(HttpStatusCode.Created); });
        await Run(s);
        await Run(s); // Fresh DbContext/runner, as after a restart.
        Assert.Equal(1, calls);
        Assert.Equal(NotificationDeliveryStatus.Accepted, (await Delivery(s)).Status);
    }

    [Fact]
    public async Task OverlappingClaims_HaveOneWinner_ExpiredLeaseRecovers_StaleCompletionCannotOverwrite()
    {
        var s = await ArrangeAsync();
        var id = await Prepare(s);
        var claims = await Task.WhenAll(WithRunner(s.Clock, (r, _) => r.ClaimAsync(id, default)), WithRunner(s.Clock, (r, _) => r.ClaimAsync(id, default)));
        var first = Assert.Single(claims, t => t != null);
        s.Clock.Current = s.Clock.Current.AddSeconds(121);
        var replacement = await WithRunner(s.Clock, (r, _) => r.ClaimAsync(id, default));
        Assert.NotNull(replacement);
        Assert.NotEqual(first, replacement);
        Assert.False(await WithRunner(s.Clock, (r, _) => r.CompleteAsync(id, first!, NotificationDeliveryStatus.Accepted, null, default)));
        Assert.True(await WithRunner(s.Clock, (r, _) => r.CompleteAsync(id, replacement!, NotificationDeliveryStatus.Pending, null, default)));
        await Run(s);
        var row = await Delivery(s);
        Assert.Equal(NotificationDeliveryStatus.Accepted, row.Status);
        Assert.Equal(1, row.RecoveredLeases);
    }

    [Fact]
    public async Task PartialFailure_OnlyFailedDestinationRetries_WithStableBoundedTopicAndTtl()
    {
        var firstCalls = 0;
        var s = await ArrangeAsync(_ => { firstCalls++; return new(HttpStatusCode.Created); });
        var secondCalls = 0;
        var topics = new List<string>();
        var ttls = new List<int>();
        var endpoint = PushTests.AllowedEndpoint();
        factory.Http.Respond(endpoint, request =>
        {
            secondCalls++;
            topics.Add(Assert.Single(request.Headers.GetValues("Topic")));
            ttls.Add(int.Parse(Assert.Single(request.Headers.GetValues("TTL"))));
            return new(secondCalls == 1 ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.Created);
        });
        await factory.InDbAsync(async db =>
        {
            var user = await db.PushSubscriptions.Where(p => p.Id == s.SubscriptionId).Select(p => p.UserId).SingleAsync();
            var fake = FakePushService.Subscription(endpoint);
            db.PushSubscriptions.Add(new() { UserId = user, Endpoint = endpoint, P256dh = fake.P256dh, Auth = fake.Auth });
            await db.SaveChangesAsync();
        });
        await Run(s);
        await Run(s); // Backoff, no immediate retry.
        Assert.Equal(1, secondCalls);
        s.Clock.Current = s.Clock.Current.AddSeconds(61);
        await Run(s);
        Assert.Equal(1, firstCalls);
        Assert.Equal(2, secondCalls);
        Assert.Equal(topics[0], topics[1]);
        Assert.Matches("^[A-Za-z0-9_-]{32}$", topics[0]);
        Assert.All(ttls, ttl => Assert.InRange(ttl, 1, 240));
        Assert.True(ttls[1] < ttls[0]);
    }

    [Theory]
    [InlineData("started")]
    [InlineData("withdrawn")]
    [InlineData("unfollowed")]
    [InlineData("deleted")]
    public async Task RevalidationAfterSnapshot_CancelsIneligibleDelivery(string change)
    {
        var calls = 0;
        var s = await ArrangeAsync(_ => { calls++; return new(HttpStatusCode.Created); });
        await Prepare(s);
        await factory.InDbAsync(async db =>
        {
            var session = await db.Sessions.SingleAsync(x => x.Id == s.SessionId);
            var team = await db.Teams.SingleAsync(x => x.Id == s.TeamId);
            if (change == "started") session.StartedAt = s.Clock.Now;
            if (change == "deleted") db.Remove(session);
            if (change == "withdrawn") team.EntryStatus = TeamEntryStatus.Withdrawn;
            if (change == "unfollowed") team.TrainerUserId = null;
            await db.SaveChangesAsync();
        });
        await Run(s);
        Assert.Equal(0, calls);
        Assert.Equal(NotificationDeliveryStatus.Cancelled, (await Delivery(s)).Status);
    }

    [Fact]
    public async Task DelayedBeyondHorizon_ThenRescheduled_RevivesUnsentDelivery()
    {
        var calls = 0;
        var s = await ArrangeAsync(_ => { calls++; return new(HttpStatusCode.Created); });
        await Prepare(s);
        await Move(s, s.Clock.Now.AddDays(1));
        await Run(s);
        Assert.Equal(NotificationDeliveryStatus.Cancelled, (await Delivery(s)).Status);
        await Move(s, s.Clock.Now.AddMinutes(29));
        await Run(s);
        Assert.Equal(1, calls);
        Assert.Equal(NotificationDeliveryStatus.Accepted, (await Delivery(s)).Status);
    }

    [Fact]
    public async Task Expiry_IsNotAcceptance_AndGenuineRescheduleRevivesUnsentWork()
    {
        var calls = 0;
        var s = await ArrangeAsync(_ => { calls++; return new(HttpStatusCode.Created); });
        await Prepare(s);
        s.Clock.Current = s.Clock.Current.AddMinutes(5);
        await Run(s);
        Assert.Equal(0, calls);
        Assert.Equal(NotificationDeliveryStatus.Expired, (await Delivery(s)).Status);
        await Move(s, s.Clock.Now.AddMinutes(29));
        await Run(s);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task EarlierReschedule_ResetsOldBackoff_ButNeverResendsAcceptedWork()
    {
        var calls = 0;
        var s = await ArrangeAsync(_ => { calls++; return new(calls == 1 ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.Created); });
        await Run(s);
        await factory.InDbAsync(db => db.NotificationDeliveries.Where(d => d.PushSubscriptionId == s.SubscriptionId)
            .ExecuteUpdateAsync(u => u.SetProperty(d => d.NextAttemptAt, s.Clock.Now.AddHours(1))));
        await Move(s, s.Clock.Now.AddMinutes(28));
        await Run(s);
        Assert.Equal(2, calls);
        await Move(s, s.Clock.Now.AddMinutes(27));
        await Run(s);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task LostProviderAcknowledgement_RetriesWithSameTopic()
    {
        var topics = new List<string>();
        var s = await ArrangeAsync(request =>
        {
            topics.Add(Assert.Single(request.Headers.GetValues("Topic")));
            if (topics.Count == 1) throw new HttpRequestException("Synthetic lost acknowledgement");
            return new(HttpStatusCode.Created);
        });
        await Run(s);
        s.Clock.Current = s.Clock.Current.AddSeconds(61);
        await Run(s);
        Assert.Equal(2, topics.Count);
        Assert.Equal(topics[0], topics[1]);
        Assert.Equal(NotificationDeliveryStatus.Accepted, (await Delivery(s)).Status);
    }

    [Fact]
    public async Task RunDrainsMoreThanOneBatchWithinBudget()
    {
        var calls = 0;
        var s = await ArrangeAsync(_ => { calls++; return new(HttpStatusCode.Created); });
        var endpoint = PushTests.AllowedEndpoint();
        factory.Http.Respond(endpoint, _ => { calls++; return new(HttpStatusCode.Created); });
        var keys = FakePushService.Subscription(endpoint);
        await factory.InDbAsync(async db =>
        {
            var user = await db.PushSubscriptions.Where(p => p.Id == s.SubscriptionId).Select(p => p.UserId).SingleAsync();
            for (var i = 0; i < 54; i++)
                db.PushSubscriptions.Add(new() { UserId = user, Endpoint = endpoint + i, P256dh = keys.P256dh, Auth = keys.Auth });
            await db.SaveChangesAsync();
        });
        await Run(s);
        Assert.Equal(55, calls);
    }

    [Fact]
    public async Task BatchCrossingExpiry_DoesNotSendRemainingDestination()
    {
        Clock? clock = null;
        var calls = 0;
        var s = await ArrangeAsync(_ =>
        {
            calls++;
            if (clock is not null) clock.Current = clock.Current.AddMinutes(5);
            return new(HttpStatusCode.Created);
        });
        clock = s.Clock;
        var secondEndpoint = PushTests.AllowedEndpoint();
        factory.Http.Respond(secondEndpoint, _ => { calls++; return new(HttpStatusCode.Created); });
        var fake = FakePushService.Subscription(secondEndpoint);
        await factory.InDbAsync(async db =>
        {
            var user = await db.PushSubscriptions.Where(p => p.Id == s.SubscriptionId).Select(p => p.UserId).SingleAsync();
            db.PushSubscriptions.Add(new() { UserId = user, Endpoint = secondEndpoint, P256dh = fake.P256dh, Auth = fake.Auth });
            await db.SaveChangesAsync();
        });
        await Run(s);
        Assert.Equal(1, calls);
        // The first provider acceptance cannot be recorded after the test advances past its lease.
        // The second destination must never get an expired alert, even when already in the batch.
    }

    private Task Move(Scenario s, DateTime time) => factory.InDbAsync(db => db.Sessions.Where(x => x.Id == s.SessionId)
        .ExecuteUpdateAsync(u => u.SetProperty(x => x.ScheduledStart, time)));

    [Fact]
    public async Task TriggerDisabledWithoutSecret_AndDiagnosticsRequireAdmin()
    {
        var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.PostAsync("/api/internal/notifications/run", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/internal/notifications/status")).StatusCode);
        var (member, _) = await factory.SignupAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/internal/notifications/status")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await factory.AdminAsync()).GetAsync("/api/internal/notifications/status")).StatusCode);
    }

    [Fact]
    public async Task TriggerRequiresCorrectDedicatedSecret()
    {
        const string secret = "synthetic-runner-secret-for-tests-only-1234567890";
        using var host = factory.WithWebHostBuilder(b => b.UseSetting("Notifications:RunnerSecret", secret));
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/internal/notifications/run")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", "wrong");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/internal/notifications/run", null)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", secret);
        var response = await client.PostAsync("/api/internal/notifications/run", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task ReminderPlan_UsesDelayedStartAndOneBasedHeatLabel()
    {
        // Midday, so every session lands on the same timetable day: a delay doesn't carry past midnight, and with the
        // real clock this failed between about 23:10 and 00:40 UTC.
        var now = DateTime.UtcNow.Date.AddHours(12);
        var section = await factory.NewSectionAsync();
        var plans = await factory.InDbAsync(async db =>
        {
            var team = new Team { CompetitionId = section.CompetitionId, CompetitionSectionId = section.Id,
                Club = new Club { Name = $"Example club {Guid.NewGuid():N}" }, DisplayName = "Example team" };
            var late = new Session { CompetitionId = section.CompetitionId, CompetitionSectionId = section.Id, Name = "Late start",
                Kind = SessionKind.Race, OrderIndex = 0, ScheduledStart = now.AddMinutes(-40), StartedAt = now.AddMinutes(-10), Status = SessionStatus.InArena };
            var briefing = new Session { CompetitionId = section.CompetitionId, CompetitionSectionId = section.Id, Name = "Delayed briefing",
                Kind = SessionKind.Briefing, OrderIndex = 1, ScheduledStart = now.AddMinutes(50) };
            var racing = new Session { CompetitionId = section.CompetitionId, CompetitionSectionId = section.Id, Name = "Heat race",
                Kind = SessionKind.Race, OrderIndex = 2, ScheduledStart = now.AddMinutes(-90), Status = SessionStatus.Upcoming };
            db.AddRange(team, late, briefing, racing);
            await db.SaveChangesAsync();
            racing.ScheduledStart = null;
            var heat = new Heat { SessionId = racing.Id, OrderIndex = 0, ScheduledStart = now.AddMinutes(65) };
            heat.Entries.Add(new HeatEntry { TeamId = team.Id, LaneIndex = 1 });
            db.Add(heat);
            await db.SaveChangesAsync();
            var plan = await ReminderPlan.LoadAsync(db, now, default, section.CompetitionId);
            return (plan, briefing.Id);
        });
        var brief = Assert.Single(plans.plan, p => p.Key == $"brief:{plans.Item2}");
        Assert.InRange((brief.DueAt - now).TotalMinutes, 49, 51);
        Assert.Contains(plans.plan, p => p.Payload.Body.Contains("(Heat 1,"));
    }
}
