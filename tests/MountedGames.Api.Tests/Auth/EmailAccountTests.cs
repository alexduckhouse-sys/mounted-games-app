using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using DnsClient;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging.Abstractions;
using MountedGames.Api.Auth;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Email;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>Sign-up: password wording, real-looking addresses, and the confirmation email (which never blocks sign-in).</summary>
public class EmailAccountTests : IClassFixture<EmailApiFactory>
{
    private readonly EmailApiFactory _f;
    public EmailAccountTests(EmailApiFactory f) => _f = f;

    private const string Password = "Passw0rd!x";
    private static string NewEmail(string domain = "gmail.com") => $"rider.{Guid.NewGuid():N}@{domain}";

    private Task<HttpResponseMessage> SignUp(string username, string password = Password)
        => _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(username, password, null, "Email Test Club", "Sam Lee"));

    /// <summary>Pretends the last confirmation went out a while ago, so the next resend isn't held back by the 2 minute gap.</summary>
    private Task AgeLastSendAsync(string userId, int sentToday = 1, TimeSpan? ago = null)
        => _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == userId);
            u.LastConfirmationSentAt = DateTime.UtcNow - (ago ?? TimeSpan.FromMinutes(5));
            u.ConfirmationsSentToday = sentToday;
            await db.SaveChangesAsync();
        });

    private static async Task<string> Message(HttpResponseMessage r) => await r.Content.ReadAsStringAsync();

    private static (string UserId, string Token) LinkIn(EmailApiFactory.SentMessage m)
    {
        var match = Regex.Match(m.Text, @"https://mg\.example\.org/confirm-email\?userId=([^&\s]+)&token=(\S+)");
        Assert.True(match.Success, m.Text);
        return (Uri.UnescapeDataString(match.Groups[1].Value), Uri.UnescapeDataString(match.Groups[2].Value));
    }

    private async Task<(string Email, AuthResponse Auth, EmailApiFactory.SentMessage Mail)> SignedUpAsync()
    {
        var email = NewEmail();
        var r = await SignUp(email);
        r.EnsureSuccessStatusCode();
        return (email, await r.ReadAsync<AuthResponse>(), _f.Sent.Last(m => m.To == email));
    }

    // ---- password rules ----

    [Theory]
    [InlineData("Passw0rdxx", "special character")]
    [InlineData("Password!!", "a number")]
    [InlineData("PASSW0RD!!", "lowercase letter")]
    [InlineData("Pa1!", "at least 8 characters")]
    public async Task WeakPassword_GetsFriendlyWording_NeverNonAlphanumeric(string password, string expected)
    {
        var r = await SignUp(NewEmail(), password);

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var body = await Message(r);
        Assert.Contains(expected, body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("alphanumeric", body.Replace("PasswordRequiresNonAlphanumeric", ""), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("errorCodes", body);
    }

    [Fact]
    public async Task Password_NeedsNoCapital_MirroringProgramCs()
    {
        // web/src/lib/passwordRules.ts mirrors these rules: 8+ characters, a digit, a lowercase letter, a special character, no capital.
        var r = await SignUp(NewEmail(), "passw0rd!x");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public void IdentityRules_MatchWhatTheWebChecklistShows()
    {
        // web/src/lib/passwordRules.ts mirrors these (and its own test reads Program.cs); change them together.
        var p = _f.Services.GetRequiredService<IOptions<IdentityOptions>>().Value.Password;
        Assert.Equal(PasswordRules.MinLength, p.RequiredLength);
        Assert.True(p.RequireDigit);
        Assert.True(p.RequireLowercase);
        Assert.False(p.RequireUppercase);
        Assert.True(p.RequireNonAlphanumeric);
    }

    [Fact]
    public void FriendlyWording_CoversEveryIdentityCode()
    {
        foreach (var code in new[] { "PasswordTooShort", "PasswordRequiresDigit", "PasswordRequiresLower", "PasswordRequiresUpper", "PasswordRequiresNonAlphanumeric", "PasswordRequiresUniqueChars" })
            Assert.DoesNotContain("alphanumeric", PasswordRules.Friendly(new IdentityError { Code = code, Description = "x" }), StringComparison.OrdinalIgnoreCase);
        Assert.Equal("Must have a special character.", PasswordRules.Friendly(new IdentityError { Code = "Other", Description = "Must have a non-alphanumeric character." }));
    }

    [Fact]
    public async Task AdminRegister_WeakPassword_AlsoGetsFriendlyWording()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/auth/register", new RegisterRequest(NewEmail(), "Passw0rdxx", "Pat", null, null));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("special character", await Message(r));
    }

    // ---- address checks ----

    [Theory]
    [InlineData("sam@")]
    [InlineData("@gmail.com")]
    [InlineData("sam@gmail")]
    [InlineData("sam@@gmail.com")]
    [InlineData("sam..lee@gmail.com")]
    [InlineData(".sam@gmail.com")]
    [InlineData("sam lee@gmail.com")]
    [InlineData("sam@-gmail.com")]
    [InlineData("sam@gmail.c")]
    [InlineData("sam@gmail.123")]
    [InlineData("sam@exa_mple.com")]
    public async Task BadFormat_IsRejected_AndNoAccountMade(string email)
    {
        var r = await SignUp(email);

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("email_invalid", await Message(r));
    }

    [Fact]
    public async Task TooLongAddress_IsRejected()
    {
        var r = await SignUp(new string('a', 65) + "@gmail.com");

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task DomainWithNoMail_IsRejected_WithFriendlyMessage()
    {
        _f.Domains.Set("gmial.invalid-test.com", DomainMail.NoMail);
        var email = NewEmail("gmial.invalid-test.com");

        var r = await SignUp(email);

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var body = await Message(r);
        Assert.Contains("email_domain", body);
        Assert.Contains("couldn't find a mailbox", body);
        Assert.DoesNotContain(_f.Sent, m => m.To == email);
        var login = await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, Password));
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    [Theory]
    [InlineData("mailinator.com")]
    [InlineData("YOPmail.com")]
    [InlineData("inbox.guerrillamail.com")]
    public async Task DisposableDomain_IsRejected(string domain)
    {
        var r = await SignUp(NewEmail(domain));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("email_disposable", await Message(r));
    }

    [Fact]
    public async Task DnsTrouble_FailsOpen()
    {
        _f.Domains.Set("flaky-dns.example", DomainMail.Unknown);

        var r = await SignUp(NewEmail("flaky-dns.example"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task DuplicateAddress_StillConflicts_AndSendsNothing()
    {
        var (email, _, _) = await SignedUpAsync();
        var before = _f.Sent.Count(m => m.To == email);

        var again = await SignUp(email);

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal(before, _f.Sent.Count(m => m.To == email));
    }

    [Fact]
    public async Task AddressIsLowerCased()
    {
        var local = $"Rider.{Guid.NewGuid():N}";
        var r = await SignUp($"{local}@GMail.com");

        Assert.Equal($"{local}@gmail.com".ToLowerInvariant(), (await r.ReadAsync<AuthResponse>()).User.Email);
    }

    // ---- the confirmation email ----

    [Fact]
    public async Task SignUp_SendsOneConfirmation_AndLeavesTheAccountUnconfirmed()
    {
        var (email, auth, mail) = await SignedUpAsync();

        Assert.False(auth.User.EmailConfirmed);
        Assert.Equal(email, mail.To);
        Assert.Equal("Confirm your email address", mail.Subject);
        Assert.Equal(1, _f.Sent.Count(m => m.To == email));
        // The name is typed by whoever signs up, so it never goes into someone else's inbox.
        Assert.DoesNotContain("Sam Lee", mail.Text);
        Assert.StartsWith("Hello,", mail.Text);
        Assert.NotNull(mail.Html);
        Assert.DoesNotContain("Sam Lee", mail.Html);
        Assert.Contains(EmailHtml.HeaderStyle, mail.Html);
        Assert.Contains(EmailHtml.CardStyle, mail.Html);
        Assert.Contains("/confirm-email?userId=", mail.Html);
        Assert.StartsWith("confirm-email-", mail.IdempotencyKey);
        var (userId, _) = LinkIn(mail);
        Assert.Equal(auth.User.Id, userId);
    }

    [Fact]
    public async Task Confirmation_NeverLogsTheTokenOrTheFullAddress()
    {
        var (email, _, mail) = await SignedUpAsync();
        var (_, token) = LinkIn(mail);
        await Task.Yield();

        var logs = string.Join("\n", _f.Logs);
        Assert.DoesNotContain(token, logs);
        Assert.DoesNotContain(email, logs);
    }

    [Fact]
    public async Task UnconfirmedUser_CanStillSignIn_AndSeesTheFlag()
    {
        var (email, _, _) = await SignedUpAsync();

        var login = await _f.LoginAsync(email, Password);
        var me = await _f.WithToken(login.Token).GetAsync("/api/auth/me");

        Assert.False(login.User.EmailConfirmed);
        Assert.False((await me.ReadAsync<UserProfile>()).EmailConfirmed);
    }

    [Fact]
    public async Task ConfirmEmail_WithTheEmailedLink_ConfirmsTheAccount()
    {
        var (email, auth, mail) = await SignedUpAsync();
        var (userId, token) = LinkIn(mail);

        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest(userId, token));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var me = await _f.WithToken(auth.Token).GetAsync("/api/auth/me");
        Assert.True((await me.ReadAsync<UserProfile>()).EmailConfirmed);
        // Using the link a second time does no harm.
        var again = await _f.CreateClient().PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest(userId, token));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.True((await _f.LoginAsync(email, Password)).User.EmailConfirmed);
    }

    [Theory]
    [InlineData("")]
    [InlineData("garbage")]
    [InlineData("9999999999.AAAA")]
    [InlineData("1.AAAA")]
    [InlineData("x.AAAA")]
    public async Task ConfirmEmail_WithABadToken_IsRefused_AndChangesNothing(string token)
    {
        var (_, auth, _) = await SignedUpAsync();

        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest(auth.User.Id, token));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var me = await _f.WithToken(auth.Token).GetAsync("/api/auth/me");
        Assert.False((await me.ReadAsync<UserProfile>()).EmailConfirmed);
    }

    [Fact]
    public async Task ConfirmEmail_TokenForSomeoneElse_OrUnknownUser_GetsTheSameAnswer()
    {
        var (_, _, mail) = await SignedUpAsync();
        var (_, token) = LinkIn(mail);
        var (_, other, _) = await SignedUpAsync();

        var wrongUser = await _f.CreateClient().PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest(other.User.Id, token));
        var noUser = await _f.CreateClient().PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest("nobody", token));
        var blankUser = await _f.CreateClient().PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest("", token));

        Assert.Equal(HttpStatusCode.BadRequest, wrongUser.StatusCode);
        Assert.Equal(await Message(wrongUser), await Message(noUser));
        Assert.Equal(await Message(wrongUser), await Message(blankUser));
    }

    // ---- resend ----

    [Fact]
    public async Task Resend_SendsAFreshLink_ThatAlsoWorks()
    {
        var (email, auth, first) = await SignedUpAsync();
        await AgeLastSendAsync(auth.User.Id);

        var r = await _f.WithToken(auth.Token).PostAsync("/api/auth/resend-confirmation", null);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("\"Sent\"", await Message(r));
        var second = _f.Sent.Last(m => m.To == email);
        Assert.NotSame(first, second);
        var (userId, token) = LinkIn(second);
        var confirm = await _f.CreateClient().PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest(userId, token));
        Assert.Equal(HttpStatusCode.OK, confirm.StatusCode);
    }

    [Fact]
    public async Task Resend_WhenAlreadyConfirmed_SendsNothing()
    {
        var (email, auth, mail) = await SignedUpAsync();
        var (userId, token) = LinkIn(mail);
        await _f.CreateClient().PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest(userId, token));
        var before = _f.Sent.Count(m => m.To == email);

        var r = await _f.WithToken(auth.Token).PostAsync("/api/auth/resend-confirmation", null);

        Assert.Contains("AlreadyConfirmed", await Message(r));
        Assert.Equal(before, _f.Sent.Count(m => m.To == email));
    }

    [Fact]
    public async Task Resend_NeedsSignIn()
    {
        var r = await _f.CreateClient().PostAsync("/api/auth/resend-confirmation", null);

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Resend_ForAMadeUpUsername_HasNowhereToSend()
    {
        var (client, auth) = await _f.SignupAsync();
        Assert.True(auth.User.EmailConfirmed);

        // Confirmed already, so nothing to do; flip it back to prove the made-up address is skipped rather than mailed.
        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == auth.User.Id);
            u.EmailConfirmed = false;
            await db.SaveChangesAsync();
        });
        var r = await client.PostAsync("/api/auth/resend-confirmation", null);

        Assert.Contains("NotSent", await Message(r));
    }

    [Fact]
    public async Task ProviderFailure_NeverBlocksSignUp_AndResendReportsIt()
    {
        _f.Fail = () => new HttpResponseMessage(HttpStatusCode.InternalServerError);
        try
        {
            var email = NewEmail();
            var r = await SignUp(email);
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            var auth = await r.ReadAsync<AuthResponse>();
            await AgeLastSendAsync(auth.User.Id);

            var resend = await _f.WithToken(auth.Token).PostAsync("/api/auth/resend-confirmation", null);

            Assert.Contains("Failed", await Message(resend));
        }
        finally { _f.Fail = null; }
    }

    // ---- the per-account cap ----

    [Fact]
    public async Task Resend_RightAfterSignUp_IsHeldBack_AndSendsNothing()
    {
        var (email, auth, _) = await SignedUpAsync();

        var r = await _f.WithToken(auth.Token).PostAsync("/api/auth/resend-confirmation", null);

        Assert.Equal(HttpStatusCode.TooManyRequests, r.StatusCode);
        Assert.Contains("TooSoon", await Message(r));
        Assert.Equal(1, _f.Sent.Count(m => m.To == email));
    }

    [Fact]
    public async Task Resend_StopsAtFiveADay_ThenStartsAgainTheNextDay()
    {
        var (email, auth, _) = await SignedUpAsync();
        var client = _f.WithToken(auth.Token);

        await AgeLastSendAsync(auth.User.Id, sentToday: 4);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/auth/resend-confirmation", null)).StatusCode);
        var sent = _f.Sent.Count(m => m.To == email);

        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == auth.User.Id);
            u.LastConfirmationSentAt = DateTime.UtcNow.Date.AddSeconds(1);
            u.ConfirmationsSentToday = 5;
            await db.SaveChangesAsync();
        });
        var blocked = await client.PostAsync("/api/auth/resend-confirmation", null);
        if (DateTime.UtcNow - DateTime.UtcNow.Date > TimeSpan.FromMinutes(3))
        {
            Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
            Assert.Contains("DailyLimit", await Message(blocked));
            Assert.Equal(sent, _f.Sent.Count(m => m.To == email));
        }

        // Yesterday's five don't count today.
        await AgeLastSendAsync(auth.User.Id, sentToday: 5, ago: TimeSpan.FromDays(1));
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/auth/resend-confirmation", null)).StatusCode);
        var count = await _f.InDbAsync(db => db.Users.Where(x => x.Id == auth.User.Id).Select(x => x.ConfirmationsSentToday).SingleAsync());
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task ABurstOfResends_SendsAtMostOne()
    {
        var (email, auth, _) = await SignedUpAsync();
        await AgeLastSendAsync(auth.User.Id);
        var before = _f.Sent.Count(m => m.To == email);
        var client = _f.WithToken(auth.Token);

        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => client.PostAsync("/api/auth/resend-confirmation", null)));

        Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(5, results.Count(r => r.StatusCode == HttpStatusCode.TooManyRequests));
        Assert.Equal(before + 1, _f.Sent.Count(m => m.To == email));
    }

    [Fact]
    public async Task SignUpName_NeverReachesTheEmail()
    {
        var email = NewEmail();
        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(email, Password, null, "Email Test Club", "Click https://evil.example now\nyou won"));
        r.EnsureSuccessStatusCode();

        var text = _f.Sent.Last(m => m.To == email).Text;
        Assert.DoesNotContain("evil.example", text);
        Assert.DoesNotContain("you won", text);
    }

    // ---- existing behaviour ----

    [Fact]
    public async Task SeededAndMadeUpAccounts_StayConfirmed_AndGetNoEmail()
    {
        var before = _f.Sent.Count;
        var seeded = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        var (_, bare) = await _f.SignupAsync();

        Assert.True(seeded.User.EmailConfirmed);
        Assert.True(bare.User.EmailConfirmed);
        Assert.Equal(before, _f.Sent.Count);
        Assert.True((await _f.AdminLoginAsync()).User.EmailConfirmed);
    }

    // ---- units ----

    [Theory]
    [InlineData("sam@gmail.com", true)]
    [InlineData("  Sam.Lee+club@Sub.Example.co.uk ", true)]
    [InlineData("o'brien@example.ie", true)]
    [InlineData("sam@xn--bcher-kva.example", true)]
    [InlineData("sam", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("sam@localhost", false)]
    [InlineData("sam@example.com.", false)]
    [InlineData("sam@example..com", false)]
    [InlineData("sam<x>@example.com", false)]
    public void EmailValidation_Shape(string? input, bool ok)
    {
        Assert.Equal(ok, EmailValidation.TryNormalise(input, out var address));
        Assert.Equal(ok ? input!.Trim().ToLowerInvariant() : string.Empty, address);
    }

    [Fact]
    public void EmailValidation_Messages()
    {
        Assert.Equal(string.Empty, EmailValidation.Message(EmailProblem.None));
        Assert.False(EmailValidation.IsDisposable("gmail.com"));
        Assert.False(EmailValidation.IsDisposable("notmailinator.com"));
        Assert.True(EmailValidation.IsDisposable("a.mailinator.com"));
    }

    [Fact]
    public void Tokens_ExpireAfterThreeDays_AndDieWithTheSecurityStamp()
    {
        var clock = new ManualTimeProvider();
        var tokens = new EmailConfirmationTokens(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Jwt:Key"] = "k" + new string('x', 40) }).Build(), clock);
        var user = new AppUser { Id = "u1", Email = "a@b.com", SecurityStamp = "s1" };
        var token = tokens.Create(user);

        Assert.True(tokens.IsValid(user, token));
        Assert.False(tokens.IsValid(new AppUser { Id = "u1", Email = "a@b.com", SecurityStamp = "s2" }, token));
        Assert.False(tokens.IsValid(new AppUser { Id = "u1", Email = "other@b.com", SecurityStamp = "s1" }, token));
        Assert.False(tokens.IsValid(new AppUser { Id = "u2", Email = "a@b.com", SecurityStamp = "s1" }, token));
        clock.Advance(TimeSpan.FromDays(2));
        Assert.True(tokens.IsValid(user, token));
        clock.Advance(TimeSpan.FromDays(1.1));
        Assert.False(tokens.IsValid(user, token));
        Assert.False(tokens.IsValid(user, null));
        Assert.False(tokens.IsValid(user, new string('1', 300)));
    }

    [Fact]
    public async Task NoSiteAddress_MeansNothingIsSent()
    {
        var service = new AccountEmailService(
            new FailingSender(), Microsoft.Extensions.Options.Options.Create(new EmailOptions()), new ConfigurationBuilder().Build(),
            new EmailConfirmationTokens(new ConfigurationBuilder().Build(), TimeProvider.System), null!, TimeProvider.System, NullLogger<AccountEmailService>.Instance);

        Assert.Equal(ConfirmationResult.NotSent, await service.SendConfirmationAsync(new AppUser { Id = "u", Email = "a@b.com" }));
    }

    [Fact]
    public async Task ASenderFailure_IsReportedAsFailed_NotThrown()
    {
        var (_, auth, _) = await SignedUpAsync();
        await AgeLastSendAsync(auth.User.Id);
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MountedGames.Api.Data.AppDbContext>();
        var service = new AccountEmailService(
            new FailingSender(), Microsoft.Extensions.Options.Options.Create(new EmailOptions { SiteUrl = "https://mg.example.org" }), new ConfigurationBuilder().Build(),
            new EmailConfirmationTokens(new ConfigurationBuilder().Build(), TimeProvider.System), db, TimeProvider.System, NullLogger<AccountEmailService>.Instance);

        Assert.Equal(ConfirmationResult.Failed, await service.SendConfirmationAsync(new AppUser { Id = auth.User.Id, Email = "a@b.com" }));
    }

    private sealed class FailingSender : IEmailSender
    {
        public Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default) => throw new InvalidOperationException("boom");
    }
}

/// <summary>With email sending off, the flow still works and the resend says it couldn't send.</summary>
public class EmailOffAccountTests : IClassFixture<EmailOffApiFactory>
{
    private readonly EmailOffApiFactory _f;
    public EmailOffAccountTests(EmailOffApiFactory f) => _f = f;

    [Fact]
    public async Task SignUpWorks_ConfirmationIsNotSent_AndResendSaysSo()
    {
        var email = $"rider.{Guid.NewGuid():N}@gmail.com";
        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(email, "Passw0rd!x", null, "Email Test Club"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var auth = await r.ReadAsync<AuthResponse>();
        Assert.False(auth.User.EmailConfirmed);

        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == auth.User.Id);
            u.LastConfirmationSentAt = DateTime.UtcNow.AddMinutes(-5);
            await db.SaveChangesAsync();
        });
        var resend = await _f.WithToken(auth.Token).PostAsync("/api/auth/resend-confirmation", null);

        Assert.Contains("NotSent", await resend.Content.ReadAsStringAsync());
        Assert.Empty(_f.Sent);
    }
}

/// <summary>The resend limit is a few a minute for each person.</summary>
public class EmailResendLimitTests : IClassFixture<EmailResendLimitTests.Factory>
{
    public sealed class Factory : EmailApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("RateLimits:EmailResendPerMinute", "2");
        }
    }

    private readonly Factory _f;
    public EmailResendLimitTests(Factory f) => _f = f;

    [Fact]
    public async Task ThirdResendInAMinute_Gets429_ButAnotherPersonIsNotAffected()
    {
        var a = await Register();
        var b = await Register();

        // The database cap would hold these back anyway, so age the last send before each to test the rate limiter itself.
        Assert.Equal(HttpStatusCode.OK, (await Resend(a)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Resend(a)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Resend(a)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Resend(b)).StatusCode);
    }

    private async Task<HttpResponseMessage> Resend((HttpClient Client, string Id) who)
    {
        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == who.Id);
            u.LastConfirmationSentAt = DateTime.UtcNow.AddMinutes(-5);
            u.ConfirmationsSentToday = 0;
            await db.SaveChangesAsync();
        });
        return await who.Client.PostAsync("/api/auth/resend-confirmation", null);
    }

    private async Task<(HttpClient Client, string Id)> Register()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest($"rider.{Guid.NewGuid():N}@gmail.com", "Passw0rd!x", null, "Email Test Club"));
        r.EnsureSuccessStatusCode();
        var auth = await r.ReadAsync<AuthResponse>();
        return (_f.WithToken(auth.Token), auth.User.Id);
    }
}

/// <summary>The real mail-domain check, against a small fake DNS server on the loopback address.</summary>
public sealed class DnsEmailDomainCheckerTests : IDisposable
{
    private readonly FakeDnsServer _dns = new();

    private DnsEmailDomainChecker Checker(int timeoutMs = 2000)
        => new(new LookupClient(new LookupClientOptions(_dns.Endpoint) { Timeout = TimeSpan.FromMilliseconds(timeoutMs), Retries = 0, UseCache = false, ThrowDnsErrors = false }),
            NullLogger<DnsEmailDomainChecker>.Instance);

    [Fact]
    public async Task MxRecord_MeansMail()
    {
        _dns.Answer = (_, type) => type == FakeDnsServer.MX ? new FakeDnsServer.Reply(0, FakeDnsServer.MxRecord(10, "mx.good.test")) : new FakeDnsServer.Reply(0);

        Assert.Equal(DomainMail.HasMail, await Checker().CheckAsync("good.test"));
    }

    [Fact]
    public async Task NoMx_ButAnAddress_MeansMail()
    {
        _dns.Answer = (_, type) => type == FakeDnsServer.A ? new FakeDnsServer.Reply(0, FakeDnsServer.ARecord("192.0.2.10")) : new FakeDnsServer.Reply(0);

        Assert.Equal(DomainMail.HasMail, await Checker().CheckAsync("web-only.test"));
    }

    [Fact]
    public async Task NoMx_ButAnIpv6Address_MeansMail()
    {
        _dns.Answer = (_, type) => type == FakeDnsServer.AAAA ? new FakeDnsServer.Reply(0, System.Net.IPAddress.Parse("2001:db8::1").GetAddressBytes()) : new FakeDnsServer.Reply(0);

        Assert.Equal(DomainMail.HasMail, await Checker().CheckAsync("v6.test"));
    }

    [Fact]
    public async Task NoSuchDomain_MeansNoMail()
    {
        _dns.Answer = (_, _) => new FakeDnsServer.Reply(3);

        Assert.Equal(DomainMail.NoMail, await Checker().CheckAsync("gmial.test"));
    }

    [Fact]
    public async Task NoRecordsAtAll_MeansNoMail()
    {
        _dns.Answer = (_, _) => new FakeDnsServer.Reply(0);

        Assert.Equal(DomainMail.NoMail, await Checker().CheckAsync("empty.test"));
    }

    [Fact]
    public async Task NullMx_MeansNoMail()
    {
        _dns.Answer = (_, type) => type == FakeDnsServer.MX ? new FakeDnsServer.Reply(0, FakeDnsServer.MxRecord(0, "")) : new FakeDnsServer.Reply(0);

        Assert.Equal(DomainMail.NoMail, await Checker().CheckAsync("nomail.test"));
    }

    [Fact]
    public async Task ServerFailure_FailsOpen()
    {
        _dns.Answer = (_, _) => new FakeDnsServer.Reply(2);

        Assert.Equal(DomainMail.Unknown, await Checker().CheckAsync("broken.test"));
    }

    [Fact]
    public async Task ServerFailureOnAddressLookup_FailsOpen()
    {
        _dns.Answer = (_, type) => type == FakeDnsServer.MX ? new FakeDnsServer.Reply(0) : new FakeDnsServer.Reply(2);

        Assert.Equal(DomainMail.Unknown, await Checker().CheckAsync("half-broken.test"));
    }

    [Fact]
    public async Task SlowDns_IsCutOffByTheOverallTimeout_AndFailsOpen()
    {
        // The client alone would wait 30 seconds for each of its three queries; the overall limit stops it first.
        _dns.Answer = (_, _) => null;
        var client = new LookupClient(new LookupClientOptions(_dns.Endpoint) { Timeout = TimeSpan.FromSeconds(30), Retries = 2, UseCache = false });
        var checker = new DnsEmailDomainChecker(client, NullLogger<DnsEmailDomainChecker>.Instance, TimeSpan.FromMilliseconds(300));
        var started = DateTime.UtcNow;

        Assert.Equal(DomainMail.Unknown, await checker.CheckAsync("hangs.test"));
        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(10));
    }

    [Fact]
    public async Task ACallerWhoGivesUp_StillGetsFailOpen()
    {
        _dns.Answer = (_, _) => null;
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        Assert.Equal(DomainMail.Unknown, await Checker(timeoutMs: 5000).CheckAsync("hangs.test", cts.Token));
    }

    [Fact]
    public async Task Timeout_FailsOpen()
    {
        _dns.Answer = (_, _) => null;

        Assert.Equal(DomainMail.Unknown, await Checker(timeoutMs: 300).CheckAsync("slow.test"));
    }

    public void Dispose() => _dns.Dispose();
}
