using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Privacy;

/// <summary>Riders who ask to be shown by initial, or not to be filmed, are respected server-side.</summary>
public class RiderPrivacyTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public RiderPrivacyTests(ApiFactory f) => _f = f;

    private const string Forms = "/api/declaration-forms";
    private static string Filming(int competitionId) => $"/api/competitions/{competitionId}/filming-optouts";

    private static RiderEntryInput Rider(string name, bool initial = false, bool noFilming = false, int? savedId = null)
        => new(savedId, name, new DateTime(2012, 3, 4, 0, 0, 0, DateTimeKind.Utc), "Pony", null, false, false, 0, initial, noFilming);

    /// <summary>Makes the trainer the team's own coach, since only they (or its organisers) may submit for it.</summary>
    private async Task ClaimAsync(HttpClient trainer, int teamId)
    {
        var me = await (await trainer.GetAsync("/api/auth/me")).ReadAsync<UserProfile>();
        await _f.WithDbAsync(async db =>
        {
            (await db.Teams.FindAsync(teamId))!.TrainerUserId = me.Id;
            await db.SaveChangesAsync();
        });
    }

    private async Task<int> SubmitAsync(HttpClient trainer, int teamId, params RiderEntryInput[] riders)
    {
        await ClaimAsync(trainer, teamId);
        var r = await trainer.PostAsJsonAsync(Forms, new SubmitDeclarationFormRequest(teamId, null, riders, false, null));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return (await r.ReadAsync<DeclarationFormDto>()).Id;
    }

    private static async Task<DeclarationFormDto> OnlyFormAsync(HttpClient client, int competitionId)
        => Assert.Single(await (await client.GetAsync($"{Forms}?competitionId={competitionId}")).ReadAsync<List<DeclarationFormDto>>());

    private async Task<List<FilmingOptOutDto>> OptOutsAsync(int competitionId)
    {
        var r = await (await _f.AdminAsync()).GetAsync(Filming(competitionId));
        Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
        return await r.ReadAsync<List<FilmingOptOutDto>>();
    }

    private async Task<HttpClient> TeamMemberAsync(int competitionId)
    {
        var (client, auth) = await _f.SignupAsync("Member");
        await _f.WithDbAsync(async db =>
        {
            db.CompetitionCollaborators.Add(new CompetitionCollaborator
            {
                CompetitionId = competitionId, UserId = auth.User.Id, Role = CollaboratorRole.CompetitionAdmin,
                AddedByUserId = auth.User.Id, AddedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        });
        return client;
    }

    [Fact]
    public async Task Anonymous_SeesInitialOnly_ForRidersWhoAskedForIt()
    {
        var a = await _f.CreateArenaAsync(1);
        await SubmitAsync(await _f.TrainerAsync(), a.TeamIds[0], Rider("Oliver Smith", initial: true, noFilming: true), Rider("Ava Bell"));

        var form = await OnlyFormAsync(_f.CreateClient(), a.CompetitionId);

        Assert.Equal(new[] { "Oliver S.", "Ava Bell" }, form.Riders.Select(r => r.FullName));
        Assert.All(form.Riders, r => { Assert.False(r.NoFilming); Assert.Null(r.DateOfBirth); });
        var byId = await _f.CreateClient().GetAsync($"{Forms}/{form.Id}");
        Assert.Equal("Oliver S.", (await byId.ReadAsync<DeclarationFormDto>()).Riders[0].FullName);
    }

    [Fact]
    public async Task OtherTrainersAndMembersNotOnTheTeam_AlsoSeeInitialOnly()
    {
        var a = await _f.CreateArenaAsync(1);
        await SubmitAsync(await _f.TrainerAsync(), a.TeamIds[0], Rider("Oliver Smith", initial: true));
        var (stranger, _) = await _f.ApprovedTrainerAsync();
        var (member, _) = await _f.SignupAsync("Member");

        Assert.Equal("Oliver S.", (await OnlyFormAsync(stranger, a.CompetitionId)).Riders[0].FullName);
        Assert.Equal("Oliver S.", (await OnlyFormAsync(member, a.CompetitionId)).Riders[0].FullName);
    }

    [Fact]
    public async Task AdminAndTheSubmittingTrainer_SeeFullNames()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await _f.TrainerAsync();
        await ClaimAsync(trainer, a.TeamIds[0]);
        var created = await trainer.PostAsJsonAsync(Forms, new SubmitDeclarationFormRequest(a.TeamIds[0], null,
            new[] { Rider("Oliver Smith", initial: true, noFilming: true) }, false, null));
        var submitted = await created.ReadAsync<DeclarationFormDto>();

        Assert.Equal("Oliver Smith", submitted.Riders[0].FullName);
        Assert.True(submitted.Riders[0].UseInitialOnly);
        Assert.True(submitted.Riders[0].NoFilming);
        foreach (var viewer in new[] { trainer, await _f.AdminAsync() })
        {
            var rider = (await OnlyFormAsync(viewer, a.CompetitionId)).Riders[0];
            Assert.Equal("Oliver Smith", rider.FullName);
            Assert.NotNull(rider.DateOfBirth);
        }
    }

    [Fact]
    public async Task CompetitionOwner_SeesFullNames()
    {
        var a = await _f.CreateArenaAsync(1);
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(a.CompetitionId))!.CreatedByUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });
        await SubmitAsync(await _f.TrainerAsync(), a.TeamIds[0], Rider("Oliver Smith", initial: true));

        Assert.Equal("Oliver Smith", (await OnlyFormAsync(owner, a.CompetitionId)).Riders[0].FullName);
    }

    [Fact]
    public async Task CompetitionAdmin_SeesTheFullRecord_ButOnlyForTheirCompetition()
    {
        var a = await _f.CreateArenaAsync(1);
        var other = await _f.CreateArenaAsync(1);
        var trainer = await _f.TrainerAsync();
        await SubmitAsync(trainer, a.TeamIds[0], Rider("Oliver Smith", initial: true, noFilming: true));
        await SubmitAsync(trainer, other.TeamIds[0], Rider("Oliver Smith", initial: true));
        var member = await TeamMemberAsync(a.CompetitionId);

        var rider = (await OnlyFormAsync(member, a.CompetitionId)).Riders[0];
        Assert.Equal("Oliver Smith", rider.FullName);
        Assert.NotNull(rider.DateOfBirth);
        Assert.True(rider.NoFilming);
        Assert.Equal("Oliver S.", (await OnlyFormAsync(member, other.CompetitionId)).Riders[0].FullName);
    }

    [Fact]
    public async Task Submit_SavesTheChoicesToTheRoster_AndASavedRiderCarriesThemAcross()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await _f.TrainerAsync();
        await ClaimAsync(trainer, a.TeamIds[0]);
        var clubId = await _f.WithDbAsync(async db => (await db.Teams.SingleAsync(t => t.Id == a.TeamIds[0])).ClubId);
        var first = await trainer.PostAsJsonAsync(Forms, new SubmitDeclarationFormRequest(a.TeamIds[0], null,
            new[] { Rider("Roster Rider", initial: true, noFilming: true) }, true, null));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var saved = (await (await trainer.GetAsync($"/api/clubs/{clubId}/saved-riders")).ReadAsync<List<SavedRiderDto>>())
            .Single(s => s.FullName == "Roster Rider");
        Assert.True(saved.UseInitialOnly);
        Assert.True(saved.NoFilming);

        // Picking the saved rider again, with the choices as the roster holds them, keeps them on the new entry.
        var again = await trainer.PostAsJsonAsync(Forms, new SubmitDeclarationFormRequest(a.TeamIds[0], null,
            new[] { Rider("Roster Rider", saved.UseInitialOnly, saved.NoFilming, saved.Id) }, false, null));
        var rider = (await again.ReadAsync<DeclarationFormDto>()).Riders[0];
        Assert.True(rider.UseInitialOnly);
        Assert.True(rider.NoFilming);
    }

    [Fact]
    public async Task Submit_UpdatesAnExistingRosterRider_WhenTheChoicesChange()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await _f.TrainerAsync();
        await ClaimAsync(trainer, a.TeamIds[0]);
        var clubId = await _f.WithDbAsync(async db => (await db.Teams.SingleAsync(t => t.Id == a.TeamIds[0])).ClubId);
        await trainer.PostAsJsonAsync(Forms, new SubmitDeclarationFormRequest(a.TeamIds[0], null, new[] { Rider("Changing Rider") }, true, null));
        await trainer.PostAsJsonAsync(Forms, new SubmitDeclarationFormRequest(a.TeamIds[0], null, new[] { Rider("Changing Rider", noFilming: true) }, true, null));

        var saved = (await (await trainer.GetAsync($"/api/clubs/{clubId}/saved-riders")).ReadAsync<List<SavedRiderDto>>())
            .Single(s => s.FullName == "Changing Rider");
        Assert.True(saved.NoFilming);
        Assert.False(saved.UseInitialOnly);
    }

    [Fact]
    public async Task TheChoices_AreOffByDefault()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await _f.TrainerAsync();
        await ClaimAsync(trainer, a.TeamIds[0]);
        var submitted = await (await trainer.PostAsJsonAsync(Forms,
            new SubmitDeclarationFormRequest(a.TeamIds[0], null, new[] { new RiderEntryInput(null, "Plain Rider", null, null, null, false, false, 0) }, false, null)))
            .ReadAsync<DeclarationFormDto>();
        Assert.False(submitted.Riders[0].UseInitialOnly);
        Assert.False(submitted.Riders[0].NoFilming);
    }

    [Fact]
    public async Task Signup_RecordsTheChoices()
    {
        var section = await _f.NewSectionAsync();
        var (entrant, _) = await _f.SignupAsync();
        var url = $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups";

        var dto = await (await entrant.PostAsJsonAsync(url, new CreateSectionSignupRequest("Oliver Smith", null, null, null, true, true, true, SignupTerms.WordingVersion)))
            .ReadAsync<SectionSignupDto>();
        Assert.True(dto.UseInitialOnly);
        Assert.True(dto.NoFilming);

        var plain = await (await entrant.PostAsJsonAsync(url, new CreateSectionSignupRequest("Ava Bell", null, null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion)))
            .ReadAsync<SectionSignupDto>();
        Assert.False(plain.UseInitialOnly);
        Assert.False(plain.NoFilming);
    }

    // ---- Filming opt-outs ----

    [Fact]
    public async Task FilmingOptOuts_ListTheRightHeatAndLane_ForStaff()
    {
        var a = await _f.CreateArenaAsync(3);
        var (heatId, _) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, label: "Heat 2");
        var trainer = await _f.TrainerAsync();
        await SubmitAsync(trainer, a.TeamIds[1], Rider("Oliver Smith", noFilming: true), Rider("Ava Bell"));
        await SubmitAsync(trainer, a.TeamIds[2], Rider("Other Rider"));

        var hit = Assert.Single(await OptOutsAsync(a.CompetitionId));

        Assert.Equal((heatId, "Heat 2", a.TeamIds[1], 2, "Oliver Smith"), (hit.HeatId, hit.HeatLabel, hit.TeamId, hit.Lane, hit.RiderName));
        Assert.False(hit.HeatFinished);
    }

    [Fact]
    public async Task FilmingOptOuts_UseTheNewestDeclaration_AndNumberUnlabelledHeats()
    {
        var a = await _f.CreateArenaAsync(2);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds, label: "Heat 1", orderIndex: 1);
        var (second, _) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, label: " ", orderIndex: 2);
        var trainer = await _f.TrainerAsync();
        await SubmitAsync(trainer, a.TeamIds[0], Rider("Old Optout", noFilming: true));
        await Task.Delay(20);
        await SubmitAsync(trainer, a.TeamIds[0], Rider("Old Optout"));
        Assert.Empty(await OptOutsAsync(a.CompetitionId));

        await SubmitAsync(trainer, a.TeamIds[1], Rider("New Optout", noFilming: true));
        var list = await OptOutsAsync(a.CompetitionId);
        Assert.Equal(new[] { "Heat 1", "Heat 2" }, list.Select(x => x.HeatLabel));
        Assert.Equal(second, list[1].HeatId);
    }

    [Fact]
    public async Task FilmingOptOuts_AreEmpty_WhenNobodyOptedOut()
    {
        var a = await _f.CreateArenaAsync(1);
        Assert.Empty(await OptOutsAsync(a.CompetitionId));
    }

    [Fact]
    public async Task FilmingOptOuts_ReachTheCompetitionTeam_AndNobodyElse()
    {
        var a = await _f.CreateArenaAsync(1);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        await SubmitAsync(await _f.TrainerAsync(), a.TeamIds[0], Rider("Oliver Smith", noFilming: true));
        var producer = await TeamMemberAsync(a.CompetitionId);
        var (member, _) = await _f.SignupAsync("Member");
        var (strangerTrainer, _) = await _f.ApprovedTrainerAsync();

        Assert.Single(await (await producer.GetAsync(Filming(a.CompetitionId))).ReadAsync<List<FilmingOptOutDto>>());
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(Filming(a.CompetitionId))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(Filming(a.CompetitionId))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await strangerTrainer.GetAsync(Filming(a.CompetitionId))).StatusCode);
    }

    [Fact]
    public async Task FilmingOptOuts_IgnoreOtherCompetitions()
    {
        var a = await _f.CreateArenaAsync(1);
        var other = await _f.CreateArenaAsync(1);
        await _f.AddHeatAsync(other.SessionId, other.TeamIds);
        await SubmitAsync(await _f.TrainerAsync(), other.TeamIds[0], Rider("Oliver Smith", noFilming: true));

        Assert.Empty(await OptOutsAsync(a.CompetitionId));
    }
}
