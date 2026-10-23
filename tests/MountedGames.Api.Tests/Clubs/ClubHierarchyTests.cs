using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Clubs;

/// <summary>Everyone belongs to a club; a club's Team Manager runs its teams, trainers and riders.</summary>
public class ClubHierarchyTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ClubHierarchyTests(ApiFactory f) => _f = f;

    private const string Requests = "/api/admin/trainer-requests";
    private static string NewClubName() => $"Hierarchy Club {Guid.NewGuid():N}";

    private async Task<(int CompetitionId, int SectionId)> NewCompetitionAsync()
    {
        var comp = await _f.SeedCompetitionAsync();
        return (comp, await _f.SeedSectionAsync(comp));
    }

    private Task<int> ClubIdAsync(string name) => _f.WithDbAsync(db => db.Clubs.Where(c => c.Name == name).Select(c => c.Id).SingleAsync());

    // ---- signup ----

    [Fact]
    public async Task Signup_Returns400_WithoutAClubName()
    {
        var anon = _f.CreateClient();
        foreach (var blank in new string?[] { null, "", "   " })
        {
            var r = await anon.PostAsJsonAsync("/api/auth/signup-trainer",
                new SignupTrainerRequest($"user{Guid.NewGuid():N}"[..14], "Passw0rd!x", null, blank));
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        }
    }

    [Fact]
    public async Task Signup_CreatesTheClubWhenItIsNew_AndReusesItIgnoringCase()
    {
        var name = NewClubName();
        var (_, first) = await _f.SignupAsync("Member", name);
        var (_, second) = await _f.SignupAsync("Member", $"  {name.ToUpperInvariant()} ");

        Assert.Equal(name, first.User.ClubName);
        Assert.Equal(first.User.ClubId, second.User.ClubId);
        Assert.Equal(1, await _f.WithDbAsync(db => db.Clubs.CountAsync(c => c.Name.ToLower() == name.ToLower())));
    }

    [Fact]
    public async Task Signup_DoesNotLeaveAClubBehind_WhenTheAccountCannotBeCreated()
    {
        var name = NewClubName();

        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest($"user{Guid.NewGuid():N}"[..14], "weak", null, name));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.Clubs.AnyAsync(c => c.Name == name)));
    }

    [Fact]
    public async Task ManagerSignup_WaitsForAdminApproval_AsAMember()
    {
        var (client, auth) = await _f.SignupAsync("Manager");

        Assert.Equal(new[] { Roles.ManagerRequest, Roles.Member }, auth.User.Roles.Order());
        var pending = await (await (await _f.AdminAsync()).GetAsync(Requests)).ReadAsync<List<TrainerRequestDto>>();
        Assert.Equal(Roles.Manager, pending.Single(p => p.UserId == auth.User.Id).RequestedRole);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Requests)).StatusCode);
    }

    [Fact]
    public async Task AdminApproval_MakesAManager_ThenDeclineKeepsAMember()
    {
        var (_, approved) = await _f.SignupAsync("Manager");
        var (_, declined) = await _f.SignupAsync("Manager");
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"{Requests}/{approved.User.Id}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"{Requests}/{declined.User.Id}/decline", null)).StatusCode);

        Assert.Equal(new[] { Roles.Manager }, (await _f.LoginAsync(approved.User.Email, "Passw0rd!x")).User.Roles);
        Assert.Equal(new[] { Roles.Member }, (await _f.LoginAsync(declined.User.Email, "Passw0rd!x")).User.Roles);
    }

    // ---- a club's manager approves the club's trainers ----

    [Fact]
    public async Task ClubManager_SeesAndApprovesOnlyTheirOwnClubsTrainerRequests()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (_, mine) = await _f.SignupAsync("Trainer", club);
        var (_, elsewhere) = await _f.SignupAsync("Trainer", NewClubName());
        var (_, wantsManager) = await _f.SignupAsync("Manager", club);

        var list = await (await manager.GetAsync(Requests)).ReadAsync<List<TrainerRequestDto>>();
        Assert.Equal(new[] { mine.User.Id }, list.Select(r => r.UserId));

        Assert.Equal(HttpStatusCode.NotFound, (await manager.PostAsync($"{Requests}/{elsewhere.User.Id}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.PostAsync($"{Requests}/{wantsManager.User.Id}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await manager.PostAsync($"{Requests}/{mine.User.Id}/approve", null)).StatusCode);
        Assert.Equal(new[] { Roles.Trainer }, (await _f.LoginAsync(mine.User.Email, "Passw0rd!x")).User.Roles);
    }

    // ---- my teams, trainers and bibs ----

    [Fact]
    public async Task MyTeams_GivesAClubManagerEveryTeamOfTheirClub()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var clubId = await ClubIdAsync(club);
        var otherClubId = await _f.SeedClubAsync();
        var (comp, section) = await NewCompetitionAsync();
        var mine = await _f.SeedTeamAsync(comp, section, clubId, "Mine");
        var theirs = await _f.SeedTeamAsync(comp, section, otherClubId, "Theirs");

        var teams = await (await manager.GetAsync("/api/trainer/my-teams")).ReadAsync<List<TeamDto>>();

        var team = Assert.Single(teams, t => t.Id == mine);
        Assert.Equal("manager", team.Relationship);
        Assert.DoesNotContain(teams, t => t.Id == theirs);
    }

    [Fact]
    public async Task ClubManager_PutsATrainerInChargeAndDescribesTheBibs()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (_, trainer) = await _f.SignupAsync("Trainer", club);
        await (await _f.AdminAsync()).PostAsync($"{Requests}/{trainer.User.Id}/approve", null);
        var (comp, section) = await NewCompetitionAsync();
        var teamId = await _f.SeedTeamAsync(comp, section, await ClubIdAsync(club));

        var set = await manager.PutAsJsonAsync($"/api/teams/{teamId}/trainer",
            new UpdateTeamRequest(TrainerUserId: trainer.User.Id, BibDescription: "  Red bibs, 1 to 5  "));

        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        var dto = await set.ReadAsync<TeamDto>();
        Assert.Equal((trainer.User.Id, "Red bibs, 1 to 5"), (dto.TrainerUserId, dto.BibDescription));

        var cleared = await (await manager.PutAsJsonAsync($"/api/teams/{teamId}/trainer", new UpdateTeamRequest(TrainerUserId: "", BibDescription: "")))
            .ReadAsync<TeamDto>();
        Assert.Equal((null, null), (cleared.TrainerUserId, cleared.BibDescription));
    }

    [Fact]
    public async Task SetTrainer_IsRefused_ForAnotherClubsManager_AndForSomeoneWhoIsNotATrainer()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (otherManager, _) = await _f.ApprovedManagerAsync(NewClubName());
        var (_, member) = await _f.SignupAsync("Member", club);
        var (comp, section) = await NewCompetitionAsync();
        var teamId = await _f.SeedTeamAsync(comp, section, await ClubIdAsync(club));

        Assert.Equal(HttpStatusCode.NotFound, (await otherManager.PutAsJsonAsync($"/api/teams/{teamId}/trainer", new UpdateTeamRequest(TrainerUserId: ""))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.PutAsJsonAsync($"/api/teams/{teamId}/trainer", new UpdateTeamRequest(TrainerUserId: member.User.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.PutAsJsonAsync("/api/teams/999999/trainer", new UpdateTeamRequest())).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PutAsJsonAsync($"/api/teams/{teamId}/trainer", new UpdateTeamRequest())).StatusCode);
    }

    [Fact]
    public async Task ClubManager_CannotPutAnotherClubsTrainerInChargeOfTheirTeam()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (_, foreign) = await _f.SignupAsync("Trainer", NewClubName());
        await (await _f.AdminAsync()).PostAsync($"{Requests}/{foreign.User.Id}/approve", null);
        var (comp, section) = await NewCompetitionAsync();
        var teamId = await _f.SeedTeamAsync(comp, section, await ClubIdAsync(club));

        var refused = await manager.PutAsJsonAsync($"/api/teams/{teamId}/trainer", new UpdateTeamRequest(TrainerUserId: foreign.User.Id));
        var byAdmin = await (await _f.AdminAsync()).PutAsJsonAsync($"/api/teams/{teamId}/trainer", new UpdateTeamRequest(TrainerUserId: foreign.User.Id));

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal(HttpStatusCode.OK, byAdmin.StatusCode);
    }

    [Fact]
    public async Task OrganiserUpdate_CanAssignATrainer_AndRejectsANonTrainer()
    {
        var (comp, section) = await NewCompetitionAsync();
        var teamId = await _f.SeedTeamAsync(comp, section, await _f.SeedClubAsync());
        var trainerId = await _f.TrainerIdAsync();
        var admin = await _f.AdminAsync();
        var (_, member) = await _f.SignupAsync("Member");

        var ok = await (await admin.PutAsJsonAsync($"/api/competitions/{comp}/teams/{teamId}", new UpdateTeamRequest(TrainerUserId: trainerId))).ReadAsync<TeamDto>();
        var bad = await admin.PutAsJsonAsync($"/api/competitions/{comp}/teams/{teamId}", new UpdateTeamRequest(TrainerUserId: member.User.Id));

        Assert.Equal(trainerId, ok.TrainerUserId);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task ClubTrainers_ListsTheClubsApprovedTrainers_ForStaffOnly()
    {
        var club = NewClubName();
        var (_, trainer) = await _f.SignupAsync("Trainer", club);
        var (_, pending) = await _f.SignupAsync("Trainer", club);
        await (await _f.AdminAsync()).PostAsync($"{Requests}/{trainer.User.Id}/approve", null);
        var clubId = await ClubIdAsync(club);

        var list = await (await (await _f.AdminAsync()).GetAsync($"/api/clubs/{clubId}/trainers")).ReadAsync<List<ClubTrainerDto>>();

        Assert.Equal(new[] { trainer.User.Id }, list.Select(t => t.UserId));
        Assert.DoesNotContain(list, t => t.UserId == pending.User.Id);
        var (member, _) = await _f.SignupAsync("Member", club);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"/api/clubs/{clubId}/trainers")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync($"/api/clubs/{clubId}/trainers")).StatusCode);
    }

    // ---- declarations ----

    private static RiderEntryInput Rider(string name, bool guest = false, int? savedId = null)
        => new(savedId, name, null, null, null, false, false, 0, IsGuestRider: guest);

    [Fact]
    public async Task ClubManager_SubmitsForTheirClubsTeam_AndResubmittingUpdatesTheSameForm()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (comp, section) = await NewCompetitionAsync();
        var teamId = await _f.SeedTeamAsync(comp, section, await ClubIdAsync(club));

        var first = await (await manager.PostAsJsonAsync("/api/declaration-forms",
            new SubmitDeclarationFormRequest(teamId, "first", new[] { Rider("A"), Rider("B"), Rider("Guest G", guest: true) }, false, null, "Red bibs", AcceptTerms: true))).ReadAsync<DeclarationFormDto>();
        var second = await (await manager.PostAsJsonAsync("/api/declaration-forms",
            new SubmitDeclarationFormRequest(teamId, "second", new[] { Rider("A"), Rider("C") }, false, null, "Blue bibs", AcceptTerms: true))).ReadAsync<DeclarationFormDto>();

        Assert.Equal(first.Id, second.Id);
        Assert.Equal("Blue bibs", second.BibDescription);
        Assert.Equal(new[] { "A", "C" }, second.Riders.Select(r => r.FullName));
        Assert.Equal(1, await _f.WithDbAsync(db => db.DeclarationForms.CountAsync(f => f.TeamId == teamId)));
        Assert.Equal(2, await _f.WithDbAsync(db => db.RiderEntries.CountAsync(r => r.DeclarationFormId == first.Id)));
        Assert.True(first.Riders.Single(r => r.FullName == "Guest G").IsGuestRider);
        Assert.Equal("Blue bibs", await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == teamId).Select(t => t.BibDescription).SingleAsync()));
    }

    [Fact]
    public async Task Resubmitting_FoldsOlderDuplicateFormsIntoTheLatest()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (comp, section) = await NewCompetitionAsync();
        var teamId = await _f.SeedTeamAsync(comp, section, await ClubIdAsync(club));
        await _f.WithDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm { TeamId = teamId, SubmittedAt = DateTime.UtcNow.AddDays(-2), IsLocked = true });
            db.DeclarationForms.Add(new DeclarationForm { TeamId = teamId, SubmittedAt = DateTime.UtcNow.AddDays(-1), IsLocked = true });
            await db.SaveChangesAsync();
        });

        await manager.PostAsJsonAsync("/api/declaration-forms", new SubmitDeclarationFormRequest(teamId, null, new[] { Rider("A") }, false, null, AcceptTerms: true));

        Assert.Equal(1, await _f.WithDbAsync(db => db.DeclarationForms.CountAsync(f => f.TeamId == teamId)));
    }

    [Fact]
    public async Task Submit_IsRefused_ForAnotherClubsManager_AndForAnUnclaimedTeamOfAnotherClub()
    {
        var (otherManager, _) = await _f.ApprovedManagerAsync(NewClubName());
        var (comp, section) = await NewCompetitionAsync();
        var teamId = await _f.SeedTeamAsync(comp, section, await _f.SeedClubAsync());

        var r = await otherManager.PostAsJsonAsync("/api/declaration-forms", new SubmitDeclarationFormRequest(teamId, null, new[] { Rider("A") }, false, null, AcceptTerms: true));

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task SavedRiders_AreSharedByTheClubsManagerAndTrainers_ButNotWithOtherClubs()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (otherManager, _) = await _f.ApprovedManagerAsync(NewClubName());
        var (trainer, trainerAuth) = await _f.SignupAsync("Trainer", club);
        await (await _f.AdminAsync()).PostAsync($"{Requests}/{trainerAuth.User.Id}/approve", null);
        trainer = _f.WithToken((await _f.LoginAsync(trainerAuth.User.Email, "Passw0rd!x")).Token);
        var clubId = await ClubIdAsync(club);
        var (comp, section) = await NewCompetitionAsync();
        var teamId = await _f.SeedTeamAsync(comp, section, clubId, trainerUserId: trainerAuth.User.Id);

        // The trainer submits and saves a new rider to the club roster.
        await trainer.PostAsJsonAsync("/api/declaration-forms", new SubmitDeclarationFormRequest(teamId, null, new[] { Rider("Shared Rider") }, true, null, AcceptTerms: true));

        var seenByManager = await (await manager.GetAsync($"/api/clubs/{clubId}/saved-riders")).ReadAsync<List<SavedRiderDto>>();
        var seenByOther = await (await otherManager.GetAsync($"/api/clubs/{clubId}/saved-riders")).ReadAsync<List<SavedRiderDto>>();
        Assert.Contains(seenByManager, r => r.FullName == "Shared Rider");
        Assert.Empty(seenByOther);

        // The manager can declare using the trainer's saved rider.
        var saved = seenByManager.Single(r => r.FullName == "Shared Rider");
        var used = await manager.PostAsJsonAsync("/api/declaration-forms", new SubmitDeclarationFormRequest(teamId, null, new[] { Rider("Shared Rider", savedId: saved.Id) }, false, null, AcceptTerms: true));
        Assert.Equal(HttpStatusCode.OK, used.StatusCode);
        // Saving the same rider again updates the club's one entry instead of adding a second.
        await manager.PostAsJsonAsync("/api/declaration-forms", new SubmitDeclarationFormRequest(teamId, null, new[] { Rider("Shared Rider") }, true, null, AcceptTerms: true));
        Assert.Equal(1, await _f.WithDbAsync(db => db.SavedRiders.CountAsync(r => r.ClubId == clubId && r.FullName == "Shared Rider")));
    }

    [Fact]
    public async Task GuestRiders_AreNotSavedToTheClubRoster()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var clubId = await ClubIdAsync(club);
        var (comp, section) = await NewCompetitionAsync();
        var teamId = await _f.SeedTeamAsync(comp, section, clubId);

        await manager.PostAsJsonAsync("/api/declaration-forms", new SubmitDeclarationFormRequest(teamId, null, new[] { Rider("Borrowed Rider", guest: true) }, true, null, AcceptTerms: true));

        Assert.False(await _f.WithDbAsync(db => db.SavedRiders.AnyAsync(r => r.ClubId == clubId)));
    }

    // ---- team profiles ----

    [Fact]
    public async Task TeamProfile_NeedsNoSuffix_CanNameAClubThatDoesNotExistYet_AndLinksAnyTeamOfTheClub()
    {
        var trainer = await _f.TrainerAsync();
        var clubName = NewClubName();

        var created = await trainer.PostAsJsonAsync("/api/team-profiles", new CreateTeamProfileRequest(0, "", "Welsh Dragons", clubName));

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var profile = await created.ReadAsync<TeamProfileDto>();
        Assert.Equal(("", clubName), (profile.Suffix, profile.ClubName));
        var again = await (await trainer.PostAsJsonAsync("/api/team-profiles", new CreateTeamProfileRequest(0, "B", "Welsh Dragons 2", clubName.ToUpperInvariant()))).ReadAsync<TeamProfileDto>();
        Assert.Equal(profile.ClubId, again.ClubId);

        var owner = await _f.TrainerIdAsync();
        var comp = await _f.SeedCompetitionAsync(ownerUserId: owner);
        var section = await _f.SeedSectionAsync(comp);
        var teamId = await _f.SeedTeamAsync(comp, section, profile.ClubId, "Welsh Dragons Reds");
        var link = await trainer.PostAsJsonAsync($"/api/competitions/{comp}/team-profile-links", new LinkEventTeamRequest(profile.Id, teamId));
        Assert.Equal(HttpStatusCode.Created, link.StatusCode);

        var otherTeam = await _f.SeedTeamAsync(comp, section, await _f.SeedClubAsync(), "Someone else");
        var wrongClub = await trainer.PostAsJsonAsync($"/api/competitions/{comp}/team-profile-links", new LinkEventTeamRequest(again.Id, otherTeam));
        Assert.Equal(HttpStatusCode.Conflict, wrongClub.StatusCode);
    }

    [Fact]
    public async Task TeamProfile_Returns400_WithoutAnyClub_OrWithATooLongSuffix()
    {
        var trainer = await _f.TrainerAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync("/api/team-profiles", new CreateTeamProfileRequest(0, "A", "X"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync("/api/team-profiles", new CreateTeamProfileRequest(0, "ABCDEFGHIJK", "X", "Some club"))).StatusCode);
    }

    // ---- CSV import ----

    [Fact]
    public async Task CsvImport_CreatesNewClubsAndAcceptsEmptySuffixesAndCustomNames()
    {
        var ownerId = await _f.TrainerIdAsync();
        var comp = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        await _f.SeedSectionAsync(comp, "U14 csv");
        var trainer = await _f.TrainerAsync();
        var fresh = NewClubName();
        var csv = $"club,suffix,section,team\n{fresh},,U14 csv,Welsh Dragons\n{fresh},,U14 csv,Gower Greys\n{fresh},A,U14 csv,";
        var url = $"/api/event-tools/competitions/{comp}/team-import";

        var preview = await (await trainer.PostAsJsonAsync($"{url}/preview", new CsvTeamImportRequest(csv))).ReadAsync<CsvTeamImportPreviewDto>();

        Assert.All(preview.Rows, r => Assert.Empty(r.Errors));
        Assert.Equal(new[] { "Welsh Dragons", "Gower Greys", $"{fresh} A" }, preview.Rows.Select(r => r.TeamName));
        Assert.False(await _f.WithDbAsync(db => db.Clubs.AnyAsync(c => c.Name == fresh)));

        var applied = await trainer.PostAsJsonAsync($"{url}/apply", new ApplyCsvTeamImportRequest(csv, preview.Fingerprint, preview.PreviewVersion));

        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);
        Assert.Equal(1, await _f.WithDbAsync(db => db.Clubs.CountAsync(c => c.Name == fresh)));
        var teams = await _f.WithDbAsync(db => db.Teams.Where(t => t.CompetitionId == comp).Select(t => t.DisplayName).ToListAsync());
        Assert.Equal(new[] { "Gower Greys", $"{fresh} A", "Welsh Dragons" }, teams.Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task CsvImport_StillCatchesTheSameTeamTwice()
    {
        var ownerId = await _f.TrainerIdAsync();
        var comp = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        await _f.SeedSectionAsync(comp, "U16 csv");
        var trainer = await _f.TrainerAsync();
        var fresh = NewClubName();

        var preview = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{comp}/team-import/preview",
            new CsvTeamImportRequest($"club,section\n{fresh},U16 csv\n{fresh.ToUpperInvariant()},U16 csv"))).ReadAsync<CsvTeamImportPreviewDto>();

        Assert.Empty(preview.Rows[0].Errors);
        Assert.Contains("Duplicate team in this CSV.", preview.Rows[1].Errors);
    }
}
