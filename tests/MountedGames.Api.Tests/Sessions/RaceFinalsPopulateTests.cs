using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sessions;

public class RaceFinalsPopulateTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public RaceFinalsPopulateTests(ApiFactory f) => _f = f;

    private static string Url(Arena a, string suffix) => $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}{suffix}";

    /// <summary>Generates one race round (Q1, Q2, Final) for the arena's teams and returns its three heats.</summary>
    private async Task<(HttpClient Admin, HeatDto Q1, HeatDto Q2, HeatDto Final)> GenerateRoundAsync(Arena a, int? lanes = null)
    {
        var admin = await _f.AdminAsync();
        var s = await (await admin.PostAsJsonAsync(Url(a, "/generate-race-finals"),
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Race" }, lanes, true))).ReadAsync<SessionDto>();
        return (admin, s.Heats[0], s.Heats[1], s.Heats[2]);
    }

    private static async Task ScoreAsync(HttpClient admin, HeatDto heat, params (int TeamId, int Place, bool Elim)[] places)
    {
        var body = new SubmitRaceResultsRequest(places.Select(p => new FinishingPlaceDto(p.TeamId, p.Place, p.Elim)).ToList());
        var r = await admin.PostAsJsonAsync($"/api/races/{heat.Races[0].Id}/results", body);
        r.EnsureSuccessStatusCode();
    }

    private static int[] Teams(HeatDto h) => h.Entries.Select(e => e.TeamId).ToArray();

    [Fact]
    public async Task Populate_InterleavesTopQualifiers_FromBothHeats()
    {
        var a = await _f.CreateArenaAsync(6, raceFinals: true);
        var (admin, q1, q2, fin) = await GenerateRoundAsync(a); // 3 lanes
        var q1t = Teams(q1); var q2t = Teams(q2);
        await ScoreAsync(admin, q1, (q1t[2], 1, false), (q1t[0], 2, false), (q1t[1], 3, false));
        await ScoreAsync(admin, q2, (q2t[1], 1, false), (q2t[0], 2, false), (q2t[2], 3, false));

        var r = await admin.PostAsJsonAsync(Url(a, $"/heats/{fin.Id}/populate-race-final"), new PopulateRaceFinalRequest(2));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var heat = await r.ReadAsync<HeatDto>();
        // Session has 3 lanes: Q1[1], Q2[1], Q1[2] then the cap stops it.
        Assert.Equal(new[] { q1t[2], q2t[1], q1t[0] }, Teams(heat));
        Assert.Equal(new[] { 1, 2, 3 }, heat.Entries.Select(e => e.LaneIndex));
    }

    [Fact]
    public async Task Populate_ReplacesPreviousFinalEntries()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (admin, q1, q2, fin) = await GenerateRoundAsync(a);
        var q1t = Teams(q1); var q2t = Teams(q2);
        await ScoreAsync(admin, q1, (q1t[0], 1, false), (q1t[1], 2, false));
        await ScoreAsync(admin, q2, (q2t[0], 1, false), (q2t[1], 2, false));
        var url = Url(a, $"/heats/{fin.Id}/populate-race-final");
        await admin.PostAsJsonAsync(url, new PopulateRaceFinalRequest(1));

        var again = await (await admin.PostAsJsonAsync(url, new PopulateRaceFinalRequest(1))).ReadAsync<HeatDto>();

        Assert.Equal(new[] { q1t[0], q2t[0] }, Teams(again));
        Assert.Equal(2, await _f.WithDbAsync(db => db.HeatEntries.CountAsync(e => e.HeatId == fin.Id)));
    }

    [Fact]
    public async Task Populate_SkipsEliminatedTeams_AndUsesOnlyOneHeatWhenOtherUnscored()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (admin, q1, _, fin) = await GenerateRoundAsync(a);
        var q1t = Teams(q1);
        await ScoreAsync(admin, q1, (q1t[0], 1, true), (q1t[1], 2, false));

        var heat = await (await admin.PostAsJsonAsync(Url(a, $"/heats/{fin.Id}/populate-race-final"), new PopulateRaceFinalRequest(2))).ReadAsync<HeatDto>();

        Assert.Equal(new[] { q1t[1] }, Teams(heat));
    }

    [Fact]
    public async Task Populate_SkipsHorsConcoursTeams_SoTheNextFinisherTakesTheirPlace()
    {
        var a = await _f.CreateArenaAsync(6, raceFinals: true);
        var (admin, q1, q2, fin) = await GenerateRoundAsync(a);
        var q1t = Teams(q1); var q2t = Teams(q2);
        await ScoreAsync(admin, q1, (q1t[0], 1, false), (q1t[1], 2, false), (q1t[2], 3, false));
        await ScoreAsync(admin, q2, (q2t[0], 1, false), (q2t[1], 2, false), (q2t[2], 3, false));
        // The winner of the first qualifier is marked hors concours: it keeps its result but takes no final place.
        await _f.WithDbAsync(async db => { (await db.Teams.FindAsync(q1t[0]))!.IsHorsConcours = true; await db.SaveChangesAsync(); return 0; });

        var heat = await (await admin.PostAsJsonAsync(Url(a, $"/heats/{fin.Id}/populate-race-final"), new PopulateRaceFinalRequest(2))).ReadAsync<HeatDto>();

        // HC is skipped before the top two are taken, so Q1 sends its 2nd and 3rd. Session has 3 lanes.
        Assert.DoesNotContain(q1t[0], Teams(heat));
        Assert.Equal(new[] { q1t[1], q2t[0], q1t[2] }, Teams(heat));
    }

    [Fact]
    public async Task Populate_WithoutSessionLanes_UsesAllQualifiersThatFitTopN()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (admin, q1, q2, fin) = await GenerateRoundAsync(a);
        await _f.WithDbAsync(async db =>
        {
            (await db.Sessions.SingleAsync(s => s.Id == a.SessionId)).LanesPerHeat = null;
            await db.SaveChangesAsync();
        });
        var q1t = Teams(q1); var q2t = Teams(q2);
        await ScoreAsync(admin, q1, (q1t[0], 1, false), (q1t[1], 2, false));
        await ScoreAsync(admin, q2, (q2t[0], 1, false), (q2t[1], 2, false));

        var heat = await (await admin.PostAsJsonAsync(Url(a, $"/heats/{fin.Id}/populate-race-final"), new PopulateRaceFinalRequest(2))).ReadAsync<HeatDto>();

        Assert.Equal(new[] { q1t[0], q2t[0], q1t[1], q2t[1] }, Teams(heat));
    }

    private async Task SetQualifiersAsync(HttpClient admin, Arena a, int qualifiers)
        => (await admin.PutAsJsonAsync(Url(a, "/settings"), new UpdateSessionSettingsRequest(null, null, QualifiersPerHeat: qualifiers)))
            .EnsureSuccessStatusCode();

    [Fact]
    public async Task ScoringTheSecondQualifier_FillsTheFinalByItself_UsingTheSessionsQualifierCount()
    {
        var a = await _f.CreateArenaAsync(8, raceFinals: true);
        var (admin, q1, q2, fin) = await GenerateRoundAsync(a, lanes: 4);
        await SetQualifiersAsync(admin, a, 2);
        var q1t = Teams(q1); var q2t = Teams(q2);

        await ScoreAsync(admin, q1, (q1t[0], 1, false), (q1t[1], 2, false), (q1t[2], 3, false), (q1t[3], 4, false));
        Assert.Equal(0, await _f.WithDbAsync(db => db.HeatEntries.CountAsync(e => e.HeatId == fin.Id)));

        await ScoreAsync(admin, q2, (q2t[0], 1, false), (q2t[1], 2, false), (q2t[2], 3, false), (q2t[3], 4, false));

        var entries = await _f.WithDbAsync(db => db.HeatEntries.Where(e => e.HeatId == fin.Id).OrderBy(e => e.LaneIndex).Select(e => e.TeamId).ToListAsync());
        Assert.Equal(new[] { q1t[0], q2t[0], q1t[1], q2t[1] }, entries);
    }

    [Fact]
    public async Task TheFinalFillsItself_WithThreeQualifiersEachWhenNoCountWasSet()
    {
        var a = await _f.CreateArenaAsync(8, raceFinals: true);
        var (admin, q1, q2, fin) = await GenerateRoundAsync(a, lanes: 8);
        var q1t = Teams(q1); var q2t = Teams(q2);
        await ScoreAsync(admin, q1, (q1t[0], 1, false), (q1t[1], 2, false), (q1t[2], 3, false), (q1t[3], 4, false));
        await ScoreAsync(admin, q2, (q2t[0], 1, false), (q2t[1], 2, false), (q2t[2], 3, false), (q2t[3], 4, false));

        Assert.Equal(6, await _f.WithDbAsync(db => db.HeatEntries.CountAsync(e => e.HeatId == fin.Id)));
    }

    [Fact]
    public async Task ACorrectedQualifier_DoesNotRefillAFinalThatHasAlreadyBeenRaced()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (admin, q1, q2, fin) = await GenerateRoundAsync(a);
        await SetQualifiersAsync(admin, a, 1);
        var q1t = Teams(q1); var q2t = Teams(q2);
        await ScoreAsync(admin, q1, (q1t[0], 1, false), (q1t[1], 2, false));
        await ScoreAsync(admin, q2, (q2t[0], 1, false), (q2t[1], 2, false));
        var finalists = await _f.WithDbAsync(db => db.HeatEntries.Where(e => e.HeatId == fin.Id).OrderBy(e => e.LaneIndex).Select(e => e.TeamId).ToListAsync());
        var finalRace = (await _f.WithDbAsync(db => db.Races.Where(r => r.HeatId == fin.Id).Select(r => r.Id).SingleAsync()));
        (await admin.PostAsJsonAsync($"/api/races/{finalRace}/results", new SubmitRaceResultsRequest(
            [new FinishingPlaceDto(finalists[0], 1, false), new FinishingPlaceDto(finalists[1], 2, false)]))).EnsureSuccessStatusCode();

        // The scorer fixes Q1 afterwards: the raced final is left as it was.
        (await admin.PostAsJsonAsync($"/api/races/{q1.Races[0].Id}/results", new SubmitRaceResultsRequest(
            [new FinishingPlaceDto(q1t[1], 1, false), new FinishingPlaceDto(q1t[0], 2, false)], null, "wrong order"))).EnsureSuccessStatusCode();

        Assert.Equal(finalists, await _f.WithDbAsync(db => db.HeatEntries.Where(e => e.HeatId == fin.Id).OrderBy(e => e.LaneIndex).Select(e => e.TeamId).ToListAsync()));
    }

    [Fact]
    public async Task FinalistsAreScoredOnTheFinalsOwnField_NotTheQualifiersBiggerOne()
    {
        var a = await _f.CreateArenaAsync(8, raceFinals: true);
        var (admin, q1, q2, fin) = await GenerateRoundAsync(a, lanes: 4);
        await SetQualifiersAsync(admin, a, 1);
        var q1t = Teams(q1); var q2t = Teams(q2);
        await ScoreAsync(admin, q1, (q1t[0], 1, false), (q1t[1], 2, false), (q1t[2], 3, false), (q1t[3], 4, false));
        await ScoreAsync(admin, q2, (q2t[0], 1, false), (q2t[1], 2, false), (q2t[2], 3, false), (q2t[3], 4, false));
        var finalists = await _f.WithDbAsync(db => db.HeatEntries.Where(e => e.HeatId == fin.Id).OrderBy(e => e.LaneIndex).Select(e => e.TeamId).ToListAsync());
        Assert.Equal(2, finalists.Count);
        var finalRace = await _f.WithDbAsync(db => db.Races.Where(r => r.HeatId == fin.Id).Select(r => r.Id).SingleAsync());

        (await admin.PostAsJsonAsync($"/api/races/{finalRace}/results", new SubmitRaceResultsRequest(
            [new FinishingPlaceDto(finalists[1], 1, false), new FinishingPlaceDto(finalists[0], 2, false)]))).EnsureSuccessStatusCode();

        // Two finalists: 3 points for the win and 2 for last, one more than the 1 a qualifier earns.
        var points = await _f.WithDbAsync(db => db.Results.Where(r => r.RaceId == finalRace).OrderBy(r => r.Placing).Select(r => r.Points).ToListAsync());
        Assert.Equal(new[] { 3, 2 }, points);
        var qualifierPoints = await _f.WithDbAsync(db => db.Results.Where(r => r.RaceId == q1.Races[0].Id).Select(r => r.Points).ToListAsync());
        Assert.All(qualifierPoints, point => Assert.Equal(1, point));
    }

    [Fact]
    public async Task SessionSettings_StoreHowManyTeamsGoThroughFromEachQualifier()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var admin = await _f.AdminAsync();

        var saved = await (await admin.PutAsJsonAsync(Url(a, "/settings"), new UpdateSessionSettingsRequest(null, null, QualifiersPerHeat: 4))).ReadAsync<SessionDto>();
        var tooMany = await admin.PutAsJsonAsync(Url(a, "/settings"), new { qualifiersPerHeat = 99 });

        Assert.Equal(4, saved.QualifiersPerHeat);
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns400_WhenNoQualifierResults()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (admin, _, _, fin) = await GenerateRoundAsync(a);
        var r = await admin.PostAsJsonAsync(Url(a, $"/heats/{fin.Id}/populate-race-final"), new PopulateRaceFinalRequest(2));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns400_WhenTopNBelowOne()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (admin, _, _, fin) = await GenerateRoundAsync(a);
        var r = await admin.PostAsJsonAsync(Url(a, $"/heats/{fin.Id}/populate-race-final"), new PopulateRaceFinalRequest(0));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns400_WhenHeatIsAQualifier()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (admin, q1, _, _) = await GenerateRoundAsync(a);
        var r = await admin.PostAsJsonAsync(Url(a, $"/heats/{q1.Id}/populate-race-final"), new PopulateRaceFinalRequest(1));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns400_WhenFinalHasNoRound()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (heatId, _) = await _f.AddHeatAsync(a.SessionId, Array.Empty<int>(), "Orphan final", 1, stage: RaceRoundStage.Final, roundId: null);
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync(Url(a, $"/heats/{heatId}/populate-race-final"), new PopulateRaceFinalRequest(1));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns400_WhenQualifierHeatsMissing()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (heatId, _) = await _f.AddHeatAsync(a.SessionId, Array.Empty<int>(), "Final", 1, stage: RaceRoundStage.Final, roundId: 1);
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync(Url(a, $"/heats/{heatId}/populate-race-final"), new PopulateRaceFinalRequest(1));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns404_WhenHeatMissing()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync(Url(a, "/heats/999999/populate-race-final"), new PopulateRaceFinalRequest(1));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns404_WhenCompetitionDoesNotOwnSession()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var b = await _f.CreateArenaAsync(2);
        var (admin, _, _, fin) = await GenerateRoundAsync(a);
        var r = await admin.PostAsJsonAsync($"/api/competitions/{b.CompetitionId}/sessions/{a.SessionId}/heats/{fin.Id}/populate-race-final",
            new PopulateRaceFinalRequest(1));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }
}
