using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.DeclarationForms;

public class DeclarationFormsEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public DeclarationFormsEndpointsTests(ApiFactory f) => _f = f;

    private const string Url = "/api/declaration-forms";

    private static RiderEntryInput Rider(string name, int order = 0, string? bib = null, DateTime? dob = null, string? horse = null,
        int? savedId = null, bool captain = false, bool reserve = false)
        => new(savedId, name, dob, horse, bib, captain, reserve, order);

    private static SubmitDeclarationFormRequest Form(int teamId, RiderEntryInput[]? riders = null, bool save = false, string? phone = null, string? notes = null)
        => new(teamId, notes, riders ?? new[] { Rider("Rider One") }, save, phone, AcceptTerms: true);

    private async Task SetTrainerAsync(int teamId, string? userId)
        => await _f.WithDbAsync(async db =>
        {
            (await db.Teams.SingleAsync(t => t.Id == teamId)).TrainerUserId = userId;
            await db.SaveChangesAsync();
        });

    private async Task<int> SeedFormAsync(int teamId, bool locked, string? submitter = null, DateTime? at = null)
        => await _f.WithDbAsync(async db =>
        {
            var d = new DeclarationForm { TeamId = teamId, IsLocked = locked, SubmittedByUserId = submitter, SubmittedAt = at ?? DateTime.UtcNow };
            db.DeclarationForms.Add(d);
            await db.SaveChangesAsync();
            return d.Id;
        });

    /// <summary>Makes the seeded trainer the coach of every team in the arena and returns their client.</summary>
    private async Task<HttpClient> CoachAsync(Arena a)
    {
        var id = await _f.TrainerIdAsync();
        foreach (var t in a.TeamIds) await SetTrainerAsync(t, id);
        return await _f.TrainerAsync();
    }

    // ---- Submit ----

    [Fact]
    public async Task Submit_CreatesLockedForm_WithOrderedRidersAndTrimmedBib()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);
        var riders = new[]
        {
            Rider("First", bib: "  red  ", captain: true),          // order 0 -> position 0
            Rider("Second", order: 7, bib: "   "),                  // explicit order kept, blank bib -> null
            Rider("Third", reserve: true),                           // order 0 -> position 2
        };

        var r = await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0], riders, notes: "all good"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<DeclarationFormDto>();
        Assert.True(dto.IsLocked);
        Assert.Equal("all good", dto.Notes);
        Assert.Equal("Team 1", dto.TeamName);
        Assert.Equal(a.CompetitionId, dto.CompetitionId);
        Assert.Equal("Jamie Carter", dto.SubmittedByName);
        Assert.Equal(new[] { "First", "Third", "Second" }, dto.Riders.Select(x => x.FullName));
        Assert.Equal(new[] { 0, 2, 7 }, dto.Riders.Select(x => x.OrderIndex));
        Assert.Equal("red", dto.Riders[0].BibColour);
        Assert.True(dto.Riders[0].IsCaptain);
        Assert.True(dto.Riders[1].IsReserve);
        Assert.Null(dto.Riders[2].BibColour);
    }

    [Fact]
    public async Task Submit_Returns400_WhenTeamMissing()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PostAsJsonAsync(Url, Form(999999));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Submit_Returns403_WhenTeamBelongsToAnotherTrainer()
    {
        var a = await _f.CreateArenaAsync(1);
        var coach = await _f.LoginAsync("coach@mg.local", TestClients.TrainerPassword);
        await SetTrainerAsync(a.TeamIds[0], coach.User.Id);
        var trainer = await _f.TrainerAsync();

        var r = await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]));

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.DeclarationForms.AnyAsync(d => d.TeamId == a.TeamIds[0])));
    }

    [Fact]
    public async Task Submit_Allowed_ForOwnTeam_ButNotForUnassignedTeam()
    {
        var a = await _f.CreateArenaAsync(2);
        var me = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        await SetTrainerAsync(a.TeamIds[0], me.User.Id);
        var trainer = _f.WithToken(me.Token);

        var own = await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]));
        var unassigned = await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[1]));

        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, unassigned.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.DeclarationForms.AnyAsync(d => d.TeamId == a.TeamIds[1])));
    }

    [Fact]
    public async Task Submit_Returns403_ForUnclaimedTeam_ForEveryTeamRole()
    {
        var a = await _f.CreateArenaAsync(1);
        var (manager, _) = await _f.SignupAsync("Manager");
        var (member, _) = await _f.SignupAsync("Member");

        Assert.Equal(HttpStatusCode.Forbidden, (await manager.PostAsJsonAsync(Url, Form(a.TeamIds[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync(Url, Form(a.TeamIds[0]))).StatusCode);
    }

    [Fact]
    public async Task Submit_Allowed_ForCompetitionOwner_OnAnyTeamInIt()
    {
        var a = await _f.CreateArenaAsync(1);
        var me = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.SingleAsync(c => c.Id == a.CompetitionId)).CreatedByUserId = me.User.Id;
            await db.SaveChangesAsync();
        });

        var r = await _f.WithToken(me.Token).PostAsJsonAsync(Url, Form(a.TeamIds[0]));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Submit_Allowed_ForCompetitionTeamMember_ButNotForOtherCompetitions()
    {
        var a = await _f.CreateArenaAsync(1);
        var b = await _f.CreateArenaAsync(1);
        var (helper, auth) = await _f.SignupAsync("Member");
        await _f.WithDbAsync(async db =>
        {
            db.CompetitionCollaborators.Add(new CompetitionCollaborator
            {
                CompetitionId = a.CompetitionId, UserId = auth.User.Id, Role = CollaboratorRole.CompetitionAdmin,
                AddedByUserId = auth.User.Id, AddedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.OK, (await helper.PostAsJsonAsync(Url, Form(a.TeamIds[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await helper.PostAsJsonAsync(Url, Form(b.TeamIds[0]))).StatusCode);
    }

    [Fact]
    public async Task Submit_Returns403_ForTrainerWhoDoesNotOwnTheCompetition()
    {
        var a = await _f.CreateArenaAsync(1);
        var other = await _f.LoginAsync("coach@mg.local", TestClients.TrainerPassword);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.SingleAsync(c => c.Id == a.CompetitionId)).CreatedByUserId = other.User.Id;
            await db.SaveChangesAsync();
        });

        var r = await (await _f.TrainerAsync()).PostAsJsonAsync(Url, Form(a.TeamIds[0]));

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Submit_AdminCanSubmitForAnyTeam()
    {
        var a = await _f.CreateArenaAsync(1);
        var coach = await _f.LoginAsync("coach@mg.local", TestClients.TrainerPassword);
        await SetTrainerAsync(a.TeamIds[0], coach.User.Id);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync(Url, Form(a.TeamIds[0]));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Submit_ManagerAndMemberRolesAreAllowed_ForTeamsTheyCoach()
    {
        var a = await _f.CreateArenaAsync(2);
        var (manager, m1) = await _f.SignupAsync("Manager");
        var (member, m2) = await _f.SignupAsync("Member");
        await SetTrainerAsync(a.TeamIds[0], m1.User.Id);
        await SetTrainerAsync(a.TeamIds[1], m2.User.Id);

        Assert.Equal(HttpStatusCode.OK, (await manager.PostAsJsonAsync(Url, Form(a.TeamIds[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.PostAsJsonAsync(Url, Form(a.TeamIds[1]))).StatusCode);
    }

    [Fact]
    public async Task Submit_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync(Url, Form(1));
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Submit_Returns403_ForRiderRole()
    {
        var admin = await _f.AdminAsync();
        var email = $"rider{Guid.NewGuid():N}"[..14] + "@mg.local";
        var reg = await admin.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, "Passw0rd!x", "A Rider", Roles.Rider, null));
        reg.EnsureSuccessStatusCode();
        var rider = _f.WithToken((await reg.ReadAsync<AuthResponse>()).Token);

        var r = await rider.PostAsJsonAsync(Url, Form(1));

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Submit_SavesTrainerPhone_WhenChanged()
    {
        var a = await _f.CreateArenaAsync(1);
        var (client, auth) = await _f.SignupAsync();
        await SetTrainerAsync(a.TeamIds[0], auth.User.Id);

        var dto = await (await client.PostAsJsonAsync(Url, Form(a.TeamIds[0], phone: "  07700 900123 "))).ReadAsync<DeclarationFormDto>();

        Assert.Equal("07700 900123", dto.SubmittedByPhone);
        Assert.Equal("07700 900123", (await _f.WithDbAsync(db => db.Users.SingleAsync(u => u.Id == auth.User.Id))).PhoneNumber);
    }

    [Fact]
    public async Task Submit_LeavesPhoneAlone_WhenUnchangedOrBlank()
    {
        var a = await _f.CreateArenaAsync(1);
        var (client, auth) = await _f.SignupAsync();
        await SetTrainerAsync(a.TeamIds[0], auth.User.Id);
        await client.PostAsJsonAsync(Url, Form(a.TeamIds[0], phone: "07700 900123"));

        // Same number again (no update path) and blank (ignored).
        await client.PostAsJsonAsync(Url, Form(a.TeamIds[0], phone: "07700 900123"));
        var blank = await (await client.PostAsJsonAsync(Url, Form(a.TeamIds[0], phone: "   "))).ReadAsync<DeclarationFormDto>();

        Assert.Equal("07700 900123", blank.SubmittedByPhone);
    }

    [Fact]
    public async Task Submit_WithoutSaveToRoster_DoesNotTouchRoster()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);

        await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0], new[] { Rider("Nobody Saved") }, save: false));

        Assert.False(await _f.WithDbAsync(db => db.SavedRiders.AnyAsync(s => s.FullName == "Nobody Saved")));
    }

    [Fact]
    public async Task Submit_SaveToRoster_AddsNewRiders_AndSkipsBlankOrAlreadySavedOnes()
    {
        var a = await _f.CreateArenaAsync(1);
        var clubId = await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == a.TeamIds[0]).Select(t => t.ClubId).SingleAsync());
        var trainerId = await _f.TrainerIdAsync();
        var linkedId = await _f.WithDbAsync(async db =>
        {
            var existing = new SavedRider { ClubId = clubId, FullName = "Linked Rider", CreatedByUserId = trainerId };
            db.SavedRiders.Add(existing);
            await db.SaveChangesAsync();
            return existing.Id;
        });
        var trainer = await CoachAsync(a);
        var dob = new DateTime(2012, 4, 5, 0, 0, 0, DateTimeKind.Utc);
        var riders = new[]
        {
            Rider("New Rider", dob: dob, horse: "Star"),
            Rider("  ", horse: "ignored"),
            Rider("Linked Rider", savedId: linkedId, horse: "not copied"),
        };

        await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0], riders, save: true));

        var saved = await _f.WithDbAsync(db => db.SavedRiders.Where(s => s.ClubId == clubId).ToListAsync());
        Assert.Equal(new[] { "Linked Rider", "New Rider" }, saved.Select(x => x.FullName).Order());
        Assert.Null(saved.Single(x => x.FullName == "Linked Rider").HorseName);
        var added = saved.Single(x => x.FullName == "New Rider");
        Assert.Equal("Star", added.HorseName);
        Assert.Equal(dob, added.DateOfBirth);
    }

    [Fact]
    public async Task Submit_SaveToRoster_FillsMissingDetailsOfExistingRider_ButKeepsExistingOnes()
    {
        var a = await _f.CreateArenaAsync(1);
        var clubId = await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == a.TeamIds[0]).Select(t => t.ClubId).SingleAsync());
        var trainerId = await _f.TrainerIdAsync();
        await _f.WithDbAsync(async db =>
        {
            db.SavedRiders.Add(new SavedRider { ClubId = clubId, FullName = "Needs DOB", HorseName = "Keep Me", CreatedByUserId = trainerId });
            db.SavedRiders.Add(new SavedRider { ClubId = clubId, CreatedByUserId = trainerId, FullName = "Needs Horse", DateOfBirth = new DateTime(2010, 1, 1, 0, 0, 0, DateTimeKind.Utc) });
            await db.SaveChangesAsync();
        });
        var trainer = await CoachAsync(a);
        var dob = new DateTime(2012, 4, 5, 0, 0, 0, DateTimeKind.Utc);
        var riders = new[]
        {
            Rider("Needs DOB", dob: dob, horse: "Overwrite?"),
            Rider("Needs Horse", dob: dob, horse: "Comet"),
        };

        await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0], riders, save: true));

        var saved = (await _f.WithDbAsync(db => db.SavedRiders.Where(s => s.ClubId == clubId).ToListAsync())).ToDictionary(s => s.FullName);
        Assert.Equal(2, saved.Count);
        Assert.Equal(dob, saved["Needs DOB"].DateOfBirth);
        Assert.Equal("Keep Me", saved["Needs DOB"].HorseName);
        Assert.NotNull(saved["Needs DOB"].UpdatedAt);
        Assert.Equal(new DateTime(2010, 1, 1, 0, 0, 0, DateTimeKind.Utc), saved["Needs Horse"].DateOfBirth);
        Assert.Equal("Comet", saved["Needs Horse"].HorseName);
    }

    // ---- List ----

    [Fact]
    public async Task List_Anonymous_SeesOnlyLockedForms_NewestFirst()
    {
        var a = await _f.CreateArenaAsync(1);
        var now = DateTime.UtcNow;
        var older = await SeedFormAsync(a.TeamIds[0], true, at: now.AddHours(-2));
        var newer = await SeedFormAsync(a.TeamIds[0], true, at: now.AddHours(-1));
        await SeedFormAsync(a.TeamIds[0], false, at: now);

        var r = await _f.CreateClient().GetAsync($"{Url}?competitionId={a.CompetitionId}");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(new[] { newer, older }, (await r.ReadAsync<List<DeclarationFormDto>>()).Select(d => d.Id));
    }

    [Fact]
    public async Task List_Admin_AlsoSeesDrafts()
    {
        var a = await _f.CreateArenaAsync(1);
        await SeedFormAsync(a.TeamIds[0], true);
        await SeedFormAsync(a.TeamIds[0], false);
        var admin = await _f.AdminAsync();

        var list = await (await admin.GetAsync($"{Url}?competitionId={a.CompetitionId}")).ReadAsync<List<DeclarationFormDto>>();

        Assert.Equal(2, list.Count);
        Assert.Contains(list, d => !d.IsLocked);
    }

    [Fact]
    public async Task List_FiltersByCompetitionAndTeam()
    {
        var a = await _f.CreateArenaAsync(2);
        var b = await _f.CreateArenaAsync(1);
        var f1 = await SeedFormAsync(a.TeamIds[0], true);
        var f2 = await SeedFormAsync(a.TeamIds[1], true);
        await SeedFormAsync(b.TeamIds[0], true);
        var client = _f.CreateClient();

        var byComp = await (await client.GetAsync($"{Url}?competitionId={a.CompetitionId}")).ReadAsync<List<DeclarationFormDto>>();
        var byTeam = await (await client.GetAsync($"{Url}?teamId={a.TeamIds[1]}")).ReadAsync<List<DeclarationFormDto>>();

        Assert.Equal(new[] { f1, f2 }, byComp.Select(d => d.Id).Order());
        Assert.Equal(f2, Assert.Single(byTeam).Id);
    }

    // ---- Get ----

    [Fact]
    public async Task Get_ReturnsForm_ToAnonymous()
    {
        var a = await _f.CreateArenaAsync(1);
        var id = await SeedFormAsync(a.TeamIds[0], true);

        var r = await _f.CreateClient().GetAsync($"{Url}/{id}");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<DeclarationFormDto>();
        Assert.Equal(id, dto.Id);
        Assert.Equal("Team 1", dto.TeamName);
    }

    [Fact]
    public async Task Get_Returns404_WhenMissing()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"{Url}/999999")).StatusCode);
    }

    // ---- Delete ----

    [Fact]
    public async Task Delete_AdminCanDeleteAnyForm()
    {
        var a = await _f.CreateArenaAsync(1);
        var id = await SeedFormAsync(a.TeamIds[0], true);
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"{Url}/{id}")).StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.DeclarationForms.AnyAsync(d => d.Id == id)));
    }

    [Fact]
    public async Task Delete_SubmitterCanDeleteOwnForm()
    {
        var a = await _f.CreateArenaAsync(1);
        var (client, auth) = await _f.SignupAsync();
        var id = await SeedFormAsync(a.TeamIds[0], true, submitter: auth.User.Id);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{Url}/{id}")).StatusCode);
    }

    [Fact]
    public async Task Delete_TeamTrainerCanDeleteFormSubmittedBySomeoneElse()
    {
        var a = await _f.CreateArenaAsync(1);
        var me = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        await SetTrainerAsync(a.TeamIds[0], me.User.Id);
        var (_, other) = await _f.SignupAsync();
        var id = await SeedFormAsync(a.TeamIds[0], true, submitter: other.User.Id);

        var r = await _f.WithToken(me.Token).DeleteAsync($"{Url}/{id}");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
    }

    [Fact]
    public async Task Delete_Returns403_ForUnrelatedTrainer()
    {
        var a = await _f.CreateArenaAsync(1);
        var me = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        await SetTrainerAsync(a.TeamIds[0], me.User.Id);
        var (_, other) = await _f.SignupAsync();
        var id = await SeedFormAsync(a.TeamIds[0], true, submitter: other.User.Id);
        var coach = await _f.LoginAsync("coach@mg.local", TestClients.TrainerPassword);

        var r = await _f.WithToken(coach.Token).DeleteAsync($"{Url}/{id}");

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.True(await _f.WithDbAsync(db => db.DeclarationForms.AnyAsync(d => d.Id == id)));
    }

    [Fact]
    public async Task Delete_Returns404_WhenMissing()
    {
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"{Url}/999999")).StatusCode);
    }

    [Fact]
    public async Task Delete_Returns401_WhenAnonymous()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().DeleteAsync($"{Url}/1")).StatusCode);
    }

    // ---- Dec form screen: terms tick, pony height, trainer name, team name ----

    [Fact]
    public async Task Submit_Returns400_WithoutTheTermsTick_AndSavesNothing()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);

        var r = await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]) with { AcceptTerms = false });

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.DeclarationForms.AnyAsync(d => d.TeamId == a.TeamIds[0])));
    }

    [Fact]
    public async Task Submit_ChecksAccessBeforeTheTick()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await _f.TrainerAsync();

        var r = await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]) with { AcceptTerms = false });

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Submit_RecordsWhoAgreedAndWhen_AndTheTrainerName()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);

        var dto = await (await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]) with { TrainerName = "  Alex Morgan " })).ReadAsync<DeclarationFormDto>();

        Assert.Equal("Alex Morgan", dto.TrainerName);
        Assert.NotNull(dto.TermsAcceptedAt);
        var stored = await _f.WithDbAsync(db => db.DeclarationForms.SingleAsync(d => d.Id == dto.Id));
        Assert.Equal(dto.SubmittedByUserId, stored.TermsAcceptedByUserId);
        Assert.Equal(stored.SubmittedAt, stored.TermsAcceptedAt);
    }

    [Fact]
    public async Task Submit_DefaultsTheTrainerNameToTheAccountName()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);

        var dto = await (await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]))).ReadAsync<DeclarationFormDto>();

        Assert.Equal("Jamie Carter", dto.TrainerName);
    }

    [Fact]
    public async Task Submit_KeepsTheTrainerNameAndTickPrivate_FromTheAnonymousList()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);
        await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]) with { TrainerName = "Private Name" });

        var anonymous = await (await _f.CreateClient().GetAsync($"{Url}?teamId={a.TeamIds[0]}")).ReadAsync<List<DeclarationFormDto>>();

        Assert.Single(anonymous);
        Assert.Null(anonymous[0].TrainerName);
        Assert.Null(anonymous[0].TermsAcceptedAt);
    }

    [Fact]
    public async Task Submit_StoresPonyHeights_AndSavesThemToTheRoster()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);
        var name = $"Tall {Guid.NewGuid():N}"[..16];
        var rider = Rider(name) with { HorseName = "Pickle", PonyHeightHands = 13.2m };

        var dto = await (await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0], new[] { rider }, save: true))).ReadAsync<DeclarationFormDto>();

        Assert.Equal(13.2m, dto.Riders.Single().PonyHeightHands);
        var saved = await _f.WithDbAsync(db => db.SavedRiders.SingleAsync(s => s.FullName == name));
        Assert.Equal(13.2m, saved.PonyHeightHands);
        var clubId = await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == a.TeamIds[0]).Select(t => t.ClubId).SingleAsync());
        var listed = await (await trainer.GetAsync($"/api/clubs/{clubId}/saved-riders")).ReadAsync<List<SavedRiderDto>>();
        Assert.Equal(13.2m, listed.Single(s => s.FullName == name).PonyHeightHands);
    }

    [Theory]
    [InlineData(4.9)]
    [InlineData(20.1)]
    [InlineData(-13.2)]
    public async Task Submit_Returns400_ForAPonyHeightOutsideTheSensibleRange(double hands)
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);
        var rider = Rider("Odd Height") with { PonyHeightHands = (decimal)hands };

        var r = await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0], new[] { rider }));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Submit_RenamesTheTeam_WhenAskedTo_AndKeepsItWhenNot()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);

        var renamed = await (await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]) with { TeamName = "  Stockport C " })).ReadAsync<DeclarationFormDto>();
        var unchanged = await (await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]))).ReadAsync<DeclarationFormDto>();

        Assert.Equal("Stockport C", renamed.TeamName);
        Assert.Equal("Stockport C", unchanged.TeamName);
    }

    [Fact]
    public async Task MyTeams_FlagsTheTeamsStillNeedingADecForm()
    {
        var a = await _f.CreateArenaAsync(2);
        var trainer = await CoachAsync(a);
        await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]));

        var mine = await (await trainer.GetAsync("/api/trainer/my-teams")).ReadAsync<List<TeamDto>>();

        Assert.False(mine.Single(t => t.Id == a.TeamIds[0]).NeedsDeclaration);
        Assert.True(mine.Single(t => t.Id == a.TeamIds[1]).NeedsDeclaration);
    }

    [Fact]
    public async Task MyTeams_DoesNotAskForADecFormOnceTheEventIsOver_OrTheTeamIsOut()
    {
        var a = await _f.CreateArenaAsync(2);
        var trainer = await CoachAsync(a);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.SingleAsync(c => c.Id == a.CompetitionId)).EndDate = DateTime.UtcNow.AddDays(-3);
            await db.SaveChangesAsync();
        });

        var over = await (await trainer.GetAsync("/api/trainer/my-teams")).ReadAsync<List<TeamDto>>();
        Assert.All(over.Where(t => a.TeamIds.Contains(t.Id)), t => Assert.False(t.NeedsDeclaration));

        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.SingleAsync(c => c.Id == a.CompetitionId)).EndDate = DateTime.UtcNow.AddDays(3);
            (await db.Teams.SingleAsync(t => t.Id == a.TeamIds[1])).EntryStatus = TeamEntryStatus.Withdrawn;
            await db.SaveChangesAsync();
        });

        var out_ = await (await trainer.GetAsync("/api/trainer/my-teams")).ReadAsync<List<TeamDto>>();
        Assert.True(out_.Single(t => t.Id == a.TeamIds[0]).NeedsDeclaration);
        Assert.False(out_.Single(t => t.Id == a.TeamIds[1]).NeedsDeclaration);
    }

    [Fact]
    public async Task MyTeams_NeverAsksASupporterForADecForm()
    {
        var a = await _f.CreateArenaAsync(1);
        var (supporter, auth) = await _f.SignupAsync("Member");
        await _f.WithDbAsync(async db =>
        {
            db.TeamSupporters.Add(new TeamSupporter { TeamId = a.TeamIds[0], UserId = auth.User.Id, Status = TeamSupporterStatus.Accepted });
            await db.SaveChangesAsync();
        });

        var mine = await (await supporter.GetAsync("/api/trainer/my-teams")).ReadAsync<List<TeamDto>>();

        Assert.False(mine.Single(t => t.Id == a.TeamIds[0]).NeedsDeclaration);
    }
}
