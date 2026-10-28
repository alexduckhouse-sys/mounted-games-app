using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Accounts;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>Inviting an organiser or site admin by email: create, list, resend, cancel and accept.</summary>
public class AccountInviteTests : IClassFixture<EmailApiFactory>
{
    private readonly EmailApiFactory _f;
    public AccountInviteTests(EmailApiFactory f) => _f = f;

    private const string Password = "Passw0rd!x";
    private static readonly Regex LinkPattern = new(@"/invite#t=(mgi_[A-Za-z0-9_-]+)", RegexOptions.Compiled);

    private static string NewEmail() => $"invitee-{Guid.NewGuid():N}@example.org";

    private async Task<(InviteDto Invite, string Token)> InviteAsync(InviteAccess access = InviteAccess.Organiser, string? email = null)
    {
        var address = email ?? NewEmail();
        var admin = await _f.AdminAsync();
        var response = await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest(address, access));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var invite = await response.ReadAsync<InviteDto>();
        return (invite, TokenFor(address));
    }

    /// <summary>The token exists only in the email: read it from the latest message to that address.</summary>
    private string TokenFor(string address)
    {
        var message = _f.Sent.Last(m => m.To == address.ToLowerInvariant());
        return LinkPattern.Match(message.Text).Groups[1].Value;
    }

    private Task<HttpResponseMessage> AcceptAsync(string token, string name = "New Person", string password = Password)
        => _f.CreateClient().PostAsJsonAsync("/api/auth/invites/accept", new AcceptInviteRequest(token, name, password));

    private Task<HttpResponseMessage> LookupAsync(string token)
        => _f.CreateClient().PostAsJsonAsync("/api/auth/invites/lookup", new InviteTokenRequest(token));

    // ---- who can ----

    [Fact]
    public async Task OnlyAdminsManageInvitations()
    {
        var (invite, _) = await InviteAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var (organiser, _) = await _f.ApprovedTrainerAsync();
        var anonymous = _f.CreateClient();
        foreach (var client in new[] { anonymous, member, organiser })
        {
            var expected = ReferenceEquals(client, anonymous) ? HttpStatusCode.Unauthorized : HttpStatusCode.Forbidden;
            Assert.Equal(expected, (await client.GetAsync("/api/admin/invites")).StatusCode);
            Assert.Equal(expected, (await client.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest(NewEmail(), InviteAccess.Organiser))).StatusCode);
            Assert.Equal(expected, (await client.PostAsync($"/api/admin/invites/{invite.Id}/resend", null)).StatusCode);
            Assert.Equal(expected, (await client.DeleteAsync($"/api/admin/invites/{invite.Id}")).StatusCode);
        }
    }

    // ---- create ----

    [Fact]
    public async Task CreatingSendsAnEmailWithOneLink_AndStoresOnlyTheHashOfTheToken()
    {
        var address = NewEmail().ToUpperInvariant();
        var admin = await _f.AdminAsync();

        var response = await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest($"  {address}  ", InviteAccess.SiteAdmin));
        var invite = await response.ReadAsync<InviteDto>();
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal((address.ToLowerInvariant(), InviteAccess.SiteAdmin, EmailDeliveryStatus.Sent, 1, false),
            (invite.Email, invite.Access, invite.EmailStatus, invite.SendCount, invite.IsExpired));
        Assert.True(invite.ExpiresAt > DateTime.UtcNow.AddDays(AccountInvite.Days - 1));
        var message = _f.Sent.Last(m => m.To == address.ToLowerInvariant());
        Assert.Equal("You're invited to Mounted Games", message.Subject);
        Assert.Contains($"{EmailApiFactory.SiteUrl}/invite#t=", message.Text);
        Assert.Contains("site admin", message.Text);
        var token = LinkPattern.Match(message.Text).Groups[1].Value;
        Assert.DoesNotContain(token, body);
        var stored = await _f.WithDbAsync(db => db.AccountInvites.SingleAsync(i => i.Id == invite.Id));
        Assert.Equal(InviteTokens.Hash(token), stored.TokenHash);
        Assert.NotEqual(token, stored.TokenHash);
        Assert.Equal(1, stored.SendCount);
    }

    [Fact]
    public async Task CreateRefusesBadAddressesUnknownAccessExistingAccountsAndDuplicates()
    {
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest("not-an-email", InviteAccess.Organiser))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest("", InviteAccess.Organiser))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest(NewEmail(), (InviteAccess)7))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest(TestClients.TrainerEmail, InviteAccess.Organiser))).StatusCode);

        var (invite, _) = await InviteAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest(invite.Email, InviteAccess.SiteAdmin))).StatusCode);

        // Once the first has expired, the address can be invited again.
        await _f.InDbAsync(async db =>
        {
            (await db.AccountInvites.SingleAsync(i => i.Id == invite.Id)).ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest(invite.Email, InviteAccess.SiteAdmin))).StatusCode);
    }

    // ---- accept ----

    [Fact]
    public async Task AnOrganiserInvitationMakesAnApprovedTrainerWhoIsSignedIn()
    {
        var (invite, token) = await InviteAsync(InviteAccess.Organiser);

        var preview = await (await LookupAsync(token)).ReadAsync<InvitePreviewDto>();
        Assert.Equal((invite.Email, InviteAccess.Organiser), (preview.Email, preview.Access));

        var response = await AcceptAsync(token, "  Olive Organiser  ");
        var auth = await response.ReadAsync<AuthResponse>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(("Olive Organiser", invite.Email, true), (auth.User.FullName, auth.User.Email, auth.User.EmailConfirmed));
        Assert.Equal([Roles.Trainer], auth.User.Roles);
        var client = _f.WithToken(auth.Token);
        (await client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
        // An organiser can create a competition at once, and signs in again with the new password.
        var created = await client.PostAsJsonAsync("/api/competitions", new CreateCompetitionRequest(
            "Invited organiser's event", null, null, null, null, null, null, DateTime.UtcNow.AddDays(30), null));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal([Roles.Trainer], (await _f.LoginAsync(invite.Email, Password)).User.Roles);
        var stored = await _f.WithDbAsync(db => db.AccountInvites.SingleAsync(i => i.Id == invite.Id));
        Assert.Equal(auth.User.Id, stored.AcceptedUserId);
        Assert.NotNull(stored.AcceptedAt);
        // The password came through a link sent to the address, so Google or Apple may later link by email (LinkByEmail).
        Assert.Equal(LinkByEmail.FromInvite, await _f.WithDbAsync(db => db.UserClaims
            .Where(c => c.UserId == auth.User.Id && c.ClaimType == LinkByEmail.PasswordFromMailbox).Select(c => c.ClaimValue).SingleAsync()));
    }

    [Fact]
    public async Task ASiteAdminInvitationMakesAnAdmin_ButNeverAMasterAdmin()
    {
        var (_, token) = await InviteAsync(InviteAccess.SiteAdmin);

        var auth = await (await AcceptAsync(token)).ReadAsync<AuthResponse>();

        Assert.Equal([Roles.Admin], auth.User.Roles);
        Assert.Equal(HttpStatusCode.OK, (await _f.WithToken(auth.Token).GetAsync("/api/admin/invites")).StatusCode);
    }

    [Fact]
    public async Task AcceptingRecordsTheNetworkAsAHash()
    {
        var (invite, token) = await InviteAsync();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/invites/accept")
            { Content = JsonContent.Create(new AcceptInviteRequest(token, "Net Person", Password)) };
        request.Headers.Add("X-Test-Ip", "198.51.100.150");
        var auth = await (await _f.CreateClient().SendAsync(request)).ReadAsync<AuthResponse>();

        var rows = await _f.WithDbAsync(db => db.AccountIps.Where(a => a.UserId == auth.User.Id).ToListAsync());
        Assert.StartsWith(IpRetention.HashPrefix, Assert.Single(rows).IpHash);
        Assert.NotNull(invite);
    }

    [Fact]
    public async Task AnInvitationWorksOnce_AndUnknownOrUsedTokensGiveSafeAnswers()
    {
        var (_, token) = await InviteAsync();
        (await AcceptAsync(token)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Gone, (await AcceptAsync(token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await LookupAsync(token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await AcceptAsync("mgi_" + new string('A', 43))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await AcceptAsync("not a token")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await LookupAsync("")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await LookupAsync("mgi_" + new string('B', 43))).StatusCode);
    }

    [Fact]
    public async Task ABadNameOrWeakPasswordLeavesTheInvitationOpenForAnotherTry()
    {
        var (invite, token) = await InviteAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await AcceptAsync(token, "   ")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await AcceptAsync(token, new string('n', 101))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await AcceptAsync(token, "Name", "")).StatusCode);
        var weak = await AcceptAsync(token, "Name", "short");
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.Contains("password", (await weak.Content.ReadAsStringAsync()).ToLowerInvariant());

        Assert.Equal(HttpStatusCode.OK, (await LookupAsync(token)).StatusCode);
        (await AcceptAsync(token)).EnsureSuccessStatusCode();
        Assert.Equal(1, await _f.WithDbAsync(db => db.Users.CountAsync(u => u.Email == invite.Email)));
    }

    [Fact]
    public async Task AnExpiredOrCancelledInvitationCannotBeAccepted_AndIfTheyAlreadyHaveAnAccountItIsRefused()
    {
        var (expired, expiredToken) = await InviteAsync();
        await _f.InDbAsync(async db =>
        {
            (await db.AccountInvites.SingleAsync(i => i.Id == expired.Id)).ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.NotFound, (await LookupAsync(expiredToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await AcceptAsync(expiredToken)).StatusCode);

        var (cancelled, cancelledToken) = await InviteAsync();
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/admin/invites/{cancelled.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await AcceptAsync(cancelledToken)).StatusCode);

        // The person signed up on their own while the invitation was waiting.
        var (_, takenToken) = await InviteAsync();
        var taken = await _f.WithDbAsync(db => db.AccountInvites.OrderByDescending(i => i.Id).FirstAsync());
        using (var scope = _f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            Assert.True((await users.CreateAsync(new AppUser { UserName = taken.Email, Email = taken.Email, FullName = "Already here" }, Password)).Succeeded);
        }
        Assert.Equal(HttpStatusCode.Conflict, (await AcceptAsync(takenToken)).StatusCode);
        Assert.Null((await _f.WithDbAsync(db => db.AccountInvites.SingleAsync(i => i.Id == taken.Id))).AcceptedAt);
    }

    // ---- list, resend, cancel ----

    [Fact]
    public async Task PendingListsOpenInvitations_IncludingExpiredOnes_ButNotAcceptedOrCancelled()
    {
        var admin = await _f.AdminAsync();
        var (open, _) = await InviteAsync();
        var (expired, _) = await InviteAsync();
        var (accepted, acceptedToken) = await InviteAsync();
        var (cancelled, _) = await InviteAsync();
        await _f.InDbAsync(async db =>
        {
            (await db.AccountInvites.SingleAsync(i => i.Id == expired.Id)).ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });
        (await AcceptAsync(acceptedToken)).EnsureSuccessStatusCode();
        await admin.DeleteAsync($"/api/admin/invites/{cancelled.Id}");

        var list = await (await admin.GetAsync("/api/admin/invites")).ReadAsync<List<InviteDto>>();

        Assert.Contains(list, i => i.Id == open.Id && !i.IsExpired);
        Assert.Contains(list, i => i.Id == expired.Id && i.IsExpired);
        Assert.DoesNotContain(list, i => i.Id == accepted.Id);
        Assert.DoesNotContain(list, i => i.Id == cancelled.Id);
        Assert.False(string.IsNullOrEmpty(list.First(i => i.Id == open.Id).InvitedByName));
    }

    [Fact]
    public async Task ResendingIssuesAFreshLink_AndTheOldOneStopsWorking()
    {
        var (invite, oldToken) = await InviteAsync();
        var admin = await _f.AdminAsync();

        // Too soon.
        Assert.Equal(HttpStatusCode.TooManyRequests, (await admin.PostAsync($"/api/admin/invites/{invite.Id}/resend", null)).StatusCode);
        await _f.InDbAsync(async db =>
        {
            var row = await db.AccountInvites.SingleAsync(i => i.Id == invite.Id);
            row.LastSentAt = DateTime.UtcNow.AddMinutes(-5);
            row.ExpiresAt = DateTime.UtcNow.AddHours(1);
            await db.SaveChangesAsync();
        });

        var resent = await admin.PostAsync($"/api/admin/invites/{invite.Id}/resend", null);
        var dto = await resent.ReadAsync<InviteDto>();

        Assert.Equal(HttpStatusCode.OK, resent.StatusCode);
        Assert.Equal(2, dto.SendCount);
        Assert.True(dto.ExpiresAt > DateTime.UtcNow.AddDays(AccountInvite.Days - 1));
        var newToken = TokenFor(invite.Email);
        Assert.NotEqual(oldToken, newToken);
        Assert.Equal(HttpStatusCode.NotFound, (await LookupAsync(oldToken)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await LookupAsync(newToken)).StatusCode);
    }

    [Fact]
    public async Task ResendIsLimited_AndRefusedOnceAcceptedOrCancelled()
    {
        var admin = await _f.AdminAsync();
        var (invite, _) = await InviteAsync();
        await _f.InDbAsync(async db =>
        {
            var row = await db.AccountInvites.SingleAsync(i => i.Id == invite.Id);
            row.SendCount = AccountInvite.MaxSends;
            row.LastSentAt = DateTime.UtcNow.AddHours(-1);
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.TooManyRequests, (await admin.PostAsync($"/api/admin/invites/{invite.Id}/resend", null)).StatusCode);

        var (done, token) = await InviteAsync();
        (await AcceptAsync(token)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/invites/{done.Id}/resend", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/api/admin/invites/{done.Id}")).StatusCode);

        var (gone, _) = await InviteAsync();
        await admin.DeleteAsync($"/api/admin/invites/{gone.Id}");
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/admin/invites/{gone.Id}")).StatusCode); // cancelling twice is harmless
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/invites/{gone.Id}/resend", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/admin/invites/999999/resend", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("/api/admin/invites/999999")).StatusCode);
    }

    // ---- email failures and privacy ----

    [Fact]
    public async Task AFailedSendStillCreatesTheInvitation_AndSaysSo()
    {
        var admin = await _f.AdminAsync();
        _f.Fail = () => new HttpResponseMessage(HttpStatusCode.InternalServerError);
        try
        {
            var response = await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest(NewEmail(), InviteAccess.Organiser));
            var invite = await response.ReadAsync<InviteDto>();
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            Assert.Equal(EmailDeliveryStatus.Failed, invite.EmailStatus);
        }
        finally { _f.Fail = null; }
    }

    [Fact]
    public async Task NeitherTheAddressNorTheLinkIsEverLogged()
    {
        var (invite, token) = await InviteAsync();
        (await AcceptAsync(token)).EnsureSuccessStatusCode();

        var logs = string.Join('\n', _f.Logs);
        Assert.DoesNotContain(token, logs);
        Assert.DoesNotContain(invite.Email, logs, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(token[4..], logs);
    }

    [Fact]
    public void TokensAreLongRandomAndOnlyHashedForStorage()
    {
        var a = InviteTokens.Generate();
        var b = InviteTokens.Generate();
        Assert.NotEqual(a, b);
        Assert.True(InviteTokens.LooksValid(a));
        Assert.Equal(64, InviteTokens.Hash(a).Length);
        Assert.False(InviteTokens.LooksValid(null));
        Assert.False(InviteTokens.LooksValid("mgi_"));
        Assert.False(InviteTokens.LooksValid("mgi_has space"));
        Assert.False(InviteTokens.LooksValid("xyz_" + new string('a', 43)));
        Assert.False(InviteTokens.LooksValid("mgi_" + new string('a', 80)));
    }
}

/// <summary>With sending switched off an invitation is still made, and the admin is told it wasn't sent.</summary>
public class AccountInviteEmailOffTests : IClassFixture<EmailOffApiFactory>
{
    private readonly EmailOffApiFactory _f;
    public AccountInviteEmailOffTests(EmailOffApiFactory f) => _f = f;

    [Fact]
    public async Task InvitationIsMadeButTheAdminIsToldNothingWasSent()
    {
        var admin = await _f.AdminAsync();
        var response = await admin.PostAsJsonAsync("/api/admin/invites", new CreateInviteRequest($"off-{Guid.NewGuid():N}@example.org", InviteAccess.Organiser));
        var invite = await response.ReadAsync<InviteDto>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(EmailDeliveryStatus.NotSent, invite.EmailStatus);
        Assert.Empty(_f.Sent);
    }
}
