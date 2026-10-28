using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Email;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

public class EmailServicesTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public EmailServicesTests(ApiFactory f) => _f = f;

    [Theory]
    [InlineData("alice@example.org", "alice@example.org")]
    [InlineData("  Alice.Smith+pc@Sub.Example.CO.UK ", "alice.smith+pc@sub.example.co.uk")]
    public void Addresses_AreNormalised(string input, string expected)
    {
        Assert.True(EmailAddresses.TryNormalise(input, out var address));
        Assert.Equal(expected, address);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("alice")]
    [InlineData("@example.org")]
    [InlineData("alice@")]
    [InlineData("alice@example")]
    [InlineData("alice@exa..mple.org")]
    [InlineData("alice@-example.org")]
    [InlineData("alice@example.org.")]
    [InlineData("al\r\nice@example.org")]
    [InlineData("alice@example.org\nBcc: x@y.org")]
    [InlineData("\"alice\"@example.org")]
    public void BadAddresses_AreRefused(string? input)
        => Assert.False(EmailAddresses.TryNormalise(input, out _));

    [Fact]
    public void LongLocalPart_IsRefused()
        => Assert.False(EmailAddresses.TryNormalise(new string('a', 65) + "@example.org", out _));

    [Theory]
    [InlineData("jane.doe@example.org", "j***@e***.org")]
    [InlineData("a@b.co", "a***@b***.co")]
    [InlineData("nonsense", "***")]
    [InlineData(null, "(none)")]
    public void Masking_ShowsLittleOfTheAddress(string? input, string expected)
        => Assert.Equal(expected, EmailAddresses.Mask(input));

    private static SectionSignup Signup(int pence = 1500) => new()
    {
        Id = 7, FullName = "Alice Rider", AmountMinor = pence, ContactEmail = "a@example.org",
    };

    private static (Competition, CompetitionSection) Event(DateTime? end = null, string? location = "Tatton Park", string? pay = "Bank 12-34-56")
    {
        var comp = new Competition
        {
            Id = 3, Name = "Spring Games", StartDate = new DateTime(2027, 3, 14, 0, 0, 0, DateTimeKind.Utc),
            EndDate = end, Location = location, PaymentDestination = pay,
        };
        return (comp, new CompetitionSection { Id = 4, DisplayName = "Under 12 Teams", CompetitionId = 3 });
    }

    [Fact]
    public void Message_ReadsPlainlyAndGivesTheDetails()
    {
        var (comp, section) = Event();

        var m = SignupConfirmationEmail.Build(Signup(), comp, section, "a@example.org", "https://mg.example.org/competitions/3", OptInOutcome.NotAsked, null);

        Assert.Equal("Your entry for Spring Games", m.Subject);
        Assert.StartsWith("Hello,", m.TextBody);
        Assert.DoesNotContain("Alice Rider", m.TextBody);
        Assert.Contains("Date: Sunday 14 March 2027", m.TextBody);
        Assert.Contains("Entry fee: £15.00", m.TextBody);
        Assert.Contains("Bank 12-34-56", m.TextBody);
        Assert.Contains("https://mg.example.org/competitions/3", m.TextBody);
        Assert.DoesNotContain("new competitions", m.TextBody);
        Assert.NotNull(m.HtmlBody);
        Assert.Contains(EmailHtml.HeaderStyle, m.HtmlBody);
        Assert.Contains(EmailHtml.CardStyle, m.HtmlBody);
        Assert.Contains("Spring Games", m.HtmlBody);
        Assert.Contains("Sunday 14 March 2027", m.HtmlBody);
        Assert.Contains("Tatton Park", m.HtmlBody);
        Assert.Contains("Under 12 Teams", m.HtmlBody);
        Assert.Contains(EmailHtml.Encode("£15.00"), m.HtmlBody);
        Assert.Contains("Bank 12-34-56", m.HtmlBody);
        Assert.Contains("href=\"https://mg.example.org/competitions/3\"", m.HtmlBody);
        Assert.DoesNotContain("Alice Rider", m.HtmlBody);
    }

    [Fact]
    public void HtmlBody_EscapesUntrustedStrings_SoMarkupCannotBeInjected()
    {
        var (comp, section) = Event(location: "<b>Arena & Field</b>", pay: "<script>alert(1)</script>");
        comp.Name = "Spring <Games> & Cup";
        section.DisplayName = "U12 \"Pairs\"";

        var m = SignupConfirmationEmail.Build(
            Signup(), comp, section, "a@example.org",
            "https://mg.example.org/competitions/3?a=1&b=2",
            OptInOutcome.Joined,
            "https://mg.example.org/unsubscribe?token=a&b=2");

        Assert.NotNull(m.HtmlBody);
        Assert.DoesNotContain("<script>", m.HtmlBody);
        Assert.DoesNotContain("<b>Arena", m.HtmlBody);
        Assert.Contains("Spring &lt;Games&gt; &amp; Cup", m.HtmlBody);
        Assert.Contains("&lt;b&gt;Arena &amp; Field&lt;/b&gt;", m.HtmlBody);
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;", m.HtmlBody);
        Assert.Contains("href=\"https://mg.example.org/competitions/3?a=1&amp;b=2\"", m.HtmlBody);
        Assert.Contains("href=\"https://mg.example.org/unsubscribe?token=a&amp;b=2\"", m.HtmlBody);
    }

    [Fact]
    public void HtmlBody_KeepsLineBreaksInBankDetailsAndOrganiserNote()
    {
        var (comp, section) = Event(pay: "Sort 12-34-56\nAcc 87654321 <ok>");

        var confirm = SignupConfirmationEmail.Build(Signup(), comp, section, "a@example.org", null, OptInOutcome.NotAsked, null);
        var reminder = SignupConfirmationEmail.BuildPaymentReminder(
            new SectionSignup { Id = 1, AmountMinor = 1500 }, comp, section, "a@example.org", "Line one\r\nLine two");

        Assert.Contains("Sort 12-34-56<br>Acc 87654321 &lt;ok&gt;", confirm.HtmlBody);
        Assert.Contains("Sort 12-34-56<br>Acc 87654321 &lt;ok&gt;", reminder.HtmlBody);
        Assert.Contains("Line one<br>Line two", reminder.HtmlBody);
    }

    [Fact]
    public void Message_CoversMultiDayEventsMissingPaymentDetailsAndNoLink()
    {
        var (comp, section) = Event(end: new DateTime(2027, 3, 15, 0, 0, 0, DateTimeKind.Utc), location: null, pay: null);

        var m = SignupConfirmationEmail.Build(Signup(), comp, section, "a@example.org", null, OptInOutcome.NotAsked, null);

        Assert.Contains("Date: Sunday 14 March 2027 to Monday 15 March 2027", m.TextBody);
        Assert.DoesNotContain("Where:", m.TextBody);
        Assert.Contains("The organiser will let you know how they'd like to be paid.", m.TextBody);
        Assert.DoesNotContain("competition page", m.TextBody);
    }

    [Fact]
    public void Message_ForANewOptIn_CarriesTheUnsubscribeLink()
    {
        var (comp, section) = Event();

        var m = SignupConfirmationEmail.Build(Signup(0), comp, section, "a@example.org", null, OptInOutcome.Joined, "https://mg.example.org/unsubscribe?token=abc");

        Assert.Contains("when new competitions open", m.TextBody);
        Assert.Contains("https://mg.example.org/unsubscribe?token=abc", m.TextBody);
        Assert.Equal("You're entered in Spring Games", m.Subject);
    }

    [Fact]
    public async Task SignupWithoutAnAddress_IsNotRequested_AndNothingIsBuilt()
    {
        var (comp, section) = Event();
        var service = new SignupConfirmationService(new ThrowingSender(), Options.Create(new EmailOptions()), new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build(),
            NullLogger<SignupConfirmationService>.Instance);
        var signup = Signup();
        signup.ContactEmail = null;

        Assert.Equal(EmailDeliveryStatus.NotRequested, await service.SendAsync(signup, comp, section, OptInOutcome.NotAsked, null));
    }

    [Theory]
    [InlineData(null, "https://fallback.example.org/competitions/3")]
    [InlineData("https://own.example.org/some/path?x=1", "https://own.example.org/competitions/3")]
    public async Task LinksUseTheConfiguredSite_OrTheSharingSettingAsAFallback(string? siteUrl, string expected)
    {
        var (comp, section) = Event();
        var sender = new CapturingSender();
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Sharing:PublicBaseUrl"] = "https://fallback.example.org/ignored" }).Build();
        var service = new SignupConfirmationService(sender, Options.Create(new EmailOptions { SiteUrl = siteUrl }), config, NullLogger<SignupConfirmationService>.Instance);

        await service.SendAsync(Signup(), comp, section, OptInOutcome.NotAsked, null);

        Assert.Contains(expected, sender.Last!.TextBody);
    }

    [Theory]
    [InlineData("not a url")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://user:pw@example.org")]
    public async Task OddSiteSettings_GiveNoLinkRatherThanABadOne(string siteUrl)
    {
        var (comp, section) = Event();
        var sender = new CapturingSender();
        var service = new SignupConfirmationService(sender, Options.Create(new EmailOptions { SiteUrl = siteUrl }),
            new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build(), NullLogger<SignupConfirmationService>.Instance);

        await service.SendAsync(Signup(), comp, section, OptInOutcome.Joined, "tok");

        Assert.DoesNotContain("http", sender.Last!.TextBody);
    }

    [Fact]
    public async Task SenderThatThrowsWhileBuilding_IsRecordedAsFailed()
    {
        var (comp, section) = Event();
        var service = new SignupConfirmationService(new ThrowingSender(), Options.Create(new EmailOptions()),
            new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build(), NullLogger<SignupConfirmationService>.Instance);

        Assert.Equal(EmailDeliveryStatus.Failed, await service.SendAsync(Signup(), comp, section, OptInOutcome.NotAsked, null));
    }

    [Theory]
    [InlineData(false, "key", "from@example.org")]
    [InlineData(true, null, "from@example.org")]
    [InlineData(true, "key", " ")]
    public async Task HalfConfiguredEmail_FallsBackToTheLoggingSender_AndNeverTouchesTheNetwork(bool enabled, string? key, string? from)
    {
        var options = Options.Create(new EmailOptions { Enabled = enabled, ApiKey = key, From = from });
        var resend = new ResendEmailSender(new NoNetwork(), options, NullLogger<ResendEmailSender>.Instance);
        var sender = new ConfiguredEmailSender(options, resend, new LoggingEmailSender(NullLogger<LoggingEmailSender>.Instance));

        Assert.False(options.Value.IsConfigured);
        Assert.Equal(EmailDeliveryStatus.NotSent, await sender.SendAsync(new EmailMessage("a@example.org", "s", "b")));
        Assert.Equal(EmailDeliveryStatus.NotSent, await resend.SendAsync(new EmailMessage("a@example.org", "s", "b")));
    }

    [Fact]
    public async Task Resend_SendsHtmlAlongsideText()
    {
        var stub = new StubHttp();
        string? body = null;
        stub.Respond("api.resend.com", r =>
        {
            body = r.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(System.Net.HttpStatusCode.OK);
        });
        var resend = new ResendEmailSender(new StubFactory(stub),
            Options.Create(new EmailOptions { Enabled = true, ApiKey = "k", From = "f@example.org", TimeoutSeconds = 99 }),
            NullLogger<ResendEmailSender>.Instance);

        var status = await resend.SendAsync(new EmailMessage("a@example.org", "Hi", "plain", "<p>rich</p>"));

        Assert.Equal(EmailDeliveryStatus.Sent, status);
        Assert.Contains("\"html\":\"\\u003Cp\\u003Erich\\u003C/p\\u003E\"", body);
        Assert.Contains("\"text\":\"plain\"", body);
        Assert.DoesNotContain("\"reply_to\"", body);
    }

    [Fact]
    public async Task Resend_IncludesReplyTo_WhenConfigured()
    {
        var stub = new StubHttp();
        string? body = null;
        stub.Respond("api.resend.com", r =>
        {
            body = r.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(System.Net.HttpStatusCode.OK);
        });
        var resend = new ResendEmailSender(new StubFactory(stub),
            Options.Create(new EmailOptions
            {
                Enabled = true,
                ApiKey = "k",
                From = "f@example.org",
                ReplyTo = "organiser@example.org",
                TimeoutSeconds = 99,
            }),
            NullLogger<ResendEmailSender>.Instance);

        var status = await resend.SendAsync(new EmailMessage("a@example.org", "Hi", "plain"));

        Assert.Equal(EmailDeliveryStatus.Sent, status);
        Assert.Contains("\"reply_to\":\"organiser@example.org\"", body);
    }

    [Fact]
    public async Task Unsubscribe_IgnoresBlankAndOversizedTokens()
    {
        using var scope = _f.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<EmailOptInService>();

        await service.UnsubscribeAsync(null);
        await service.UnsubscribeAsync("   ");
        await service.UnsubscribeAsync(new string('x', 500));
    }

    // ---- SQLite upgrade ----

    [Fact]
    public async Task ExistingSqliteDatabase_GainsTheEmailColumnsAndTable_WithoutLosingSignups()
    {
        var section = await _f.NewSectionAsync(priceMinor: 700);
        var signupId = await _f.InDbAsync(async db =>
        {
            var s = new SectionSignup { CompetitionSectionId = section.Id, FullName = "Before the upgrade", AmountMinor = 700, ContactInfo = "07700 900000" };
            db.SectionSignups.Add(s);
            await db.SaveChangesAsync();
            return s.Id;
        });
        await _f.InDbAsync(db => db.Database.ExecuteSqlRawAsync("""
            DROP INDEX "IX_SectionSignups_CompetitionSectionId_UserId_ClientRequestId";
            DROP INDEX IF EXISTS "IX_SectionSignups_ContactEmail";
            ALTER TABLE "SectionSignups" DROP COLUMN "ContactEmail";
            ALTER TABLE "SectionSignups" DROP COLUMN "ConfirmationEmailStatus";
            ALTER TABLE "SectionSignups" DROP COLUMN "ConfirmationEmailAt";
            ALTER TABLE "SectionSignups" DROP COLUMN "ClientRequestId";
            DROP TABLE "EmailOptIns";
            """));

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services); // running twice is harmless

        await _f.InDbAsync(async db =>
        {
            db.ChangeTracker.Clear();
            var kept = await db.SectionSignups.AsNoTracking().SingleAsync(s => s.Id == signupId);
            Assert.Equal(("Before the upgrade", "07700 900000", 700), (kept.FullName, kept.ContactInfo, kept.AmountMinor));
            Assert.Null(kept.ContactEmail);
            Assert.Equal(EmailDeliveryStatus.NotRequested, kept.ConfirmationEmailStatus);
            db.EmailOptIns.Add(new EmailOptIn { Email = "x@example.org", WordingVersion = "v", Source = "s", UnsubscribeTokenHash = "h" });
            await db.SaveChangesAsync();
            Assert.Equal(1, await db.EmailOptIns.CountAsync());
        });
    }

    private sealed class ThrowingSender : IEmailSender
    {
        public Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default) => throw new InvalidOperationException("boom a@example.org");
    }

    private sealed class CapturingSender : IEmailSender
    {
        public EmailMessage? Last { get; private set; }
        public Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default)
        {
            Last = message;
            return Task.FromResult(EmailDeliveryStatus.Sent);
        }
    }

    private sealed class NoNetwork : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("no network in tests");
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}
