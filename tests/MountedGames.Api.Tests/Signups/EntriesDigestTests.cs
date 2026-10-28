using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Email;
using MountedGames.Api.Services.Geo;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

/// <summary>The daily "entries are open" email: what it says, who gets it, and that it can never go twice or get lost half-way.</summary>
public class EntriesDigestTests : IClassFixture<DigestApiFactory>
{
    private readonly DigestApiFactory _f;
    public EntriesDigestTests(DigestApiFactory f) => _f = f;

    private static string Addr(string prefix = "reader") => $"{prefix}-{Guid.NewGuid():N}@example.org";

    /// <summary>Saturday 24 October 2026, 18:30 BST: inside the evening window, the day before the clocks go back.</summary>
    private async Task StartAsync(int hour = 17, int minute = 30)
    {
        await _f.ResetAsync();
        _f.At(2026, 10, 24, hour, minute);
    }

    private async Task<List<EntriesDigestRun>> RunsAsync()
        => await _f.InDbAsync(db => db.EntriesDigestRuns.AsNoTracking().OrderBy(r => r.Id).ToListAsync());

    private async Task<Dictionary<EntriesDigestRecipientStatus, int>> CountsAsync(int runId)
        => await _f.InDbAsync(async db => (await db.EntriesDigestRecipients.AsNoTracking().Where(r => r.RunId == runId)
            .GroupBy(r => r.Status).Select(g => new { g.Key, N = g.Count() }).ToListAsync()).ToDictionary(x => x.Key, x => x.N));

    private EntriesDigestService Service(IServiceScope scope, EmailOptions? email = null)
    {
        var sp = scope.ServiceProvider;
        return new EntriesDigestService(sp.GetRequiredService<MountedGames.Api.Data.AppDbContext>(), sp.GetRequiredService<IEmailSender>(),
            Options.Create(email ?? sp.GetRequiredService<IOptions<EmailOptions>>().Value), sp.GetRequiredService<IConfiguration>(), _f.Clock,
            sp.GetRequiredService<LocationInference>(), NullLogger<EntriesDigestService>.Instance);
    }

    // ---- content ----

    [Fact]
    public async Task OneEmailListsTheNewEventsWithTheirDetails_AndCarriesTheUnsubscribeHeaders()
    {
        await StartAsync();
        var to = Addr();
        await _f.OptInsAsync(to);
        var close = new DateTime(2026, 11, 6, 18, 0, 0, DateTimeKind.Utc);
        var first = await _f.OpenEventAsync("Spring <b>Cup</b>", 5, venue: "Hartpury", closeAt: close);
        var second = await _f.OpenEventAsync("Autumn Open", 20);

        await _f.TickAsync();

        var run = Assert.Single(await RunsAsync());
        Assert.Equal(EntriesDigestRunStatus.Done, run.Status);
        Assert.Equal("2026-10-24", run.RunDate);
        var message = Assert.Single(_f.SentTo(to));
        Assert.Equal("2 new competitions are open for entries", message.Subject);
        Assert.StartsWith("entries-digest-", message.IdempotencyKey);
        Assert.True(message.Text.IndexOf("Spring", StringComparison.Ordinal) < message.Text.IndexOf("Autumn Open", StringComparison.Ordinal));
        Assert.Contains("Where: Hartpury", message.Text);
        Assert.Contains("Entries close: Friday 6 November 2026, 6pm", message.Text);
        Assert.Contains($"{DigestApiFactory.SiteUrl}/competitions/{first}", message.Text);
        Assert.Contains($"{DigestApiFactory.SiteUrl}/competitions/{second}", message.Text);
        Assert.Contains("/unsubscribe?token=n1.", message.Text);
        Assert.Contains("&lt;b&gt;Cup&lt;/b&gt;", message.Html);
        Assert.DoesNotContain("<b>Cup</b>", message.Html);
        var headers = message.Body.GetProperty("headers");
        Assert.Equal("List-Unsubscribe=One-Click", headers.GetProperty("List-Unsubscribe-Post").GetString());
        Assert.Contains("/api/email/unsubscribe-one-click?token=n1.", headers.GetProperty("List-Unsubscribe").GetString());
    }

    [Fact]
    public async Task OneNewEventGetsItsOwnSubject()
    {
        await StartAsync();
        var to = Addr();
        await _f.OptInsAsync(to);
        await _f.OpenEventAsync("Summer Show");
        await _f.TickAsync();
        Assert.Equal("Entries are open for Summer Show", Assert.Single(_f.SentTo(to)).Subject);
    }

    [Fact]
    public async Task NothingNewMeansNoEmailAndNoRun()
    {
        await StartAsync();
        await _f.OptInsAsync(Addr());
        await _f.TickAsync();
        Assert.Empty(_f.Sent);
        Assert.Empty(await RunsAsync());
    }

    [Fact]
    public async Task TheFirstEverTickOnlyRecordsWhatIsAlreadyOpen_ThenNewEventsAreAnnounced()
    {
        await StartAsync();
        var to = Addr();
        await _f.OptInsAsync(to);
        var already = await _f.OpenEventAsync("Already open");
        await _f.TickAsync(allowBaseline: true);

        var baseline = Assert.Single(await RunsAsync());
        Assert.Equal(EntriesDigestRunStatus.Baseline, baseline.Status);
        Assert.Equal(EntriesDigestRun.BaselineKey, baseline.RunDate);
        Assert.Empty(_f.Sent);
        Assert.True(await _f.InDbAsync(db => db.EntriesDigestCompetitions.AnyAsync(c => c.CompetitionId == already)));

        var fresh = await _f.OpenEventAsync("Opened tonight");
        await _f.TickAsync(allowBaseline: true);
        var message = Assert.Single(_f.SentTo(to));
        Assert.Contains("Opened tonight", message.Text);
        Assert.DoesNotContain("Already open", message.Text);
        Assert.Contains($"/competitions/{fresh}", message.Text);
    }

    [Fact]
    public async Task ABaselineIsKeptEvenWhenNothingIsOpenYet_SoLaterEventsAreNotSwallowed()
    {
        await StartAsync();
        await _f.OptInsAsync(Addr());
        await _f.TickAsync(allowBaseline: true);
        Assert.Equal(EntriesDigestRunStatus.Baseline, Assert.Single(await RunsAsync()).Status);
        await _f.OpenEventAsync("Opens later");
        await _f.TickAsync(allowBaseline: true);
        Assert.Single(_f.Sent);
    }

    // ---- which events ----

    [Fact]
    public async Task DemoLockedClosedArchivedAndEmptyEventsAreNeverAnnounced()
    {
        await StartAsync();
        var to = Addr();
        await _f.OptInsAsync(to);
        await _f.OpenEventAsync("Demo show", demo: true);
        await _f.OpenEventAsync("Locked show", locked: true);
        await _f.OpenEventAsync("Closed show", closeAt: new DateTime(2026, 10, 24, 12, 0, 0, DateTimeKind.Utc));
        await _f.OpenEventAsync("Archived show", archived: true);
        await _f.OpenEventAsync("No age groups", sections: false);
        await _f.OpenEventAsync("Finished show", daysAhead: -3);
        await _f.OpenEventAsync("Real show", closeAt: new DateTime(2026, 10, 30, 12, 0, 0, DateTimeKind.Utc));
        await _f.TickAsync();
        var message = Assert.Single(_f.SentTo(to));
        Assert.Equal("Entries are open for Real show", message.Subject);
        Assert.Equal(1, Assert.Single(await RunsAsync()).Competitions);
    }

    [Fact]
    public async Task AnEventLockedAfterTheRunWasClaimedIsDroppedFromTheEmail_AndAnEmptyEmailIsNotSent()
    {
        await StartAsync();
        var one = Addr();
        await _f.OptInsAsync(one);
        var keep = await _f.OpenEventAsync("Stays open");
        var lockedLater = await _f.OpenEventAsync("Locked later");
        using (var scope = _f.Services.CreateScope())
            Assert.NotNull(await Service(scope).ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None));
        await _f.InDbAsync(db => db.Competitions.Where(c => c.Id == lockedLater).ExecuteUpdateAsync(s => s.SetProperty(c => c.SignupsLocked, true)));
        await _f.TickAsync();
        var message = Assert.Single(_f.SentTo(one));
        Assert.Equal("Entries are open for Stays open", message.Subject);
        Assert.DoesNotContain("Locked later", message.Text);

        // The run's only event gets locked before anyone is mailed: nobody gets an empty email.
        await StartAsync();
        var other = Addr();
        await _f.OptInsAsync(other);
        var only = await _f.OpenEventAsync("Only one");
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None);
        await _f.InDbAsync(db => db.Competitions.Where(c => c.Id == only).ExecuteUpdateAsync(s => s.SetProperty(c => c.SignupsLocked, true)));
        await _f.TickAsync();
        Assert.Empty(_f.Sent);
        var run = Assert.Single(await RunsAsync());
        Assert.Equal(EntriesDigestRunStatus.Done, run.Status);
        Assert.Equal(1, (await CountsAsync(run.Id))[EntriesDigestRecipientStatus.Skipped]);
        Assert.NotEqual(0, keep);
    }

    [Fact]
    public async Task TheEmailSaysWhatWasTrueWhenTheRunWasClaimed_NotWhatTheOrganiserTypedSince()
    {
        await StartAsync();
        var people = Enumerable.Range(0, 7).Select(_ => Addr()).ToArray(); // more than two batches of three
        await _f.OptInsAsync(people);
        var id = await _f.OpenEventAsync("Spring Cup", 12, 52.0, -2.0, venue: "Hartpury");
        using (var scope = _f.Services.CreateScope())
            Assert.NotNull(await Service(scope).ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None));
        var frozen = await _f.InDbAsync(db => db.EntriesDigestCompetitions.AsNoTracking().SingleAsync(c => c.CompetitionId == id));
        Assert.Equal(("Spring Cup", "Hartpury"), (frozen.Name, frozen.Location));

        // Someone with the organiser's login puts something else in front of the whole list between the claim and the sends.
        await _f.InDbAsync(db => db.Competitions.Where(c => c.Id == id).ExecuteUpdateAsync(s => s
            .SetProperty(c => c.Name, "Click here to win a prize").SetProperty(c => c.Location, "Somewhere else entirely")
            .SetProperty(c => c.StartDate, new DateTime(2027, 5, 1, 0, 0, 0, DateTimeKind.Utc))));
        await _f.TickAsync();

        Assert.Equal(people.Length, _f.Sent.Count);
        foreach (var message in _f.Sent)
        {
            Assert.Equal("Entries are open for Spring Cup", message.Subject);
            Assert.Contains("Where: Hartpury", message.Text);
            Assert.DoesNotContain("prize", message.Text + message.Html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("Somewhere else", message.Text);
            Assert.DoesNotContain("2027", message.Text);
        }
    }

    [Fact]
    public async Task ANewCompetitionWaitsSixHoursBeforeItIsAnnounced_SoAdminsCanSpotABadName()
    {
        await StartAsync();
        var to = Addr();
        await _f.OptInsAsync(to);
        var id = await _f.OpenEventAsync("Just created", age: TimeSpan.FromHours(5));
        using (var scope = _f.Services.CreateScope())
        {
            var status = await Service(scope).StatusAsync(CancellationToken.None);
            Assert.Equal(0, status.PendingCount);
        }
        await _f.TickAsync();
        Assert.Empty(_f.Sent);
        Assert.Empty(await RunsAsync());

        // Once it has been there six hours (still inside the evening window) it goes in; before that nothing is lost or marked announced.
        _f.At(2026, 10, 24, 18, 31);
        await _f.TickAsync();
        Assert.Contains("Just created", Assert.Single(_f.SentTo(to)).Text);
        Assert.True(await _f.InDbAsync(db => db.EntriesDigestCompetitions.AnyAsync(c => c.CompetitionId == id)));
    }

    [Fact]
    public async Task AnAdminCanArchiveABadlyNamedNewCompetitionInTheWaitingTime()
    {
        await StartAsync();
        await _f.OptInsAsync(Addr());
        var id = await _f.OpenEventAsync("Oops typo", age: TimeSpan.FromHours(1));
        await _f.TickAsync();
        await _f.InDbAsync(db => db.Competitions.Where(c => c.Id == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.IsArchived, true)));
        _f.At(2026, 10, 24, 21, 0);
        await _f.TickAsync();
        Assert.Empty(_f.Sent);
        Assert.Empty(await RunsAsync());
    }

    [Fact]
    public async Task ACompetitionIsAnnouncedOnce_EvenIfTheOrganiserUnlocksItAgain()
    {
        await StartAsync();
        await _f.OptInsAsync(Addr());
        var id = await _f.OpenEventAsync("Round and round");
        await _f.TickAsync();
        Assert.Single(_f.Sent);
        _f.Sent.Clear();
        _f.At(2026, 10, 25, 17, 30);
        await _f.InDbAsync(db => db.Competitions.Where(c => c.Id == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.SignupsLocked, true)));
        await _f.InDbAsync(db => db.Competitions.Where(c => c.Id == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.SignupsLocked, false)));
        await _f.TickAsync();
        Assert.Empty(_f.Sent);
        Assert.Single(await RunsAsync());
    }

    // ---- who gets it ----

    [Fact]
    public async Task UnsubscribedPeopleAreLeftOut_IncludingSomeoneWhoLeavesAfterTheRunBegan()
    {
        await StartAsync();
        var stays = Addr(); var leavesBefore = Addr(); var leavesDuring = Addr();
        var ids = await _f.OptInsAsync(stays, leavesBefore, leavesDuring);
        await _f.InDbAsync(db => db.EmailOptIns.Where(o => o.Id == ids[1]).ExecuteUpdateAsync(s => s.SetProperty(o => o.UnsubscribedAt, DateTime.UtcNow)));
        await _f.OpenEventAsync("Open for all");
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None);
        await _f.InDbAsync(db => db.EmailOptIns.Where(o => o.Id == ids[2]).ExecuteUpdateAsync(s => s.SetProperty(o => o.UnsubscribedAt, DateTime.UtcNow)));
        await _f.TickAsync();
        Assert.Single(_f.SentTo(stays));
        Assert.Empty(_f.SentTo(leavesBefore));
        Assert.Empty(_f.SentTo(leavesDuring));
        var run = Assert.Single(await RunsAsync());
        Assert.Equal(2, run.Total);
        var counts = await CountsAsync(run.Id);
        Assert.Equal(1, counts[EntriesDigestRecipientStatus.Sent]);
        Assert.Equal(1, counts[EntriesDigestRecipientStatus.Skipped]);
    }

    [Fact]
    public async Task OneRowPerAddress_AndMadeUpAddressesAreLeftOut()
    {
        await StartAsync();
        var twice = Addr();
        await _f.OptInsAsync(twice, twice.ToUpperInvariant(), "nobody@mg.local");
        await _f.OpenEventAsync("Open");
        await _f.TickAsync();
        Assert.Single(_f.Sent);
    }

    // ---- ordering ----

    [Fact]
    public async Task SomeoneWithEntryHistoryGetsNearestFirst_AndEveryoneElseGetsDateOrder()
    {
        await StartAsync();
        var local = Addr("local"); var stranger = Addr("stranger");
        await _f.OptInsAsync(local, stranger);
        // Past venue near Exeter, where "local" has entered before (the address they gave on the form).
        var past = await _f.OpenEventAsync("Old venue", -100, 50.7, -3.5);
        var section = await _f.InDbAsync(db => db.CompetitionSections.Where(s => s.CompetitionId == past).Select(s => s.Id).FirstAsync());
        await _f.InDbAsync(async db =>
        {
            db.SectionSignups.Add(new SectionSignup { CompetitionSectionId = section, FullName = "Parent", ContactEmail = local, Status = SignupPaymentStatus.Paid });
            await db.SaveChangesAsync();
        });
        await _f.OpenEventAsync("A north", 3, 55.9, -3.2);       // Edinburgh, soonest
        await _f.OpenEventAsync("B unplaced", 5);                  // no coordinates
        await _f.OpenEventAsync("C south west", 8, 50.9, -3.4);  // near Exeter
        await _f.OpenEventAsync("D middle", 12, 52.5, -1.9);     // Birmingham

        await _f.TickAsync();

        var near = _f.SentTo(local).Single().Text;
        Assert.True(Position(near, "C south west") < Position(near, "D middle"));
        Assert.True(Position(near, "D middle") < Position(near, "A north"));
        Assert.True(Position(near, "A north") < Position(near, "B unplaced"));
        var plain = _f.SentTo(stranger).Single().Text;
        Assert.True(Position(plain, "A north") < Position(plain, "B unplaced"));
        Assert.True(Position(plain, "B unplaced") < Position(plain, "C south west"));
        Assert.True(Position(plain, "C south west") < Position(plain, "D middle"));
    }

    private static int Position(string text, string needle) => text.IndexOf(needle, StringComparison.Ordinal);

    // ---- never twice, never lost ----

    [Fact]
    public async Task TwoInstancesTickingTogetherSendOneEmailEach()
    {
        await StartAsync();
        var people = Enumerable.Range(0, 8).Select(i => Addr($"p{i}")).ToArray();
        await _f.OptInsAsync(people);
        await _f.OpenEventAsync("Busy night");

        await Task.WhenAll(_f.TickAsync(), _f.TickAsync(), _f.TickAsync());
        await _f.TickAsync();

        Assert.Single(await RunsAsync());
        foreach (var person in people) Assert.Single(_f.SentTo(person));
        Assert.Equal(8, _f.Sent.Count);
    }

    [Fact]
    public async Task TickingAgainTheSameEveningSendsNothingMore_EvenForAnEventOpenedInBetween()
    {
        await StartAsync();
        var to = Addr();
        await _f.OptInsAsync(to);
        await _f.OpenEventAsync("First");
        await _f.TickAsync();
        await _f.OpenEventAsync("Second, too late");
        _f.At(2026, 10, 24, 20, 0);
        await _f.TickAsync();
        Assert.Single(_f.SentTo(to));
        // Tomorrow evening it goes out.
        _f.At(2026, 10, 25, 18, 30);
        await _f.TickAsync();
        Assert.Equal(2, _f.SentTo(to).Count);
        Assert.Contains("Second, too late", _f.SentTo(to)[1].Text);
    }

    [Fact]
    public async Task ARunStoppedHalfWayIsCarriedOnWithoutRepeatingAnyone()
    {
        await StartAsync();
        var people = Enumerable.Range(0, 7).Select(i => Addr($"q{i}")).ToArray();
        await _f.OptInsAsync(people);
        await _f.OpenEventAsync("Half way");
        int runId;
        using (var scope = _f.Services.CreateScope())
        {
            var service = Service(scope);
            runId = (await service.ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None))!.Id;
            await service.WorkAsync(runId, TimeSpan.Zero, CancellationToken.None); // out of time after the first person, then "the instance goes away"
        }
        Assert.Single(_f.Sent);
        Assert.Equal(EntriesDigestRunStatus.Sending, (await RunsAsync()).Single().Status);

        await _f.TickAsync();
        Assert.Equal(7, _f.Sent.Count);
        foreach (var person in people) Assert.Single(_f.SentTo(person));
        Assert.Equal(EntriesDigestRunStatus.Done, (await RunsAsync()).Single().Status);
    }

    [Fact]
    public async Task AnAbandonedClaimIsRetakenOnlyOnceItIsStale()
    {
        await StartAsync();
        var to = Addr();
        var ids = await _f.OptInsAsync(to);
        await _f.OpenEventAsync("Claimed");
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None);
        var now = _f.Clock.GetUtcNow().UtcDateTime;
        await _f.InDbAsync(db => db.EntriesDigestRecipients.ExecuteUpdateAsync(s => s
            .SetProperty(r => r.Status, EntriesDigestRecipientStatus.Claimed).SetProperty(r => r.ClaimedAt, now.AddSeconds(-30))
            .SetProperty(r => r.ClaimToken, Guid.NewGuid())));
        await _f.TickAsync();
        Assert.Empty(_f.Sent); // another instance is still on it

        _f.At(2026, 10, 24, 17, 35);
        await _f.TickAsync();
        Assert.Single(_f.SentTo(to));
        Assert.NotEmpty(ids);
    }

    [Fact]
    public async Task AClaimAbandonedAgainAndAgainIsGivenUpOn_NotRetriedForEver()
    {
        await StartAsync();
        var stuck = Addr();
        var fine = Addr();
        await _f.OptInsAsync(stuck, fine);
        await _f.OpenEventAsync("Dies mid-send");
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None);
        var now = _f.Clock.GetUtcNow().UtcDateTime;
        var firstId = await _f.InDbAsync(db => db.EntriesDigestRecipients.OrderBy(r => r.Id).Select(r => r.Id).FirstAsync());
        // The first person's claim has been taken and abandoned three times already (every attempt killed the instance).
        await _f.InDbAsync(db => db.EntriesDigestRecipients.Where(r => r.Id == firstId).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.Status, EntriesDigestRecipientStatus.Claimed).SetProperty(r => r.ClaimedAt, now.AddMinutes(-10))
            .SetProperty(r => r.ClaimToken, Guid.NewGuid()).SetProperty(r => r.Attempts, EntriesDigestService.MaxAttempts)));

        await _f.TickAsync();

        Assert.Single(_f.Sent); // only the other person
        var run = Assert.Single(await RunsAsync());
        Assert.Equal(EntriesDigestRunStatus.Done, run.Status);
        var counts = await CountsAsync(run.Id);
        Assert.Equal(1, counts[EntriesDigestRecipientStatus.Failed]);
        Assert.Equal(1, counts[EntriesDigestRecipientStatus.Sent]);
        Assert.Equal(EntriesDigestService.MaxAttempts, await _f.InDbAsync(db => db.EntriesDigestRecipients.Where(r => r.Id == firstId).Select(r => r.Attempts).SingleAsync()));
    }

    [Fact]
    public async Task AFailedSendIsRetriedAfterAWait_ThenGivenUpOn()
    {
        await StartAsync();
        var to = Addr();
        await _f.OptInsAsync(to);
        await _f.OpenEventAsync("Flaky provider");
        _f.Fail = () => new HttpResponseMessage(HttpStatusCode.InternalServerError);
        await _f.TickAsync();
        var run = (await RunsAsync()).Single();
        Assert.Equal(EntriesDigestRunStatus.Sending, run.Status);
        Assert.Equal(1, (await CountsAsync(run.Id))[EntriesDigestRecipientStatus.Failed]);

        var before = _f.Sent.Count;
        _f.At(2026, 10, 24, 17, 40);
        await _f.TickAsync();
        Assert.Equal(before, _f.Sent.Count); // too soon to try again

        for (var attempt = 2; attempt <= EntriesDigestService.MaxAttempts; attempt++)
        {
            _f.At(2026, 10, 24, 17, 30 + 16 * attempt);
            await _f.TickAsync();
        }
        run = (await RunsAsync()).Single();
        Assert.Equal(EntriesDigestRunStatus.Done, run.Status);
        Assert.Equal(EntriesDigestService.MaxAttempts, _f.Sent.Count);
        Assert.False((await CountsAsync(run.Id)).ContainsKey(EntriesDigestRecipientStatus.Sent));

        // A provider that comes back in time delivers it, and the run finishes.
        await StartAsync();
        var again = Addr();
        await _f.OptInsAsync(again);
        await _f.OpenEventAsync("Recovers");
        _f.Fail = () => new HttpResponseMessage(HttpStatusCode.BadGateway);
        await _f.TickAsync();
        _f.Fail = null;
        _f.At(2026, 10, 24, 17, 50);
        await _f.TickAsync();
        run = (await RunsAsync()).Single();
        Assert.Equal(EntriesDigestRunStatus.Done, run.Status);
        Assert.Equal(1, (await CountsAsync(run.Id))[EntriesDigestRecipientStatus.Sent]);
    }

    [Fact]
    public async Task ARunLeftForTwoDaysIsClosedAndNeverArrivesLate()
    {
        await StartAsync();
        await _f.OptInsAsync(Addr());
        await _f.OpenEventAsync("Stale");
        _f.Fail = () => new HttpResponseMessage(HttpStatusCode.InternalServerError);
        await _f.TickAsync();
        _f.Fail = null;
        _f.At(2026, 10, 27, 8, 0); // outside the window, so only the clean-up can act
        await _f.TickAsync();
        var run = (await RunsAsync()).Single();
        Assert.Equal(EntriesDigestRunStatus.Done, run.Status);
        Assert.NotNull(run.CompletedAt);
        Assert.Equal(1, (await CountsAsync(run.Id))[EntriesDigestRecipientStatus.Skipped]);
    }

    // ---- the clock ----

    [Theory]
    [InlineData(2026, 10, 24, 17, 30, true)]   // 18:30 BST, the day before the clocks go back
    [InlineData(2026, 10, 24, 16, 59, false)]  // 17:59 BST
    [InlineData(2026, 10, 24, 21, 59, true)]   // 22:59 BST
    [InlineData(2026, 10, 24, 22, 0, false)]   // 23:00 BST
    [InlineData(2026, 10, 26, 17, 30, false)]  // 17:30 GMT: not yet, though 17:30 UTC was in the window a week earlier
    [InlineData(2026, 10, 26, 18, 0, true)]    // 18:00 GMT
    [InlineData(2026, 10, 26, 22, 59, true)]   // 22:59 GMT
    [InlineData(2026, 10, 26, 23, 0, false)]   // 23:00 GMT
    [InlineData(2026, 3, 28, 17, 30, false)]   // 17:30 GMT, the day before the clocks go forward
    [InlineData(2026, 3, 29, 17, 30, true)]    // 18:30 BST
    [InlineData(2026, 3, 29, 16, 59, false)]   // 17:59 BST
    public async Task TheEveningWindowFollowsUkTimeAcrossBothClockChanges(int y, int m, int d, int h, int min, bool sends)
    {
        await _f.ResetAsync();
        _f.At(y, m, d, h, min);
        await _f.OptInsAsync(Addr());
        await _f.OpenEventAsync("Clock test");
        await _f.TickAsync();
        Assert.Equal(sends ? 1 : 0, _f.Sent.Count);
        if (sends) Assert.Equal($"{y:0000}-{m:00}-{d:00}", (await RunsAsync()).Single().RunDate);
    }

    // ---- email off ----

    [Fact]
    public async Task WhenEmailIsOffNothingIsClaimedMarkedAnnouncedOrSent()
    {
        await StartAsync();
        await _f.OptInsAsync(Addr());
        var id = await _f.OpenEventAsync("Waiting");
        using var scope = _f.Services.CreateScope();
        var off = Service(scope, new EmailOptions { Enabled = false });
        await off.TickAsync(allowBaseline: true, CancellationToken.None);
        Assert.Empty(await RunsAsync());
        Assert.Empty(_f.Sent);
        Assert.False(await _f.InDbAsync(db => db.EntriesDigestCompetitions.AnyAsync(c => c.CompetitionId == id)));

        var status = await off.StatusAsync(CancellationToken.None);
        Assert.False(status.CanSend);
        Assert.Contains("switched off", status.CannotSendBecause);
        Assert.Equal(1, status.PendingCount);
        var ex = await Assert.ThrowsAsync<EntriesDigestException>(() => off.SendNowAsync(1, CancellationToken.None));
        Assert.Equal(409, ex.StatusCode);

        // Without a website address there are no links to put in, so it also waits.
        var noSiteConfig = new EntriesDigestService(scope.ServiceProvider.GetRequiredService<MountedGames.Api.Data.AppDbContext>(),
            scope.ServiceProvider.GetRequiredService<IEmailSender>(), Options.Create(new EmailOptions { Enabled = true, ApiKey = "k", From = "x <x@example.org>" }),
            new ConfigurationBuilder().Build(), _f.Clock, scope.ServiceProvider.GetRequiredService<LocationInference>(), NullLogger<EntriesDigestService>.Instance);
        Assert.Contains("website address", (await noSiteConfig.StatusAsync(CancellationToken.None)).CannotSendBecause);
    }

    // ---- the admin card ----

    [Fact]
    public async Task OnlySiteAdminsSeeTheCardOrPressSendNow()
    {
        var anonymous = _f.CreateClient();
        var (trainer, _) = await _f.ApprovedTrainerAsync();
        var body = new SendEntriesDigestRequest(true, 1);
        foreach (var (client, expected) in new[] { (anonymous, HttpStatusCode.Unauthorized), (trainer, HttpStatusCode.Forbidden) })
        {
            Assert.Equal(expected, (await client.GetAsync("/api/admin/entries-digest")).StatusCode);
            Assert.Equal(expected, (await client.PostAsJsonAsync("/api/admin/entries-digest/send", body)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).GetAsync("/api/admin/entries-digest")).StatusCode);
    }

    [Fact]
    public async Task SendNowStartsTodaysRun_ReportsIt_AndRefusesToRepeatIt()
    {
        await StartAsync(hour: 9); // morning: the evening tick would not act yet
        var people = new[] { Addr(), Addr() };
        await _f.OptInsAsync(people);
        var admin = await _f.AdminAsync();

        var before = await (await admin.GetAsync("/api/admin/entries-digest")).ReadAsync<EntriesDigestStatusDto>();
        Assert.True(before.CanSend);
        Assert.Equal(2, before.Recipients);
        Assert.Equal(0, before.PendingCount);
        Assert.Null(before.Last);
        Assert.Equal(409, (await Problem(admin, new SendEntriesDigestRequest(true, 2))).Status); // nothing new yet
        Assert.Equal(400, (await Problem(admin, new SendEntriesDigestRequest(false, 2))).Status);

        await _f.OpenEventAsync("Morning opener", 4, venue: "Somewhere");
        var pending = await (await admin.GetAsync("/api/admin/entries-digest")).ReadAsync<EntriesDigestStatusDto>();
        Assert.Equal("Morning opener", Assert.Single(pending.Pending).Name);
        Assert.False(pending.TodayClaimed);
        Assert.Equal(new DateTime(2026, 10, 24, 17, 0, 0, DateTimeKind.Utc), pending.NextSendUtc); // 18:00 BST

        Assert.Equal(409, (await Problem(admin, new SendEntriesDigestRequest(true, 5))).Status); // the list changed
        var response = await admin.PostAsJsonAsync("/api/admin/entries-digest/send", new SendEntriesDigestRequest(true, 2));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var after = await response.ReadAsync<EntriesDigestStatusDto>();
        Assert.True(after.TodayClaimed);
        Assert.Equal(0, after.PendingCount);
        Assert.NotNull(after.Last);
        Assert.True(after.Last!.Manual);
        Assert.Equal(2, after.Last.Sent);
        Assert.Equal(0, after.Last.Remaining);
        Assert.Equal(EntriesDigestRunStatus.Done, after.Last.Status);
        Assert.Equal(new DateTime(2026, 10, 25, 18, 0, 0, DateTimeKind.Utc), after.NextSendUtc); // tomorrow 18:00 is GMT: the clocks go back overnight
        foreach (var person in people) Assert.Single(_f.SentTo(person));

        await _f.OpenEventAsync("Opened afterwards");
        Assert.Equal(409, (await Problem(admin, new SendEntriesDigestRequest(true, 2))).Status); // today's has gone
        _f.At(2026, 10, 24, 18, 30);
        await _f.TickAsync(); // the evening tick finds today's already claimed
        Assert.Equal(2, _f.Sent.Count);
    }

    [Fact]
    public async Task SendNowCarriesOnARunThatIsPartWay()
    {
        await StartAsync(hour: 9);
        var people = Enumerable.Range(0, 5).Select(i => Addr($"w{i}")).ToArray();
        await _f.OptInsAsync(people);
        await _f.OpenEventAsync("Part way");
        using (var scope = _f.Services.CreateScope())
        {
            var service = Service(scope);
            var run = (await service.ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None))!;
            await service.WorkAsync(run.Id, TimeSpan.Zero, CancellationToken.None);
        }
        Assert.Single(_f.Sent);
        var admin = await _f.AdminAsync();
        var status = await (await admin.PostAsJsonAsync("/api/admin/entries-digest/send", new SendEntriesDigestRequest(true, 5))).ReadAsync<EntriesDigestStatusDto>();
        Assert.Equal(5, _f.Sent.Count);
        Assert.Equal(5, status.Last!.Sent);
    }

    private static async Task<ProblemInfo> Problem(HttpClient client, SendEntriesDigestRequest body)
    {
        var response = await client.PostAsJsonAsync("/api/admin/entries-digest/send", body);
        return new ProblemInfo((int)response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private sealed record ProblemInfo(int Status, string Body);

    // ---- the scheduler ----

    [Fact]
    public async Task TheSchedulerTickRunsTheDigest()
    {
        await StartAsync();
        await _f.OptInsAsync(Addr());
        await _f.OpenEventAsync("Scheduled");
        var scheduler = new NotificationScheduler(_f.Services, NullLogger<NotificationScheduler>.Instance);
        await scheduler.DigestTickAsync(CancellationToken.None);
        Assert.Equal(EntriesDigestRunStatus.Baseline, Assert.Single(await RunsAsync()).Status);
    }

    // ---- the failing claim ----

    [Fact]
    public async Task ALostClaimRaceLeavesNothingBehind()
    {
        await StartAsync();
        await _f.OptInsAsync(Addr());
        var id = await _f.OpenEventAsync("Raced");
        using var scope = _f.Services.CreateScope();
        var service = Service(scope);
        Assert.NotNull(await service.ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None));
        // Another instance already holds the day, so the second claim fails whole; nothing extra is written.
        await _f.OpenEventAsync("Raced too");
        Assert.Null(await service.ClaimRunAsync("2026-10-24", EntriesDigestRunStatus.Sending, false, CancellationToken.None));
        Assert.Single(await RunsAsync());
        Assert.Equal(1, await _f.InDbAsync(db => db.EntriesDigestCompetitions.CountAsync()));
        Assert.NotEqual(0, id);
    }
}
