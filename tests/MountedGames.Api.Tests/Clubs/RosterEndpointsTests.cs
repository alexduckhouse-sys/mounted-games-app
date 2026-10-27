using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Clubs;

public class RosterEndpointsTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static string Roster(bool clubRoute, int clubId) => clubRoute ? $"/api/clubs/{clubId}/saved-riders" : "/api/roster";
    private static string Rider(bool clubRoute, int clubId, int riderId) => $"{Roster(clubRoute, clubId)}/{riderId}";

    private async Task<(HttpClient Client, string UserId, int ClubId)> MemberAsync()
    {
        var (client, auth) = await f.SignupAsync("Member", $"Roster test club {Guid.NewGuid():N}");
        var clubId = await f.WithDbAsync(db => db.Users.Where(u => u.Id == auth.User.Id).Select(u => u.ClubId).SingleAsync());
        Assert.NotNull(clubId);
        return (client, auth.User.Id, clubId.Value);
    }

    private static async Task<SavedRiderDto> SaveAsync(HttpClient client, string url, SaveToRosterRequest request)
    {
        var response = await client.PostAsJsonAsync(url, request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<SavedRiderDto>();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Create_NormalisesDetails_AndRepeatedSaveKeepsOneRiderAndOmittedPrivacy(bool clubRoute)
    {
        var member = await MemberAsync();
        var url = Roster(clubRoute, member.ClubId);
        // The unscoped route can infer the signed-in member's club.
        var first = await SaveAsync(member.Client, url, new(null, "  Example Rider  ",
            new DateTime(2012, 1, 1), "  Test Pony  ", 13.2m, "  TEST-PASSPORT  ", "  Example Owner  ", true, true));
        Assert.Equal(member.ClubId, first.ClubId);
        Assert.Equal("Example Rider", first.FullName);
        Assert.Equal("Test Pony", first.HorseName);
        Assert.Equal("TEST-PASSPORT", first.PonyPassportNumber);
        Assert.Equal("Example Owner", first.PonyOwnerFullName);
        Assert.True(first.UseInitialOnly);
        Assert.True(first.NoFilming);

        var repeated = await SaveAsync(member.Client, url, new(member.ClubId, " example rider ", HorseName: " test pony "));
        Assert.Equal(first.Id, repeated.Id);
        Assert.Equal(first.DateOfBirth, repeated.DateOfBirth);
        Assert.Equal(first.PonyHeightHands, repeated.PonyHeightHands);
        Assert.Equal(first.PonyPassportNumber, repeated.PonyPassportNumber);
        Assert.Equal(first.PonyOwnerFullName, repeated.PonyOwnerFullName);
        Assert.True(repeated.UseInitialOnly);
        Assert.True(repeated.NoFilming);
        Assert.Equal(1, await f.WithDbAsync(db => db.SavedRiders.CountAsync(r => r.ClubId == member.ClubId)));
        Assert.Equal(member.UserId, await f.WithDbAsync(db => db.SavedRiders.Where(r => r.Id == first.Id).Select(r => r.CreatedByUserId).SingleAsync()));

        var changed = await SaveAsync(member.Client, url, new(member.ClubId, "Example Rider", new DateTime(2011, 2, 2),
            "Test Pony", 14.1m, "REPLACEMENT-TEST-PASSPORT", "Another Example Owner", false, false));
        Assert.Equal(first.Id, changed.Id);
        Assert.Equal(new DateTime(2011, 2, 2), changed.DateOfBirth);
        Assert.Equal(14.1m, changed.PonyHeightHands);
        Assert.Equal("REPLACEMENT-TEST-PASSPORT", changed.PonyPassportNumber);
        Assert.Equal("Another Example Owner", changed.PonyOwnerFullName);
        Assert.False(changed.UseInitialOnly);
        Assert.False(changed.NoFilming);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Update_PreservesOmittedDetails_ClearsExplicitBlanks_AndHonoursPrivacyChanges(bool clubRoute)
    {
        var member = await MemberAsync();
        var saved = await SaveAsync(member.Client, Roster(clubRoute, member.ClubId), new(member.ClubId, "Example Rider",
            new DateTime(2012, 1, 1), "Test Pony", 13.2m, "TEST-PASSPORT", "Example Owner", true, true));
        var url = Rider(clubRoute, member.ClubId, saved.Id);
        var response = await member.Client.PutAsJsonAsync(url, new UpdateSavedRiderRequest(null, "  Other Test Pony  "));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var preserved = await response.ReadAsync<SavedRiderDto>();
        Assert.Equal(saved.FullName, preserved.FullName);
        Assert.Equal("Other Test Pony", preserved.HorseName);
        Assert.Equal(saved.DateOfBirth, preserved.DateOfBirth);
        Assert.Equal(saved.PonyHeightHands, preserved.PonyHeightHands);
        Assert.Equal(saved.PonyPassportNumber, preserved.PonyPassportNumber);
        Assert.Equal(saved.PonyOwnerFullName, preserved.PonyOwnerFullName);
        Assert.True(preserved.UseInitialOnly);
        Assert.True(preserved.NoFilming);

        response = await member.Client.PutAsJsonAsync(url, new UpdateSavedRiderRequest("  Changed Example  ", " ",
            new DateTime(2011, 2, 2), 14.1m, " ", " ", false, false));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var changed = await response.ReadAsync<SavedRiderDto>();
        Assert.Equal("Changed Example", changed.FullName);
        Assert.Null(changed.HorseName);
        Assert.Null(changed.PonyPassportNumber);
        Assert.Null(changed.PonyOwnerFullName);
        Assert.Equal(new DateTime(2011, 2, 2), changed.DateOfBirth);
        Assert.Equal(14.1m, changed.PonyHeightHands);
        Assert.False(changed.UseInitialOnly);
        Assert.False(changed.NoFilming);
        Assert.Equal(changed.FullName, await f.WithDbAsync(db => db.SavedRiders.Where(r => r.Id == saved.Id).Select(r => r.FullName).SingleAsync()));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InitialOnlyNames_CannotHaveTheirPrivacyFlagClearedByCreateUpsertOrUpdate(bool clubRoute)
    {
        var member = await MemberAsync();
        var url = Roster(clubRoute, member.ClubId);
        var saved = await SaveAsync(member.Client, url, new(member.ClubId, "Example R.", UseInitialOnly: false));
        Assert.True(saved.UseInitialOnly);
        var repeated = await SaveAsync(member.Client, url, new(member.ClubId, "Example R.", UseInitialOnly: false));
        Assert.Equal(saved.Id, repeated.Id);
        Assert.True(repeated.UseInitialOnly);
        var response = await member.Client.PutAsJsonAsync(Rider(clubRoute, member.ClubId, saved.Id),
            new UpdateSavedRiderRequest("Other E.", UseInitialOnly: false, NoFilming: true));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.ReadAsync<SavedRiderDto>();
        Assert.True(updated.UseInitialOnly);
        Assert.True(updated.NoFilming);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Writes_RequireSignIn_AndRejectAnotherClubsMemberWithoutChangingTheRoster(bool clubRoute)
    {
        var owner = await MemberAsync();
        var stranger = await MemberAsync();
        var saved = await SaveAsync(owner.Client, Roster(clubRoute, owner.ClubId), new(owner.ClubId, "Example Protected", NoFilming: true));
        var collection = Roster(clubRoute, owner.ClubId);
        var item = Rider(clubRoute, owner.ClubId, saved.Id);
        foreach (var (client, status) in new[] { (f.CreateClient(), HttpStatusCode.Unauthorized), (stranger.Client, HttpStatusCode.Forbidden) })
        {
            Assert.Equal(status, (await client.PostAsJsonAsync(collection, new SaveToRosterRequest(owner.ClubId, "Unwanted Example"))).StatusCode);
            Assert.Equal(status, (await client.PutAsJsonAsync(item, new UpdateSavedRiderRequest("Unwanted Change", NoFilming: false))).StatusCode);
            Assert.Equal(status, (await client.DeleteAsync(item)).StatusCode);
        }
        var kept = await f.WithDbAsync(db => db.SavedRiders.SingleAsync(r => r.Id == saved.Id));
        Assert.Equal("Example Protected", kept.FullName);
        Assert.True(kept.NoFilming);
        Assert.Equal(1, await f.WithDbAsync(db => db.SavedRiders.CountAsync(r => r.ClubId == owner.ClubId)));
    }

    [Fact]
    public async Task ClubRoute_IsAuthoritative_AndCannotUpdateOrDeleteARiderFromAnotherClubEvenAsAdmin()
    {
        var member = await MemberAsync();
        var otherClub = await f.SeedClubAsync();
        var saved = await SaveAsync(member.Client, Roster(true, member.ClubId), new(otherClub, "Example Route Rider"));
        Assert.Equal(member.ClubId, saved.ClubId);
        // A permitted club in the body must not bypass the club in the URL.
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PostAsJsonAsync(Roster(true, otherClub),
            new SaveToRosterRequest(member.ClubId, "Unwanted Example"))).StatusCode);
        var admin = await f.AdminAsync();
        var wrongUrl = Rider(true, otherClub, saved.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync(wrongUrl, new UpdateSavedRiderRequest("Unwanted Change"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync(wrongUrl)).StatusCode);
        Assert.Equal("Example Route Rider", await f.WithDbAsync(db => db.SavedRiders.Where(r => r.Id == saved.Id).Select(r => r.FullName).SingleAsync()));
        Assert.False(await f.WithDbAsync(db => db.SavedRiders.AnyAsync(r => r.ClubId == otherClub)));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Delete_UnlinksEveryDeclaration_ButPreservesLockedFormsSnapshotsAndOtherRosterLinks(bool clubRoute)
    {
        var member = await MemberAsync();
        var saved = await SaveAsync(member.Client, Roster(clubRoute, member.ClubId), new(member.ClubId, "Example Historical", NoFilming: true));
        var retained = await SaveAsync(member.Client, Roster(clubRoute, member.ClubId), new(member.ClubId, "Example Retained"));
        var arena = await f.CreateArenaAsync(2);
        var snapshots = await f.WithDbAsync(async db =>
        {
            var forms = arena.TeamIds.Select(teamId => new DeclarationForm
            {
                TeamId = teamId, IsLocked = true, SubmittedByUserId = member.UserId,
                Riders = new List<RiderEntry>
                {
                    new() { SavedRiderId = saved.Id, FullName = "Example Historical", HorseName = "Historical Test Pony", UseInitialOnly = true, NoFilming = true, PonyPassportNumber = "HISTORICAL-TEST-PASSPORT" },
                    new() { SavedRiderId = retained.Id, FullName = "Example Retained", OrderIndex = 1 },
                },
            }).ToList();
            db.DeclarationForms.AddRange(forms);
            await db.SaveChangesAsync();
            return forms.SelectMany(form => form.Riders).Select(r => new { r.Id, r.DeclarationFormId, r.SavedRiderId, r.FullName, r.HorseName, r.UseInitialOnly, r.NoFilming, r.PonyPassportNumber }).ToList();
        });

        // Administrators can manage a club they do not belong to as well.
        var admin = await f.AdminAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync(Rider(clubRoute, member.ClubId, saved.Id))).StatusCode);
        Assert.False(await f.WithDbAsync(db => db.SavedRiders.AnyAsync(r => r.Id == saved.Id)));
        Assert.True(await f.WithDbAsync(db => db.SavedRiders.AnyAsync(r => r.Id == retained.Id)));
        foreach (var before in snapshots)
        {
            var after = await f.WithDbAsync(db => db.RiderEntries.Include(r => r.DeclarationForm).SingleAsync(r => r.Id == before.Id));
            Assert.Equal(before.SavedRiderId == saved.Id ? null : before.SavedRiderId, after.SavedRiderId);
            Assert.Equal(before.DeclarationFormId, after.DeclarationFormId);
            Assert.NotNull(after.DeclarationForm);
            Assert.True(after.DeclarationForm.IsLocked);
            Assert.Equal(before.FullName, after.FullName);
            Assert.Equal(before.HorseName, after.HorseName);
            Assert.Equal(before.UseInitialOnly, after.UseInitialOnly);
            Assert.Equal(before.NoFilming, after.NoFilming);
            Assert.Equal(before.PonyPassportNumber, after.PonyPassportNumber);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync(Rider(clubRoute, member.ClubId, saved.Id))).StatusCode);
    }

    [Fact]
    public async Task InvalidRequests_ReturnBadRequestWithoutOverwritingASavedRider()
    {
        var member = await MemberAsync();
        var saved = await SaveAsync(member.Client, "/api/roster", new(member.ClubId, "Example Kept"));
        Assert.Equal(HttpStatusCode.BadRequest, (await member.Client.PostAsJsonAsync("/api/roster", new SaveToRosterRequest(member.ClubId, " "))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await member.Client.PostAsJsonAsync("/api/roster", new SaveToRosterRequest(0, "Example Invalid"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await member.Client.PutAsJsonAsync($"/api/roster/{saved.Id}", new UpdateSavedRiderRequest(" "))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PutAsJsonAsync("/api/roster/2147483647", new UpdateSavedRiderRequest("Example Missing"))).StatusCode);
        Assert.Equal("Example Kept", await f.WithDbAsync(db => db.SavedRiders.Where(r => r.Id == saved.Id).Select(r => r.FullName).SingleAsync()));
        await f.WithDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == member.UserId);
            user.ClubId = null;
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.BadRequest, (await member.Client.PostAsJsonAsync("/api/roster", new SaveToRosterRequest(null, "Example No Club"))).StatusCode);
    }
}
