using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services.Operations;
using MountedGames.Api.Services.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Privacy;

public class PrivacySecurityHandoffTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private sealed record Seed(Arena Arena, int FormId, int RiderId, int SavedId, int ClubId);

    private async Task<Seed> SeedAsync(bool locked = true, string? submitter = null)
    {
        var arena = await factory.CreateArenaAsync(1);
        return await factory.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0]);
            var saved = new SavedRider { ClubId = team.ClubId, FullName = "Fake Privatesurname", UseInitialOnly = true, CreatedByUserId = submitter };
            var rider = new RiderEntry
            {
                FullName = "Fake Privatesurname", SavedRider = saved, HorseName = "Fake Pony", DateOfBirth = new DateTime(2015, 3, 2),
                MedicalNotes = "FAKE_PRIVATE_MEDICAL", EmergencyContactPhone = "07700900001",
            };
            var form = new DeclarationForm { TeamId = team.Id, IsLocked = locked, SubmittedByUserId = submitter, TrainerPhone = "07700900002", Riders = [rider] };
            db.Add(form);
            await db.SaveChangesAsync();
            return new Seed(arena, form.Id, rider.Id, saved.Id, team.ClubId);
        });
    }

    [Fact]
    public async Task UnrelatedTrainerCannotReadOrOverwriteAnUnlockedDeclaration()
    {
        var seed = await SeedAsync(locked: false);
        var (stranger, _) = await factory.ApprovedTrainerAsync();
        var route = $"/api/declaration-forms/{seed.FormId}";
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync(route)).StatusCode);
        var listed = await (await stranger.GetAsync($"/api/declaration-forms?teamId={seed.Arena.TeamIds[0]}")).ReadAsync<List<DeclarationFormDto>>();
        Assert.Empty(listed);
        var replacement = new SubmitDeclarationFormRequest(seed.Arena.TeamIds[0], null,
            [new(null, "Fake Replacement", null, null, null, false, false, 0)], false, null, AcceptTerms: true);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.PostAsJsonAsync("/api/declaration-forms", replacement)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.DeleteAsync(route)).StatusCode);
        Assert.Equal("FAKE_PRIVATE_MEDICAL", await factory.WithDbAsync(db => db.RiderEntries.Where(r => r.Id == seed.RiderId).Select(r => r.MedicalNotes).SingleAsync()));
    }

    [Fact]
    public async Task RosterPrivacyAppliesToBothPublicDeclarationReads_WhileStaffCanEditFullDetails()
    {
        var seed = await SeedAsync();
        var visitor = factory.CreateClient();
        var byId = await (await visitor.GetAsync($"/api/declaration-forms/{seed.FormId}")).ReadAsync<DeclarationFormDto>();
        var listed = Assert.Single(await (await visitor.GetAsync($"/api/declaration-forms?teamId={seed.Arena.TeamIds[0]}")).ReadAsync<List<DeclarationFormDto>>());
        foreach (var form in new[] { byId, listed })
        {
            var rider = Assert.Single(form.Riders);
            Assert.Equal("Fake P.", rider.FullName);
            Assert.True(rider.UseInitialOnly);
            Assert.Null(rider.DateOfBirth);
            Assert.Null(rider.MedicalNotes);
            Assert.Null(rider.EmergencyContactPhone);
            Assert.Null(form.TrainerPhone);
        }
        var admin = await factory.AdminAsync();
        var staff = await (await admin.GetAsync($"/api/declaration-forms/{seed.FormId}")).ReadAsync<DeclarationFormDto>();
        Assert.Equal("Fake Privatesurname", staff.Riders[0].FullName);
        Assert.Equal("FAKE_PRIVATE_MEDICAL", staff.Riders[0].MedicalNotes);
    }

    [Fact]
    public async Task PrintedEntriesAndTackListsUseCurrentRosterPrivacy()
    {
        var seed = await SeedAsync();
        var admin = await factory.AdminAsync();
        foreach (var path in new[] { "print/entries", "print/tack-check", "tack-check" })
        {
            var response = await admin.GetAsync($"/api/event-tools/competitions/{seed.Arena.CompetitionId}/{path}");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            Assert.Contains("Fake P.", json);
            Assert.DoesNotContain("Privatesurname", json);
            Assert.DoesNotContain("FAKE_PRIVATE_MEDICAL", json);
        }
    }

    [Fact]
    public async Task CommentatorBriefingHidesDraftRiders_ThenHonoursCurrentRosterPrivacy()
    {
        var seed = await SeedAsync(locked: false);
        var heat = await factory.AddHeatAsync(seed.Arena.SessionId, seed.Arena.TeamIds);
        var draft = await factory.WithDbAsync(db => new CommentatorBriefingService(db).GetAsync(seed.Arena.CompetitionId, seed.Arena.SessionId, heat.HeatId));
        Assert.Empty(Assert.Single(draft.Lanes).RidersAndPonies);
        await factory.WithDbAsync(async db => { (await db.DeclarationForms.FindAsync(seed.FormId))!.IsLocked = true; await db.SaveChangesAsync(); return true; });
        var locked = await factory.WithDbAsync(db => new CommentatorBriefingService(db).GetAsync(seed.Arena.CompetitionId, seed.Arena.SessionId, heat.HeatId));
        Assert.Equal("Fake P. on Fake Pony", Assert.Single(Assert.Single(locked.Lanes).RidersAndPonies));
    }

    [Fact]
    public async Task AccountDeletionClearsSubmittedAndAssignedTrainerPhones_AndKeepsRosterPrivacy()
    {
        var (client, auth) = await factory.SignupAsync();
        var submitted = await SeedAsync(submitter: auth.User.Id);
        var assigned = await SeedAsync();
        var unrelated = await SeedAsync();
        await factory.WithDbAsync(async db => { (await db.Teams.FindAsync(assigned.Arena.TeamIds[0]))!.TrainerUserId = auth.User.Id; await db.SaveChangesAsync(); return true; });
        var response = await client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me") { Content = JsonContent.Create(new { password = "Passw0rd!x" }) });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await factory.WithDbAsync(async db =>
        {
            foreach (var id in new[] { submitted.FormId, assigned.FormId }) Assert.Null((await db.DeclarationForms.FindAsync(id))!.TrainerPhone);
            Assert.Equal("07700900002", (await db.DeclarationForms.FindAsync(unrelated.FormId))!.TrainerPhone);
            var rider = await db.RiderEntries.FindAsync(submitted.RiderId);
            Assert.Null(rider!.SavedRiderId);
            Assert.True(rider.UseInitialOnly);
            return true;
        });
    }

    [Theory]
    [InlineData(SectionFormat.Teams)]
    [InlineData(SectionFormat.Pairs)]
    public async Task LinkedTeamProfilesKeepTheirTeamNames(SectionFormat format)
    {
        var seed = await SeedAsync();
        var ownerId = await factory.TrainerIdAsync();
        var profileId = await factory.WithDbAsync(async db =>
        {
            var team = await db.Teams.Include(t => t.Section).SingleAsync(t => t.Id == seed.Arena.TeamIds[0]);
            team.Section!.Format = format;
            var profile = new TeamProfile { ClubId = seed.ClubId, OwnerUserId = ownerId, DisplayName = "Fake Club A" };
            db.Add(new EventTeamProfileLink { TeamId = team.Id, CompetitionId = team.CompetitionId, TeamProfile = profile, LinkedByUserId = ownerId });
            await db.SaveChangesAsync();
            return profile.Id;
        });
        var protectedProfiles = await factory.WithDbAsync(db => SeasonRiderPrivacy.InitialOnlyProfilesAsync(db, [profileId], CancellationToken.None));
        Assert.Equal("Fake Club A", SeasonRiderPrivacy.Display(profileId, "Fake Club A", protectedProfiles));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task LinkedIndividualProfileUsesRosterPrivacyBeforePublication(bool locked)
    {
        var seed = await SeedAsync(locked);
        var ownerId = await factory.TrainerIdAsync();
        var profileId = await factory.WithDbAsync(async db =>
        {
            var team = await db.Teams.Include(t => t.Section).SingleAsync(t => t.Id == seed.Arena.TeamIds[0]);
            team.Section!.Format = SectionFormat.Individual;
            var profile = new TeamProfile { ClubId = seed.ClubId, OwnerUserId = ownerId, DisplayName = "Fake Privatesurname" };
            db.Add(new EventTeamProfileLink { TeamId = team.Id, CompetitionId = team.CompetitionId, TeamProfile = profile, LinkedByUserId = ownerId });
            await db.SaveChangesAsync();
            return profile.Id;
        });
        var protectedProfiles = await factory.WithDbAsync(db => SeasonRiderPrivacy.InitialOnlyProfilesAsync(db, [profileId], CancellationToken.None));
        Assert.Equal("Fake P.", SeasonRiderPrivacy.Display(profileId, "Fake Privatesurname", protectedProfiles));
        var visitor = factory.CreateClient();
        foreach (var route in new[] { $"/api/share/team-profiles/{profileId}", $"/api/team-profiles/{profileId}/history" })
        {
            var response = await visitor.GetAsync(route);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            Assert.Contains("Fake P.", json);
            Assert.DoesNotContain("Privatesurname", json);
        }
    }
}
