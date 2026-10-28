using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>Fixes from the 28 Oct audit: session versions on lock/block, IP-block ordering, orphan accounts, locked approvals, shop images, safe deletes.</summary>
public class AuditAuthAdminFixesTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static HttpClient WithIp(HttpClient c, string ip)
    {
        c.DefaultRequestHeaders.Remove(TestIpStartupFilter.Header);
        c.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, ip);
        return c;
    }

    private Task BlockIpAsync(string ip) => f.WithDbAsync(async db =>
    {
        db.IpBlocks.Add(new IpBlock { IpAddress = ip, Reason = "test" });
        await db.SaveChangesAsync();
    });

    [Fact]
    public async Task LockAndBlock_EachRaiseSessionVersion_SoOldTokensStayDead()
    {
        var admin = await f.AdminAsync();
        var (_, organiser) = await f.ApprovedTrainerAsync();
        var id = organiser.User.Id;
        var oldClient = f.WithToken(organiser.Token);
        Assert.Equal(HttpStatusCode.OK, (await oldClient.GetAsync("/api/auth/me")).StatusCode);
        var v0 = await f.WithDbAsync(db => db.Users.Where(u => u.Id == id).Select(u => u.SessionVersion).SingleAsync());

        (await admin.PostAsync($"/api/admin/users/{id}/account-lock", null)).EnsureSuccessStatusCode();
        (await admin.DeleteAsync($"/api/admin/users/{id}/account-lock")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await oldClient.GetAsync("/api/auth/me")).StatusCode);
        var v1 = await f.WithDbAsync(db => db.Users.Where(u => u.Id == id).Select(u => u.SessionVersion).SingleAsync());
        Assert.Equal(v0 + 1, v1);

        (await admin.PostAsJsonAsync($"/api/admin/users/{id}/block", new BlockAccountRequest("test"))).EnsureSuccessStatusCode();
        (await admin.DeleteAsync($"/api/admin/users/{id}/block")).EnsureSuccessStatusCode();
        var v2 = await f.WithDbAsync(db => db.Users.Where(u => u.Id == id).Select(u => u.SessionVersion).SingleAsync());
        Assert.Equal(v1 + 1, v2);
    }

    [Fact]
    public async Task AdminKey_ChecksIpBlockBeforeTheKey()
    {
        await BlockIpAsync("10.77.0.1");
        var wrong = await WithIp(f.CreateClient(), "10.77.0.1").PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest("not-the-key"));
        Assert.Equal(HttpStatusCode.Forbidden, wrong.StatusCode);
        var right = await WithIp(f.CreateClient(), "10.77.0.1").PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey));
        Assert.Equal(HttpStatusCode.Forbidden, right.StatusCode);
        var other = await WithIp(f.CreateClient(), "10.77.0.2").PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest("not-the-key"));
        Assert.Equal(HttpStatusCode.Unauthorized, other.StatusCode);
    }

    [Fact]
    public async Task Register_AdminRoleByNonMaster_IsRefusedWithoutCreatingAnAccount()
    {
        // The test admin is a master admin, so make an ordinary admin first.
        var firstEmail = $"plain-admin-{Guid.NewGuid():N}@example.org";
        var master = await f.AdminAsync();
        var made = await master.PostAsJsonAsync("/api/auth/register", new RegisterRequest(firstEmail, "Passw0rd!x", "Plain Admin", Roles.Admin, null));
        made.EnsureSuccessStatusCode();
        var admin = f.WithToken((await f.LoginAsync(firstEmail, "Passw0rd!x")).Token);
        var email = $"orphan-{Guid.NewGuid():N}@example.org";

        var r = await admin.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, "Passw0rd!x", "Orphan Test", Roles.Admin, null));

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.False(await f.WithDbAsync(db => db.Users.AnyAsync(u => u.Email == email)));
    }

    [Fact]
    public async Task ApprovingALockedOrBlockedRequester_IsRefused()
    {
        var admin = await f.AdminAsync();
        foreach (var stop in new Action<AppUser>[] { u => u.LockedAt = DateTime.UtcNow, u => u.BlockedAt = DateTime.UtcNow })
        {
            var (_, pending) = await f.SignupAsync();
            await f.ConfirmAddressAsync(pending.User.Id);
            await f.WithDbAsync(async db =>
            {
                var u = await db.Users.SingleAsync(x => x.Id == pending.User.Id);
                stop(u);
                await db.SaveChangesAsync();
            });

            var r = await admin.PostAsync($"/api/admin/trainer-requests/{pending.User.Id}/approve", null);

            Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
            Assert.Contains("locked or blocked", await r.Content.ReadAsStringAsync());
        }
    }

    [Fact]
    public async Task ShopReport_FromABlockedNetwork_IsRefused()
    {
        await BlockIpAsync("10.77.0.3");
        var r = await WithIp(f.CreateClient(), "10.77.0.3").PostAsJsonAsync("/api/shop/posts/1/report", new CreateShopReportRequest("spam"));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Theory]
    [InlineData("https://tracker.example/pixel.gif")]
    [InlineData("data:image/svg+xml;base64,PHN2Zy8+")]
    [InlineData("javascript:alert(1)")]
    public async Task ShopPost_RejectsImagesThatAreNotInlinePictures(string image)
    {
        var (me, _) = await f.SignupAsync();
        var r = await me.PostAsJsonAsync("/api/shop/posts", new { title = "Saddle", body = "Good", authorName = "Me", imageBase64 = image });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task ShopPost_AcceptsJpegDataUrl_AndUpdateRejectsExternalImage()
    {
        var (me, _) = await f.SignupAsync();
        var ok = await me.PostAsJsonAsync("/api/shop/posts", new { title = "Saddle", body = "Good", authorName = "Me", imageBase64 = "data:image/jpeg;base64,/9j/4AAQ" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var post = await ok.ReadAsync<ShopPostDto>();

        var bad = await me.PutAsJsonAsync($"/api/shop/posts/{post.Id}", new { imageBase64 = "https://tracker.example/p.gif" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task VolunteerClaimAndCheckIn_FromABlockedNetwork_AreRefused()
    {
        await BlockIpAsync("10.77.0.4");
        var (me, _) = await f.SignupAsync("Member");
        WithIp(me, "10.77.0.4");
        var claim = await me.PostAsJsonAsync("/api/competitions/1/volunteer-shifts/1/claim", new ClaimVolunteerShiftRequest("A Name", "A Club", null));
        var checkIn = await me.PostAsJsonAsync("/api/competitions/1/volunteer-shifts/1/check-in", new { });
        Assert.Equal(HttpStatusCode.Forbidden, claim.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, checkIn.StatusCode);
    }

    [Fact]
    public async Task DeleteCompetition_WithOrdersOrSeasonRounds_Returns409AndKeepsIt()
    {
        var admin = await f.AdminAsync();
        var (_, buyer) = await f.SignupAsync("Member");
        var withOrder = await f.SeedCompetitionAsync();
        await f.WithDbAsync(async db =>
        {
            db.Add(new EventOrder { CompetitionId = withOrder, BuyerUserId = buyer.User.Id, IdempotencyKey = Guid.NewGuid().ToString("N"), RequestHash = "h" });
            await db.SaveChangesAsync();
        });
        var r = await admin.DeleteAsync($"/api/competitions/{withOrder}");
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Contains("shop orders", await r.Content.ReadAsStringAsync());
        Assert.True(await f.WithDbAsync(db => db.Competitions.AnyAsync(c => c.Id == withOrder)));

        var withRound = await f.SeedCompetitionAsync();
        var section = await f.SeedSectionAsync(withRound);
        await f.WithDbAsync(async db =>
        {
            var season = new Season { OwnerUserId = buyer.User.Id, Title = "S", Year = 2031, AgeGroup = "Open" };
            db.Add(season);
            db.Add(new SeasonRound { SeasonId = season.Id, CompetitionId = withRound, CompetitionSectionId = section });
            await db.SaveChangesAsync();
        });
        var r2 = await admin.DeleteAsync($"/api/competitions/{withRound}");
        Assert.Equal(HttpStatusCode.Conflict, r2.StatusCode);
        Assert.Contains("season round", await r2.Content.ReadAsStringAsync());
        var r3 = await admin.DeleteAsync($"/api/competitions/{withRound}/sections/{section}?force=true");
        Assert.Equal(HttpStatusCode.Conflict, r3.StatusCode);
    }

    [Fact]
    public async Task DeleteSection_RemovesItsTeamsFromOtherSectionsCombinedHeats()
    {
        var admin = await f.AdminAsync();
        var comp = await f.SeedCompetitionAsync();
        var sectionA = await f.SeedSectionAsync(comp);
        var sectionB = await f.SeedSectionAsync(comp);
        var club = await f.SeedClubAsync();
        var team = await f.SeedTeamAsync(comp, sectionA, club);
        var heatId = await f.WithDbAsync(async db =>
        {
            var session = new Session { CompetitionId = comp, CompetitionSectionId = sectionB, Name = "Combined", OrderIndex = 1 };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = session.Id, Label = "Heat 1", OrderIndex = 1 };
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
            db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = team, LaneIndex = 1 });
            await db.SaveChangesAsync();
            return heat.Id;
        });

        var r = await admin.DeleteAsync($"/api/competitions/{comp}/sections/{sectionA}?force=true");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        await f.WithDbAsync(async db =>
        {
            Assert.False(await db.Teams.AnyAsync(t => t.Id == team));
            Assert.False(await db.HeatEntries.AnyAsync(he => he.TeamId == team));
            Assert.True(await db.Heats.AnyAsync(h => h.Id == heatId));
        });
    }
}
