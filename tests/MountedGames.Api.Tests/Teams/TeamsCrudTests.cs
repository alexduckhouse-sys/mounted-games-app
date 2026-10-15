using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Teams;

public class TeamsCrudTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public TeamsCrudTests(ApiFactory f) => _f = f;

    private async Task<(int Comp, int Section, int Club)> ArrangeAsync(string? clubBib = null, string clubName = "Arrange Club")
    {
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync($"{clubName} {Guid.NewGuid():N}"[..24], clubBib);
        return (comp, section, club);
    }

    private static object NewTeam(int section, int club, string suffix = "a", string? bib = null,
        string? trainer = null, bool horsConcours = false) => new
    {
        competitionSectionId = section, clubId = club, suffix, bibColour = bib, trainerUserId = trainer, isHorsConcours = horsConcours,
    };

    // ---- list ----

    [Fact]
    public async Task List_ReturnsTeamsForCompetitionOnly_OrderedByDisplayName()
    {
        var (comp, section, club) = await ArrangeAsync();
        var (otherComp, otherSection, _) = await ArrangeAsync();
        await _f.SeedTeamAsync(comp, section, club, "Zebra");
        await _f.SeedTeamAsync(comp, section, club, "Apple");
        await _f.SeedTeamAsync(otherComp, otherSection, club, "Other");

        var r = await _f.CreateClient().GetAsync($"/api/competitions/{comp}/teams");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var teams = await r.ReadAsync<List<TeamDto>>();
        Assert.Equal(new[] { "Apple", "Zebra" }, teams.Select(t => t.DisplayName));
        Assert.All(teams, t => Assert.False(string.IsNullOrEmpty(t.ClubName)));
    }

    [Fact]
    public async Task List_IncludesTrainerName()
    {
        var (comp, section, club) = await ArrangeAsync();
        var trainerId = (await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword)).User.Id;
        await _f.SeedTeamAsync(comp, section, club, "Coached", trainerUserId: trainerId);

        var teams = await (await _f.CreateClient().GetAsync($"/api/competitions/{comp}/teams")).ReadAsync<List<TeamDto>>();

        Assert.Equal("Jamie Carter", Assert.Single(teams).TrainerName);
    }

    // ---- create ----

    [Fact]
    public async Task Create_Returns401_WhenAnonymous()
    {
        var (comp, section, club) = await ArrangeAsync();
        var r = await _f.CreateClient().PostAsJsonAsync($"/api/competitions/{comp}/teams", NewTeam(section, club));
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns403_ForMember()
    {
        var (comp, section, club) = await ArrangeAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.PostAsJsonAsync($"/api/competitions/{comp}/teams", NewTeam(section, club));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns400_WhenSectionBelongsToAnotherCompetition()
    {
        var (comp, _, club) = await ArrangeAsync();
        var (_, otherSection, _) = await ArrangeAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/teams", NewTeam(otherSection, club));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns400_WhenSectionMissing()
    {
        var (comp, _, club) = await ArrangeAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/teams", NewTeam(999999, club));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns400_WhenClubMissing()
    {
        var (comp, section, _) = await ArrangeAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/teams", NewTeam(section, 999999));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_BuildsDisplayNameFromClubAndUppercasedSuffix_AndInheritsClubBib()
    {
        var (comp, section, club) = await ArrangeAsync(clubBib: "Red");
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/teams", NewTeam(section, club, " b "));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<TeamDto>();
        var clubName = await _f.WithDbAsync(db => db.Clubs.Where(c => c.Id == club).Select(c => c.Name).SingleAsync());
        Assert.Equal($"{clubName} B", dto.DisplayName);
        Assert.Equal("B", dto.Suffix);
        Assert.Equal("Red", dto.BibColour);
        Assert.Equal(clubName, dto.ClubName);
        Assert.Equal(section, dto.CompetitionSectionId);
        Assert.Null(dto.TrainerUserId);
        Assert.False(dto.IsHorsConcours);
    }

    [Fact]
    public async Task Create_UsesClubNameAlone_WhenSuffixBlank()
    {
        var (comp, section, club) = await ArrangeAsync();
        var admin = await _f.AdminAsync();

        var dto = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/teams", NewTeam(section, club, "  ")))
            .ReadAsync<TeamDto>();

        Assert.Equal(dto.ClubName, dto.DisplayName);
        Assert.Equal("", dto.Suffix);
    }

    [Fact]
    public async Task Create_PrefersRequestBibAndHorsConcours()
    {
        var (comp, section, club) = await ArrangeAsync(clubBib: "Red");
        var admin = await _f.AdminAsync();

        var dto = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/teams",
            NewTeam(section, club, "c", bib: "Blue", horsConcours: true))).ReadAsync<TeamDto>();

        Assert.Equal("Blue", dto.BibColour);
        Assert.True(dto.IsHorsConcours);
    }

    [Fact]
    public async Task Create_AssignsCallingTrainerAsTrainer_WhenNoneSupplied()
    {
        var (comp, section, club) = await ArrangeAsync();
        var auth = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        var trainer = _f.WithToken(auth.Token);

        var dto = await (await trainer.PostAsJsonAsync($"/api/competitions/{comp}/teams", NewTeam(section, club)))
            .ReadAsync<TeamDto>();

        Assert.Equal(auth.User.Id, dto.TrainerUserId);
        Assert.Equal("Jamie Carter", dto.TrainerName);
    }

    [Fact]
    public async Task Create_KeepsExplicitTrainer_EvenWhenCallerIsTrainer()
    {
        var (comp, section, club) = await ArrangeAsync();
        var coachId = (await _f.LoginAsync("coach@mg.local", "Trainer!234")).User.Id;
        var trainer = await _f.TrainerAsync();

        var dto = await (await trainer.PostAsJsonAsync($"/api/competitions/{comp}/teams",
            NewTeam(section, club, trainer: coachId))).ReadAsync<TeamDto>();

        Assert.Equal(coachId, dto.TrainerUserId);
    }

    // ---- update ----

    [Fact]
    public async Task Update_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PutAsJsonAsync("/api/competitions/1/teams/1", new { suffix = "x" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns403_ForMember()
    {
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.PutAsJsonAsync("/api/competitions/1/teams/1", new { suffix = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns404_WhenTeamNotInCompetition()
    {
        var (comp, section, club) = await ArrangeAsync();
        var (otherComp, _, _) = await ArrangeAsync();
        var team = await _f.SeedTeamAsync(comp, section, club);
        var admin = await _f.AdminAsync();

        var r = await admin.PutAsJsonAsync($"/api/competitions/{otherComp}/teams/{team}", new { suffix = "x" });

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Update_RenamesFromClubAndNewSuffix()
    {
        var (comp, section, club) = await ArrangeAsync();
        var team = await _f.SeedTeamAsync(comp, section, club);
        var admin = await _f.AdminAsync();

        var r = await admin.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}", new { suffix = " z " });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<TeamDto>();
        Assert.Equal("Z", dto.Suffix);
        Assert.Equal($"{dto.ClubName} Z", dto.DisplayName);
        var stored = await _f.WithDbAsync(db => db.Teams.AsNoTracking().SingleAsync(t => t.Id == team));
        Assert.Equal("Z", stored.Suffix);
    }

    [Fact]
    public async Task Update_ChangesHorsConcours_AndLeavesNameWhenSuffixOmitted()
    {
        var (comp, section, club) = await ArrangeAsync();
        var team = await _f.SeedTeamAsync(comp, section, club, "Original name");
        var trainer = await _f.TrainerAsync();

        var dto = await (await trainer.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}",
            new { isHorsConcours = true })).ReadAsync<TeamDto>();

        Assert.True(dto.IsHorsConcours);
        Assert.Equal("Original name", dto.DisplayName);
        Assert.Equal("A", dto.Suffix);
    }

    [Fact]
    public async Task Update_IgnoresBlankSuffix()
    {
        var (comp, section, club) = await ArrangeAsync();
        var team = await _f.SeedTeamAsync(comp, section, club, "Keep me");
        var admin = await _f.AdminAsync();

        var dto = await (await admin.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}", new { suffix = "  " }))
            .ReadAsync<TeamDto>();

        Assert.Equal("Keep me", dto.DisplayName);
        Assert.Equal("A", dto.Suffix);
    }

    // ---- delete ----

    [Fact]
    public async Task Delete_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().DeleteAsync("/api/competitions/1/teams/1");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Delete_Returns403_ForMember()
    {
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.DeleteAsync("/api/competitions/1/teams/1");
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Delete_Returns404_WhenTeamNotInCompetition()
    {
        var (comp, section, club) = await ArrangeAsync();
        var (otherComp, _, _) = await ArrangeAsync();
        var team = await _f.SeedTeamAsync(comp, section, club);
        var admin = await _f.AdminAsync();

        var r = await admin.DeleteAsync($"/api/competitions/{otherComp}/teams/{team}");

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.True(await _f.WithDbAsync(db => db.Teams.AnyAsync(t => t.Id == team)));
    }

    [Fact]
    public async Task Delete_RemovesTeam()
    {
        var (comp, section, club) = await ArrangeAsync();
        var team = await _f.SeedTeamAsync(comp, section, club);
        var trainer = await _f.TrainerAsync();

        var r = await trainer.DeleteAsync($"/api/competitions/{comp}/teams/{team}");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.Teams.AnyAsync(t => t.Id == team)));
    }
}
