using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
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
    public async Task Submit_RiderWithLinkedSignupCanSubmitAndDeleteOwnForm()
    {
        var a = await _f.CreateArenaAsync(2);
        var admin = await _f.AdminAsync();
        var email = $"rider{Guid.NewGuid():N}"[..14] + "@mg.local";
        var reg = await admin.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, "Passw0rd!x", "Solo Rider", Roles.Rider, null));
        reg.EnsureSuccessStatusCode();
        var auth = await reg.ReadAsync<AuthResponse>();
        var rider = _f.WithToken(auth.Token);

        await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == a.TeamIds[0]);
            db.SectionSignups.Add(new SectionSignup
            {
                CompetitionSectionId = team.CompetitionSectionId,
                UserId = auth.User.Id,
                FullName = "Solo Rider",
                TeamId = team.Id,
                Status = SignupPaymentStatus.Paid,
                AmountMinor = 2500
            });
            await db.SaveChangesAsync();
            var signupId = await db.SectionSignups.Where(s => s.UserId == auth.User.Id && s.TeamId == team.Id).Select(s => s.Id).SingleAsync();
            db.Add(new SignupMatchmaking { SignupId = signupId, DeclarationAccessGranted = true });
            await db.SaveChangesAsync();
        });

        var ok = await rider.PostAsJsonAsync(Url, Form(a.TeamIds[0]));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var dto = await ok.ReadAsync<DeclarationFormDto>();

        var forbidden = await rider.PostAsJsonAsync(Url, Form(a.TeamIds[1]));
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var del = await rider.DeleteAsync($"{Url}/{dto.Id}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
    }

    [Fact]
    public async Task PublicSupporterCode_DoesNotGrantDeclarationReadOrWriteAccess()
    {
        var arena = await _f.CreateArenaAsync(1);
        var (entrant, _) = await _f.SignupAsync("Member");
        var formId = await SeedFormAsync(arena.TeamIds[0], true);
        var code = "synthetic-public-code-" + Guid.NewGuid().ToString("N");
        var sectionId = await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0]);
            team.SupporterJoinKey = code;
            var form = await db.DeclarationForms.SingleAsync(f => f.Id == formId);
            form.TrainerName = "Private Synthetic Trainer";
            await db.SaveChangesAsync();
            return team.CompetitionSectionId;
        });
        var signup = await entrant.PostAsJsonAsync($"/api/competitions/{arena.CompetitionId}/sections/{sectionId}/signups", new
        {
            fullName = "Synthetic Supporter", teamCode = code,
            acceptTerms = true, consentVersion = SignupTerms.WordingVersion,
        });
        signup.EnsureSuccessStatusCode();
        Assert.Equal(arena.TeamIds[0], (await signup.ReadAsync<SectionSignupDto>()).TeamId);
        var get = await (await entrant.GetAsync($"{Url}/{formId}")).ReadAsync<DeclarationFormDto>();
        Assert.Null(get.TrainerName);
        var list = await (await entrant.GetAsync($"{Url}?teamId={arena.TeamIds[0]}")).ReadAsync<List<DeclarationFormDto>>();
        Assert.Null(Assert.Single(list).TrainerName);
        Assert.Equal(HttpStatusCode.Forbidden, (await entrant.PostAsJsonAsync(Url, Form(arena.TeamIds[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await entrant.DeleteAsync($"{Url}/{formId}")).StatusCode);
        await _f.WithDbAsync(async db =>
        {
            (await db.DeclarationForms.SingleAsync(f => f.Id == formId)).IsLocked = false;
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.NotFound, (await entrant.GetAsync($"{Url}/{formId}")).StatusCode);
        Assert.Empty(await (await entrant.GetAsync($"{Url}?teamId={arena.TeamIds[0]}")).ReadAsync<List<DeclarationFormDto>>());
    }

    [Fact]
    public async Task OrganiserFormedEntry_GrantsAccessToDraftsAndSubmission()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Individual, priceMinor: 1000);
        var (entrant, _) = await _f.SignupAsync("Member");
        (await entrant.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups", new
        {
            fullName = "Synthetic Entrant", acceptTerms = true, consentVersion = SignupTerms.WordingVersion,
        })).EnsureSuccessStatusCode();
        var admin = await _f.AdminAsync();
        await _f.PayPendingAsync(section.Id);
        var formed = await (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/sections/{section.Id}/form-teams", new FormTeamsFromSignupsRequest(null, false, false))).ReadAsync<FormTeamsResult>();
        var team = Assert.Single(formed.Created);
        var formId = await SeedFormAsync(team.Id, false);
        Assert.Equal(HttpStatusCode.OK, (await entrant.GetAsync($"{Url}/{formId}")).StatusCode);
        Assert.Single(await (await entrant.GetAsync($"{Url}?teamId={team.Id}")).ReadAsync<List<DeclarationFormDto>>());
        Assert.Equal(HttpStatusCode.OK, (await entrant.PostAsJsonAsync(Url, Form(team.Id))).StatusCode);
    }

    [Theory]
    [InlineData(false, SignupPaymentStatus.Paid, false)]
    [InlineData(true, SignupPaymentStatus.Cancelled, false)]
    [InlineData(true, SignupPaymentStatus.Refunded, false)]
    [InlineData(true, SignupPaymentStatus.Paid, true)]
    public async Task DeclarationAccess_RequiresAnActiveExplicitTeamLink(bool linked, SignupPaymentStatus status, bool withdrawn)
    {
        var arena = await _f.CreateArenaAsync(1);
        var (client, auth) = await _f.SignupAsync("Member");
        var formId = await SeedFormAsync(arena.TeamIds[0], true);
        await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0]);
            var form = await db.DeclarationForms.SingleAsync(f => f.Id == formId);
            form.TrainerName = "Private Test Trainer";
            var signup = new SectionSignup
            {
                CompetitionSectionId = team.CompetitionSectionId, UserId = auth.User.Id,
                FullName = team.DisplayName, TeamName = team.DisplayName,
                TeamId = linked ? team.Id : null, Status = status,
            };
            db.Add(signup);
            await db.SaveChangesAsync();
            db.Add(new SignupMatchmaking { SignupId = signup.Id, DeclarationAccessGranted = true });
            await db.SaveChangesAsync();
            if (withdrawn)
            {
                db.Add(new SignupExtras { SignupId = signup.Id, IsWithdrawn = true });
                await db.SaveChangesAsync();
            }
        });
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Url, Form(arena.TeamIds[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.DeleteAsync($"{Url}/{formId}")).StatusCode);
        var visible = await (await client.GetAsync($"{Url}/{formId}")).ReadAsync<DeclarationFormDto>();
        Assert.Null(visible.TrainerName);
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
    public async Task Submit_SaveToRoster_FillsMissingDetailsOfExistingRider_AndSavesSeparateHorseCombos()
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
            Rider("Needs DOB", dob: dob, horse: "Second Pony"),
            Rider("Needs Horse", dob: dob, horse: "Comet"),
        };

        await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0], riders, save: true));

        var saved = await _f.WithDbAsync(db => db.SavedRiders.Where(s => s.ClubId == clubId).ToListAsync());
        Assert.Equal(3, saved.Count);
        var keepMe = saved.Single(s => s.FullName == "Needs DOB" && s.HorseName == "Keep Me");
        var secondPony = saved.Single(s => s.FullName == "Needs DOB" && s.HorseName == "Second Pony");
        var needsHorse = saved.Single(s => s.FullName == "Needs Horse");
        Assert.Null(keepMe.DateOfBirth);
        Assert.Null(keepMe.UpdatedAt);
        Assert.Equal(dob, secondPony.DateOfBirth);
        Assert.Equal(new DateTime(2010, 1, 1, 0, 0, 0, DateTimeKind.Utc), needsHorse.DateOfBirth);
        Assert.Equal("Comet", needsHorse.HorseName);
    }

    [Fact]
    public async Task Submit_SaveToRoster_SavesMultipleHorseCombosForSameRider_IncludingWhenSavedRiderHorseChanged()
    {
        var a = await _f.CreateArenaAsync(2);
        var clubId = await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == a.TeamIds[0]).Select(t => t.ClubId).SingleAsync());
        var trainer = await CoachAsync(a);
        var dob = new DateTime(2014, 6, 15, 0, 0, 0, DateTimeKind.Utc);

        // Declare Ella Hughes with "Star" on Team 1
        await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0], new[] { Rider("Ella Hughes", dob: dob, horse: "Star") }, save: true));
        var afterFirst = await (await trainer.GetAsync($"/api/clubs/{clubId}/saved-riders")).ReadAsync<List<SavedRiderDto>>();
        var starCombo = Assert.Single(afterFirst, s => s.FullName == "Ella Hughes");
        Assert.Equal("Star", starCombo.HorseName);

        // Pick the saved "Ella Hughes — Star" combo (savedId: starCombo.Id), but change the horse to "Flash" on Team 2
        var changedForm = await (await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[1], new[] { Rider("Ella Hughes", dob: dob, horse: "Flash", savedId: starCombo.Id) }, save: true))).ReadAsync<DeclarationFormDto>();
        Assert.Equal(starCombo.Id, Assert.Single(changedForm.Riders).SavedRiderId);

        // Submitting "Star" again (case-insensitive) does not create a third row
        await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0], new[] { Rider("  ella hughes ", dob: dob, horse: "  star ") }, save: true));

        var combos = (await (await trainer.GetAsync($"/api/clubs/{clubId}/saved-riders")).ReadAsync<List<SavedRiderDto>>())
            .Where(s => s.FullName.Equals("Ella Hughes", StringComparison.OrdinalIgnoreCase))
            .OrderBy(s => s.HorseName)
            .ToList();
        Assert.Equal(2, combos.Count);
        Assert.Equal(new[] { "Flash", "Star" }, combos.Select(c => c.HorseName));
    }

    [Fact]
    public async Task SelfEnteredRider_CanLoadOwnSavedRiders_ViaClubAndMySavedRidersEndpoints()
    {
        var a = await _f.CreateArenaAsync(1);
        var clubId = await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == a.TeamIds[0]).Select(t => t.ClubId).SingleAsync());
        var admin = await _f.AdminAsync();
        var email = $"rider{Guid.NewGuid():N}"[..14] + "@mg.local";
        var reg = await admin.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, "Passw0rd!x", "Solo Rider", Roles.Rider, null));
        reg.EnsureSuccessStatusCode();
        var auth = await reg.ReadAsync<AuthResponse>();
        var rider = _f.WithToken(auth.Token);

        await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == a.TeamIds[0]);
            var signup = new SectionSignup
            {
                CompetitionSectionId = team.CompetitionSectionId,
                UserId = auth.User.Id,
                FullName = "Solo Rider",
                TeamId = team.Id,
                Status = SignupPaymentStatus.Paid,
                AmountMinor = 2500
            };
            db.SectionSignups.Add(signup);
            db.Set<SignupMatchmaking>().Add(new SignupMatchmaking { Signup = signup, DeclarationAccessGranted = true });
            await db.SaveChangesAsync();
        });

        (await rider.PostAsJsonAsync(Url, Form(a.TeamIds[0], new[]
        {
            Rider("Solo Rider", horse: "Blaze"),
            Rider("Solo Rider", horse: "Storm")
        }, save: true))).EnsureSuccessStatusCode();

        var clubSaved = await (await rider.GetAsync($"/api/clubs/{clubId}/saved-riders")).ReadAsync<List<SavedRiderDto>>();
        Assert.Equal(new[] { "Blaze", "Storm" }, clubSaved.Select(r => r.HorseName));

        var mySaved = await (await rider.GetAsync("/api/clubs/my-saved-riders")).ReadAsync<List<SavedRiderDto>>();
        Assert.Equal(new[] { "Blaze", "Storm" }, mySaved.Select(r => r.HorseName));
    }

    [Fact]
    public async Task DeclarationLockTime_BlocksNonOrganiserEditsAfterDeadline_WhileAllowingOrganisers()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(a);
        var admin = await _f.AdminAsync();

        // Initially no lock time is set
        var initial = await (await trainer.GetAsync($"{Url}/competition/{a.CompetitionId}/lock-time")).ReadAsync< MountedGames.Api.Controllers.DeclarationLockTimeDto>();
        Assert.Null(initial.DeclarationsCloseAt);
        Assert.False(initial.IsClosed);

        // Non-organiser cannot set lock time
        var forbid = await trainer.PutAsJsonAsync($"{Url}/competition/{a.CompetitionId}/lock-time",
            new MountedGames.Api.Controllers.SetDeclarationLockTimeRequest(DateTime.UtcNow.AddMinutes(-5)));
        Assert.Equal(HttpStatusCode.NotFound, forbid.StatusCode);

        var original = await (await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]))).ReadAsync<DeclarationFormDto>();

        // Admin sets lock time in the past
        var past = DateTime.UtcNow.AddMinutes(-5);
        var locked = await (await admin.PutAsJsonAsync($"{Url}/competition/{a.CompetitionId}/lock-time",
            new MountedGames.Api.Controllers.SetDeclarationLockTimeRequest(past))).ReadAsync<MountedGames.Api.Controllers.DeclarationLockTimeDto>();
        Assert.True(locked.IsClosed);

        // Trainer is now blocked from submitting
        var blocked = await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]));
        Assert.Equal(HttpStatusCode.BadRequest, blocked.StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.DeleteAsync($"{Url}/{original.Id}")).StatusCode);
        Assert.True(await _f.WithDbAsync(db => db.DeclarationForms.AnyAsync(d => d.Id == original.Id)));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"{Url}/{original.Id}")).StatusCode);

        // Admin can still submit after lock time
        var adminSubmit = await admin.PostAsJsonAsync(Url, Form(a.TeamIds[0]));
        Assert.Equal(HttpStatusCode.OK, adminSubmit.StatusCode);

        // Admin clears lock time -> trainer can submit again
        var cleared = await (await admin.PutAsJsonAsync($"{Url}/competition/{a.CompetitionId}/lock-time",
            new MountedGames.Api.Controllers.SetDeclarationLockTimeRequest(null))).ReadAsync<MountedGames.Api.Controllers.DeclarationLockTimeDto>();
        Assert.Null(cleared.DeclarationsCloseAt);
        Assert.False(cleared.IsClosed);

        var allowedAgain = await trainer.PostAsJsonAsync(Url, Form(a.TeamIds[0]));
        Assert.Equal(HttpStatusCode.OK, allowedAgain.StatusCode);
    }

    [Fact]
    public async Task SavedRiders_RequireAuthentication_AndNeverExposeAnotherAccountsRoster()
    {
        var arena = await _f.CreateArenaAsync(1);
        var clubId = await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == arena.TeamIds[0]).Select(t => t.ClubId).SingleAsync());
        var (member, auth) = await _f.SignupAsync("Member");
        await _f.WithDbAsync(async db =>
        {
            db.SavedRiders.AddRange(
                new SavedRider { ClubId = clubId, CreatedByUserId = auth.User.Id, FullName = "Synthetic Own Rider", HorseName = "Synthetic Pony" },
                new SavedRider { ClubId = clubId, CreatedByUserId = await _f.TrainerIdAsync(), FullName = "Synthetic Private Rider", HorseName = "Private Pony" });
            await db.SaveChangesAsync();
        });
        foreach (var route in new[] { $"/api/clubs/{clubId}/saved-riders", "/api/clubs/my-saved-riders" })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(route)).StatusCode);
            var riders = await (await member.GetAsync(route)).ReadAsync<List<SavedRiderDto>>();
            Assert.Equal("Synthetic Own Rider", Assert.Single(riders).FullName);
        }
    }

    [Fact]
    public async Task SaveChangedPony_DoesNotRestoreFieldsDisabledByAdaptiveConfig()
    {
        var arena = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(arena);
        var trainerId = await _f.TrainerIdAsync();
        var savedId = await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.Include(t => t.Competition).SingleAsync(t => t.Id == arena.TeamIds[0]);
            team.Competition!.DecFormConfigJson = System.Text.Json.JsonSerializer.Serialize(
                MountedGames.Api.Services.DecForms.DecFormConfig.Basic with { TrainerPhone = MountedGames.Api.Services.DecForms.FieldRequirement.Off });
            var rider = new SavedRider { ClubId = team.ClubId, CreatedByUserId = trainerId, FullName = "Synthetic Combo Rider", HorseName = "Original Pony", DateOfBirth = new DateTime(2012, 1, 1), PonyHeightHands = 13m };
            db.SavedRiders.Add(rider);
            await db.SaveChangesAsync();
            return rider.Id;
        });
        var request = Form(arena.TeamIds[0], [Rider("Synthetic Combo Rider", dob: new DateTime(2012, 1, 1), horse: "Different Pony", savedId: savedId) with { PonyHeightHands = 14m }], save: true);
        (await trainer.PostAsJsonAsync(Url, request)).EnsureSuccessStatusCode();
        var combo = await _f.WithDbAsync(db => db.SavedRiders.SingleAsync(r => r.CreatedByUserId == trainerId && r.FullName == "Synthetic Combo Rider" && r.HorseName == "Different Pony"));
        Assert.Null(combo.DateOfBirth);
        Assert.Null(combo.PonyHeightHands);
    }

    [Fact]
    public async Task LockTime_HidesUnknownCompetition_AndRequiresOrganiser()
    {
        var arena = await _f.CreateArenaAsync(1);
        var route = $"{Url}/competition/{arena.CompetitionId}/lock-time";
        var body = new MountedGames.Api.Controllers.SetDeclarationLockTimeRequest(null);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"{Url}/competition/2147483647/lock-time")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PutAsJsonAsync(route, body)).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PutAsJsonAsync(route, body)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.AdminAsync()).PutAsJsonAsync($"{Url}/competition/2147483647/lock-time", body)).StatusCode);
    }

    [Fact]
    public async Task LockTime_ClosesAtTheExactDeadline()
    {
        var arena = await _f.CreateArenaAsync(1);
        var clock = new ManualTimeProvider();
        await _f.WithDbAsync(async db =>
        {
            db.Set<CompetitionDeclarationLock>().Add(new CompetitionDeclarationLock { CompetitionId = arena.CompetitionId, DeclarationsCloseAt = clock.GetUtcNow().UtcDateTime.AddSeconds(1) });
            await db.SaveChangesAsync();
            var controller = new MountedGames.Api.Controllers.DeclarationFormsController(db, null!, clock);
            Assert.False((await controller.GetLockTime(arena.CompetitionId)).Value!.IsClosed);
            clock.Advance(TimeSpan.FromSeconds(1));
            Assert.True((await controller.GetLockTime(arena.CompetitionId)).Value!.IsClosed);
        });
    }

    [Fact]
    public async Task SaveToRoster_LinksFirstEntry_AndDoesNotCopyDobToSameNamedOtherCombos()
    {
        var arena = await _f.CreateArenaAsync(1);
        var trainer = await CoachAsync(arena);
        var trainerId = await _f.TrainerIdAsync();
        var unrelatedId = await _f.WithDbAsync(async db =>
        {
            var clubId = await db.Teams.Where(t => t.Id == arena.TeamIds[0]).Select(t => t.ClubId).SingleAsync();
            var unrelated = new SavedRider { ClubId = clubId, CreatedByUserId = trainerId, FullName = "Synthetic Shared Name", HorseName = "Unrelated Pony" };
            db.SavedRiders.Add(unrelated);
            await db.SaveChangesAsync();
            return unrelated.Id;
        });
        var response = await trainer.PostAsJsonAsync(Url, Form(arena.TeamIds[0], [Rider("Synthetic Shared Name", dob: new DateTime(2013, 1, 1), horse: "Selected Pony")], save: true));
        response.EnsureSuccessStatusCode();
        var form = await response.ReadAsync<DeclarationFormDto>();
        var savedId = Assert.Single(form.Riders).SavedRiderId;
        Assert.NotNull(savedId);
        Assert.NotEqual(unrelatedId, savedId);
        await _f.WithDbAsync(async db =>
        {
            Assert.Null((await db.SavedRiders.FindAsync(unrelatedId))!.DateOfBirth);
            Assert.Equal("Selected Pony", (await db.SavedRiders.FindAsync(savedId))!.HorseName);
        });
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

    [Fact]
    public async Task CreateTeam_AutoFillsClubDefaultBibColour_AndAllowsPerTeamOverride()
    {
        var a = await _f.CreateArenaAsync(1);
        var admin = await _f.AdminAsync();
        var (clubId, sectionId) = await _f.WithDbAsync(async db =>
        {
            var t = await db.Teams.Where(x => x.Id == a.TeamIds[0]).Select(x => new { x.ClubId, x.CompetitionSectionId }).SingleAsync();
            var club = await db.Clubs.SingleAsync(c => c.Id == t.ClubId);
            club.BibColour = "Royal Blue";
            await db.SaveChangesAsync();
            return (t.ClubId, t.CompetitionSectionId);
        });

        var createAutoResp = await admin.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/teams", new CreateTeamRequest(sectionId, clubId, "B", null, null));
        Assert.Equal(HttpStatusCode.OK, createAutoResp.StatusCode);
        var autoTeam = await createAutoResp.ReadAsync<TeamDto>();
        Assert.Equal("Royal Blue", autoTeam.BibColour);

        var createOverrideResp = await admin.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/teams", new CreateTeamRequest(sectionId, clubId, "C", "Crimson", null));
        Assert.Equal(HttpStatusCode.OK, createOverrideResp.StatusCode);
        var overrideTeam = await createOverrideResp.ReadAsync<TeamDto>();
        Assert.Equal("Crimson", overrideTeam.BibColour);

        var updateResp = await admin.PutAsJsonAsync($"/api/competitions/{a.CompetitionId}/teams/{autoTeam.Id}", new { suffix = "B", bibColour = "Gold" });
        Assert.Equal(HttpStatusCode.OK, updateResp.StatusCode);
        var updatedTeam = await updateResp.ReadAsync<TeamDto>();
        Assert.Equal("Gold", updatedTeam.BibColour);
    }

    [Fact]
    public async Task JoinTeam_MatchesSupporterJoinKeyCaseInsensitively_ForAnySignedInAccount()
    {
        var a = await _f.CreateArenaAsync(1);
        var key = await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == a.TeamIds[0]);
            team.SupporterJoinKey = $"JOIN{Guid.NewGuid():N}"[..10].ToUpperInvariant();
            await db.SaveChangesAsync();
            return team.SupporterJoinKey;
        });

        var (parentClient, parentAuth) = await _f.SignupAsync("Parent Supporter");
        var joinResp = await parentClient.PostAsJsonAsync("/api/teams/join", new { key = $"  {key.ToLowerInvariant()}  " });
        Assert.Equal(HttpStatusCode.OK, joinResp.StatusCode);

        var joined = await _f.WithDbAsync(db => db.TeamSupporters.AnyAsync(s => s.TeamId == a.TeamIds[0] && s.UserId == parentAuth.User.Id));
        Assert.True(joined);
    }
}
