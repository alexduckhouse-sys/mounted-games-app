using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Controllers;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

/// <summary>A competition's team: competition admins added by the owner can run that one event, and nothing else.</summary>
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
    public async Task ACompetitionAdminWithAMemberAccount_CanRunThatEventOnly()
    {
        var (arena, _, races, owner, _) = await OwnedAsync();
        var other = await OwnedAsync();
        var (helper, helperAuth) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await helper.PostAsync($"/api/races/{races[0]}/start", null)).StatusCode);

        // Older clients still send a role; it's ignored.
        var added = await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email, role = 3 });
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await helper.PostAsJsonAsync($"/api/races/{races[1]}/results", Results(arena.TeamIds))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await helper.PutAsJsonAsync($"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/status", new { status = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await helper.PostAsync($"/api/races/{other.RaceIds[0]}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await helper.GetAsync(Team(other.Arena.CompetitionId))).StatusCode);
        // Deleting a competition stays with site admins.
        Assert.Equal(HttpStatusCode.Forbidden, (await helper.DeleteAsync($"/api/competitions/{arena.CompetitionId}")).StatusCode);

        var access = await helper.GetFromJsonAsync<List<CompetitionAccessDto>>("/api/competitions/access");
        Assert.Equal(new CompetitionAccessDto(arena.CompetitionId, false), Assert.Single(access!));
    }

    [Fact]
    public async Task CompetitionAdminsManageTheTeam_AndCanLeave()
    {
        var (arena, _, _, owner, ownerEmail) = await OwnedAsync();
        var other = await OwnedAsync();
        var (helper, helperAuth) = await _f.SignupAsync("Member");
        var (second, secondAuth) = await _f.SignupAsync("Member");
        await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email });

        // A competition admin adds and removes others like the owner does, but can't touch the owner.
        Assert.Equal(HttpStatusCode.OK, (await helper.PostAsJsonAsync(Team(arena.CompetitionId), new { email = secondAuth.User.Email })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await helper.PostAsJsonAsync(Team(arena.CompetitionId), new { email = ownerEmail })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await helper.DeleteAsync($"{Team(arena.CompetitionId)}/{secondAuth.User.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await helper.DeleteAsync($"{Team(arena.CompetitionId)}/{secondAuth.User.Id}")).StatusCode);

        // Someone who runs a different competition can't change this one's team.
        Assert.Equal(HttpStatusCode.NotFound, (await other.Owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = secondAuth.User.Email })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.Owner.DeleteAsync($"{Team(arena.CompetitionId)}/{helperAuth.User.Id}")).StatusCode);

        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync(Team(arena.CompetitionId), new { email = secondAuth.User.Email })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await second.DeleteAsync($"{Team(arena.CompetitionId)}/{secondAuth.User.Id}")).StatusCode);
        // Having left their only team, they're no longer competition staff at all.
        Assert.Equal(HttpStatusCode.Forbidden, (await second.GetAsync(Team(arena.CompetitionId))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await helper.DeleteAsync($"{Team(arena.CompetitionId)}/{helperAuth.User.Id}")).StatusCode);
    }

    [Fact]
    public async Task TheTeamList_ShowsTheOwnerAndEveryCompetitionAdmin()
    {
        var (arena, _, _, owner, _) = await OwnedAsync();
        var (helper, helperAuth) = await _f.SignupAsync("Member");
        await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email });

        var asHelper = await helper.GetFromJsonAsync<CompetitionTeamDto>(Team(arena.CompetitionId));

        Assert.NotNull(asHelper!.Owner);
        Assert.Equal(helperAuth.User.Email, Assert.Single(asHelper.Helpers).Email);
    }

    [Fact]
    public async Task AddingRejectsUnknownEmails_AndTheOwner_AndKeepsOneEntryPerPerson()
    {
        var (arena, _, _, owner, ownerProfile) = await OwnedAsync();
        var access = (await owner.GetFromJsonAsync<List<CompetitionAccessDto>>("/api/competitions/access"))!;
        Assert.Contains(access, a => a.CompetitionId == arena.CompetitionId && a.Owner);

        Assert.Equal(HttpStatusCode.NotFound, (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = "nobody-here@example.test" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = ownerProfile })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = "not-an-email" })).StatusCode);

        var (_, helperAuth) = await _f.SignupAsync("Member");
        var first = await (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email })).ReadAsync<TeamHelperDto>();
        var again = await (await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email })).ReadAsync<TeamHelperDto>();
        Assert.Equal(first.AddedAt, again.AddedAt);
        Assert.Single((await owner.GetFromJsonAsync<CompetitionTeamDto>(Team(arena.CompetitionId)))!.Helpers);
    }

    [Fact]
    public async Task SessionsRefuseTeamsFromAnotherCompetition()
    {
        var (arena, _, _, owner, _) = await OwnedAsync();
        var other = await OwnedAsync();
        var url = $"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}";

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"{url}/heats", new { label = "Stolen", orderIndex = 5, teamIds = other.Arena.TeamIds, raceNames = new[] { "R" } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync($"{url}/heat-assignments", new { assignments = new[] { new { label = "Heat 1", teamIds = other.Arena.TeamIds } } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"{url}/generate-heats", new { teamIds = other.Arena.TeamIds, raceNames = new[] { "R" } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"{url}/generate-race-finals", new { teamIds = other.Arena.TeamIds, raceNames = new[] { "R" } })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync($"{url}/heats", new { label = "Own teams", orderIndex = 6, teamIds = arena.TeamIds, raceNames = new[] { "R" } })).StatusCode);
    }

    [Fact]
    public async Task CompetitionAdmins_SeeEntrants_AndUseTheEventTools()
    {
        var (arena, _, _, owner, _) = await OwnedAsync();
        var (helper, helperAuth) = await _f.SignupAsync("Member");
        var (outsider, _) = await _f.SignupAsync("Member");
        await owner.PostAsJsonAsync(Team(arena.CompetitionId), new { email = helperAuth.User.Email });
        var tools = $"/api/event-tools/competitions/{arena.CompetitionId}";

        Assert.Equal(HttpStatusCode.OK, (await helper.GetAsync($"/api/competitions/{arena.CompetitionId}/signups")).StatusCode);
        // Past the access check: the CSV itself may still be refused.
        var preview = (await helper.PostAsJsonAsync($"{tools}/team-import/preview", new { csv = "Club,Suffix\n" })).StatusCode;
        Assert.DoesNotContain(preview, new[] { HttpStatusCode.NotFound, HttpStatusCode.Forbidden });
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.PostAsJsonAsync($"{tools}/team-import/preview", new { csv = "Club,Suffix\n" })).StatusCode);
        // Duplicating makes a new competition the caller owns, so it still needs a trainer account.
        Assert.Equal(HttpStatusCode.Forbidden, (await helper.PostAsJsonAsync($"{tools}/clone", new { name = "Copy", startDate = DateTime.UtcNow.AddDays(30) })).StatusCode);
    }
}
