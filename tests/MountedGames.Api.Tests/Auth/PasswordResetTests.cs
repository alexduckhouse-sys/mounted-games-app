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
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Tokens;
using MountedGames.Api.Auth;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
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
}

/// <summary>
/// The reset flow, with the API's clock in the test's hands (<see cref="ManualTimeProvider"/>), so expiry and the per-account
/// cap are tested by moving time rather than by waiting. The minimum response time is off here; see
/// <see cref="PasswordResetTimingTests"/>.
/// </summary>
public class PasswordResetTests : IClassFixture<PasswordResetTests.Factory>
{
    public sealed class Factory : EmailApiFactory
    {
        public ManualTimeProvider Clock { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", "0");
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
    public async Task ANewLinkEndsTheEarlierOne()
    {
        var account = await _f.AccountAsync();
        var first = await _f.LinkAsync(account.User.Email);
        _f.Clock.Advance(TimeSpan.FromMinutes(2));
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
    public async Task OtherInstancesCatchUpWithinAMinute_AndANewerTokenMakesThemReadAgain()
    {
        var account = await _f.AccountAsync();
        // A second instance has its own memory cache but the same database.
        var elsewhere = new LiveAccounts(_f.Services.GetRequiredService<IServiceScopeFactory>(), new MemoryCache(new MemoryCacheOptions()));
        Assert.True(await elsewhere.AcceptsTokenAsync(account.User.Id, 0));
        Assert.True(await elsewhere.IsActiveAsync(account.User.Id));

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);

        // Until its entry expires, the other instance still remembers version 0...
        Assert.True(await elsewhere.AcceptsTokenAsync(account.User.Id, 0));
        // ...but a token made after the reset sends it back to the database, which also ends the old ones there.
        Assert.True(await elsewhere.AcceptsTokenAsync(account.User.Id, 1));
        Assert.False(await elsewhere.AcceptsTokenAsync(account.User.Id, 0));
        Assert.False(await elsewhere.AcceptsTokenAsync("no-such-account", 0));
    }

    [Fact]
    public async Task AResetClearsAWrongPasswordLockoutAndConfirmsTheAddress()
    {
        var account = await _f.AccountAsync();
        for (var i = 0; i < 5; i++) await _f.SignInAsync(account.User.Email, "Wr0ng-password!");
        var before = await _f.UserAsync(account.User.Email);
        Assert.False(before.EmailConfirmed);
        Assert.True(before.LockoutEnd > DateTimeOffset.UtcNow);
        Assert.Equal(HttpStatusCode.Unauthorized, await _f.SignInAsync(account.User.Email, ResetSteps.Password));

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);

        var after = await _f.UserAsync(account.User.Email);
        Assert.True(after.EmailConfirmed);
        Assert.Null(after.LockoutEnd);
        Assert.Equal(0, after.AccessFailedCount);
        Assert.NotEqual(before.SecurityStamp, after.SecurityStamp);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(account.User.Email, ResetSteps.NewPassword));
    }

    [Fact]
    public async Task EveryoneIsToldTheirPasswordChanged_AndAdminsAreToldToGetTheAccountLocked()
    {
        var member = await _f.AccountAsync();
        var adminEmail = ResetSteps.NewEmail();
        var admin = await _f.CreateClient().PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Show Secretary", adminEmail, ResetSteps.Password));
        Assert.Equal(HttpStatusCode.OK, admin.StatusCode);
        Assert.Contains(Roles.Admin, (await admin.ReadAsync<AuthResponse>()).User.Roles);

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
        Assert.Contains("This is a site admin account", adminNotice.Text);
        Assert.Contains("This is a site admin account", adminNotice.Html);
        Assert.Equal(HttpStatusCode.OK, await _f.SignInAsync(adminEmail, ResetSteps.NewPassword));
    }

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
    public const int FloorMilliseconds = 400;

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
        Assert.Single(_f.Mail(account.User.Email, ResetSteps.ResetSubject));
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
