using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Controllers;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Accounts;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// Master admin locking, blocking by account (with the networks the account used), and the records behind them.
/// The demo admin the tests sign in as through the admin key is the seeded master admin.
/// </summary>
public class AdminAccountsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public AdminAccountsTests(ApiFactory f) => _f = f;

    private const string Password = "Passw0rd!x";

    private sealed record Person(HttpClient Client, string Id, string Email);

    private async Task<Person> NewMemberAsync()
    {
        var (client, auth) = await _f.SignupAsync("Member");
        return new Person(client, auth.User.Id, auth.User.Email);
    }

    private async Task<Person> NewOrganiserAsync()
    {
        var (client, auth) = await _f.ApprovedTrainerAsync();
        return new Person(client, auth.User.Id, auth.User.Email);
    }

    /// <summary>An Admin who is not a master admin, made by the master admin and signed in.</summary>
    private async Task<Person> NewPlainAdminAsync()
    {
        var master = await _f.AdminAsync();
        var email = $"plain-{Guid.NewGuid():N}@example.org";
        var created = await master.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, Password, "Plain Admin", Roles.Admin, null));
        created.EnsureSuccessStatusCode();
        var auth = await _f.LoginAsync(email, Password);
        return new Person(_f.WithToken(auth.Token), auth.User.Id, email);
    }

    private async Task MakeMasterAsync(string userId)
    {
        using var scope = _f.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        await users.AddToRoleAsync((await users.FindByIdAsync(userId))!, Roles.MasterAdmin);
    }

    private Task<HttpResponseMessage> LoginFromAsync(string email, string ip, string password = Password)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login") { Content = JsonContent.Create(new LoginRequest(email, password)) };
        request.Headers.Add("X-Test-Ip", ip);
        return _f.CreateClient().SendAsync(request);
    }

    private static string Lock(string id) => $"/api/admin/users/{id}/account-lock";
    private static string Block(string id) => $"/api/admin/users/{id}/block";

    private static async Task<string> TextOf(HttpResponseMessage r) => await r.Content.ReadAsStringAsync();

    // ---- master admin ----

    [Fact]
    public async Task TheDemoAdminIsTheMasterAdmin_AndAdminsMadeThroughTheApiAreNot()
    {
        var master = await _f.AdminLoginAsync();
        Assert.Contains(Roles.MasterAdmin, master.User.Roles);
        Assert.Contains(Roles.Admin, master.User.Roles);

        var plain = await NewPlainAdminAsync();
        var me = await (await plain.Client.GetAsync("/api/auth/me")).ReadAsync<UserProfile>();
        Assert.Contains(Roles.Admin, me.Roles);
        Assert.DoesNotContain(Roles.MasterAdmin, me.Roles);
    }

    [Fact]
    public async Task NoOneCanBeMadeAMasterAdminThroughTheApi()
    {
        var master = await _f.AdminAsync();
        var email = $"sneaky-{Guid.NewGuid():N}@example.org";
        (await master.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, Password, "Sneaky", Roles.MasterAdmin, null))).EnsureSuccessStatusCode();
        Assert.DoesNotContain(Roles.MasterAdmin, (await _f.LoginAsync(email, Password)).User.Roles);

        var plain = await NewPlainAdminAsync();
        var target = await NewMemberAsync();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await plain.Client.PostAsJsonAsync($"/api/admin/users/{target.Id}/roles", new ToggleUserRoleRequest(Roles.MasterAdmin, true))).StatusCode);
        // Nor can a plain admin strip the Admin role from the master admin.
        var masterId = (await _f.AdminLoginAsync()).User.Id;
        Assert.Equal(HttpStatusCode.Forbidden,
            (await plain.Client.PostAsJsonAsync($"/api/admin/users/{masterId}/roles", new ToggleUserRoleRequest(Roles.Admin, false))).StatusCode);
    }

    // ---- lock ----

    [Fact]
    public async Task Lock_IsForTheMasterAdminOnly()
    {
        var organiser = await NewOrganiserAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsync(Lock(organiser.Id), null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await NewMemberAsync()).Client.PostAsync(Lock(organiser.Id), null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await NewOrganiserAsync()).Client.PostAsync(Lock(organiser.Id), null)).StatusCode);
        var plain = await NewPlainAdminAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await plain.Client.PostAsync(Lock(organiser.Id), null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await plain.Client.DeleteAsync(Lock(organiser.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await plain.Client.GetAsync("/api/admin/staff-accounts")).StatusCode);
        // Nothing happened.
        (await LoginFromAsync(organiser.Email, "203.0.113.10")).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ALockedOrganiserCannotSignIn_ExistingTokensStop_AndOnlyTheMasterAdminCanUndoIt()
    {
        var organiser = await NewOrganiserAsync();
        var master = await _f.AdminAsync();
        (await organiser.Client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NoContent, (await master.PostAsync(Lock(organiser.Id), null)).StatusCode);
        // Locking twice changes nothing.
        Assert.Equal(HttpStatusCode.NoContent, (await master.PostAsync(Lock(organiser.Id), null)).StatusCode);

        var login = await LoginFromAsync(organiser.Email, "203.0.113.11");
        Assert.Equal(HttpStatusCode.Forbidden, login.StatusCode);
        Assert.Contains("account_stopped", await TextOf(login));
        // Wrong password still looks like any wrong password: the lock isn't revealed to someone who doesn't know it.
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginFromAsync(organiser.Email, "203.0.113.11", "Wrong-pass1!")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await organiser.Client.GetAsync("/api/auth/me")).StatusCode);

        // The Identity "unlock" that clears too many wrong passwords does not undo an admin lock.
        var plain = await NewPlainAdminAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await plain.Client.PostAsync($"/api/admin/users/{organiser.Id}/unlock", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await LoginFromAsync(organiser.Email, "203.0.113.11")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await master.DeleteAsync(Lock(organiser.Id))).StatusCode);
        (await LoginFromAsync(organiser.Email, "203.0.113.11")).EnsureSuccessStatusCode();
        // The token issued before the lock works again as well, since the account is whole again.
        (await organiser.Client.GetAsync("/api/auth/me")).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task AnAdminCanBeLocked_AndTheAdminKeyDoesNotLetThemBackIn()
    {
        var master = await _f.AdminAsync();
        var email = $"keyed-{Guid.NewGuid():N}@example.org";
        var keyed = await _f.CreateClient().PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Keyed", email, Password));
        keyed.EnsureSuccessStatusCode();
        var id = (await keyed.ReadAsync<AuthResponse>()).User.Id;

        Assert.Equal(HttpStatusCode.NoContent, (await master.PostAsync(Lock(id), null)).StatusCode);

        var again = await _f.CreateClient().PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey, "Keyed", email, Password));
        Assert.Equal(HttpStatusCode.Forbidden, again.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await LoginFromAsync(email, "203.0.113.12")).StatusCode);
    }

    [Fact]
    public async Task Lock_RefusesMasterAdminsTheSharedAccountYourselfAndPeopleWhoAreNeitherAdminNorOrganiser()
    {
        var master = await _f.AdminAsync();
        var sharedId = (await _f.AdminLoginAsync()).User.Id;
        Assert.Equal(HttpStatusCode.Conflict, (await master.PostAsync(Lock(sharedId), null)).StatusCode); // yourself, and the shared account

        var second = await NewPlainAdminAsync();
        await MakeMasterAsync(second.Id);
        var secondClient = _f.WithToken((await _f.LoginAsync(second.Email, Password)).Token);
        Assert.Equal(HttpStatusCode.Conflict, (await secondClient.PostAsync(Lock(second.Id), null)).StatusCode); // yourself
        Assert.Equal(HttpStatusCode.Conflict, (await secondClient.PostAsync(Lock(sharedId), null)).StatusCode); // another master admin and the shared account
        Assert.Equal(HttpStatusCode.Conflict, (await master.PostAsync(Lock(second.Id), null)).StatusCode);

        var member = await NewMemberAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await master.PostAsync(Lock(member.Id), null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await master.PostAsync(Lock("no-such-user"), null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await master.DeleteAsync(Lock("no-such-user"))).StatusCode);
    }

    [Fact]
    public async Task StaffAccounts_ListsAdminsAndOrganisersWithTheirLockState()
    {
        var master = await _f.AdminAsync();
        var organiser = await NewOrganiserAsync();
        var member = await NewMemberAsync();
        await master.PostAsync(Lock(organiser.Id), null);

        var rows = await (await master.GetAsync($"/api/admin/staff-accounts?q={organiser.Email}")).ReadAsync<List<StaffAccountDto>>();
        var row = Assert.Single(rows);
        Assert.Equal(organiser.Id, row.Id);
        Assert.NotNull(row.LockedAt);

        var all = await (await master.GetAsync("/api/admin/staff-accounts")).ReadAsync<List<StaffAccountDto>>();
        Assert.DoesNotContain(all, r => r.Id == member.Id);
        Assert.Contains(all, r => r.Roles.Contains(Roles.Admin));
    }

    // ---- block ----

    [Fact]
    public async Task Block_IsForAdminsOnly()
    {
        var target = await NewMemberAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(Block(target.Id), new BlockAccountRequest("x"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await NewMemberAsync()).Client.PostAsJsonAsync(Block(target.Id), new BlockAccountRequest("x"))).StatusCode);
        var organiser = await NewOrganiserAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await organiser.Client.PostAsJsonAsync(Block(target.Id), new BlockAccountRequest("x"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await organiser.Client.DeleteAsync(Block(target.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await organiser.Client.GetAsync("/api/admin/blocked-users")).StatusCode);
        (await LoginFromAsync(target.Email, "203.0.113.20")).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ABlockedAccountCannotSignIn_EnterOrChat_UntilItIsUnblocked()
    {
        var plain = await NewPlainAdminAsync();
        var target = await NewMemberAsync();
        var section = await _f.NewSectionAsync();
        var chat = $"/api/competitions/{section.CompetitionId}/chat";
        var enter = $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups";
        (await target.Client.PostAsJsonAsync(chat, new PostChatMessageRequest("hello"))).EnsureSuccessStatusCode();

        var blocked = await plain.Client.PostAsJsonAsync(Block(target.Id), new BlockAccountRequest("  Abusive in chat  "));
        Assert.Equal(HttpStatusCode.OK, blocked.StatusCode);

        var login = await LoginFromAsync(target.Email, "203.0.113.21");
        Assert.Equal(HttpStatusCode.Forbidden, login.StatusCode);
        var loginBody = await TextOf(login);
        Assert.Contains("account_stopped", loginBody);
        Assert.DoesNotContain("Abusive", loginBody);
        Assert.Equal(HttpStatusCode.Unauthorized, (await target.Client.PostAsJsonAsync(chat, new PostChatMessageRequest("again"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await target.Client.PostAsJsonAsync(enter,
            new CreateSectionSignupRequest("Blocked entrant", null, null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion))).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await plain.Client.DeleteAsync(Block(target.Id))).StatusCode);
        (await LoginFromAsync(target.Email, "203.0.113.21")).EnsureSuccessStatusCode();
        (await target.Client.PostAsJsonAsync(chat, new PostChatMessageRequest("back again"))).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task TheReasonIsForAdminsOnly()
    {
        var plain = await NewPlainAdminAsync();
        var target = await NewMemberAsync();
        await plain.Client.PostAsJsonAsync(Block(target.Id), new BlockAccountRequest("  Sent threats to a steward  "));

        var list = await (await plain.Client.GetAsync("/api/admin/blocked-users")).ReadAsync<List<BlockedAccountDto>>();
        var row = list.Single(b => b.Id == target.Id);
        Assert.Equal("Sent threats to a steward", row.Reason);
        Assert.Equal("Plain Admin", row.BlockedByName);

        // Nowhere else: the user list flags it without the reason, and the blocked person's own answers carry none.
        var users = await TextOf(await plain.Client.GetAsync($"/api/admin/users?q={target.Email}"));
        Assert.Contains("\"isBlocked\":true", users);
        Assert.DoesNotContain("threats", users);
        Assert.DoesNotContain("threats", await TextOf(await LoginFromAsync(target.Email, "203.0.113.22")));
    }

    [Fact]
    public async Task Block_RefusesYourselfMasterAdminsTheSharedAccountAndAdminsUnlessYouAreMaster()
    {
        var plain = await NewPlainAdminAsync();
        var master = await _f.AdminAsync();
        var masterId = (await _f.AdminLoginAsync()).User.Id;
        Assert.Equal(HttpStatusCode.Conflict, (await plain.Client.PostAsJsonAsync(Block(plain.Id), new BlockAccountRequest(null))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await plain.Client.PostAsJsonAsync(Block(masterId), new BlockAccountRequest(null))).StatusCode);

        var otherAdmin = await NewPlainAdminAsync();
        var refused = await plain.Client.PostAsJsonAsync(Block(otherAdmin.Id), new BlockAccountRequest(null));
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await master.PostAsJsonAsync(Block(otherAdmin.Id), new BlockAccountRequest("Left the club"))).StatusCode);
        // A plain admin can't lift a block on an admin either.
        Assert.Equal(HttpStatusCode.Forbidden, (await plain.Client.DeleteAsync(Block(otherAdmin.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await master.DeleteAsync(Block(otherAdmin.Id))).StatusCode);

        var second = await NewPlainAdminAsync();
        await MakeMasterAsync(second.Id);
        var secondClient = _f.WithToken((await _f.LoginAsync(second.Email, Password)).Token);
        Assert.Equal(HttpStatusCode.Conflict, (await secondClient.PostAsJsonAsync(Block(masterId), new BlockAccountRequest(null))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await master.PostAsJsonAsync(Block(second.Id), new BlockAccountRequest(null))).StatusCode);

        var member = await NewMemberAsync();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await plain.Client.PostAsJsonAsync(Block(member.Id), new BlockAccountRequest(new string('x', AccountAccessService.MaxReasonLength + 1)))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await plain.Client.PostAsJsonAsync(Block("no-such-user"), new BlockAccountRequest(null))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await plain.Client.DeleteAsync(Block("no-such-user"))).StatusCode);
        // Blocking without a body at all is a block with no reason.
        Assert.Equal(HttpStatusCode.OK, (await plain.Client.PostAsync(Block(member.Id), null)).StatusCode);
    }

    // ---- networks ----

    private async Task<List<string>> HashesOfAsync(string userId)
        => await _f.WithDbAsync(db => db.AccountIps.Where(a => a.UserId == userId).Select(a => a.IpHash).ToListAsync());

    [Fact]
    public async Task SignInRecordsTheNetworkAsAHashOnly_AndKeepsTheLatestTwenty()
    {
        var member = await NewMemberAsync();
        await LoginFromAsync(member.Email, "198.51.100.5");
        await LoginFromAsync(member.Email, "198.51.100.5");
        await LoginFromAsync(member.Email, "198.51.100.6");

        var rows = await _f.WithDbAsync(db => db.AccountIps.Where(a => a.UserId == member.Id).ToListAsync());
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.StartsWith(IpRetention.HashPrefix, r.IpHash));
        Assert.DoesNotContain(rows, r => r.IpHash.Contains("198.51.100"));

        for (var i = 0; i < AccountIp.MaxPerAccount + 5; i++) await LoginFromAsync(member.Email, $"192.0.2.{i + 1}");
        Assert.Equal(AccountIp.MaxPerAccount, (await HashesOfAsync(member.Id)).Count);
    }

    [Fact]
    public async Task RecordingANetworkNeverFailsASignIn()
    {
        using var scope = _f.Services.CreateScope();
        var recorder = scope.ServiceProvider.GetRequiredService<AccountIpRecorder>();
        // Nothing to record, then an account that doesn't exist (the foreign key refuses it): both are shrugged off.
        await recorder.RecordAsync("someone", null);
        await recorder.RecordAsync("", "203.0.113.1");
        await recorder.RecordAsync("no-such-account", "203.0.113.1");
        Assert.Empty(await HashesOfAsync("no-such-account"));
    }

    [Fact]
    public async Task SigningUpRecordsTheNetworkToo()
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/signup-trainer")
        {
            Content = JsonContent.Create(new SignupTrainerRequest($"net{Guid.NewGuid():N}"[..14], Password, "Member", "Test Pony Club")),
        };
        request.Headers.Add("X-Test-Ip", "198.51.100.77");
        var auth = await (await _f.CreateClient().SendAsync(request)).ReadAsync<AuthResponse>();
        Assert.Single(await HashesOfAsync(auth.User.Id));
    }

    [Fact]
    public async Task BlockingAnAccountBlocksItsNetworks_WithoutShowingThemInTheIpList()
    {
        var plain = await NewPlainAdminAsync();
        var target = await NewMemberAsync();
        await LoginFromAsync(target.Email, "203.0.113.31");
        await LoginFromAsync(target.Email, "203.0.113.32");
        var innocent = await NewMemberAsync();
        var section = await _f.NewSectionAsync();
        var chat = $"/api/competitions/{section.CompetitionId}/chat";
        HttpRequestMessage ChatFrom(string ip)
        {
            var r = new HttpRequestMessage(HttpMethod.Post, chat) { Content = JsonContent.Create(new PostChatMessageRequest("hi")) };
            r.Headers.Add("X-Test-Ip", ip);
            r.Headers.Authorization = innocent.Client.DefaultRequestHeaders.Authorization;
            return r;
        }
        Assert.Equal(HttpStatusCode.OK, (await _f.CreateClient().SendAsync(ChatFrom("203.0.113.31"))).StatusCode);

        var result = await (await plain.Client.PostAsJsonAsync(Block(target.Id), new BlockAccountRequest("Spam"))).ReadAsync<BlockResultDto>();

        Assert.Equal(2, result.NetworksBlocked);
        Assert.Equal(HttpStatusCode.Forbidden, (await _f.CreateClient().SendAsync(ChatFrom("203.0.113.31"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await _f.CreateClient().SendAsync(ChatFrom("203.0.113.32"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _f.CreateClient().SendAsync(ChatFrom("203.0.113.99"))).StatusCode);
        // Behind the scenes: no raw address is stored, and the admin's IP list doesn't show them.
        var blocks = await _f.WithDbAsync(db => db.IpBlocks.Where(b => b.BlockedAccountUserId == target.Id).ToListAsync());
        Assert.Equal(2, blocks.Count);
        Assert.All(blocks, b => Assert.StartsWith(IpRetention.HashPrefix, b.IpAddress));
        var listed = await TextOf(await plain.Client.GetAsync("/api/ip-blocks"));
        Assert.DoesNotContain(blocks[0].IpAddress, listed);
        Assert.Equal(HttpStatusCode.NotFound, (await plain.Client.DeleteAsync($"/api/ip-blocks/{blocks[0].Id}")).StatusCode);

        await plain.Client.DeleteAsync(Block(target.Id));

        Assert.Equal(HttpStatusCode.OK, (await _f.CreateClient().SendAsync(ChatFrom("203.0.113.31"))).StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.IpBlocks.Where(b => b.BlockedAccountUserId == target.Id).ToListAsync()));
    }

    [Fact]
    public async Task BlockingAlsoCoversAddressesFromRecentChatAndMarketplacePosts()
    {
        var plain = await NewPlainAdminAsync();
        var target = await NewMemberAsync();
        await _f.InDbAsync(async db =>
        {
            var competitionId = await db.Competitions.Select(c => c.Id).FirstAsync();
            db.ChatMessages.Add(new ChatMessage { CompetitionId = competitionId, UserId = target.Id, AuthorName = "x", Body = "hi", IpAddress = "203.0.113.41" });
            db.ShopPosts.Add(new ShopPost { Title = "t", Body = "b", AuthorName = "x", AuthorUserId = target.Id, IpAddress = "203.0.113.42" });
            db.ShopPosts.Add(new ShopPost { Title = "t", Body = "b", AuthorName = "x", AuthorUserId = target.Id, IpAddress = IpRetention.HashFor(Config(), "203.0.113.43") });
            await db.SaveChangesAsync();
        });

        var result = await (await plain.Client.PostAsJsonAsync(Block(target.Id), new BlockAccountRequest(null))).ReadAsync<BlockResultDto>();

        Assert.Equal(3, result.NetworksBlocked);
        var hashes = await _f.WithDbAsync(db => db.IpBlocks.Where(b => b.BlockedAccountUserId == target.Id).Select(b => b.IpAddress).ToListAsync());
        Assert.Contains(IpRetention.HashFor(Config(), "203.0.113.41"), hashes);
        Assert.Contains(IpRetention.HashFor(Config(), "203.0.113.43"), hashes);
    }

    private IConfiguration Config() => _f.Services.GetRequiredService<IConfiguration>();

    [Fact]
    public async Task ASharedNetworkIsNotBlocked()
    {
        var plain = await NewPlainAdminAsync();
        var target = await NewMemberAsync();
        await LoginFromAsync(target.Email, "203.0.113.51");
        await LoginFromAsync(target.Email, "203.0.113.52");
        // Five other accounts have used .51 (a venue's wifi, say): blocking it would shut them all out.
        var others = new List<Person>();
        for (var i = 0; i < AccountAccessService.SharedNetworkAccounts; i++) others.Add(await NewMemberAsync());
        foreach (var other in others) await LoginFromAsync(other.Email, "203.0.113.51");

        var result = await (await plain.Client.PostAsJsonAsync(Block(target.Id), new BlockAccountRequest(null))).ReadAsync<BlockResultDto>();

        Assert.Equal(1, result.NetworksBlocked);
        var blocked = await _f.WithDbAsync(db => db.IpBlocks.Where(b => b.BlockedAccountUserId == target.Id).Select(b => b.IpAddress).ToListAsync());
        Assert.Equal(IpRetention.HashFor(Config(), "203.0.113.52"), Assert.Single(blocked));
    }

    [Fact]
    public async Task AnAddressAnAdminAlreadyBlockedIsLeftAlone_AndANetworkSharedByTwoBlockedAccountsOutlivesTheFirstUnblock()
    {
        var plain = await NewPlainAdminAsync();
        var first = await NewMemberAsync();
        var second = await NewMemberAsync();
        await LoginFromAsync(first.Email, "203.0.113.61");
        await LoginFromAsync(second.Email, "203.0.113.61");
        await LoginFromAsync(second.Email, "203.0.113.62");
        // An admin's own block on .62, which blocking the account must not take over or lift.
        await _f.InDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock { IpAddress = "203.0.113.62", Reason = "by hand" });
            await db.SaveChangesAsync();
        });

        await plain.Client.PostAsJsonAsync(Block(first.Id), new BlockAccountRequest(null));
        await plain.Client.PostAsJsonAsync(Block(second.Id), new BlockAccountRequest(null));
        var shared = IpRetention.HashFor(Config(), "203.0.113.61");
        Assert.Equal(first.Id, (await _f.WithDbAsync(db => db.IpBlocks.SingleAsync(b => b.IpAddress == shared))).BlockedAccountUserId);

        await plain.Client.DeleteAsync(Block(first.Id));
        Assert.Equal(second.Id, (await _f.WithDbAsync(db => db.IpBlocks.SingleAsync(b => b.IpAddress == shared))).BlockedAccountUserId);

        await plain.Client.DeleteAsync(Block(second.Id));
        Assert.False(await _f.WithDbAsync(db => db.IpBlocks.AnyAsync(b => b.IpAddress == shared)));
        Assert.True(await _f.WithDbAsync(db => db.IpBlocks.AnyAsync(b => b.IpAddress == "203.0.113.62" && b.BlockedAccountUserId == null)));
    }

    [Fact]
    public async Task TheAdminUserListFlagsLockedAndBlockedAccounts()
    {
        var master = await _f.AdminAsync();
        var organiser = await NewOrganiserAsync();
        var member = await NewMemberAsync();
        await master.PostAsync(Lock(organiser.Id), null);
        await master.PostAsJsonAsync(Block(member.Id), new BlockAccountRequest(null));

        var locked = (await (await master.GetAsync($"/api/admin/users?q={organiser.Email}")).ReadAsync<List<AdminUserDto>>()).Single();
        var blocked = (await (await master.GetAsync($"/api/admin/users?q={member.Email}")).ReadAsync<List<AdminUserDto>>()).Single();
        Assert.Equal((true, false), (locked.IsLocked, locked.IsBlocked));
        Assert.Equal((false, true), (blocked.IsLocked, blocked.IsBlocked));
    }

    // ---- housekeeping ----

    [Fact]
    public async Task DeletingAnAccountRemovesItsNetworks()
    {
        var member = await NewMemberAsync();
        await LoginFromAsync(member.Email, "198.51.100.88");
        Assert.NotEmpty(await HashesOfAsync(member.Id));

        var deleted = await member.Client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me")
            { Content = JsonContent.Create(new DeleteAccountRequest(Password)) });

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Empty(await HashesOfAsync(member.Id));
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsTheAccountAccessTables_WithoutLosingUsers()
    {
        var member = await NewMemberAsync();
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync(@"DROP TABLE AccountIps; DROP TABLE AccountInvites; DROP INDEX IX_IpBlocks_BlockedAccountUserId;
            ALTER TABLE IpBlocks DROP COLUMN BlockedAccountUserId; ALTER TABLE AspNetUsers DROP COLUMN LockedAt; ALTER TABLE AspNetUsers DROP COLUMN LockedByUserId;
            ALTER TABLE AspNetUsers DROP COLUMN BlockedAt; ALTER TABLE AspNetUsers DROP COLUMN BlockedByUserId; ALTER TABLE AspNetUsers DROP COLUMN BlockReason;");

        await DbInitializer.SeedAsync(_f.Services);

        db.ChangeTracker.Clear();
        var kept = await db.Users.AsNoTracking().SingleAsync(u => u.Id == member.Id);
        Assert.Null(kept.LockedAt);
        Assert.Null(kept.BlockedAt);
        db.AccountIps.Add(new AccountIp { UserId = member.Id, IpHash = "h1:abc" });
        db.AccountInvites.Add(new AccountInvite { Email = "later@example.org", TokenHash = Guid.NewGuid().ToString("N"), ExpiresAt = DateTime.UtcNow.AddDays(1) });
        db.IpBlocks.Add(new IpBlock { IpAddress = "h1:abc", BlockedAccountUserId = member.Id });
        await db.SaveChangesAsync();
        // The seeded master admin is still a master admin after the upgrade.
        Assert.Contains(Roles.MasterAdmin, (await _f.AdminLoginAsync()).User.Roles);
    }
}
