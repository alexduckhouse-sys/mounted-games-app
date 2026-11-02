using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

public class SecurityHandoffPermissionsTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private async Task<(HttpClient Client, AuthResponse Auth, int Competition)> CollaboratorAsync()
    {
        var (client, auth) = await f.SignupAsync("Member");
        var competition = await f.SeedCompetitionAsync(ownerUserId: await f.TrainerIdAsync());
        await f.InDbAsync(async db =>
        {
            db.CompetitionCollaborators.Add(new CompetitionCollaborator
            { CompetitionId = competition, UserId = auth.User.Id, AddedByUserId = await f.TrainerIdAsync() });
            await db.SaveChangesAsync();
        });
        return (client, auth, competition);
    }

    [Theory]
    [InlineData("http://maps.apple.com/?ll=51,0")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://fake:credentials@maps.apple.com/")]
    [InlineData("/relative-map")]
    public async Task UnsafeMapLinksAreRefusedOnCreateAndUpdate(string url)
    {
        using var admin = await f.AdminAsync();
        var competition = await f.SeedCompetitionAsync();
        var create = new CreateCompetitionRequest("Fake event", null, null, 51, 0, null, url, DateTime.UtcNow, null);
        var update = new UpdateCompetitionRequest("Fake event", null, null, 51, 0, null, url, DateTime.UtcNow, null, true, false);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/competitions", create)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/competitions/{competition}", update)).StatusCode);
        Assert.Null(await f.WithDbAsync(db => db.Competitions.Where(c => c.Id == competition).Select(c => c.AppleMapsUrl).SingleAsync()));
    }

    [Fact]
    public async Task MapLinkLengthIsBoundedAndValidHttpsLinksAreAccepted()
    {
        using var admin = await f.AdminAsync();
        var prefix = "https://maps.apple.com/?q=";
        var create = new CreateCompetitionRequest("Fake map event", null, null, 51, 0, null,
            prefix + new string('x', 501 - prefix.Length), DateTime.UtcNow, null);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/competitions", create)).StatusCode);
        var accepted = await admin.PostAsJsonAsync("/api/competitions", create with { AppleMapsUrl = prefix + new string('x', 500 - prefix.Length) });
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
    }

    [Fact]
    public async Task OversizedBareUsernameIsRefusedBeforeAccountCreation()
    {
        var username = new string('x', 101);
        var response = await f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(username, "Passw0rd!x", "Member", "Fake Club"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("100", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task BlockedNetworksCannotReachExternalTokenValidation()
    {
        await f.InDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock { IpAddress = "198.51.100.121", Reason = "Fake test block" });
            await db.SaveChangesAsync();
        });
        using var client = f.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Ip", "198.51.100.121");
        var response = await client.PostAsJsonAsync("/api/auth/external", new { provider = "google", idToken = "fake", nonce = "fake" });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SharedAdminSignInRecordsItsNetworkAsAHash()
    {
        using var client = f.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Ip", "198.51.100.122");
        var response = await client.PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey));
        response.EnsureSuccessStatusCode();
        var auth = await response.ReadAsync<AuthResponse>();
        var hashes = await f.WithDbAsync(db => db.AccountIps.Where(a => a.UserId == auth.User.Id).Select(a => a.IpHash).ToListAsync());
        Assert.NotEmpty(hashes);
        Assert.All(hashes, hash => Assert.StartsWith(IpRetention.HashPrefix, hash));
        Assert.DoesNotContain("198.51.100.122", hashes);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task RestrictedAccountsRemainInStaffListAndCannotBeChangedByClubManagers(bool locked)
    {
        var clubName = $"Fake club {Guid.NewGuid():N}";
        var (manager, _) = await f.ApprovedManagerAsync(clubName);
        var (_, account) = await f.SignupAsync("Member", clubName);
        await f.InDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == account.User.Id);
            if (locked) user.LockedAt = DateTime.UtcNow; else user.BlockedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });
        var route = $"/api/clubs/{account.User.ClubId}/members/{account.User.Id}";
        Assert.Equal(HttpStatusCode.Conflict, (await manager.PutAsJsonAsync(route + "/role", new ChangeMemberRoleRequest(Roles.Trainer))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await manager.DeleteAsync(route)).StatusCode);
        using var admin = await f.AdminAsync();
        var rows = await (await admin.GetAsync("/api/admin/staff-accounts?q=" + Uri.EscapeDataString(account.User.FullName))).ReadAsync<List<StaffAccountDto>>();
        Assert.Contains(rows, r => r.Id == account.User.Id);
        Assert.Equal(account.User.ClubId, await f.WithDbAsync(db => db.Users.Where(u => u.Id == account.User.Id).Select(u => u.ClubId).SingleAsync()));
    }

    [Fact]
    public async Task CollaboratorsManageSupporterCodesButOnlyTheOwnerDeletesASection()
    {
        var (staff, _, competition) = await CollaboratorAsync();
        var team = await f.SeedTeamAsync(competition, await f.SeedSectionAsync(competition), await f.SeedClubAsync());
        var other = await f.SeedCompetitionAsync();
        var otherSection = await f.SeedSectionAsync(other);
        var otherTeam = await f.SeedTeamAsync(other, otherSection, await f.SeedClubAsync());
        Assert.Equal(HttpStatusCode.OK, (await staff.PostAsync($"/api/teams/{team}/supporter-key", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync($"/api/teams/{team}/supporters")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await staff.DeleteAsync($"/api/teams/{team}/supporter-key")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsync($"/api/teams/{otherTeam}/supporter-key", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staff.DeleteAsync($"/api/competitions/{other}/sections/{otherSection}")).StatusCode);
        // Deleting a section is owner/admin only: a collaborator is refused, the owning trainer is not.
        var emptySection = await f.SeedSectionAsync(competition);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.DeleteAsync($"/api/competitions/{competition}/sections/{emptySection}")).StatusCode);
        var owner = await f.TrainerAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/competitions/{competition}/sections/{emptySection}")).StatusCode);
    }

    [Fact]
    public async Task PublicVolunteerNamesUseInitialsAndRepeatCheckInPreservesAttribution()
    {
        var (staff, _, competition) = await CollaboratorAsync();
        var (volunteer, auth) = await f.SignupAsync("Member");
        var (outsider, _) = await f.SignupAsync("Member");
        var shift = await f.WithDbAsync(async db =>
        {
            var row = new VolunteerShift { CompetitionId = competition, Role = "Fake duty", Claims =
                [new VolunteerClaim { UserId = auth.User.Id, VolunteerName = "Example Volunteer", ContactPhone = "00000000000" }] };
            db.VolunteerShifts.Add(row); await db.SaveChangesAsync(); return row.Id;
        });
        var route = $"/api/competitions/{competition}/volunteer-shifts";
        foreach (var client in new[] { f.CreateClient(), outsider })
        {
            var list = await (await client.GetAsync(route)).ReadAsync<List<VolunteerShiftDto>>();
            Assert.Equal("Example V.", Assert.Single(Assert.Single(list).Claims).VolunteerName);
        }
        foreach (var client in new[] { volunteer, staff })
        {
            var list = await (await client.GetAsync(route)).ReadAsync<List<VolunteerShiftDto>>();
            Assert.Equal("Example Volunteer", Assert.Single(Assert.Single(list).Claims).VolunteerName);
        }
        var checkedIn = await volunteer.PostAsJsonAsync(route + $"/{shift}/check-in", new { checkedInByName = "Fake Volunteer" });
        checkedIn.EnsureSuccessStatusCode();
        var before = await f.WithDbAsync(db => db.VolunteerShifts.AsNoTracking().SingleAsync(s => s.Id == shift));
        (await f.CreateClient().PostAsync(route + $"/{shift}/check-in", null)).EnsureSuccessStatusCode();
        (await outsider.PostAsJsonAsync(route + $"/{shift}/check-in", new { checkedInByName = "Fake replacement" })).EnsureSuccessStatusCode();
        var after = await f.WithDbAsync(db => db.VolunteerShifts.AsNoTracking().SingleAsync(s => s.Id == shift));
        Assert.Equal((auth.User.Id, "Fake Volunteer", before.CheckedInAt), (after.CheckedInByUserId, after.CheckedInByName, after.CheckedInAt));
    }

    [Fact]
    public async Task UnrelatedSignedInCheckInDoesNotRecordAClaimedName()
    {
        var competition = await f.SeedCompetitionAsync();
        var shift = await f.WithDbAsync(async db =>
        {
            var row = new VolunteerShift { CompetitionId = competition, Role = "Fake duty" };
            db.VolunteerShifts.Add(row); await db.SaveChangesAsync(); return row.Id;
        });
        var (outsider, _) = await f.SignupAsync("Member");
        (await outsider.PostAsJsonAsync($"/api/competitions/{competition}/volunteer-shifts/{shift}/check-in",
            new { checkedInByName = "Someone else" })).EnsureSuccessStatusCode();
        var stored = await f.WithDbAsync(db => db.VolunteerShifts.SingleAsync(s => s.Id == shift));
        Assert.Equal("Here", stored.AttendanceStatus);
        Assert.Null(stored.CheckedInByName);
        Assert.Null(stored.CheckedInByUserId);
    }
}
