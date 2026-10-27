using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;
using Xunit;

namespace MountedGames.Api.Tests.Competitions;

/// <summary>Finals boundary ties: the age group's tie-break rule, the organiser's order, and where both apply.</summary>
public class TieBreakTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public TieBreakTests(ApiFactory f) => _f = f;

    private async Task<(int Comp, int Section, int[] Teams)> CompAsync(int teamCount, TieBreakRule rule = TieBreakRule.Countback)
    {
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        await _f.WithDbAsync(db => db.CompetitionSections.Where(s => s.Id == section)
            .ExecuteUpdateAsync(set => set.SetProperty(s => s.TieBreakRule, rule).SetProperty(s => s.RunoffRaceName, "2 Flag")));
        var club = await _f.SeedClubAsync();
        var teams = new List<int>();
        for (var i = 0; i < teamCount; i++) teams.Add(await _f.SeedTeamAsync(comp, section, club, $"T{i}"));
        return (comp, section, teams.ToArray());
    }

    /// <summary>One session at <paramref name="order"/> with one heat and one race, scored as given.</summary>
    private Task RaceAsync(int comp, int section, int order, params (int Team, int? Place, int Points)[] results)
        => _f.WithDbAsync(async db =>
        {
            var session = new Session { CompetitionId = comp, CompetitionSectionId = section, Name = $"S{order}", OrderIndex = order };
            var heat = new Heat { Session = session, Label = "Heat 1", OrderIndex = 1 };
            var race = new Race { Heat = heat, Name = $"R{order}", OrderIndex = 1, IsComplete = true };
            db.Races.Add(race);
            foreach (var (team, place, points) in results)
                db.Results.Add(new Result { Race = race, TeamId = team, Placing = place, Eliminated = place is null, Points = points });
            await db.SaveChangesAsync();
        });

    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return await r.ReadAsync<JsonElement>();
    }

    private static JsonElement OnlyBoundary(JsonElement body) => Assert.Single(body.GetProperty("boundaries").EnumerateArray());

    // ---- the rule at the cut ----

    [Fact]
    public async Task Countback_SettlesATieOnPoints_ByFirstPlacesThenSeconds()
    {
        var (comp, section, t) = await CompAsync(3);
        // T0 and T1 both end on 8 points. Each has one win; T1 has a 2nd as well, so T1 goes through.
        await RaceAsync(comp, section, 1, (t[0], 1, 4), (t[1], 2, 3), (t[2], 3, 2));
        await RaceAsync(comp, section, 2, (t[1], 1, 4), (t[0], 3, 2), (t[2], 2, 3));
        await RaceAsync(comp, section, 3, (t[0], 4, 2), (t[1], null, 1), (t[2], 4, 0));
        var admin = await _f.AdminAsync();

        var body = await Json(await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=1&sectionId={section}"));

        var cut = OnlyBoundary(body);
        Assert.False(body.GetProperty("unsettled").GetBoolean());
        Assert.Equal((int)TieBreakRule.Countback, cut.GetProperty("rule").GetInt32());
        Assert.Equal((int)TieSettlement.Rule, cut.GetProperty("settledBy").GetInt32());
        var teams = cut.GetProperty("teams").EnumerateArray().ToList();
        Assert.Equal(t[1], teams[0].GetProperty("id").GetInt32());
        Assert.True(teams[0].GetProperty("goesThrough").GetBoolean());
        Assert.Equal(2, teams[1].GetProperty("position").GetInt32());
        Assert.False(teams[1].GetProperty("goesThrough").GetBoolean());
    }

    [Fact]
    public async Task Countback_LeavesTheTieOpen_WhenThePlacingsMatchToo()
    {
        var (comp, section, t) = await CompAsync(3);
        await RaceAsync(comp, section, 1, (t[0], 1, 3), (t[1], 2, 2), (t[2], 3, 1));
        await RaceAsync(comp, section, 2, (t[1], 1, 3), (t[0], 2, 2), (t[2], 3, 1));
        var admin = await _f.AdminAsync();

        var body = await Json(await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=1&sectionId={section}"));

        Assert.True(body.GetProperty("unsettled").GetBoolean());
        Assert.Equal((int)TieSettlement.Open, OnlyBoundary(body).GetProperty("settledBy").GetInt32());
    }

    [Fact]
    public async Task LastRace_PutsTheBetterMostRecentResultThrough()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.LastRace);
        // Level on 5. T0 won earlier, but T1 beat it in the later race.
        await RaceAsync(comp, section, 1, (t[0], 1, 3), (t[1], 3, 1), (t[2], 2, 2));
        await RaceAsync(comp, section, 2, (t[1], 1, 4), (t[0], 2, 2), (t[2], 3, 1));
        var admin = await _f.AdminAsync();

        var body = await Json(await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=1&sectionId={section}"));

        var cut = OnlyBoundary(body);
        Assert.Equal((int)TieSettlement.Rule, cut.GetProperty("settledBy").GetInt32());
        Assert.Equal(t[1], cut.GetProperty("teams")[0].GetProperty("id").GetInt32());
    }

    [Theory]
    [InlineData(TieBreakRule.RunOff)]
    [InlineData(TieBreakRule.Manual)]
    public async Task RunOffAndManual_WaitForTheOrganiser_AndNameTheRunOffRace(TieBreakRule rule)
    {
        var (comp, section, t) = await CompAsync(3, rule);
        // A clear countback (T0 has the win) still doesn't settle it: the rule says run it off or choose.
        await RaceAsync(comp, section, 1, (t[0], 1, 5), (t[1], 2, 5), (t[2], 3, 1));
        var admin = await _f.AdminAsync();

        var body = await Json(await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=1&sectionId={section}"));

        Assert.True(body.GetProperty("unsettled").GetBoolean());
        Assert.Equal("2 Flag", body.GetProperty("runoffRaceName").GetString());
        Assert.Equal((int)rule, OnlyBoundary(body).GetProperty("rule").GetInt32());
        Assert.False(OnlyBoundary(body).GetProperty("settled").GetBoolean());
    }

    // ---- the organiser's order ----

    [Fact]
    public async Task TieOrder_SettlesTheCut_SeedsTheFinal_AndOrdersTheStandings()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.RunOff);
        await RaceAsync(comp, section, 1, (t[0], 1, 5), (t[1], 2, 5), (t[2], 3, 1));
        var admin = await _f.AdminAsync();

        // T1 won the run-off.
        var put = await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[1], t[0] } });
        Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);

        var body = await Json(await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=1&sectionId={section}"));
        Assert.False(body.GetProperty("unsettled").GetBoolean());
        Assert.Equal((int)TieSettlement.Organiser, OnlyBoundary(body).GetProperty("settledBy").GetInt32());
        Assert.Equal(t[1], OnlyBoundary(body).GetProperty("teams")[0].GetProperty("id").GetInt32());

        var standings = await Json(await admin.GetAsync($"/api/competitions/{comp}/standings?sectionId={section}"));
        Assert.Equal(new[] { t[1], t[0], t[2] }, standings.EnumerateArray().Select(r => r.GetProperty("teamId").GetInt32()));

        var finals = await Json(await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals",
            new { competitionSectionId = section, topN = 1, raceNames = new[] { "Flag" }, lanesPerHeat = 1 }));
        var entries = finals.GetProperty("heats")[0].GetProperty("entries");
        Assert.Equal(t[1], Assert.Single(entries.EnumerateArray()).GetProperty("teamId").GetInt32());
    }

    [Fact]
    public async Task TieOrder_LapsesWhenATeamsPointsChange()
    {
        var (comp, section, t) = await CompAsync(4, TieBreakRule.Manual);
        await RaceAsync(comp, section, 1, (t[0], 1, 5), (t[1], 2, 5), (t[2], 3, 1), (t[3], 4, 0));
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[1], t[0] } })).StatusCode);

        // Both gain 2 points later. They're level again, on 7 now, and the old order was for 5.
        await RaceAsync(comp, section, 2, (t[0], 1, 2), (t[1], 1, 2), (t[2], 3, 0), (t[3], 4, 0));
        var body = await Json(await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=1&sectionId={section}"));

        Assert.True(body.GetProperty("unsettled").GetBoolean());
    }

    [Fact]
    public async Task ClearingTheTieOrder_HandsTheTieBackToTheRule()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.Manual);
        await RaceAsync(comp, section, 1, (t[0], 1, 5), (t[1], 2, 5), (t[2], 3, 1));
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[1], t[0] } });

        var cleared = await admin.DeleteAsync($"/api/competitions/{comp}/finals/tie-order?teamIds={t[0]}&teamIds={t[1]}");

        Assert.Equal(HttpStatusCode.NoContent, cleared.StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.FinalsTieOrders.Where(o => o.CompetitionId == comp).ToListAsync()));
    }

    [Fact]
    public async Task TieOrder_ReplacesAnEarlierOrderForTheSameTeams()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.Manual);
        await RaceAsync(comp, section, 1, (t[0], 1, 5), (t[1], 2, 5), (t[2], 3, 1));
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[1], t[0] } });
        await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[0], t[1] } });

        var orders = await _f.WithDbAsync(db => db.FinalsTieOrders.Where(o => o.CompetitionId == comp).OrderBy(o => o.Position).ToListAsync());

        Assert.Equal(new[] { t[0], t[1] }, orders.Select(o => o.TeamId));
        Assert.All(orders, o => Assert.Equal(5, o.Points));
    }

    [Fact]
    public async Task TieOrder_Refuses_TeamsThatAreNotTheWholeTie()
    {
        var (comp, section, t) = await CompAsync(4, TieBreakRule.Manual);
        await RaceAsync(comp, section, 1, (t[0], 1, 5), (t[1], 2, 5), (t[2], 3, 5), (t[3], 4, 1));
        var admin = await _f.AdminAsync();

        var partial = await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[1], t[0] } });
        var notLevel = await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[0], t[3] } });

        Assert.Equal(HttpStatusCode.Conflict, partial.StatusCode);
        var body = await partial.ReadAsync<JsonElement>();
        Assert.Equal(3, body.GetProperty("teamIds").GetArrayLength());
        Assert.Equal(HttpStatusCode.Conflict, notLevel.StatusCode);
    }

    [Fact]
    public async Task TieOrder_Refuses_BadTeamLists()
    {
        var (comp, section, t) = await CompAsync(2, TieBreakRule.Manual);
        var (otherComp, _, other) = await CompAsync(1);
        var otherSection = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        var elsewhere = await _f.SeedTeamAsync(comp, otherSection, club, "Elsewhere");
        var hc = await _f.SeedTeamAsync(comp, section, club, "HC", horsConcours: true);
        var admin = await _f.AdminAsync();
        async Task<HttpStatusCode> Put(params int[] ids)
            => (await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = ids })).StatusCode;

        Assert.Equal(HttpStatusCode.BadRequest, await Put(t[0]));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(t[0], t[0]));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(t[0], other[0]));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(t[0], hc));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(t[0], elsewhere));
        Assert.NotEqual(comp, otherComp);
    }

    [Fact]
    public async Task TieOrder_IsForStaffOnly()
    {
        var (comp, _, t) = await CompAsync(2);
        var anonymous = await _f.CreateClient().PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = t });
        var trainer = await (await _f.TrainerAsync()).PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = t });
        var clear = await _f.CreateClient().DeleteAsync($"/api/competitions/{comp}/finals/tie-order?teamIds={t[0]}");

        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, trainer.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, clear.StatusCode);
    }

    // ---- tack check bonus ----

    private Task BonusAsync(int comp, int section, int team, int points)
        => _f.WithDbAsync(async db =>
        {
            var tack = new TackCheckSection { CompetitionId = comp, CompetitionSectionId = section, IsEnabled = true, Mode = TackCheckMode.BonusPoints };
            var sector = new TackCheckSector { TackCheckSection = tack, Name = "Turnout" };
            db.Add(new TackCheckMark { Sector = sector, TeamId = team, Points = points });
            await db.SaveChangesAsync();
        });

    [Fact]
    public async Task TackBonus_CountsForFinalsSeeding_AndForWhoIsLevel()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.Manual);
        await RaceAsync(comp, section, 1, (t[0], 1, 5), (t[1], 2, 4), (t[2], 3, 1));
        // T1's 2 bonus points take it to 6 against T0's 5, so it leads outright.
        await BonusAsync(comp, section, t[1], 2);
        var admin = await _f.AdminAsync();

        var clean = await Json(await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=1&sectionId={section}"));
        var finals = await Json(await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals",
            new { competitionSectionId = section, topN = 1, raceNames = new[] { "Flag" }, lanesPerHeat = 1 }));
        // Ordering T0 and T1 as a tie is refused: with the bonus they aren't level.
        var notLevel = await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[0], t[1] } });

        Assert.False(clean.GetProperty("tied").GetBoolean());
        Assert.Equal(t[1], Assert.Single(finals.GetProperty("heats")[0].GetProperty("entries").EnumerateArray()).GetProperty("teamId").GetInt32());
        Assert.Equal(HttpStatusCode.Conflict, notLevel.StatusCode);
    }

    [Fact]
    public async Task TackBonus_CanMakeATie_ThatTheOrganiserThenOrders()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.Manual);
        await RaceAsync(comp, section, 1, (t[0], 1, 5), (t[1], 2, 3), (t[2], 3, 1));
        await BonusAsync(comp, section, t[1], 2);
        var admin = await _f.AdminAsync();

        var tied = await Json(await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=1&sectionId={section}"));
        var put = await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[1], t[0] } });

        Assert.Equal(5, OnlyBoundary(tied).GetProperty("totalAtCutoff").GetInt32());
        Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);
        var standings = await Json(await admin.GetAsync($"/api/competitions/{comp}/standings?sectionId={section}"));
        Assert.Equal(new[] { t[1], t[0], t[2] }, standings.EnumerateArray().Select(r => r.GetProperty("teamId").GetInt32()));
    }

    // ---- the section setting ----

    [Fact]
    public async Task SectionRule_IsSetOnCreate_ChangedOnUpdate_AndKeptWhenOmitted()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();

        var created = await Json(await admin.PostAsJsonAsync($"/api/competitions/{comp}/sections",
            new { format = (int)SectionFormat.Teams, ageGroup = "Open", displayName = "Open", tieBreakRule = (int)TieBreakRule.RunOff }));
        var id = created.GetProperty("id").GetInt32();
        Assert.Equal((int)TieBreakRule.RunOff, created.GetProperty("tieBreakRule").GetInt32());

        var changed = await Json(await admin.PutAsJsonAsync($"/api/competitions/{comp}/sections/{id}", new { runoffRaceName = "2 Flag", tieBreakRule = (int)TieBreakRule.LastRace }));
        var kept = await Json(await admin.PutAsJsonAsync($"/api/competitions/{comp}/sections/{id}", new { runoffRaceName = "2 Flag" }));
        var bad = await admin.PutAsJsonAsync($"/api/competitions/{comp}/sections/{id}", new { runoffRaceName = "2 Flag", tieBreakRule = 42 });

        Assert.Equal((int)TieBreakRule.LastRace, changed.GetProperty("tieBreakRule").GetInt32());
        Assert.Equal((int)TieBreakRule.LastRace, kept.GetProperty("tieBreakRule").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task Standings_UseTheRule_ForTeamsLevelOnPoints()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.LastRace);
        await RaceAsync(comp, section, 1, (t[0], 1, 3), (t[1], 3, 1), (t[2], 2, 2));
        await RaceAsync(comp, section, 2, (t[1], 1, 4), (t[0], 2, 2), (t[2], 3, 1));
        var admin = await _f.AdminAsync();

        var standings = await Json(await admin.GetAsync($"/api/competitions/{comp}/standings?sectionId={section}"));

        Assert.Equal(new[] { t[1], t[0], t[2] }, standings.EnumerateArray().Select(r => r.GetProperty("teamId").GetInt32()));
        Assert.Contains("Ahead on Last Race", standings[0].GetProperty("tieBreakReason").GetString());
        // A null reason is left out of the JSON (WhenWritingNull), so absent and null both mean "no reason".
        Assert.False(standings[1].TryGetProperty("tieBreakReason", out var reason) && reason.ValueKind != JsonValueKind.Null);
    }

    [Fact]
    public async Task Standings_PopulatePlainEnglishTieBreakReasons_ForCountbackRunOffAndOpenTies()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.Countback);
        // T0 has 2 wins (4+4+0=8) and T1 has 1 win (4+2+2=8).
        await RaceAsync(comp, section, 1, (t[0], 1, 4), (t[1], 1, 4), (t[2], 3, 1));
        await RaceAsync(comp, section, 2, (t[0], 1, 4), (t[1], 2, 2), (t[2], 3, 1));
        await RaceAsync(comp, section, 3, (t[0], 4, 0), (t[1], 2, 2), (t[2], 3, 1));
        var admin = await _f.AdminAsync();

        var standings = await Json(await admin.GetAsync($"/api/competitions/{comp}/standings?sectionId={section}"));
        Assert.Contains("on Countback (2× 1st places vs 1× 1st place)", standings[0].GetProperty("tieBreakReason").GetString());

        // When organiser sets a manual tie order, reason reflects organiser/run-off settlement
        await admin.PutAsJsonAsync($"/api/competitions/{comp}/finals/tie-order", new { teamIds = new[] { t[1], t[0] } });
        var orderedStandings = await Json(await admin.GetAsync($"/api/competitions/{comp}/standings?sectionId={section}"));
        Assert.Equal("Settled by run-off / referee order", orderedStandings[0].GetProperty("tieBreakReason").GetString());
    }
}

/// <summary>The tie-break rules on their own, without a database.</summary>
public class TieBreakerUnitTests
{
    private static TieBreaker Breaker(TieBreakRule rule = TieBreakRule.Countback, params FinalsTieOrder[] orders)
        => new(new Dictionary<int, TieBreakRule> { [1] = rule, [2] = TieBreakRule.Manual },
            orders.ToDictionary(o => o.TeamId),
            new Dictionary<int, (int, int, int)> { [10] = (1, 1, 1), [11] = (2, 1, 1), [12] = (2, 2, 1) });

    private static Result R(int race, int? place, int points, bool eliminated = false)
        => new() { RaceId = race, Placing = place, Points = points, Eliminated = eliminated };

    [Fact]
    public void Facts_CountFinishedPlacesOnly_AndListPointsNewestFirst()
    {
        var facts = Breaker().Facts(7, 1, [R(10, 1, 4), R(12, 2, 3), R(11, 1, 0, eliminated: true), R(99, 3, 1)]);

        Assert.Equal(new[] { 1, 1, 1 }, facts.PlacingCounts);
        Assert.Equal(1, facts.Wins);
        Assert.Equal(new[] { 3.0, 0, 4, 1 }, facts.RecentPoints);
        Assert.Equal(8, facts.Total);
        Assert.Equal(20, Breaker().Facts(7, 1, [R(10, 1, 4)], total: 20).Total);
    }

    [Fact]
    public void ATeamWithNoResults_HasNoWins()
        => Assert.Equal(0, Breaker().Facts(7, 1, []).Wins);

    [Fact]
    public void Rank_PutsHigherTotalsFirst_ThenTheTieBreak()
    {
        var breaker = Breaker();
        var a = new TieFacts(1, 1, 5, [0, 2], []);
        var b = new TieFacts(2, 1, 5, [1], []);
        var c = new TieFacts(3, 1, 9, [], []);

        Assert.Equal(new[] { 3, 2, 1 }, breaker.Rank([a, b, c]).Select(f => f.TeamId));
    }

    [Fact]
    public void AStillLevelCountback_FallsBackToTeamId_AndIsOpen()
    {
        var breaker = Breaker();
        var a = new TieFacts(5, 1, 5, [1], []);
        var b = new TieFacts(4, 1, 5, [1, 0], []);

        var order = breaker.OrderLevel([a, b]);

        Assert.Equal(new[] { 4, 5 }, order.Select(f => f.TeamId));
        Assert.Equal(TieSettlement.Open, breaker.Settle(order, order[0], order[1]));
    }

    [Fact]
    public void LastRace_ComparesOnlyTheRacesBothRan()
    {
        var breaker = Breaker(TieBreakRule.LastRace);
        var a = new TieFacts(1, 1, 5, [], [3, 2]);
        var b = new TieFacts(2, 1, 5, [], [3]);

        Assert.Equal(TieSettlement.Open, breaker.Settle([a, b], a, b));
    }

    [Fact]
    public void TeamsFromDifferentAgeGroups_UseCountback()
    {
        var breaker = Breaker(TieBreakRule.RunOff);
        var a = new TieFacts(1, 1, 5, [0], []);
        var b = new TieFacts(2, 2, 5, [1], []);

        Assert.Equal(TieBreakRule.Countback, breaker.RuleOf([a, b]));
        Assert.Equal(TieSettlement.Rule, breaker.Settle([b, a], b, a));
        Assert.Equal(TieBreakRule.Countback, breaker.RuleFor(null));
        Assert.Equal(TieBreakRule.Countback, breaker.RuleFor(404));
    }

    [Fact]
    public void AnOrganiserOrder_CountsOnlyForTheWholeTie_AtItsTotal()
    {
        var breaker = Breaker(TieBreakRule.Manual,
            new FinalsTieOrder { TeamId = 1, Points = 5, Position = 2 },
            new FinalsTieOrder { TeamId = 2, Points = 5, Position = 1 },
            new FinalsTieOrder { TeamId = 3, Points = 4, Position = 1 });
        var a = new TieFacts(1, 1, 5, [], []);
        var b = new TieFacts(2, 1, 5, [], []);
        var c = new TieFacts(3, 1, 5, [], []);

        Assert.Equal(new[] { 2, 1 }, breaker.OrderLevel([a, b]).Select(f => f.TeamId));
        Assert.True(breaker.OrganiserOrdered([a, b]));
        Assert.Equal(TieSettlement.Organiser, breaker.Settle([b, a], b, a));
        // Team 3's order was for 4 points, so the three-way tie on 5 isn't ordered.
        Assert.False(breaker.OrganiserOrdered([a, b, c]));
        Assert.Equal(TieSettlement.Open, breaker.Settle([a, b, c], a, b));
        Assert.Single(breaker.OrderLevel([a]));
    }

    [Fact]
    public void Countback_ScopesToFinalHeatResultsFirst_BeforeFallingBackToQualifiers()
    {
        var breaker = new TieBreaker(
            new Dictionary<int, TieBreakRule> { [1] = TieBreakRule.Countback },
            new Dictionary<int, FinalsTieOrder>(),
            new Dictionary<int, (int, int, int)> { [10] = (1, 1, 1), [11] = (1, 2, 1), [20] = (2, 1, 1) },
            new HashSet<int> { 20 });

        // Team 1 won two qualifier races (10, 11) and came 2nd in the A Final race (20).
        // Team 2 came 2nd in both qualifier races (10, 11) and won the A Final race (20).
        // Both total 10 points. Because both raced in the A Final, Team 2's A Final win ranks it above Team 1.
        var team1 = breaker.Facts(1, 1, [R(10, 1, 4), R(11, 1, 4), R(20, 2, 2)], total: 10);
        var team2 = breaker.Facts(2, 1, [R(10, 2, 3), R(11, 2, 3), R(20, 1, 4)], total: 10);

        var ranked = breaker.Rank([team1, team2]);
        Assert.Equal(new[] { 2, 1 }, ranked.Select(f => f.TeamId));
        Assert.Equal("Ahead on A-Final placing", breaker.Explain(ranked, ranked[0], ranked[1], "Belvoir A"));
    }

    [Fact]
    public void Explain_CoversCountbackLastRaceRunOffAndUnscoredCases()
    {
        var breaker = Breaker(TieBreakRule.Countback);
        var emptyA = new TieFacts(1, 1, 0, [], []);
        var emptyB = new TieFacts(2, 1, 0, [], []);
        Assert.Null(breaker.Explain([emptyA, emptyB], emptyA, emptyB));

        var countbackA = new TieFacts(1, 1, 64, [3, 1], [5, 4]);
        var countbackB = new TieFacts(2, 1, 64, [1, 3], [4, 5]);
        Assert.Equal(
            "Ahead of Belvoir A on Countback (3× 1st places vs 1× 1st place)",
            breaker.Explain([countbackA, countbackB], countbackA, countbackB, "Belvoir A"));

        var openA = new TieFacts(1, 1, 64, [2, 1], [5]);
        var openB = new TieFacts(2, 1, 64, [2, 1], [5]);
        Assert.Equal(
            "Level on points and countback — run-off if on cut-off",
            breaker.Explain([openA, openB], openA, openB, "Belvoir A"));

        var runoffBreaker = Breaker(TieBreakRule.RunOff);
        Assert.Equal(
            "Level on points and countback — run-off if on cut-off",
            runoffBreaker.Explain([countbackA, countbackB], countbackA, countbackB, "Belvoir A"));

        var lastRaceBreaker = Breaker(TieBreakRule.LastRace);
        var lrA = new TieFacts(1, 1, 64, [1], [4, 2], null, null, [("Flag", 2, 4, false), ("Mug", 4, 2, false)]);
        var lrB = new TieFacts(2, 1, 64, [2], [2, 4], null, null, [("Flag", 4, 2, false), ("Mug", 2, 4, false)]);
        Assert.Equal("Ahead on Last Race (2nd in Flag vs 4th)", lastRaceBreaker.Explain([lrA, lrB], lrA, lrB));

        var lrNoNamesA = new TieFacts(1, 1, 64, [], [5]);
        var lrNoNamesB = new TieFacts(2, 1, 64, [], [3]);
        Assert.Equal("Ahead on Last Race (5 pts vs 3 pts)", lastRaceBreaker.Explain([lrNoNamesA, lrNoNamesB], lrNoNamesA, lrNoNamesB));

        Assert.Equal("1st", TieBreaker.Ordinal(1));
        Assert.Equal("2nd", TieBreaker.Ordinal(2));
        Assert.Equal("3rd", TieBreaker.Ordinal(3));
        Assert.Equal("4th", TieBreaker.Ordinal(4));
        Assert.Equal("11th", TieBreaker.Ordinal(11));
        Assert.Equal("12th", TieBreaker.Ordinal(12));
        Assert.Equal("13th", TieBreaker.Ordinal(13));
        Assert.Equal("21st", TieBreaker.Ordinal(21));
    }
}
