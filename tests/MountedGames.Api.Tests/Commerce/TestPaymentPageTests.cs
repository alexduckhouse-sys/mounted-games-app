using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Commerce;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Commerce;

/// <summary>The sales-demo test payment page: only demo events, every outcome idempotent, never real income.</summary>
public class TestPaymentPageTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public TestPaymentPageTests(ApiFactory f) => _f = f;

    private async Task<(CompetitionSection Section, HttpClient Entrant, SectionSignupDto Signup)> DemoEntryAsync(int price = 1500)
    {
        var section = await _f.NewSectionAsync(priceMinor: price);
        var admin = await _f.AdminAsync();
        var marked = await admin.PutAsJsonAsync($"/api/commerce/competitions/{section.CompetitionId}/settings",
            new UpdateEventCommerceSettingsRequest(true));
        Assert.Equal(HttpStatusCode.OK, marked.StatusCode);
        return await EnterAsync(section);
    }

    private async Task<(CompetitionSection Section, HttpClient Entrant, SectionSignupDto Signup)> EnterAsync(CompetitionSection section)
    {
        var (entrant, _) = await _f.SignupAsync();
        var signup = await (await entrant.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups",
            new CreateSectionSignupRequest("Test entrant", null, null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion))).ReadAsync<SectionSignupDto>();
        return (section, entrant, signup);
    }

    private static FakeCheckoutRequest Key(string key, FakePaymentOutcome outcome) => new(key, outcome);

    private Task<RealIncome> IncomeAsync(int competitionId) =>
        _f.InDbAsync(db => RealIncome.ForCompetitionAsync(db, competitionId));

    [Fact]
    public async Task RealEventEntryNeverReachesTheFakeProvider()
    {
        var section = await _f.NewSectionAsync(priceMinor: 2000);
        var (_, entrant, signup) = await EnterAsync(section);
        var (other, _) = await _f.SignupAsync();

        foreach (var outcome in new[] { FakePaymentOutcome.Success, FakePaymentOutcome.Decline, FakePaymentOutcome.Cancel })
        {
            var response = await entrant.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-checkout", Key($"real-{outcome}", outcome));
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
        var refund = await entrant.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-refund", Key("real-refund", FakePaymentOutcome.Success));
        var stranger = await other.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-checkout", Key("stranger", FakePaymentOutcome.Success));
        var anonymous = await _f.CreateClient().PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-checkout", Key("anon", FakePaymentOutcome.Success));

        Assert.Equal(HttpStatusCode.Forbidden, refund.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, stranger.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal(SignupPaymentStatus.Pending,
            await _f.InDbAsync(db => db.SectionSignups.Where(x => x.Id == signup.Id).Select(x => x.Status).SingleAsync()));
        Assert.False(await _f.InDbAsync(db => db.Set<TestPaymentRecord>().AnyAsync(x => x.CompetitionId == section.CompetitionId)));
    }

    [Fact]
    public async Task RealEventKeepsTheOrganiserConfirmedRoute()
    {
        var section = await _f.NewSectionAsync(priceMinor: 2000);
        var (_, _, signup) = await EnterAsync(section);
        var admin = await _f.AdminAsync();

        var paid = await admin.PutAsJsonAsync($"/api/signups/{signup.Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Paid));

        Assert.Equal(HttpStatusCode.OK, paid.StatusCode);
        Assert.Equal(2000, (await IncomeAsync(section.CompetitionId)).EntriesMinor);
    }

    [Fact]
    public async Task EveryOutcomeIsIdempotentAndFlaggedAsTest()
    {
        var (section, entrant, signup) = await DemoEntryAsync();
        var pay = $"/api/commerce/signups/{signup.Id}/demo-checkout";
        var refundUrl = $"/api/commerce/signups/{signup.Id}/demo-refund";

        var decline = Key("decline-1", FakePaymentOutcome.Decline);
        var declined = await (await entrant.PostAsJsonAsync(pay, decline)).ReadAsync<DemoEntryPaymentResultDto>();
        var declinedAgain = await (await entrant.PostAsJsonAsync(pay, decline)).ReadAsync<DemoEntryPaymentResultDto>();
        var cancel = Key("cancel-1", FakePaymentOutcome.Cancel);
        var cancelled = await (await entrant.PostAsJsonAsync(pay, cancel)).ReadAsync<DemoEntryPaymentResultDto>();
        var cancelledAgain = await (await entrant.PostAsJsonAsync(pay, cancel)).ReadAsync<DemoEntryPaymentResultDto>();
        var success = Key("success-1", FakePaymentOutcome.Success);
        var paid = await (await entrant.PostAsJsonAsync(pay, success)).ReadAsync<DemoEntryPaymentResultDto>();
        var paidAgain = await (await entrant.PostAsJsonAsync(pay, success)).ReadAsync<DemoEntryPaymentResultDto>();
        var refundKey = Key("refund-1", FakePaymentOutcome.Success);
        var refunded = await (await entrant.PostAsJsonAsync(refundUrl, refundKey)).ReadAsync<DemoEntryPaymentResultDto>();
        var refundedAgain = await (await entrant.PostAsJsonAsync(refundUrl, refundKey)).ReadAsync<DemoEntryPaymentResultDto>();

        Assert.Equal((SignupPaymentStatus.Pending, SignupPaymentStatus.Pending), (declined.SignupStatus, cancelled.SignupStatus));
        Assert.Equal(declined.Payment.Id, declinedAgain.Payment.Id);
        Assert.Equal(cancelled.Payment.Id, cancelledAgain.Payment.Id);
        Assert.Equal(paid.Payment.Id, paidAgain.Payment.Id);
        Assert.Equal(refunded.Payment.Id, refundedAgain.Payment.Id);
        Assert.Equal((SignupPaymentStatus.Paid, SignupPaymentStatus.Refunded), (paid.SignupStatus, refunded.SignupStatus));
        var records = await _f.InDbAsync(db => db.Set<TestPaymentRecord>().Where(x => x.CompetitionId == section.CompetitionId).ToListAsync());
        Assert.Equal(4, records.Count);
        Assert.All(records, x => Assert.True(x.IsTest && x.Provider == "fake" && x.ReceiptReference.StartsWith("TEST-")));
        Assert.All(records, x => Assert.Contains("TEST", x.ReceiptLabel));
    }

    [Fact]
    public async Task ReusedKeyForAnotherOutcomeAndSecondPaymentAreRefused()
    {
        var (_, entrant, signup) = await DemoEntryAsync();
        var url = $"/api/commerce/signups/{signup.Id}/demo-checkout";
        Assert.Equal(HttpStatusCode.OK, (await entrant.PostAsJsonAsync(url, Key("same", FakePaymentOutcome.Success))).StatusCode);

        var reuse = await entrant.PostAsJsonAsync(url, Key("same", FakePaymentOutcome.Decline));
        var second = await entrant.PostAsJsonAsync(url, Key("another", FakePaymentOutcome.Success));
        var noKey = await entrant.PostAsJsonAsync(url, new FakeCheckoutRequest(null, FakePaymentOutcome.Success));
        var refund = await entrant.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-refund", Key("r1", FakePaymentOutcome.Success));
        var refundAgain = await entrant.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-refund", Key("r2", FakePaymentOutcome.Success));

        Assert.Equal(HttpStatusCode.Conflict, reuse.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, noKey.StatusCode);
        Assert.Equal(HttpStatusCode.OK, refund.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, refundAgain.StatusCode);
    }

    [Fact]
    public async Task FreeEntriesDoNotUseTheTestCheckout()
    {
        var (_, entrant, signup) = await DemoEntryAsync(price: 0);

        var response = await entrant.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-checkout", Key("free", FakePaymentOutcome.Success));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task DemoModeCannotBeTurnedOnForAnEventWithPaidEntries()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await EnterAsync(section);
        var admin = await _f.AdminAsync();

        var turnOn = await admin.PutAsJsonAsync($"/api/commerce/competitions/{section.CompetitionId}/settings",
            new UpdateEventCommerceSettingsRequest(true));
        var stayOff = await admin.PutAsJsonAsync($"/api/commerce/competitions/{section.CompetitionId}/settings",
            new UpdateEventCommerceSettingsRequest(false));

        Assert.Equal(HttpStatusCode.Conflict, turnOn.StatusCode);
        Assert.Equal(HttpStatusCode.OK, stayOff.StatusCode);
        Assert.False(await _f.InDbAsync(db => db.Set<EventCommerceSettings>()
            .AnyAsync(x => x.CompetitionId == section.CompetitionId && x.IsDemo)));
    }

    [Fact]
    public async Task TestPaymentsNeverCountAsRealIncome()
    {
        var (section, entrant, signup) = await DemoEntryAsync(price: 2500);
        await entrant.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-checkout", Key("income", FakePaymentOutcome.Success));

        var income = await IncomeAsync(section.CompetitionId);

        Assert.Equal(SignupPaymentStatus.Paid,
            await _f.InDbAsync(db => db.SectionSignups.Where(x => x.Id == signup.Id).Select(x => x.Status).SingleAsync()));
        Assert.Equal(new RealIncome(0, 0), income);
    }

    [Fact]
    public async Task RealIncomeCountsConfirmedEntriesAndManualOrdersOnly()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1200);
        var competitionId = section.CompetitionId;
        var userId = await _f.InDbAsync(db => db.Users.Select(x => x.Id).FirstAsync());
        await _f.InDbAsync(async db =>
        {
            db.SectionSignups.AddRange(
                new SectionSignup { CompetitionSectionId = section.Id, FullName = "Paid", AmountMinor = 1200, Status = SignupPaymentStatus.Paid },
                new SectionSignup { CompetitionSectionId = section.Id, FullName = "Pending", AmountMinor = 1200, Status = SignupPaymentStatus.Pending },
                new SectionSignup { CompetitionSectionId = section.Id, FullName = "Refunded", AmountMinor = 1200, Status = SignupPaymentStatus.Refunded });
            var manual = new EventOrder { CompetitionId = competitionId, BuyerUserId = userId, IdempotencyKey = $"m-{Guid.NewGuid():N}", TotalMinor = 800, Status = CommerceOrderStatus.Paid };
            var test = new EventOrder { CompetitionId = competitionId, BuyerUserId = userId, IdempotencyKey = $"t-{Guid.NewGuid():N}", TotalMinor = 900, Status = CommerceOrderStatus.Paid };
            test.MarkAsTestOrder();
            var unpaid = new EventOrder { CompetitionId = competitionId, BuyerUserId = userId, IdempotencyKey = $"u-{Guid.NewGuid():N}", TotalMinor = 700, Status = CommerceOrderStatus.AwaitingManualPayment };
            db.AddRange(manual, test, unpaid);
            await db.SaveChangesAsync();
        });

        var income = await IncomeAsync(competitionId);

        Assert.Equal((1200, 800, 2000), (income.EntriesMinor, income.ShopMinor, income.TotalMinor));
    }

    [Fact]
    public async Task PickerAndDetailsFlagDemoEvents()
    {
        var plain = (await _f.NewSectionAsync()).CompetitionId;
        var demo = (await _f.NewSectionAsync()).CompetitionId;
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/commerce/competitions/{demo}/settings", new UpdateEventCommerceSettingsRequest(true));
        var anonymous = _f.CreateClient();

        var details = await (await anonymous.GetAsync($"/api/competitions/{demo}")).ReadAsync<CompetitionDetail>();
        var plainDetails = await (await anonymous.GetAsync($"/api/competitions/{plain}")).ReadAsync<CompetitionDetail>();
        var firstView = await (await anonymous.GetAsync($"/api/competitions/{demo}/first-view")).ReadAsync<CompetitionDetail>();
        var picker = await (await anonymous.GetAsync("/api/competitions/picker?pageSize=50")).ReadAsync<CompetitionPickerPage>();

        Assert.True(details.IsDemo);
        Assert.True(firstView.IsDemo);
        Assert.False(plainDetails.IsDemo);
        Assert.Contains(picker.Items, x => x.Id == demo && x.IsDemo);
        Assert.DoesNotContain(picker.Items, x => x.Id == plain && x.IsDemo);
    }

    [Fact]
    public async Task ReviewSeederMarksDemoEventsWithTheExistingMarkAndKeepsAnOrganiserChoice()
    {
        var today = new DateTime(2031, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        await _f.InDbAsync(async db =>
        {
            db.Competitions.Add(new Competition { Name = "EGUK Winter Pairs Series — Round 1", StartDate = today });
            var optedOut = new Competition { Name = "Midlands Series — Open & Pairs", StartDate = today };
            db.Competitions.Add(optedOut);
            await db.SaveChangesAsync();
            db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { CompetitionId = optedOut.Id, IsDemo = false });
            await db.SaveChangesAsync();
        });
        var created = await _f.InDbAsync(db => ReviewCompetitionSeeder.SeedAsync(db, today));
        var reviewNames = ReviewCompetitionSeeder.EventNames;

        var rows = await _f.InDbAsync(db => db.Competitions
            .Where(c => reviewNames.Contains(c.Name))
            .Select(c => new
            {
                c.Name,
                Demo = db.Set<EventCommerceSettings>().Where(s => s.CompetitionId == c.Id).Select(s => (bool?)s.IsDemo).FirstOrDefault(),
                Price = c.Sections.Select(s => (int?)s.PriceMinor).Max(),
            }).ToListAsync());

        Assert.Equal(6, created);
        Assert.Equal(false, rows.Single(x => x.Name == "Midlands Series — Open & Pairs").Demo);
        Assert.Equal(true, rows.Single(x => x.Name == "EGUK Winter Pairs Series — Round 1").Demo);
        Assert.Equal(true, rows.Single(x => x.Name == "Northern Challenge Pairs").Demo);
        Assert.Equal(1500, rows.Single(x => x.Name == "Northern Challenge Pairs").Price);
    }
}
