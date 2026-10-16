using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sessions;

public class SessionsGenerationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public SessionsGenerationTests(ApiFactory f) => _f = f;

    private static string Url(Arena a, string suffix) => $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}{suffix}";

    // ---- generate-heats ----

    [Fact]
    public async Task GenerateHeats_SplitsTeamsIntoBalancedGroups_WithRacesPerHeat()
    {
        var a = await _f.CreateArenaAsync(7);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync(Url(a, "/generate-heats"),
            new GenerateHeatsRequest(a.TeamIds, new[] { " Bending ", "Sack", " " }, 3, false));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal(3, s.LanesPerHeat);
        Assert.Equal(new[] { "Heat 1", "Heat 2", "Heat 3" }, s.Heats.Select(h => h.Label));
        Assert.Equal(new[] { 3, 2, 2 }, s.Heats.Select(h => h.Entries.Count));
        Assert.Equal(a.TeamIds.OrderBy(x => x), s.Heats.SelectMany(h => h.Entries).Select(e => e.TeamId).OrderBy(x => x));
        Assert.All(s.Heats, h => Assert.Equal(new[] { "Bending", "Sack" }, h.Races.Select(x => x.Name)));
        Assert.All(s.Heats, h => Assert.Equal(Enumerable.Range(1, h.Entries.Count), h.Entries.Select(e => e.LaneIndex)));
    }

    [Fact]
    public async Task GenerateHeats_PutsEveryoneInOneHeat_WhenLanesNotSpecified()
    {
        var a = await _f.CreateArenaAsync(5);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-heats"),
            new GenerateHeatsRequest(a.TeamIds, new[] { "Race" }, null, false))).ReadAsync<SessionDto>();

        Assert.Single(s.Heats);
        Assert.Equal(5, s.Heats[0].Entries.Count);
        Assert.Equal(5, s.LanesPerHeat);
    }

    [Fact]
    public async Task GenerateHeats_TreatsZeroLanesAsOneHeatOfEveryone()
    {
        var a = await _f.CreateArenaAsync(4);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-heats"),
            new GenerateHeatsRequest(a.TeamIds, new[] { "Race" }, 0, false))).ReadAsync<SessionDto>();

        Assert.Single(s.Heats);
        Assert.Equal(4, s.LanesPerHeat);
    }

    [Fact]
    public async Task GenerateHeats_FallsBackToSessionLanes_WhenRequestOmitsThem()
    {
        var a = await _f.CreateArenaAsync(4);
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync(Url(a, "/lanes"), new UpdateSessionLanesRequest(2));

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-heats"),
            new GenerateHeatsRequest(a.TeamIds, new[] { "Race" }, null, false))).ReadAsync<SessionDto>();

        Assert.Equal(2, s.Heats.Count);
        Assert.All(s.Heats, h => Assert.Equal(2, h.Entries.Count));
    }

    [Fact]
    public async Task GenerateHeats_ReplaceExisting_DiscardsOldHeatsAndRestartsNumbering()
    {
        var a = await _f.CreateArenaAsync(4);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Old", 1);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-heats"),
            new GenerateHeatsRequest(a.TeamIds, new[] { "Race" }, 4, true))).ReadAsync<SessionDto>();

        var heat = Assert.Single(s.Heats);
        Assert.Equal("Heat 1", heat.Label);
    }

    [Fact]
    public async Task GenerateHeats_AppendsAfterExistingHeats_WhenNotReplacing()
    {
        var a = await _f.CreateArenaAsync(4);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Old", 1);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-heats"),
            new GenerateHeatsRequest(a.TeamIds, new[] { "Race" }, 4, false))).ReadAsync<SessionDto>();

        Assert.Equal(new[] { "Old", "Heat 2" }, s.Heats.Select(h => h.Label));
    }

    [Fact]
    public async Task GenerateHeats_Returns400_WhenNoTeams()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync(Url(a, "/generate-heats"), new GenerateHeatsRequest(Array.Empty<int>(), new[] { "Race" }, null, false));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task GenerateHeats_Returns400_WhenOnlyBlankRaceNames()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync(Url(a, "/generate-heats"), new GenerateHeatsRequest(a.TeamIds, new[] { " ", "" }, null, false));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task GenerateHeats_Returns404_WhenSessionMissing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/sessions/999999/generate-heats",
            new GenerateHeatsRequest(a.TeamIds, new[] { "Race" }, null, false));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- generate-race-finals ----

    [Fact]
    public async Task GenerateRaceFinals_CreatesQ1Q2AndEmptyFinalPerRace()
    {
        var a = await _f.CreateArenaAsync(5, raceFinals: true);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"),
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Bending", " Sack " }, null, true));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal(3, s.LanesPerHeat); // ceil(5 / 2)
        Assert.Equal(new[]
        {
            "Bending · Q1", "Bending · Q2", "Bending · Final",
            "Sack · Q1", "Sack · Q2", "Sack · Final",
        }, s.Heats.Select(h => h.Label));
        Assert.Equal(new[] { 1, 1, 1, 2, 2, 2 }, s.Heats.Select(h => h.RaceRoundId!.Value));
        Assert.Equal(new[]
        {
            RaceRoundStage.Qualifier, RaceRoundStage.Qualifier, RaceRoundStage.Final,
            RaceRoundStage.Qualifier, RaceRoundStage.Qualifier, RaceRoundStage.Final,
        }, s.Heats.Select(h => h.RaceRoundStage));
        Assert.Equal(new[] { 3, 2, 0, 3, 2, 0 }, s.Heats.Select(h => h.Entries.Count));
        var q1 = s.Heats[0].Entries.Select(e => e.TeamId).Concat(s.Heats[1].Entries.Select(e => e.TeamId));
        Assert.Equal(a.TeamIds.OrderBy(x => x), q1.OrderBy(x => x));
        Assert.All(s.Heats, h => Assert.Equal(1, h.Races.Single().OrderIndex));
    }

    [Fact]
    public async Task GenerateRaceFinals_UsesRequestLanes_OverSessionLanes()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync(Url(a, "/lanes"), new UpdateSessionLanesRequest(9));

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"),
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Race" }, 4, true))).ReadAsync<SessionDto>();

        Assert.Equal(4, s.LanesPerHeat);
    }

    [Fact]
    public async Task GenerateRaceFinals_UsesSessionLanes_WhenRequestOmitsThem()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync(Url(a, "/lanes"), new UpdateSessionLanesRequest(9));

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"),
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Race" }, null, true))).ReadAsync<SessionDto>();

        Assert.Equal(9, s.LanesPerHeat);
    }

    [Fact]
    public async Task GenerateRaceFinals_ZeroLanes_FallsBackToTeamCount()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"),
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Race" }, 0, true))).ReadAsync<SessionDto>();

        Assert.Equal(4, s.LanesPerHeat);
    }

    [Fact]
    public async Task GenerateRaceFinals_SingleTeam_PutsItInQ1Only()
    {
        var a = await _f.CreateArenaAsync(1, raceFinals: true);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"),
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Race" }, null, true))).ReadAsync<SessionDto>();

        Assert.Equal(1, s.LanesPerHeat);
        Assert.Equal(new[] { 1, 0, 0 }, s.Heats.Select(h => h.Entries.Count));
    }

    [Fact]
    public async Task GenerateRaceFinals_AppendingToSessionWithNoHeats_StartsAtRoundOne()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"),
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Race" }, null, false));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal(3, s.Heats.Count);
        Assert.All(s.Heats, h => Assert.Equal(1, h.RaceRoundId));
    }

    [Fact]
    public async Task GenerateRaceFinals_ReplaceExisting_DropsOldHeatsAndRestartsRoundNumbers()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Old", 1, stage: RaceRoundStage.Qualifier, roundId: 7);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"),
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Race" }, null, true))).ReadAsync<SessionDto>();

        Assert.Equal(3, s.Heats.Count);
        Assert.DoesNotContain(s.Heats, h => h.Label == "Old");
        Assert.All(s.Heats, h => Assert.Equal(1, h.RaceRoundId));
        Assert.Equal(new[] { 1, 2, 3 }, s.Heats.Select(h => h.OrderIndex));
    }

    [Fact]
    public async Task GenerateRaceFinals_Append_ContinuesOrderAndRoundNumbers()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Existing", 1, stage: RaceRoundStage.Qualifier, roundId: 7);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"),
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Race" }, null, false))).ReadAsync<SessionDto>();

        Assert.Equal(4, s.Heats.Count);
        Assert.Equal("Existing", s.Heats[0].Label);
        Assert.Equal(new[] { 2, 3, 4 }, s.Heats.Skip(1).Select(h => h.OrderIndex));
        Assert.All(s.Heats.Skip(1), h => Assert.Equal(8, h.RaceRoundId));
    }

    [Fact]
    public async Task GenerateRaceFinals_Returns400_WhenNoTeams()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"), new GenerateRaceFinalsRequest(Array.Empty<int>(), new[] { "Race" }, null, true));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task GenerateRaceFinals_Returns400_WhenNoRaceNames()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"), new GenerateRaceFinalsRequest(a.TeamIds, new[] { "  " }, null, true));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task GenerateRaceFinals_Returns404_WhenSessionMissing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/sessions/999999/generate-race-finals",
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Race" }, null, true));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }
}
