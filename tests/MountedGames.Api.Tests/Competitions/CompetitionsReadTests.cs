using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

public class CompetitionsReadTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CompetitionsReadTests(ApiFactory f) => _f = f;

    // ---- geocode ----

    [Fact]
    public async Task Geocode_ReturnsCoordinates_ForPostcode()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", """{"result":{"latitude":52.1,"longitude":-1.2}}""");

        var r = await _f.CreateClient().GetAsync("/api/geocode?postcode=CV8%202LG");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.ReadAsync<GeocodeResult>();
        Assert.Equal(52.1, body.Latitude);
        Assert.Equal(-1.2, body.Longitude);
        Assert.Equal("postcode", body.Source);
    }

    [Fact]
    public async Task Geocode_ReturnsNulls_WhenNothingSupplied()
    {
        var r = await _f.CreateClient().GetAsync("/api/geocode");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.ReadAsync<GeocodeResult>();
        Assert.Null(body.Latitude);
        Assert.Null(body.Longitude);
        Assert.Null(body.Source);
    }

    // ---- picker ----

    [Theory]
    [InlineData("page=0")]
    [InlineData("page=10001")]
    [InlineData("pageSize=0")]
    [InlineData("pageSize=51")]
    public async Task Picker_Returns400_ForOutOfRangePaging(string query)
    {
        var r = await _f.CreateClient().GetAsync($"/api/competitions/picker?{query}");
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Picker_SplitsCurrentAndPastCompetitions()
    {
        var past = await _f.SeedCompetitionAsync($"Past {Guid.NewGuid():N}", start: DateTime.UtcNow.Date.AddDays(-10));
        var future = await _f.SeedCompetitionAsync($"Future {Guid.NewGuid():N}", start: DateTime.UtcNow.Date.AddDays(10));
        var client = _f.CreateClient();

        var current = await (await client.GetAsync("/api/competitions/picker?pageSize=50")).ReadAsync<CompetitionPickerPage>();
        var pastPage = await (await client.GetAsync("/api/competitions/picker?past=true&pageSize=50")).ReadAsync<CompetitionPickerPage>();

        Assert.Contains(current.Items, i => i.Id == future);
        Assert.DoesNotContain(current.Items, i => i.Id == past);
        Assert.Contains(pastPage.Items, i => i.Id == past);
        Assert.DoesNotContain(pastPage.Items, i => i.Id == future);
    }

    // ---- list ----

    [Fact]
    public async Task List_HidesArchivedByDefault_AndIncludesThemOnRequest()
    {
        var archived = await _f.SeedCompetitionAsync(archived: true);
        var active = await _f.SeedCompetitionAsync();
        var client = _f.CreateClient();

        var normal = await (await client.GetAsync("/api/competitions")).ReadAsync<List<CompetitionSummary>>();
        var all = await (await client.GetAsync("/api/competitions?includeArchived=true")).ReadAsync<List<CompetitionSummary>>();

        Assert.Contains(normal, c => c.Id == active);
        Assert.DoesNotContain(normal, c => c.Id == archived);
        Assert.Contains(all, c => c.Id == archived);
    }

    [Fact]
    public async Task List_ReportsSectionTeamAndSessionCounts()
    {
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        await _f.SeedTeamAsync(comp, section, club);
        await _f.SeedTeamAsync(comp, section, club);
        await _f.SeedScoredRaceAsync(comp, section, Array.Empty<(int, int?, bool, int)>());

        var list = await (await _f.CreateClient().GetAsync("/api/competitions")).ReadAsync<List<CompetitionSummary>>();

        var row = Assert.Single(list, c => c.Id == comp);
        Assert.Equal(1, row.SectionCount);
        Assert.Equal(2, row.TeamCount);
        Assert.Equal(1, row.SessionCount);
    }

    [Fact]
    public async Task List_OrdersNewestStartFirst()
    {
        var older = await _f.SeedCompetitionAsync(start: DateTime.UtcNow.Date.AddDays(400));
        var newer = await _f.SeedCompetitionAsync(start: DateTime.UtcNow.Date.AddDays(401));

        var list = await (await _f.CreateClient().GetAsync("/api/competitions")).ReadAsync<List<CompetitionSummary>>();

        Assert.True(list.FindIndex(c => c.Id == newer) < list.FindIndex(c => c.Id == older));
    }

    // ---- get ----

    [Fact]
    public async Task Get_Returns404_WhenCompetitionMissing()
    {
        var r = await _f.CreateClient().GetAsync("/api/competitions/999999");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Get_ReturnsDetailWithOrderedChildren()
    {
        var comp = await _f.SeedCompetitionAsync();
        await _f.SeedSectionAsync(comp, "B section");
        var secA = await _f.SeedSectionAsync(comp, "A section");
        var club = await _f.SeedClubAsync("Zeta Club");
        await _f.SeedTeamAsync(comp, secA, club, "Zeta B");
        await _f.SeedTeamAsync(comp, secA, club, "Zeta A");
        await _f.WithDbAsync(async db =>
        {
            db.Sessions.AddRange(
                new Session { CompetitionId = comp, Name = "Second", OrderIndex = 2 },
                new Session { CompetitionId = comp, Name = "First", OrderIndex = 1 });
            await db.SaveChangesAsync();
        });

        var r = await _f.CreateClient().GetAsync($"/api/competitions/{comp}");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var d = await r.ReadAsync<CompetitionDetail>();
        using var json = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        Assert.True(json.RootElement.GetProperty("staffChatEnabled").GetBoolean());
        Assert.Equal(comp, d.Id);
        Assert.Equal(new[] { "A section", "B section" }, d.Sections.Select(s => s.DisplayName));
        Assert.Equal(new[] { "Zeta A", "Zeta B" }, d.Teams.Select(t => t.DisplayName));
        Assert.All(d.Teams, t => Assert.Equal("Zeta Club", t.ClubName));
        Assert.Equal(new[] { "First", "Second" }, d.Sessions.Select(s => s.Name));
    }

    [Fact]
    public async Task Get_IncludesRaceResultsOrderedByPlacing_WithEliminatedLast()
    {
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        var first = await _f.SeedTeamAsync(comp, section, club, "Winners");
        var second = await _f.SeedTeamAsync(comp, section, club, "Runners-up");
        var out1 = await _f.SeedTeamAsync(comp, section, club, "Eliminated");
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[]
        {
            (out1, null, true, 0), (second, 2, false, 4), (first, 1, false, 5),
        });

        var d = await (await _f.CreateClient().GetAsync($"/api/competitions/{comp}")).ReadAsync<CompetitionDetail>();

        var race = d.Sessions.Single().Heats.Single().Races.Single();
        Assert.Equal(new[] { "Winners", "Runners-up", "Eliminated" }, race.Results.Select(x => x.TeamName));
        Assert.Equal(new[] { 5, 4, 0 }, race.Results.Select(x => x.Points));
        Assert.True(race.Results[2].Eliminated);
        Assert.Null(race.Results[2].Placing);
    }

    // ---- standings ----

    [Fact]
    public async Task Standings_RanksByPointsThenWins_AndExcludesHorsConcours()
    {
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync("Standings Club");
        var a = await _f.SeedTeamAsync(comp, section, club, "A team");
        var b = await _f.SeedTeamAsync(comp, section, club, "B team");
        var c = await _f.SeedTeamAsync(comp, section, club, "C team");
        var hc = await _f.SeedTeamAsync(comp, section, club, "HC team", horsConcours: true);
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[]
        {
            (a, 1, false, 5), (b, 2, false, 5), (c, null, true, 0), (hc, 3, false, 99),
        });

        var rows = await (await _f.CreateClient().GetAsync($"/api/competitions/{comp}/standings"))
            .ReadAsync<List<StandingRow>>();

        Assert.Equal(new[] { "A team", "B team", "C team" }, rows.Select(x => x.TeamName));
        Assert.Equal(1, rows[0].Wins);
        Assert.Equal(0, rows[1].Wins);
        Assert.Equal(1, rows[2].Eliminations);
        Assert.Equal(1, rows[0].RacesRun);
        Assert.Equal("Standings Club", rows[0].ClubName);
    }

    [Fact]
    public async Task Standings_FiltersBySection()
    {
        var comp = await _f.SeedCompetitionAsync();
        var s1 = await _f.SeedSectionAsync(comp);
        var s2 = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        await _f.SeedTeamAsync(comp, s1, club, "In section one");
        await _f.SeedTeamAsync(comp, s2, club, "In section two");

        var rows = await (await _f.CreateClient().GetAsync($"/api/competitions/{comp}/standings?sectionId={s2}"))
            .ReadAsync<List<StandingRow>>();

        Assert.Equal("In section two", Assert.Single(rows).TeamName);
    }

    [Fact]
    public async Task Standings_ReturnsEmptyList_ForUnknownCompetition()
    {
        var r = await _f.CreateClient().GetAsync("/api/competitions/999999/standings");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Empty(await r.ReadAsync<List<StandingRow>>());
    }
}
