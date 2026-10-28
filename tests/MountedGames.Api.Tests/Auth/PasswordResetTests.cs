using System.Diagnostics;
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using MountedGames.Api.Auth;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Security;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Email;
using MountedGames.Api.Services.Accounts;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>Shared steps for the password reset tests: accounts with real-looking addresses, and the link from the email.</summary>
internal static class ResetSteps
{
    public const string Password = "Passw0rd!x";
    public const string NewPassword = "N3w-passw0rd!";
    public const string ResetSubject = "Reset your Mounted Games password";
    public const string ChangedSubject = "Your Mounted Games password was changed";
    private static readonly Regex LinkPattern = new(@"/reset-password#t=(mgr_[A-Za-z0-9_-]+)", RegexOptions.Compiled);

    public static string NewEmail() => $"reset-{Guid.NewGuid():N}@example.org";

    /// <summary>Signs up a Member with a real-looking address (made-up usernames have no mailbox, so can't be reset).</summary>
    public static async Task<AuthResponse> AccountAsync(this ApiFactory f, string? email = null)
    {
        var response = await f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(email ?? NewEmail(), Password, "Member", "Test Pony Club"));
        response.EnsureSuccessStatusCode();
        return await response.ReadAsync<AuthResponse>();
    }

    public static Task<HttpResponseMessage> RequestResetAsync(this ApiFactory f, string email, string? ip = null)
    {
        var client = f.CreateClient();
        if (ip is not null) client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, ip);
        return client.PostAsJsonAsync("/api/auth/password-reset/request", new PasswordResetRequest(email));
    }

    public static Task<HttpResponseMessage> ConfirmAsync(this ApiFactory f, string? token, string? password = NewPassword, string? ip = null)
    {
        var client = f.CreateClient();
        if (ip is not null) client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, ip);
        return client.PostAsJsonAsync("/api/auth/password-reset/confirm", new PasswordResetConfirmRequest(token, password));
    }

    public static async Task<PasswordResetCheckResponse> CheckAsync(this ApiFactory f, string? token)
    {
        var response = await f.CreateClient().PostAsJsonAsync("/api/auth/password-reset/check", new PasswordResetTokenRequest(token));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<PasswordResetCheckResponse>();
    }

    public static IReadOnlyList<EmailApiFactory.SentMessage> Mail(this EmailApiFactory f, string email, string subject)
        => f.Sent.Where(m => m.To == email.ToLowerInvariant() && m.Subject == subject).ToList();

    /// <summary>The token exists only in the email: read it from the latest reset email to that address.</summary>
    public static string LatestToken(this EmailApiFactory f, string email)
        => LinkPattern.Match(f.Mail(email, ResetSubject).Last().Text).Groups[1].Value;

    public static async Task<string> LinkAsync(this EmailApiFactory f, string email)
    {
        Assert.Equal(HttpStatusCode.Accepted, (await f.RequestResetAsync(email)).StatusCode);
        return f.LatestToken(email);
    }

    public static async Task<HttpStatusCode> SignInAsync(this ApiFactory f, string email, string password)
        => (await f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password))).StatusCode;

    public static async Task<HttpStatusCode> MeAsync(this ApiFactory f, string jwt)
        => (await f.WithToken(jwt).GetAsync("/api/auth/me")).StatusCode;

    public static Task<AppUser> UserAsync(this ApiFactory f, string email)
        => f.WithDbAsync(db => db.Users.AsNoTracking().SingleAsync(u => u.NormalizedEmail == email.ToUpperInvariant()));

    /// <summary>Links Google or Apple sign-ins to the account, as the social sign-in flow would.</summary>
    public static Task AddSignInsAsync(this ApiFactory f, string userId, params string[] providers) => f.WithDbAsync(async db =>
    {
        foreach (var provider in providers)
            db.UserLogins.Add(new IdentityUserLogin<string>
            {
                LoginProvider = provider, ProviderKey = $"{provider}-{Guid.NewGuid():N}", ProviderDisplayName = provider, UserId = userId,
            });
        await db.SaveChangesAsync();
    });

    public static Task<int> SignInsAsync(this ApiFactory f, string userId)
        => f.WithDbAsync(db => db.UserLogins.CountAsync(l => l.UserId == userId));

    public static Task ConfirmAddressAsync(this ApiFactory f, string userId)
        => f.WithDbAsync(db => db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, true)));

    /// <summary>Waits for something an email send does after the request has been answered.</summary>
    public static async Task EventuallyAsync(Func<bool> condition, string what)
    {
        for (var waited = TimeSpan.Zero; waited < TimeSpan.FromSeconds(30); waited += TimeSpan.FromMilliseconds(50))
        {
            if (condition()) return;
            await Task.Delay(50);
        }
        Assert.Fail($"Timed out waiting for {what}.");
    }
}

/// <summary>
/// The reset flow, with the API's clock in the test's hands (<see cref="ManualTimeProvider"/>), so expiry and the per-account
/// cap are tested by moving time rather than by waiting. The minimum response time is off here; see
/// <see cref="PasswordResetTimingTests"/>.
/// </summary>
public class PasswordResetTests : IClassFixture<PasswordResetTests.Factory>
{
    public const string MasterKey = "test-master-key-for-reset-tests";

    public sealed class Factory : EmailApiFactory
    {
        public ManualTimeProvider Clock { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", "0");
            builder.UseSetting("MasterAdmin:KeyHash", MasterAdminKey.Hash(MasterKey));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(Clock);
            });
        }
    }

    private readonly Factory _f;
    public PasswordResetTests(Factory f) => _f = f;

    // ---- asking for a link ----

    [Fact]
    public async Task KnownAndUnknownAddressesGetTheSameAnswer_AndOnlyTheKnownOneGetsAnEmail()
    {
        var account = await _f.AccountAsync();
        var unknown = ResetSteps.NewEmail();

        var known = await _f.RequestResetAsync($"  {account.User.Email.ToUpperInvariant()} ", ip: "198.51.100.71");
        var missing = await _f.RequestResetAsync(unknown, ip: "198.51.100.71");

        Assert.Equal(HttpStatusCode.Accepted, known.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, missing.StatusCode);
        var knownBody = await known.Content.ReadAsStringAsync();
        Assert.Equal(knownBody, await missing.Content.ReadAsStringAsync());
        Assert.Contains("30 minutes", knownBody);
        Assert.Equal(known.Content.Headers.ContentType?.ToString(), missing.Content.Headers.ContentType?.ToString());
        Assert.Equal(known.Headers.Select(h => h.Key).Order(), missing.Headers.Select(h => h.Key).Order());
        Assert.DoesNotContain(_f.Sent, m => m.To == unknown);

        var message = Assert.Single(_f.Mail(account.User.Email, ResetSteps.ResetSubject));
        Assert.Contains($"{EmailApiFactory.SiteUrl}/reset-password#t=mgr_", message.Text);
        Assert.Contains("30 minutes", message.Text);
        Assert.Contains("ignore this email", message.Text);
        Assert.Contains($"{EmailApiFactory.SiteUrl}/reset-password#t=mgr_", message.Html);
        var token = _f.LatestToken(account.User.Email);
        Assert.DoesNotContain(token, knownBody);

        // Only the hash of the token and of the network are stored.
        var row = await _f.WithDbAsync(db => db.PasswordResetTokens.AsNoTracking().SingleAsync(t => t.UserId == account.User.Id));
        Assert.Equal(PasswordResetTokens.Hash(token), row.TokenHash);
        Assert.Equal(row.CreatedAt + TimeSpan.FromMinutes(30), row.ExpiresAt);
        Assert.Null(row.UsedAt);
        Assert.StartsWith(IpRetention.HashPrefix, row.RequestedIpHash);
        Assert.DoesNotContain("198.51.100.71", row.RequestedIpHash);
        Assert.DoesNotContain(_f.Logs, l => l.Contains(token) || l.Contains(account.User.Email));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-an-address")]
    [InlineData("two@@example.org")]
    public async Task AMalformedAddressIsRefusedForItsShapeAlone(string email)
    {
        var response = await _f.RequestResetAsync(email);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AccountsThatCantBeResetGetNoEmail_ButTheSameAnswer()
    {
        var blocked = await _f.AccountAsync();
        var locked = await _f.AccountAsync();
        var passwordless = await _f.AccountAsync();
        var deleted = await _f.AccountAsync();
        await _f.WithDbAsync(async db =>
        {
            var now = DateTime.UtcNow;
            await db.Users.Where(u => u.Id == blocked.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.BlockedAt, now));
            await db.Users.Where(u => u.Id == locked.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.LockedAt, now));
            await db.Users.Where(u => u.Id == passwordless.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.PasswordHash, (string?)null));
        });
        // Without a password and with an unconfirmed address, asking to be an organiser is enough to get no link.
        using (var scope = _f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            Assert.True((await users.AddToRoleAsync((await users.FindByIdAsync(passwordless.User.Id))!, Roles.TrainerRequest)).Succeeded);
        }
        // A link asked for before deletion goes with the account.
        await _f.LinkAsync(deleted.User.Email);
        Assert.Equal(HttpStatusCode.NoContent, (await _f.WithToken(deleted.Token).SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me")
        {
            Content = JsonContent.Create(new DeleteAccountRequest(ResetSteps.Password)),
        })).StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.PasswordResetTokens.AnyAsync(t => t.UserId == deleted.User.Id)));
        var before = _f.Sent.Count;

        foreach (var email in new[] { blocked.User.Email, locked.User.Email, passwordless.User.Email, deleted.User.Email,
                     TestClients.TrainerEmail, TestClients.AdminEmail })
        {
            var response = await _f.RequestResetAsync(email);
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            Assert.Equal(PasswordResetController.RequestedMessage, (await response.ReadAsync<PasswordResetRequestedResponse>()).Message);
        }

        Assert.Equal(before, _f.Sent.Count);
        Assert.False(await _f.WithDbAsync(db => db.PasswordResetTokens.AnyAsync(t =>
            t.UserId == blocked.User.Id || t.UserId == locked.User.Id || t.UserId == passwordless.User.Id)));
    }

    [Fact]
    public async Task EachAccountGetsAtMostOneLinkAMinuteAndFiveAnHour()
    {
        var account = await _f.AccountAsync();
        var email = account.User.Email;

        await _f.LinkAsync(email);
        Assert.Equal(HttpStatusCode.Accepted, (await _f.RequestResetAsync(email)).StatusCode);
        Assert.Single(_f.Mail(email, ResetSteps.ResetSubject));

        for (var sent = 2; sent <= PasswordResetService.MaxPerWindow; sent++)
        {
            _f.Clock.Advance(TimeSpan.FromMinutes(1));
            await _f.LinkAsync(email);
            Assert.Equal(sent, _f.Mail(email, ResetSteps.ResetSubject).Count);
        }
        _f.Clock.Advance(TimeSpan.FromMinutes(5));
        Assert.Equal(HttpStatusCode.Accepted, (await _f.RequestResetAsync(email)).StatusCode);
        Assert.Equal(PasswordResetService.MaxPerWindow, _f.Mail(email, ResetSteps.ResetSubject).Count);

        // An hour after the first, there is room again.
        _f.Clock.Advance(TimeSpan.FromMinutes(56));
        await _f.LinkAsync(email);
        Assert.Equal(PasswordResetService.MaxPerWindow + 1, _f.Mail(email, ResetSteps.ResetSubject).Count);
    }

    [Fact]
    public async Task ALinkUnderFiveMinutesOldOutlivesANewRequest()
    {
        var account = await _f.AccountAsync();
        var first = await _f.LinkAsync(account.User.Email);
        // Someone asking again and again for this address can't keep killing the link its owner has just been sent.
        _f.Clock.Advance(TimeSpan.FromMinutes(2));
        var second = await _f.LinkAsync(account.User.Email);
        _f.Clock.Advance(TimeSpan.FromMinutes(2));
        await _f.LinkAsync(account.User.Email);

        Assert.NotEqual(first, second);
        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(first)).State);
        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(second)).State);
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(first)).StatusCode);
        // Using one ends the rest.
        Assert.Equal(PasswordResetLinkState.Expired, (await _f.CheckAsync(second)).State);
    }

    [Fact]
    public async Task ANewLinkEndsOnesAtLeastFiveMinutesOld()
    {
        var account = await _f.AccountAsync();
        var first = await _f.LinkAsync(account.User.Email);
        _f.Clock.Advance(PasswordResetService.ProtectedFor);
        var second = await _f.LinkAsync(account.User.Email);
        Assert.NotEqual(first, second);

        Assert.Equal(PasswordResetLinkState.Expired, (await _f.CheckAsync(first)).State);
        var refused = await _f.ConfirmAsync(first);
        Assert.Equal(HttpStatusCode.Gone, refused.StatusCode);
        Assert.Equal("expired", (await refused.ReadAsync<PasswordResetProblem>()).Code);

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(second)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.NewPassword));
    }

    // ---- the link ----

    [Fact]
    public async Task ALinkWorksFor30MinutesAndNoLonger()
    {
        var account = await _f.AccountAsync();
        var token = await _f.LinkAsync(account.User.Email);
        var requestedAt = _f.Clock.GetUtcNow().UtcDateTime;

        var check = await _f.CheckAsync(token);
        Assert.Equal(PasswordResetLinkState.Valid, check.State);
        Assert.Equal(requestedAt.AddMinutes(30), check.ExpiresAt);

        _f.Clock.Advance(TimeSpan.FromMinutes(29));
        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(token)).State);
        _f.Clock.Advance(TimeSpan.FromMinutes(1));
        var expired = await _f.CheckAsync(token);
        Assert.Equal((PasswordResetLinkState.Expired, (DateTime?)null), (expired.State, expired.ExpiresAt));

        var refused = await _f.ConfirmAsync(token);
        Assert.Equal(HttpStatusCode.Gone, refused.StatusCode);
        var problem = await refused.ReadAsync<PasswordResetProblem>();
        Assert.Equal("expired", problem.Code);
        Assert.Contains("expired", problem.Message);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.Password));
        Assert.Null((await _f.WithDbAsync(db => db.PasswordResetTokens.AsNoTracking().SingleAsync(t => t.UserId == account.User.Id))).UsedAt);
    }

    [Fact]
    public async Task ALinkWorksOnce()
    {
        var account = await _f.AccountAsync();
        var token = await _f.LinkAsync(account.User.Email);

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(token)).StatusCode);
        var again = await _f.ConfirmAsync(token, "An0ther-passw0rd!");

        Assert.Equal(HttpStatusCode.Gone, again.StatusCode);
        Assert.Equal("used", (await again.ReadAsync<PasswordResetProblem>()).Code);
        Assert.Equal(PasswordResetLinkState.Used, (await _f.CheckAsync(token)).State);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.NewPassword));
        Assert.Equal(HttpStatusCode.Unauthorized, await _f.SignInAsync(account.User.Email, "An0ther-passw0rd!"));
    }

    [Fact]
    public async Task TwoSubmitsAtOnce_OnlyOneChangesThePassword()
    {
        var account = await _f.AccountAsync();
        var token = await _f.LinkAsync(account.User.Email);
        var passwords = Enumerable.Range(1, 6).Select(i => $"Rac3-passw0rd-{i}!").ToArray();

        var responses = await Task.WhenAll(passwords.Select(p => _f.ConfirmAsync(token, p)));

        var winner = Assert.Single(responses.Select((r, i) => (r, i)), x => x.r.StatusCode == HttpStatusCode.OK);
        Assert.All(responses.Where(r => r.StatusCode != HttpStatusCode.OK), r => Assert.Equal(HttpStatusCode.Gone, r.StatusCode));
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, passwords[winner.i]));
        Assert.Equal(1, (await _f.UserAsync(account.User.Email)).SessionVersion);
        Assert.Single(_f.Mail(account.User.Email, ResetSteps.ChangedSubject));
    }

    [Fact]
    public async Task APasswordThatBreaksTheRulesLeavesTheLinkUsable()
    {
        var account = await _f.AccountAsync();
        var token = await _f.LinkAsync(account.User.Email);

        var weak = await _f.ConfirmAsync(token, "short");
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        var problem = await weak.ReadAsync<PasswordResetProblem>();
        Assert.Equal("password_rules", problem.Code);
        Assert.Contains("PasswordTooShort", problem.ErrorCodes!);
        Assert.Contains("PasswordRequiresDigit", problem.ErrorCodes!);
        Assert.Contains("Your password needs a number.", problem.Errors!);
        Assert.DoesNotContain(problem.Errors!, e => e.Contains("alphanumeric", StringComparison.OrdinalIgnoreCase));

        var empty = await _f.ConfirmAsync(token, "");
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal("password_required", (await empty.ReadAsync<PasswordResetProblem>()).Code);

        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(token)).State);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.Password));
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(token)).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("mgr_")]
    [InlineData("mgi_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("mgr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("mgr_has spaces and / slashes")]
    public async Task AnUnknownOrMalformedLinkIsInvalid(string? token)
    {
        var check = await _f.CheckAsync(token);
        Assert.Equal((PasswordResetLinkState.Invalid, (DateTime?)null), (check.State, check.ExpiresAt));
        var refused = await _f.ConfirmAsync(token);
        Assert.Equal(HttpStatusCode.NotFound, refused.StatusCode);
        Assert.Equal("invalid", (await refused.ReadAsync<PasswordResetProblem>()).Code);
    }

    [Fact]
    public async Task CheckingALinkNeverSaysWhoseAccountItIs()
    {
        var account = await _f.AccountAsync();
        var token = await _f.LinkAsync(account.User.Email);

        var response = await _f.CreateClient().PostAsJsonAsync("/api/auth/password-reset/check", new PasswordResetTokenRequest(token));
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain(account.User.Email, body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(account.User.Id, body);
        Assert.DoesNotContain(account.User.FullName, body);
        Assert.Equal(new[] { "expiresAt", "state" }, System.Text.Json.JsonDocument.Parse(body).RootElement.EnumerateObject().Select(p => p.Name).Order());
    }

    [Fact]
    public async Task ALinkStopsWorkingWhenTheAccountIsBlocked()
    {
        var account = await _f.AccountAsync();
        var token = await _f.LinkAsync(account.User.Email);
        await _f.WithDbAsync(db => db.Users.Where(u => u.Id == account.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.BlockedAt, DateTime.UtcNow)));

        Assert.Equal(PasswordResetLinkState.Invalid, (await _f.CheckAsync(token)).State);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.ConfirmAsync(token)).StatusCode);
        Assert.Null((await _f.WithDbAsync(db => db.PasswordResetTokens.AsNoTracking().SingleAsync(t => t.UserId == account.User.Id))).UsedAt);
    }

    [Fact]
    public async Task ABlockedNetworkCantAskForOrUseALink()
    {
        var account = await _f.AccountAsync();
        var token = await _f.LinkAsync(account.User.Email);
        const string ip = "203.0.113.77";
        await _f.WithDbAsync(async db => { db.IpBlocks.Add(new IpBlock { IpAddress = ip, Reason = "Test" }); await db.SaveChangesAsync(); });

        Assert.Equal(HttpStatusCode.Forbidden, (await _f.RequestResetAsync(account.User.Email, ip)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await _f.ConfirmAsync(token, ip: ip)).StatusCode);
        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(token)).State);
    }

    // ---- after a reset ----

    [Fact]
    public async Task AResetSignsTheAccountOutEverywhere()
    {
        var account = await _f.AccountAsync();
        var otherDevice = (await _f.LoginAsync(account.User.Email, ResetSteps.Password)).Token;
        Assert.Equal(HttpStatusCode.OK, await _f.MeAsync(account.Token));
        Assert.Equal(HttpStatusCode.OK, await _f.MeAsync(otherDevice));

        var confirmed = await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email));
        Assert.Equal(HttpStatusCode.OK, confirmed.StatusCode);
        Assert.DoesNotContain("token", await confirmed.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        Assert.Equal(HttpStatusCode.Unauthorized, await _f.MeAsync(account.Token));
        Assert.Equal(HttpStatusCode.Unauthorized, await _f.MeAsync(otherDevice));
        Assert.Equal(HttpStatusCode.Unauthorized, await _f.SignInAsync(account.User.Email, ResetSteps.Password));
        var fresh = await _f.LoginAsync(account.User.Email, ResetSteps.NewPassword);
        Assert.Equal(HttpStatusCode.OK, await _f.MeAsync(fresh.Token));
    }

    [Fact]
    public async Task TokensMadeBeforeTheSessionClaimExistedWorkUntilAReset()
    {
        var account = await _f.AccountAsync();
        var legacy = LegacyToken(account.User.Id, account.User.Email);
        Assert.Equal(HttpStatusCode.OK, await _f.MeAsync(legacy));

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, await _f.MeAsync(legacy));
    }

    [Fact]
    public async Task AResetOnAnotherInstanceIsRefusedHereAtOnce()
    {
        var account = await _f.AccountAsync();
        Assert.Equal(HttpStatusCode.OK, await _f.MeAsync(account.Token));
        // What another instance's reset leaves in the shared database, with nothing said to this instance.
        await _f.WithDbAsync(db => db.Users.Where(u => u.Id == account.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.SessionVersion, 1)));

        Assert.Equal(HttpStatusCode.Unauthorized, await _f.MeAsync(account.Token));
        var fresh = await _f.LoginAsync(account.User.Email, ResetSteps.Password);
        Assert.Equal(HttpStatusCode.OK, await _f.MeAsync(fresh.Token));
    }

    [Fact]
    public async Task AResetClearsAWrongPasswordLockout_ButLeavesTheAddressAsItWas()
    {
        var account = await _f.AccountAsync();
        for (var i = 0; i < 5; i++) await _f.SignInAsync(account.User.Email, "Wr0ng-password!");
        var before = await _f.UserAsync(account.User.Email);
        Assert.False(before.EmailConfirmed);
        Assert.True(before.LockoutEnd > DateTimeOffset.UtcNow);
        Assert.Equal(HttpStatusCode.Unauthorized, await _f.SignInAsync(account.User.Email, ResetSteps.Password));

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);

        var after = await _f.UserAsync(account.User.Email);
        // Reading the mailbox doesn't prove the address belongs to the account's owner, so it stays unconfirmed.
        Assert.False(after.EmailConfirmed);
        Assert.Null(after.LockoutEnd);
        Assert.Equal(0, after.AccessFailedCount);
        Assert.NotEqual(before.SecurityStamp, after.SecurityStamp);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.NewPassword));

        // A confirmed address stays confirmed.
        var confirmed = await _f.AccountAsync();
        await _f.ConfirmAddressAsync(confirmed.User.Id);
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(confirmed.User.Email))).StatusCode);
        Assert.True((await _f.UserAsync(confirmed.User.Email)).EmailConfirmed);
    }

    [Fact]
    public async Task AResetCantCarryAnUnconfirmedAddressThroughATrainerRequestApproval()
    {
        // Someone asks to be an organiser but mistypes their address: whoever reads that mailbox gets no link.
        var email = ResetSteps.NewEmail();
        var signup = await (await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(email, ResetSteps.Password, "Trainer", "Test Pony Club"))).ReadAsync<AuthResponse>();
        Assert.Contains(Roles.TrainerRequest, signup.User.Roles);
        Assert.Equal(HttpStatusCode.Accepted, (await _f.RequestResetAsync(email)).StatusCode);
        Assert.Empty(_f.Mail(email, ResetSteps.ResetSubject));
        Assert.False(await _f.WithDbAsync(db => db.PasswordResetTokens.AnyAsync(t => t.UserId == signup.User.Id)));

        // A member reset before asking (when a link is allowed) leaves the address unconfirmed, so it can't be approved either.
        var member = await _f.AccountAsync();
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(member.User.Email))).StatusCode);
        using (var scope = _f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            Assert.True((await users.AddToRoleAsync((await users.FindByIdAsync(member.User.Id))!, Roles.TrainerRequest)).Succeeded);
        }
        var admin = await _f.AdminAsync();
        foreach (var id in new[] { signup.User.Id, member.User.Id })
        {
            var approval = await admin.PostAsync($"/api/admin/trainer-requests/{id}/approve", null);
            Assert.Equal(HttpStatusCode.Conflict, approval.StatusCode);
            Assert.Contains(ConfirmedAddress.Code, await approval.Content.ReadAsStringAsync());
            Assert.DoesNotContain(Roles.Trainer, await RolesAsync(id));
        }
    }

    [Fact]
    public async Task EveryoneIsToldTheirPasswordChanged_AndAdminsAreToldToAskAMasterAdminForALock()
    {
        var member = await _f.AccountAsync();
        var adminEmail = ResetSteps.NewEmail();
        var admin = await _f.CreateClient().PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Show Secretary", adminEmail, ResetSteps.Password));
        Assert.Equal(HttpStatusCode.OK, admin.StatusCode);
        var adminAuth = await admin.ReadAsync<AuthResponse>();
        Assert.Contains(Roles.Admin, adminAuth.User.Roles);
        await _f.ConfirmAddressAsync(adminAuth.User.Id);

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(member.User.Email))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(adminEmail))).StatusCode);

        var memberNotice = Assert.Single(_f.Mail(member.User.Email, ResetSteps.ChangedSubject));
        var adminNotice = Assert.Single(_f.Mail(adminEmail, ResetSteps.ChangedSubject));
        foreach (var notice in new[] { memberNotice, adminNotice })
        {
            Assert.Contains("signed the account out on every device", notice.Text);
            Assert.Contains($"{EmailApiFactory.SiteUrl}/forgot-password", notice.Text);
            Assert.Contains($"{EmailApiFactory.SiteUrl}/forgot-password", notice.Html);
            Assert.DoesNotContain("reset-password#t=", notice.Text);
        }
        Assert.DoesNotContain("site admin", memberNotice.Text);
        Assert.DoesNotContain("master admin", memberNotice.Text);
        Assert.Contains("This is a site admin account", adminNotice.Text);
        Assert.Contains("ask a master admin to lock the account", adminNotice.Text);
        Assert.Contains("This is a site admin account", adminNotice.Html);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(adminEmail, ResetSteps.NewPassword));
    }

    [Fact]
    public async Task AResetTakesAwayMasterAdmin_WhichTheKeyGivesBack()
    {
        var account = await _f.AccountAsync();
        using (var scope = _f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = (await users.FindByIdAsync(account.User.Id))!;
            Assert.True((await users.AddToRolesAsync(user, [Roles.Admin, Roles.MasterAdmin])).Succeeded);
        }
        await _f.ConfirmAddressAsync(account.User.Id);

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);

        var roles = await RolesAsync(account.User.Id);
        Assert.Contains(Roles.Admin, roles);
        Assert.DoesNotContain(Roles.MasterAdmin, roles);
        var notice = Assert.Single(_f.Mail(account.User.Email, ResetSteps.ChangedSubject));
        Assert.Contains("This account was a master admin", notice.Text);
        Assert.Contains("enter the master admin key again", notice.Text);
        Assert.Contains("This account was a master admin", notice.Html);
        // Nobody can lock a master admin, so the notice doesn't suggest it.
        Assert.DoesNotContain("lock", notice.Text, StringComparison.OrdinalIgnoreCase);

        // The owner, who holds the key, gets the role back.
        var signedIn = await _f.LoginAsync(account.User.Email, ResetSteps.NewPassword);
        Assert.DoesNotContain(Roles.MasterAdmin, signedIn.User.Roles);
        var restored = await _f.WithToken(signedIn.Token).PostAsJsonAsync("/api/auth/master-admin", new MasterAdminKeyRequest(MasterKey));
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        Assert.Contains(Roles.MasterAdmin, (await restored.ReadAsync<AuthResponse>()).User.Roles);
    }

    [Fact]
    public async Task OrganisersAndAdminsGetALinkOnlyOnceTheirAddressIsConfirmed()
    {
        // An admin-key admin can type any address, so the mailbox may not be theirs.
        var adminEmail = ResetSteps.NewEmail();
        var admin = await (await _f.CreateClient().PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Show Secretary", adminEmail, ResetSteps.Password))).ReadAsync<AuthResponse>();
        // A trainer request with a confirmed address gets a link.
        var trainerEmail = ResetSteps.NewEmail();
        var signup = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(trainerEmail, ResetSteps.Password, "Trainer", "Test Pony Club"));
        var trainer = await signup.ReadAsync<AuthResponse>();
        await _f.ConfirmAddressAsync(trainer.User.Id);
        var earlyLink = await _f.LinkAsync(trainerEmail);
        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(earlyLink)).State);
        // Approval needs a confirmed address now, so an unconfirmed organiser is an account approved before that rule.
        (await (await _f.AdminAsync()).PostAsync($"/api/admin/trainer-requests/{trainer.User.Id}/approve", null)).EnsureSuccessStatusCode();
        await _f.WithDbAsync(db => db.Users.Where(u => u.Id == trainer.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, false)));
        _f.Clock.Advance(TimeSpan.FromMinutes(2));
        var before = _f.Sent.Count;

        foreach (var email in new[] { adminEmail, trainerEmail })
        {
            var response = await _f.RequestResetAsync(email);
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            Assert.Equal(PasswordResetController.RequestedMessage, (await response.ReadAsync<PasswordResetRequestedResponse>()).Message);
        }
        Assert.Equal(before, _f.Sent.Count);
        // The link sent while they were a member stops working once they organise.
        Assert.Equal(PasswordResetLinkState.Invalid, (await _f.CheckAsync(earlyLink)).State);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.ConfirmAsync(earlyLink)).StatusCode);

        await _f.ConfirmAddressAsync(admin.User.Id);
        await _f.ConfirmAddressAsync(trainer.User.Id);
        _f.Clock.Advance(TimeSpan.FromMinutes(2));
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(adminEmail))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(trainerEmail))).StatusCode);
    }

    [Fact]
    public async Task ACompetitionAdminNeedsAConfirmedAddressToo()
    {
        // Running an event is staff access without a role, so it counts like one.
        var account = await _f.AccountAsync();
        var section = await _f.NewSectionAsync();
        await _f.WithDbAsync(async db =>
        {
            db.CompetitionCollaborators.Add(new CompetitionCollaborator
            {
                CompetitionId = section.CompetitionId, UserId = account.User.Id, AddedByUserId = account.User.Id, AddedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        });
        var before = _f.Sent.Count;

        Assert.Equal(HttpStatusCode.Accepted, (await _f.RequestResetAsync(account.User.Email)).StatusCode);
        Assert.Equal(before, _f.Sent.Count);

        await _f.ConfirmAddressAsync(account.User.Id);
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);
    }

    [Fact]
    public async Task AResetDisconnectsGoogleAndAppleSignIns_AndTheNoticeSaysSo()
    {
        var linked = await _f.AccountAsync();
        var plain = await _f.AccountAsync();
        await _f.AddSignInsAsync(linked.User.Id, "Google", "Apple");
        await _f.AddSignInsAsync(plain.User.Id);

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(linked.User.Email))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(plain.User.Email))).StatusCode);

        Assert.Equal(0, await _f.SignInsAsync(linked.User.Id));
        var notice = Assert.Single(_f.Mail(linked.User.Email, ResetSteps.ChangedSubject));
        Assert.Contains("disconnected any Google, Apple or Facebook sign-in", notice.Text);
        Assert.Contains("connect it again from your account page", notice.Text);
        Assert.Contains("disconnected any Google, Apple or Facebook sign-in", notice.Html);
        // Nothing to disconnect, nothing said about it.
        Assert.DoesNotContain("Google", Assert.Single(_f.Mail(plain.User.Email, ResetSteps.ChangedSubject)).Text);
    }

    [Fact]
    public async Task AnAccountWithoutAPasswordSetsItsFirstOne_EvenWithAnUnconfirmedAddress()
    {
        // A Member made with a provider whose address nobody checked: the mailbox's owner can take it back.
        var account = await _f.AccountAsync();
        await _f.WithDbAsync(db => db.Users.Where(u => u.Id == account.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.PasswordHash, (string?)null)));
        await _f.AddSignInsAsync(account.User.Id, "Facebook");
        Assert.False((await _f.UserAsync(account.User.Email)).EmailConfirmed);

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);

        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.NewPassword));
        Assert.Equal(0, await _f.SignInsAsync(account.User.Id));
        // The reset doesn't confirm the address, but it does record that the password came through the mailbox.
        Assert.False((await _f.UserAsync(account.User.Email)).EmailConfirmed);
        Assert.Equal(LinkByEmail.FromReset, await _f.WithDbAsync(db => db.UserClaims
            .Where(c => c.UserId == account.User.Id && c.ClaimType == LinkByEmail.PasswordFromMailbox).Select(c => c.ClaimValue).SingleAsync()));
        var notice = Assert.Single(_f.Mail(account.User.Email, "A password was set on your Mounted Games account"));
        Assert.Contains("A password has just been set for the Mounted Games account", notice.Text);
        Assert.Contains("disconnected any Google, Apple or Facebook sign-in", notice.Text);

        // A second reset keeps the one record.
        _f.Clock.Advance(PasswordResetService.MinGap);
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email), "An0ther-passw0rd!")).StatusCode);
        Assert.Equal(1, await _f.WithDbAsync(db => db.UserClaims.CountAsync(c => c.UserId == account.User.Id && c.ClaimType == LinkByEmail.PasswordFromMailbox)));
    }

    [Fact]
    public async Task AnAccountWithoutAPasswordThatAskedForStaffAccessSetsItsFirstOne_OnlyOnceItsAddressIsConfirmed()
    {
        var account = await _f.AccountAsync();
        await _f.WithDbAsync(db => db.Users.Where(u => u.Id == account.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.PasswordHash, (string?)null)));
        await _f.AddSignInsAsync(account.User.Id, "Google");
        using (var scope = _f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            Assert.True((await users.AddToRoleAsync((await users.FindByIdAsync(account.User.Id))!, Roles.ManagerRequest)).Succeeded);
        }
        var before = _f.Sent.Count;
        Assert.Equal(HttpStatusCode.Accepted, (await _f.RequestResetAsync(account.User.Email)).StatusCode);
        Assert.Equal(before, _f.Sent.Count);

        await _f.ConfirmAddressAsync(account.User.Id);
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.NewPassword));
        Assert.Equal(0, await _f.SignInsAsync(account.User.Id));
    }

    [Fact]
    public async Task AnAdminWithoutAPasswordGetsNoLink_EvenWithAConfirmedAddress()
    {
        var account = await _f.AccountAsync();
        using (var scope = _f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            Assert.True((await users.AddToRoleAsync((await users.FindByIdAsync(account.User.Id))!, Roles.Admin)).Succeeded);
        }
        await _f.ConfirmAddressAsync(account.User.Id);
        await _f.WithDbAsync(db => db.Users.Where(u => u.Id == account.User.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.PasswordHash, (string?)null)));
        var before = _f.Sent.Count;

        var response = await _f.RequestResetAsync(account.User.Email);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(PasswordResetController.RequestedMessage, (await response.ReadAsync<PasswordResetRequestedResponse>()).Message);
        Assert.Equal(before, _f.Sent.Count);
    }

    private Task<List<string>> RolesAsync(string userId) => _f.WithDbAsync(db =>
        (from membership in db.UserRoles join role in db.Roles on membership.RoleId equals role.Id
         where membership.UserId == userId select role.Name!).ToListAsync());

    [Fact]
    public async Task AMailProviderFailureChangesNothingForThePerson_AndIsLoggedWithoutTheAddressOrLink()
    {
        var account = await _f.AccountAsync();
        _f.Fail = () => new HttpResponseMessage(HttpStatusCode.InternalServerError);
        try
        {
            var response = await _f.RequestResetAsync(account.User.Email);
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            Assert.Equal(PasswordResetController.RequestedMessage, (await response.ReadAsync<PasswordResetRequestedResponse>()).Message);
        }
        finally { _f.Fail = null; }

        var token = _f.LatestToken(account.User.Email);
        Assert.Contains(_f.Logs, l => l.Contains("password reset link") && l.Contains("not delivered"));
        Assert.DoesNotContain(_f.Logs, l => l.Contains(token) || l.Contains(account.User.Email));
        // The link was made, so it still works if the email turns up after all.
        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(token)).State);
    }

    private static string LegacyToken(string userId, string email)
    {
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes("test-jwt-key-0123456789-0123456789-0123456789")),
            SecurityAlgorithms.HmacSha256);
        var jwt = new JwtSecurityToken("MountedGames.Api", "MountedGames.Web",
            [new Claim(JwtRegisteredClaimNames.Sub, userId), new Claim(JwtRegisteredClaimNames.Email, email)],
            expires: DateTime.UtcNow.AddHours(1), signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }
}

/// <summary>Every request takes at least the configured minimum, whether or not an email was sent.</summary>
public class PasswordResetTimingTests : IClassFixture<PasswordResetTimingTests.Factory>
{
    public const int FloorMilliseconds = 1500;

    public sealed class Factory : EmailApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", FloorMilliseconds.ToString());
        }
    }

    private readonly Factory _f;
    public PasswordResetTimingTests(Factory f) => _f = f;

    [Fact]
    public async Task KnownAndUnknownAddressesBothTakeAtLeastTheMinimum()
    {
        var account = await _f.AccountAsync();
        foreach (var email in new[] { account.User.Email, ResetSteps.NewEmail() })
        {
            var clock = Stopwatch.StartNew();
            var response = await _f.RequestResetAsync(email);
            clock.Stop();
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            Assert.True(clock.ElapsedMilliseconds >= FloorMilliseconds - 20, $"Answered in {clock.ElapsedMilliseconds} ms.");
        }
        await ResetSteps.EventuallyAsync(() => _f.Mail(account.User.Email, ResetSteps.ResetSubject).Count == 1, "the reset email");
    }

    [Fact]
    public void TheMinimumComesFromConfiguration_WithinSensibleBounds()
    {
        using var scope = _f.Services.CreateScope();
        Assert.Equal(TimeSpan.FromMilliseconds(FloorMilliseconds), scope.ServiceProvider.GetRequiredService<PasswordResetService>().MinimumResponse);
    }
}

/// <summary>The per-network limits, on a host with production-like (small) numbers.</summary>
public class PasswordResetRateLimitTests : IClassFixture<PasswordResetRateLimitTests.Factory>
{
    public sealed class Factory : EmailApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", "0");
            builder.UseSetting("RateLimits:PasswordResetRequestsPerMinute", "2");
            builder.UseSetting("RateLimits:PasswordResetLinksPerMinute", "2");
        }
    }

    private readonly Factory _f;
    public PasswordResetRateLimitTests(Factory f) => _f = f;

    [Fact]
    public async Task RequestsAreLimitedPerNetwork_OnTheirOwnBudget()
    {
        const string venue = "198.51.100.90";
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.Accepted, (await _f.RequestResetAsync(ResetSteps.NewEmail(), venue)).StatusCode);
        var limited = await _f.RequestResetAsync(ResetSteps.NewEmail(), venue);
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("60", limited.Headers.GetValues("Retry-After").Single());

        // Another network is unaffected, and the venue can still sign in.
        Assert.Equal(HttpStatusCode.Accepted, (await _f.RequestResetAsync(ResetSteps.NewEmail(), "198.51.100.91")).StatusCode);
        var signIn = _f.CreateClient();
        signIn.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, venue);
        Assert.Equal(HttpStatusCode.OK, (await signIn.PostAsJsonAsync("/api/auth/login",
            new LoginRequest(TestClients.TrainerEmail, TestClients.TrainerPassword))).StatusCode);
    }

    [Fact]
    public async Task CheckingAndUsingLinksAreLimitedPerNetwork()
    {
        const string venue = "198.51.100.92";
        var client = _f.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, venue);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/auth/password-reset/check", new PasswordResetTokenRequest("mgr_x"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/auth/password-reset/confirm",
            new PasswordResetConfirmRequest("mgr_x", ResetSteps.NewPassword))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/auth/password-reset/check", new PasswordResetTokenRequest("mgr_x"))).StatusCode);
    }
}

/// <summary>Without a website address there is nowhere to send people, so no link is made, and the answer is the same.</summary>
public class PasswordResetWithoutSiteTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public PasswordResetWithoutSiteTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task NoLinkIsMadeWhenTheSiteAddressIsMissing()
    {
        var account = await _f.AccountAsync();
        var response = await _f.RequestResetAsync(account.User.Email);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(PasswordResetController.RequestedMessage, (await response.ReadAsync<PasswordResetRequestedResponse>()).Message);
        Assert.False(await _f.WithDbAsync(db => db.PasswordResetTokens.AnyAsync(t => t.UserId == account.User.Id)));
    }
}

/// <summary>A mail provider slower than the floor: the answer still comes at the floor, and the send is cancelled then, so nothing runs on after it.</summary>
public class PasswordResetSlowMailTests : IClassFixture<PasswordResetSlowMailTests.Factory>
{
    public const int FloorMilliseconds = 300;
    public static readonly TimeSpan SendTakes = TimeSpan.FromSeconds(6);

    /// <summary>Takes <see cref="SendTakes"/> and then fails, like a provider that times out.</summary>
    public sealed class SlowSender : IEmailSender
    {
        public System.Collections.Concurrent.ConcurrentQueue<EmailMessage> Finished { get; } = new();

        public int Cancelled;

        public async Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default)
        {
            try { await Task.Delay(SendTakes, ct); }
            catch (OperationCanceledException) { Interlocked.Increment(ref Cancelled); throw; }
            Finished.Enqueue(message);
            return EmailDeliveryStatus.Failed;
        }
    }

    public sealed class Factory : EmailApiFactory
    {
        public SlowSender Slow { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", FloorMilliseconds.ToString());
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(Slow);
            });
        }
    }

    private readonly Factory _f;
    public PasswordResetSlowMailTests(Factory f) => _f = f;

    [Fact]
    public async Task ASlowSendDoesntStretchTheAnswer_AndIsCancelledAndLoggedWithinTheRequest()
    {
        var account = await _f.AccountAsync();
        // Warm the host up first, so the timing below is the request's own.
        Assert.Equal(HttpStatusCode.Accepted, (await _f.RequestResetAsync(ResetSteps.NewEmail())).StatusCode);

        var clock = Stopwatch.StartNew();
        var response = await _f.RequestResetAsync(account.User.Email);
        clock.Stop();

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.True(clock.Elapsed < SendTakes - TimeSpan.FromSeconds(2), $"Answered in {clock.ElapsedMilliseconds} ms, so it waited for the email.");
        Assert.True(clock.ElapsedMilliseconds >= FloorMilliseconds - 20, $"Answered in {clock.ElapsedMilliseconds} ms, before the floor.");
        // Cancelled at the floor and logged before the answer went, with a masked address only; it never finishes later.
        Assert.Contains(_f.Logs, l => l.Contains("password reset link") && l.Contains("cancelled before it was sent"));
        Assert.DoesNotContain(_f.Logs, l => l.Contains(account.User.Email));
        Assert.Equal(1, _f.Slow.Cancelled);
        await Task.Delay(SendTakes);
        Assert.DoesNotContain(_f.Slow.Finished, m => m.Subject == ResetSteps.ResetSubject);
    }
}

/// <summary>
/// The reset saving over an account that something else changed after the reset read it (a lock or block, which now give
/// the account a new ConcurrencyStamp). The race is staged by changing the stamp just before the reset's own save.
/// </summary>
public class PasswordResetRaceTests : IClassFixture<PasswordResetRaceTests.Factory>
{
    public sealed class RaceTrigger
    {
        private string? _armed;
        /// <summary>When set, the staged failure is an ordinary Identity error rather than a changed ConcurrencyStamp.</summary>
        public bool OtherFailure { get; private set; }
        public void Arm(string userId, bool otherFailure = false)
        {
            OtherFailure = otherFailure;
            Volatile.Write(ref _armed, userId);
        }
        /// <summary>Fires once. CompareExchange compares references, so it swaps out the armed instance itself.</summary>
        public bool Take(string userId)
        {
            var armed = Volatile.Read(ref _armed);
            return armed == userId && ReferenceEquals(Interlocked.CompareExchange(ref _armed, null, armed), armed);
        }
    }

    public sealed class RacingUserStore(AppDbContext context, RaceTrigger trigger, IdentityErrorDescriber? describer = null)
        : Microsoft.AspNetCore.Identity.EntityFrameworkCore.UserStore<AppUser, IdentityRole, AppDbContext>(context, describer)
    {
        public override async Task<IdentityResult> UpdateAsync(AppUser user, CancellationToken cancellationToken = default)
        {
            if (trigger.OtherFailure && trigger.Take(user.Id))
                return IdentityResult.Failed(new IdentityError { Code = "DuplicateEmail", Description = "Staged failure." });
            if (trigger.Take(user.Id))
                await Context.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE \"AspNetUsers\" SET \"ConcurrencyStamp\" = {Guid.NewGuid().ToString()} WHERE \"Id\" = {user.Id}", cancellationToken);
            return await base.UpdateAsync(user, cancellationToken);
        }
    }

    public sealed class Factory : EmailApiFactory
    {
        public RaceTrigger Trigger { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", "0");
            builder.ConfigureServices(services =>
            {
                services.AddSingleton(Trigger);
                services.RemoveAll<IUserStore<AppUser>>();
                services.AddScoped<IUserStore<AppUser>, RacingUserStore>();
            });
        }
    }

    private readonly Factory _f;
    public PasswordResetRaceTests(Factory f) => _f = f;

    [Fact]
    public async Task AnAccountChangedDuringTheSave_GetsAConflictAndNothingIsSaved()
    {
        var account = await _f.AccountAsync();
        var token = await _f.LinkAsync(account.User.Email);
        _f.Trigger.Arm(account.User.Id);

        var response = await _f.ConfirmAsync(token);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await response.ReadAsync<PasswordResetProblem>();
        Assert.Equal("conflict", problem.Code);
        Assert.Contains("Try the link again", problem.Message);
        // Rolled back: the link still works, so does the old password and the existing sign-in.
        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(token)).State);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.Password));
        Assert.Equal(HttpStatusCode.OK, await _f.MeAsync(account.Token));
        Assert.Equal(0, (await _f.UserAsync(account.User.Email)).SessionVersion);

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(token)).StatusCode);
    }

    [Fact]
    public async Task AFailureThatIsntAConflict_Gets500_IsLogged_AndSavesNothing()
    {
        var account = await _f.AccountAsync();
        var token = await _f.LinkAsync(account.User.Email);
        _f.Trigger.Arm(account.User.Id, otherFailure: true);

        var response = await _f.ConfirmAsync(token);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("failed", (await response.ReadAsync<PasswordResetProblem>()).Code);
        Assert.Contains(_f.Logs, l => l.Contains("could not be saved: DuplicateEmail"));
        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(token)).State);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.Password));
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(token)).StatusCode);
    }

    [Fact]
    public async Task AMasterAdminChangedDuringTheSave_KeepsTheRole()
    {
        var account = await _f.AccountAsync();
        using (var scope = _f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            Assert.True((await users.AddToRolesAsync((await users.FindByIdAsync(account.User.Id))!, [Roles.Admin, Roles.MasterAdmin])).Succeeded);
        }
        await _f.ConfirmAddressAsync(account.User.Id);
        var token = await _f.LinkAsync(account.User.Email);
        _f.Trigger.Arm(account.User.Id);

        Assert.Equal(HttpStatusCode.Conflict, (await _f.ConfirmAsync(token)).StatusCode);
        Assert.True(await _f.WithDbAsync(db => (from m in db.UserRoles join r in db.Roles on m.RoleId equals r.Id
                                                 where m.UserId == account.User.Id && r.Name == Roles.MasterAdmin select m).AnyAsync()));
    }
}

/// <summary>
/// Making the link fails (the database drops out, say): the request is still answered 202 at the floor, like any other,
/// so a failure for a known address can't be told from an unknown one, and the failure is logged with a masked address.
/// </summary>
public class PasswordResetPrepareFailureTests : IClassFixture<PasswordResetPrepareFailureTests.Factory>
{
    public const int FloorMilliseconds = 300;

    public sealed class Trap
    {
        private string? _armed;
        public void Arm(string normalizedEmail) => Volatile.Write(ref _armed, normalizedEmail);
        public bool Springs(string normalizedEmail) => Volatile.Read(ref _armed) == normalizedEmail;
    }

    public sealed class FailingUserStore(AppDbContext context, Trap trap, IdentityErrorDescriber? describer = null)
        : Microsoft.AspNetCore.Identity.EntityFrameworkCore.UserStore<AppUser, IdentityRole, AppDbContext>(context, describer)
    {
        public override Task<AppUser?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken = default)
            => trap.Springs(normalizedEmail)
                ? throw new InvalidOperationException("The database went away.")
                : base.FindByEmailAsync(normalizedEmail, cancellationToken);
    }

    public sealed class Factory : EmailApiFactory
    {
        public Trap Trap { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", FloorMilliseconds.ToString());
            builder.ConfigureServices(services =>
            {
                services.AddSingleton(Trap);
                services.RemoveAll<IUserStore<AppUser>>();
                services.AddScoped<IUserStore<AppUser>, FailingUserStore>();
            });
        }
    }

    private readonly Factory _f;
    public PasswordResetPrepareFailureTests(Factory f) => _f = f;

    [Fact]
    public async Task AFailureMakingTheLink_IsAnsweredLikeAnyOtherRequest_AtTheFloor_AndLoggedMasked()
    {
        var account = await _f.AccountAsync();
        // Warm the host up first, so the timing below is the request's own.
        Assert.Equal(HttpStatusCode.Accepted, (await _f.RequestResetAsync(ResetSteps.NewEmail())).StatusCode);
        _f.Trap.Arm(account.User.Email.ToUpperInvariant());

        var clock = Stopwatch.StartNew();
        var response = await _f.RequestResetAsync(account.User.Email);
        clock.Stop();

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(PasswordResetController.RequestedMessage, (await response.ReadAsync<PasswordResetRequestedResponse>()).Message);
        Assert.True(clock.ElapsedMilliseconds >= FloorMilliseconds - 20, $"Answered in {clock.ElapsedMilliseconds} ms, before the floor.");
        Assert.Contains(_f.Logs, l => l.Contains("password reset link") && l.Contains("could not be made: InvalidOperationException"));
        Assert.DoesNotContain(_f.Logs, l => l.Contains(account.User.Email));
        Assert.Empty(_f.Mail(account.User.Email, ResetSteps.ResetSubject));
    }
}

/// <summary>
/// A slow (cold) start with the floor on, driven by the API's clock (<see cref="ManualTimeProvider"/>) rather than real
/// waits: an email that can't go in time never uses up the account's one-a-minute gap, so asking again works at once.
/// </summary>
public class PasswordResetColdStartTests : IClassFixture<PasswordResetColdStartTests.Factory>
{
    public const int FloorMilliseconds = 2500;
    public static readonly TimeSpan Floor = TimeSpan.FromMilliseconds(FloorMilliseconds);

    /// <summary>Moves the clock on while the account is looked up, as a cold database connection would.</summary>
    public sealed class SlowLookup
    {
        private readonly object _gate = new();
        private string? _armed;
        public void Arm(string normalizedEmail) { lock (_gate) _armed = normalizedEmail; }

        /// <summary>True once, for the armed address.</summary>
        public bool Springs(string normalizedEmail)
        {
            lock (_gate)
            {
                if (_armed != normalizedEmail) return false;
                _armed = null;
                return true;
            }
        }
    }

    public sealed class SlowLookupStore(AppDbContext context, SlowLookup slow, ManualTimeProvider clock, IdentityErrorDescriber? describer = null)
        : Microsoft.AspNetCore.Identity.EntityFrameworkCore.UserStore<AppUser, IdentityRole, AppDbContext>(context, describer)
    {
        public override Task<AppUser?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken = default)
        {
            if (slow.Springs(normalizedEmail)) clock.Advance(Floor);
            return base.FindByEmailAsync(normalizedEmail, cancellationToken);
        }
    }

    /// <summary>
    /// Sends instantly unless told to take <see cref="Takes"/> (on the test clock) first. Like a provider that gives up when
    /// cancelled, it then fails unless <see cref="AcceptsLate"/> says it accepted the email just as the deadline passed.
    /// </summary>
    public sealed class ClockSender(ManualTimeProvider clock) : IEmailSender
    {
        public System.Collections.Concurrent.ConcurrentQueue<EmailMessage> Accepted { get; } = new();
        public TimeSpan Takes { get; set; }
        public bool AcceptsLate { get; set; }

        public Task<EmailDeliveryStatus> SendAsync(EmailMessage message, CancellationToken ct = default)
        {
            if (Takes > TimeSpan.Zero) clock.Advance(Takes);
            if (ct.IsCancellationRequested && !AcceptsLate) throw new OperationCanceledException(ct);
            Accepted.Enqueue(message);
            return Task.FromResult(EmailDeliveryStatus.Sent);
        }
    }

    public sealed class Factory : EmailApiFactory
    {
        public ManualTimeProvider Clock { get; } = new();
        public SlowLookup Slow { get; } = new();
        public ClockSender Sender { get; }

        public Factory() => Sender = new ClockSender(Clock);

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", FloorMilliseconds.ToString());
            builder.UseSetting("PasswordReset:MinSendMilliseconds", "1000");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(Clock);
                services.AddSingleton(Clock);
                services.AddSingleton(Slow);
                services.RemoveAll<IUserStore<AppUser>>();
                services.AddScoped<IUserStore<AppUser>, SlowLookupStore>();
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(Sender);
            });
        }
    }

    private readonly Factory _f;
    public PasswordResetColdStartTests(Factory f) => _f = f;

    private Task<int> LinksAsync(string userId) => _f.WithDbAsync(db => db.PasswordResetTokens.CountAsync(t => t.UserId == userId));

    private int ResetEmails(string email) => _f.Sender.Accepted.Count(m => m.To == email && m.Subject == ResetSteps.ResetSubject);

    /// <summary>Asks for a link with the sender taking the whole floor, so the request needs no further time to pass.</summary>
    private async Task<HttpResponseMessage> AskAsync(string email, bool acceptsLate)
    {
        (_f.Sender.Takes, _f.Sender.AcceptsLate) = (Floor, acceptsLate);
        try { return await _f.RequestResetAsync(email); }
        finally { (_f.Sender.Takes, _f.Sender.AcceptsLate) = (TimeSpan.Zero, false); }
    }

    [Fact]
    public void TheSendTimeIsAtMostHalfTheFloor()
    {
        using var scope = _f.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<PasswordResetService>();
        Assert.Equal(TimeSpan.FromSeconds(1), service.MinimumSend);
        Assert.True(service.MinimumSend <= service.MinimumResponse / 2);
    }

    [Fact]
    public async Task WithNoTimeLeftToSend_NoLinkIsMade_SoAskingAgainWorksAtOnce()
    {
        var account = await _f.AccountAsync();
        _f.Slow.Arm(account.User.Email.ToUpperInvariant());

        var response = await _f.RequestResetAsync(account.User.Email);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(PasswordResetController.RequestedMessage, (await response.ReadAsync<PasswordResetRequestedResponse>()).Message);
        Assert.Equal(0, await LinksAsync(account.User.Id));
        Assert.Equal(0, ResetEmails(account.User.Email));
        Assert.Contains(_f.Logs, l => l.Contains("password reset link") && l.Contains("too little time was left"));
        Assert.DoesNotContain(_f.Logs, l => l.Contains(account.User.Email));

        // Seconds later, well inside the one-minute gap, the next request gets its link.
        Assert.Equal(HttpStatusCode.Accepted, (await AskAsync(account.User.Email, acceptsLate: true)).StatusCode);
        Assert.Equal(1, ResetEmails(account.User.Email));
        Assert.Equal(1, await LinksAsync(account.User.Id));
    }

    [Fact]
    public async Task AnEmailCutOffAtTheFloor_HasItsLinkWithdrawn_SoAskingAgainWorksAtOnce()
    {
        var account = await _f.AccountAsync();

        Assert.Equal(HttpStatusCode.Accepted, (await AskAsync(account.User.Email, acceptsLate: false)).StatusCode);
        Assert.Equal(0, ResetEmails(account.User.Email));
        Assert.Equal(0, await LinksAsync(account.User.Id));
        Assert.Contains(_f.Logs, l => l.Contains("password reset link") && l.Contains("cancelled before it was sent"));

        // A provider that accepts the email just as the deadline passes counts as sent: the link is kept and works.
        Assert.Equal(HttpStatusCode.Accepted, (await AskAsync(account.User.Email, acceptsLate: true)).StatusCode);
        var mail = Assert.Single(_f.Sender.Accepted, m => m.To == account.User.Email && m.Subject == ResetSteps.ResetSubject);
        var token = System.Text.RegularExpressions.Regex.Match(mail.TextBody, @"/reset-password#t=(mgr_[A-Za-z0-9_-]+)").Groups[1].Value;
        Assert.Equal(PasswordResetLinkState.Valid, (await _f.CheckAsync(token)).State);
        Assert.Equal(1, await LinksAsync(account.User.Id));
    }
}
