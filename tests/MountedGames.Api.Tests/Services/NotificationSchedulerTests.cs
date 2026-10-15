using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;
using MountedGames.Api.Tests.Push;

namespace MountedGames.Api.Tests.Services;

public class NotificationSchedulerTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public NotificationSchedulerTests(ApiFactory f) => _f = f;

    private NotificationScheduler NewScheduler() => new(_f.Services, NullLogger<NotificationScheduler>.Instance);

    /// <summary>A competition with one team whose trainer is subscribed to a fake push service.</summary>
    private async Task<Scenario> ArrangeAsync(HttpStatusCode pushStatus = HttpStatusCode.Created, bool withSection = true)
    {
        var push = new FakePushService(pushStatus);
        var (client, auth) = await _f.SignupAsync();
        await client.PostAsJsonAsync("/api/push/subscribe", FakePushService.Subscription(push.Endpoint));
        var section = await _f.NewSectionAsync();
        var teamId = await _f.InDbAsync(async db =>
        {
            var team = new Team
            {
                CompetitionId = section.CompetitionId,
                CompetitionSectionId = section.Id,
                Club = new Club { Name = $"Sched {Guid.NewGuid():N}" },
                Suffix = "A",
                DisplayName = "Sched A",
                TrainerUserId = auth.User.Id,
            };
            db.Teams.Add(team);
            await db.SaveChangesAsync();
            return team.Id;
        });
        return new Scenario(push, section, teamId, withSection);
    }

    private sealed record Scenario(FakePushService Push, CompetitionSection Section, int TeamId, bool WithSection) : IDisposable
    {
        public void Dispose() => Push.Dispose();
    }

    private Task<int> AddSessionAsync(Scenario s, SessionKind kind, double minutesAhead,
        SessionStatus status = SessionStatus.Upcoming, bool withSection = true)
        => _f.InDbAsync(async db =>
        {
            var session = new Session
            {
                CompetitionId = s.Section.CompetitionId,
                CompetitionSectionId = withSection ? s.Section.Id : null,
                Name = "Session",
                Kind = kind,
                Status = status,
                ScheduledStart = DateTime.UtcNow.AddMinutes(minutesAhead),
            };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            return session.Id;
        });

    [Fact]
    public async Task Tick_PushesToTrainer_OneHourBeforeRaceSession()
    {
        using var s = await ArrangeAsync();
        await AddSessionAsync(s, SessionKind.Race, 57);

        await NewScheduler().TickAsync(CancellationToken.None);

        Assert.Equal(1, s.Push.Received);
    }

    [Fact]
    public async Task Tick_PushesForSessionWithoutSection_ToEveryTeamInCompetition()
    {
        using var s = await ArrangeAsync();
        await AddSessionAsync(s, SessionKind.Race, 57, withSection: false);

        await NewScheduler().TickAsync(CancellationToken.None);

        Assert.Equal(1, s.Push.Received);
    }

    [Fact]
    public async Task Tick_PushesThirtyMinutesBeforeBriefing()
    {
        using var s = await ArrangeAsync();
        await AddSessionAsync(s, SessionKind.Briefing, 27);

        await NewScheduler().TickAsync(CancellationToken.None);

        Assert.Equal(1, s.Push.Received);
    }

    [Fact]
    public async Task Tick_DoesNotRepeatNotification_OnLaterTicks()
    {
        using var s = await ArrangeAsync();
        await AddSessionAsync(s, SessionKind.Race, 57);
        var scheduler = NewScheduler();

        await scheduler.TickAsync(CancellationToken.None);
        await scheduler.TickAsync(CancellationToken.None);

        Assert.Equal(1, s.Push.Received);
    }

    [Theory]
    [InlineData(SessionKind.Race, 40)]       // inside the horizon but outside the 1h window
    [InlineData(SessionKind.Race, 80)]       // beyond the 1h window
    [InlineData(SessionKind.Briefing, 45)]   // briefing outside its window
    [InlineData(SessionKind.Break, 57)]      // wrong kind
    [InlineData(SessionKind.Custom, 27)]     // wrong kind
    [InlineData(SessionKind.Race, 120)]      // beyond the 90 minute horizon
    [InlineData(SessionKind.Race, -30)]      // already started
    public async Task Tick_StaysQuiet_OutsideNotificationWindows(SessionKind kind, double minutesAhead)
    {
        using var s = await ArrangeAsync();
        await AddSessionAsync(s, kind, minutesAhead);

        await NewScheduler().TickAsync(CancellationToken.None);

        Assert.Equal(0, s.Push.Received);
    }

    [Fact]
    public async Task Tick_SkipsFinishedSessions()
    {
        using var s = await ArrangeAsync();
        await AddSessionAsync(s, SessionKind.Race, 57, SessionStatus.Finished);

        await NewScheduler().TickAsync(CancellationToken.None);

        Assert.Equal(0, s.Push.Received);
    }

    [Fact]
    public async Task Tick_SkipsSession_WhenNoOneIsLinkedToTheTeams()
    {
        using var s = await ArrangeAsync();
        await _f.InDbAsync(async db =>
        {
            var team = await db.Teams.FindAsync(s.TeamId);
            team!.TrainerUserId = null;
            await db.SaveChangesAsync();
        });
        await AddSessionAsync(s, SessionKind.Race, 57);

        await NewScheduler().TickAsync(CancellationToken.None);

        Assert.Equal(0, s.Push.Received);
    }

    [Fact]
    public async Task Tick_NotifiesAcceptedSupporters_ButNotPendingOnes()
    {
        using var s = await ArrangeAsync();
        using var accepted = new FakePushService(HttpStatusCode.Created);
        using var pending = new FakePushService(HttpStatusCode.Created);
        foreach (var (svc, status) in new[] { (accepted, TeamSupporterStatus.Accepted), (pending, TeamSupporterStatus.Pending) })
        {
            var (client, auth) = await _f.SignupAsync();
            await client.PostAsJsonAsync("/api/push/subscribe", FakePushService.Subscription(svc.Endpoint));
            await _f.InDbAsync(async db =>
            {
                db.TeamSupporters.Add(new TeamSupporter { TeamId = s.TeamId, UserId = auth.User.Id, Status = status });
                await db.SaveChangesAsync();
            });
        }
        await AddSessionAsync(s, SessionKind.Race, 57);

        await NewScheduler().TickAsync(CancellationToken.None);

        Assert.Equal((1, 0), (accepted.Received, pending.Received));
    }

    [Fact]
    public async Task Tick_StillCompletes_WhenPushServiceRejects()
    {
        using var s = await ArrangeAsync(HttpStatusCode.Gone);
        await AddSessionAsync(s, SessionKind.Race, 57);

        await NewScheduler().TickAsync(CancellationToken.None);

        Assert.Equal(1, s.Push.Received);
    }

    // ---- hosted-service loop ----

    [Fact]
    public async Task Loop_RunsTicks_UntilStopped()
    {
        using var s = await ArrangeAsync();
        await AddSessionAsync(s, SessionKind.Race, 57);
        var scheduler = new NotificationScheduler(_f.Services, NullLogger<NotificationScheduler>.Instance,
            TimeSpan.Zero, TimeSpan.FromMilliseconds(5));

        await scheduler.StartAsync(CancellationToken.None);
        await s.Push.WaitForAsync(1);
        await scheduler.StopAsync(CancellationToken.None);

        Assert.Equal(1, s.Push.Received);
    }

    [Fact]
    public async Task Loop_LogsAndKeepsGoing_WhenATickThrows()
    {
        var log = new RecordingLogger();
        var broken = new ServiceCollection().BuildServiceProvider(); // no DbContext registered: every tick throws
        var scheduler = new NotificationScheduler(broken, log, TimeSpan.Zero, TimeSpan.FromMilliseconds(5));

        await scheduler.StartAsync(CancellationToken.None);
        await log.WaitForErrorsAsync(2);
        await scheduler.StopAsync(CancellationToken.None);

        Assert.True(log.Errors >= 2);
    }

    [Fact]
    public async Task Cancel_DuringStartupDelay_ExitsCleanly()
    {
        using var cts = new CancellationTokenSource();
        var scheduler = new Exposed(_f.Services, TimeSpan.FromHours(1), TimeSpan.FromHours(1));

        var run = scheduler.RunAsync(cts.Token);
        await cts.CancelAsync();
        await run;

        Assert.True(run.IsCompletedSuccessfully);
    }

    [Fact]
    public async Task Cancel_DuringIntervalDelay_ExitsCleanly()
    {
        using var s = await ArrangeAsync();
        await AddSessionAsync(s, SessionKind.Race, 57);
        using var cts = new CancellationTokenSource();
        var scheduler = new Exposed(_f.Services, TimeSpan.Zero, TimeSpan.FromHours(1));

        var run = scheduler.RunAsync(cts.Token);
        await s.Push.WaitForAsync(1); // first tick done, now parked in the interval delay
        await cts.CancelAsync();
        await run;

        Assert.True(run.IsCompletedSuccessfully);
    }

    // BackgroundService.StartAsync may cancel the task before ExecuteAsync ever runs, so drive ExecuteAsync directly.
    private sealed class Exposed : NotificationScheduler
    {
        public Exposed(IServiceProvider sp, TimeSpan startupDelay, TimeSpan interval)
            : base(sp, NullLogger<NotificationScheduler>.Instance, startupDelay, interval) { }

        public Task RunAsync(CancellationToken ct) => ExecuteAsync(ct);
    }

    private sealed class RecordingLogger : ILogger<NotificationScheduler>
    {
        private readonly SemaphoreSlim _errors = new(0);
        private int _count;
        public int Errors => Volatile.Read(ref _count);

        public async Task WaitForErrorsAsync(int n)
        {
            for (var i = 0; i < n; i++) await _errors.WaitAsync(TimeSpan.FromSeconds(15));
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (logLevel != LogLevel.Error) return;
            Interlocked.Increment(ref _count);
            _errors.Release();
        }
    }
}
