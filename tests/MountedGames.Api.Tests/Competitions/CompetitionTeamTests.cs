using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Controllers;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

/// <summary>A competition's team: helpers added by the owner can run that one event, and nothing else.</summary>
public class CompetitionTeamTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CompetitionTeamTests(ApiFactory f) => _f = f;

    private static string Team(int competitionId) => $"/api/competitions/{competitionId}/team";

    /// <summary>A competition owned by a fresh trainer, with one heat (two races) in a session.</summary>
    private async Task<(Arena Arena, int HeatId, int[] RaceIds, HttpClient Owner, string OwnerEmail)> OwnedAsync()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });
        var (heatId, raceIds) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        return (arena, heatId, raceIds, owner, auth.User.Email);
    }

    private static object Results(int[] teamIds) => new { places = teamIds.Select((t, i) => new { teamId = t, place = i + 1, eliminated = false }) };

    [Fact]
    public async Task OwnerCanNowScore_AndRunTheirSessions()
    {
        var (arena, _, races, owner, _) = await OwnedAsync();

        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsync($"/api/races/{races[0]}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PutAsJsonAsync($"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/status", new { status = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync($"/api/races/{races[0]}/results", Results(arena.TeamIds))).StatusCode);
    }

    [Fact]
    public async Task AHelperWithAMemberAccount_CanRunThatEventOnly()
    {
        var (arena, _, races, owner, _) = await OwnedAsync();
        var other = await OwnedAsync();
        var (helper, helperAuth) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await helper.PostAsync($"/api/races/{races[0]}/start", null)).StatusCode);

        var added = await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email, role = CollaboratorRole.RingScorer });
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await helper.PostAsJsonAsync($"/api/races/{races[1]}/results", Results(arena.TeamIds))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await helper.PutAsJsonAsync($"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/status", new { status = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await helper.PostAsync($"/api/races/{other.RaceIds[0]}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await helper.GetAsync(Team(other.Arena.CompetitionId))).StatusCode);
        // Deleting a competition stays admin-only.
        Assert.Equal(HttpStatusCode.Forbidden, (await helper.DeleteAsync($"/api/competitions/{arena.CompetitionId}")).StatusCode);

        var access = await helper.GetFromJsonAsync<List<CompetitionAccessDto>>("/api/competitions/access");
        Assert.Equal(new CompetitionAccessDto(arena.CompetitionId, false, CollaboratorRole.RingScorer), Assert.Single(access!));
    }

    [Fact]
    public async Task OnlyTheOwnerOrAnAdminChangesTheTeam_AndHelpersCanLeave()
    {
        var (arena, _, _, owner, _) = await OwnedAsync();
        var (helper, helperAuth) = await _f.SignupAsync("Member");
        var (second, secondAuth) = await _f.SignupAsync("Member");
        await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email, role = CollaboratorRole.CoOrganiser });

        Assert.Equal(HttpStatusCode.Forbidden, (await helper.PostAsJsonAsync(Team(arena.CompetitionId), new { email = secondAuth.User.Email, role = 0 })).StatusCode);
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync(Team(arena.CompetitionId), new { email = secondAuth.User.Email, role = CollaboratorRole.Commentator })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await helper.PutAsJsonAsync($"{Team(arena.CompetitionId)}/{secondAuth.User.Id}", new { role = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await helper.DeleteAsync($"{Team(arena.CompetitionId)}/{secondAuth.User.Id}")).StatusCode);

        var changed = await (await owner.PutAsJsonAsync($"{Team(arena.CompetitionId)}/{secondAuth.User.Id}", new { role = CollaboratorRole.StreamProducer })).ReadAsync<TeamHelperDto>();
        Assert.Equal(CollaboratorRole.StreamProducer, changed.Role);

        Assert.Equal(HttpStatusCode.NoContent, (await second.DeleteAsync($"{Team(arena.CompetitionId)}/{secondAuth.User.Id}")).StatusCode);
        // Having left their only team, they're no longer competition staff at all.
        Assert.Equal(HttpStatusCode.Forbidden, (await second.GetAsync(Team(arena.CompetitionId))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"{Team(arena.CompetitionId)}/{helperAuth.User.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"{Team(arena.CompetitionId)}/{helperAuth.User.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.PutAsJsonAsync($"{Team(arena.CompetitionId)}/{helperAuth.User.Id}", new { role = 1 })).StatusCode);
    }

    [Fact]
    public async Task TheTeamList_ShowsEmailsOnlyToTheOwnerAndAdmins()
    {
        var (arena, _, _, owner, _) = await OwnedAsync();
        var (helper, helperAuth) = await _f.SignupAsync("Member");
        await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email, role = CollaboratorRole.LineJudge });

        var asOwner = await owner.GetFromJsonAsync<CompetitionTeamDto>(Team(arena.CompetitionId));
        var asHelper = await helper.GetFromJsonAsync<CompetitionTeamDto>(Team(arena.CompetitionId));

        Assert.True(asOwner!.CanManageTeam);
        Assert.NotNull(asOwner.Owner);
        Assert.Equal(helperAuth.User.Email, Assert.Single(asOwner.Helpers).Email);
        Assert.False(asHelper!.CanManageTeam);
        Assert.Null(Assert.Single(asHelper.Helpers).Email);
    }

    [Fact]
    public async Task AddingRejectsUnknownEmails_TheOwner_AndBadRoles()
    {
        var (arena, _, _, owner, ownerProfile) = await OwnedAsync();
        var access = (await owner.GetFromJsonAsync<List<CompetitionAccessDto>>("/api/competitions/access"))!;
        Assert.Contains(access, a => a.CompetitionId == arena.CompetitionId && a.Owner && a.Role is null);

        Assert.Equal(HttpStatusCode.NotFound, (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = "nobody-here@example.test", role = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = ownerProfile, role = 0 })).StatusCode);
        var (_, helperAuth) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email, role = 9 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = "not-an-email", role = 0 })).StatusCode);
    }

    [Fact]
    public async Task AddingTheSameHelperAgain_ChangesTheirRole()
    {
        var (arena, _, _, owner, _) = await OwnedAsync();
        var (_, helperAuth) = await _f.SignupAsync("Member");
        await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email, role = CollaboratorRole.LineJudge });

        var again = await (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email, role = CollaboratorRole.Commentator })).ReadAsync<TeamHelperDto>();

        Assert.Equal(CollaboratorRole.Commentator, again.Role);
        Assert.Single((await owner.GetFromJsonAsync<CompetitionTeamDto>(Team(arena.CompetitionId)))!.Helpers);
    }

    [Fact]
    public async Task SessionsRefuseTeamsFromAnotherCompetition()
    {
        var (arena, heatId, _, owner, _) = await OwnedAsync();
        var other = await OwnedAsync();
        var url = $"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}";

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"{url}/heats", new { label = "Stolen", orderIndex = 5, teamIds = other.Arena.TeamIds, raceNames = new[] { "R" } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync($"{url}/heat-assignments", new { assignments = new[] { new { label = "Heat 1", teamIds = other.Arena.TeamIds } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"{url}/generate-heats", new { teamIds = other.Arena.TeamIds, raceNames = new[] { "R" } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"{url}/generate-race-finals", new { teamIds = other.Arena.TeamIds, raceNames = new[] { "R" } })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync($"{url}/heats", new { label = "Own teams", orderIndex = 6, teamIds = arena.TeamIds, raceNames = new[] { "R" } })).StatusCode);
        _ = heatId;
    }
}
