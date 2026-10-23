using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

/// <summary>DNS, DNF, Retired and Eliminated results, and the referee's private note.</summary>
public class ResultStatusTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ResultStatusTests(ApiFactory f) => _f = f;

    private ScoringService Service(IServiceScope scope) => scope.ServiceProvider.GetRequiredService<ScoringService>();

    private static FinishingPlace Fin(int team, int place) => new(team, place, false);
    private static FinishingPlace Out(int team, ResultStatus? status = null, string? note = null) => new(team, 0, true, status, note);

    private async Task<(Arena Arena, int Race)> ArenaWithRaceAsync(int teams = 5)
    {
        var a = await _f.CreateArenaAsync(teams);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        return (a, races[0]);
    }

    private Task<List<Result>> StoredAsync(int raceId)
        => _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => r.RaceId == raceId).OrderBy(r => r.TeamId).ToListAsync());

    // ---- scoring rules ----

    [Fact]
    public async Task EveryKindOfNonFinish_ScoresZero_HasNoPlace_AndKeepsItsStatus()
    {
        var (a, race) = await ArenaWithRaceAsync(5);
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(race, new[]
        {
            Fin(a.TeamIds[0], 1), Out(a.TeamIds[1], ResultStatus.Eliminated), Out(a.TeamIds[2], ResultStatus.DidNotStart),
            Out(a.TeamIds[3], ResultStatus.DidNotFinish), Out(a.TeamIds[4], ResultStatus.Retired),
        }, "u1");

        var stored = await StoredAsync(race);
        Assert.Equal(new[] { 5, 0, 0, 0, 0 }, stored.Select(r => r.Points));
        Assert.All(stored.Skip(1), r => { Assert.True(r.Eliminated); Assert.Null(r.Placing); });
        Assert.Equal(new[] { ResultStatus.Finished, ResultStatus.Eliminated, ResultStatus.DidNotStart, ResultStatus.DidNotFinish, ResultStatus.Retired },
            stored.Select(r => r.Status));
    }

    [Fact]
    public async Task ATeamMarkedEliminatedWithoutAStatus_IsStoredAsEliminated()
    {
        var (a, race) = await ArenaWithRaceAsync(2);
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(race, new[] { Fin(a.TeamIds[0], 1), Out(a.TeamIds[1]) }, null);

        Assert.Equal(ResultStatus.Eliminated, (await StoredAsync(race))[1].Status);
    }

    [Fact]
    public async Task AStatusAloneMakesATeamNotFinish_AndAFinisherHasNoStatus()
    {
        var (a, race) = await ArenaWithRaceAsync(3);
        using var scope = _f.Services.CreateScope();

        // DNS without the Eliminated flag still scores nothing; Finished with a place stays a finisher.
        await Service(scope).ApplyRaceResultsAsync(race, new[]
        {
            Fin(a.TeamIds[0], 1) with { Status = ResultStatus.Finished },
            new FinishingPlace(a.TeamIds[1], 2, false, ResultStatus.DidNotStart),
            Out(a.TeamIds[2], ResultStatus.Finished),
        }, null);

        var stored = await StoredAsync(race);
        Assert.Equal(new[] { 3, 0, 0 }, stored.Select(r => r.Points));
        Assert.Equal(new[] { ResultStatus.Finished, ResultStatus.DidNotStart, ResultStatus.Eliminated }, stored.Select(r => r.Status));
        Assert.Equal(new[] { false, true, true }, stored.Select(r => r.Eliminated));
    }

    [Fact]
    public async Task AStatusThatDoesNotExist_IsRefused()
    {
        var (a, race) = await ArenaWithRaceAsync(2);
        using var scope = _f.Services.CreateScope();

        var ex = await Assert.ThrowsAsync<ScoreValidationException>(() =>
            Service(scope).ApplyRaceResultsAsync(race, new[] { Out(a.TeamIds[0], (ResultStatus)9) }, null));
        Assert.Equal("Unknown result status.", ex.Message);
    }

    [Fact]
    public async Task QualifierHeat_GivesAnyNonFinisherZero_AndFinishersOnePoint()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Q", 1, stage: RaceRoundStage.Qualifier, roundId: 1);
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(races[0], new[]
        {
            Fin(a.TeamIds[0], 1), Fin(a.TeamIds[1], 2), Out(a.TeamIds[2], ResultStatus.DidNotFinish), Out(a.TeamIds[3], ResultStatus.Retired),
        }, null);

        Assert.Equal(new[] { 1, 1, 0, 0 }, (await StoredAsync(races[0])).Select(r => r.Points));
    }

    [Fact]
    public async Task OnlyEliminationsAreCountedAsEliminations_InTheStandings()
    {
        var (a, race) = await ArenaWithRaceAsync(4);
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(race, new[]
            {
                Fin(a.TeamIds[0], 1), Out(a.TeamIds[1], ResultStatus.Eliminated), Out(a.TeamIds[2], ResultStatus.DidNotStart), Out(a.TeamIds[3]),
            }, null);

        var rows = await (await _f.CreateClient().GetAsync($"/api/competitions/{a.CompetitionId}/standings")).ReadAsync<List<StandingRow>>();

        Assert.Equal(new[] { 0, 1, 0, 1 }, a.TeamIds.Select(id => rows.Single(r => r.TeamId == id).Eliminations));
    }

    // ---- data from before the choice existed ----

    [Fact]
    public async Task ARowSavedBeforeStatusesExisted_ReadsAsEliminated()
    {
        var (a, race) = await ArenaWithRaceAsync(2);
        await _f.WithDbAsync(async db =>
        {
            db.Results.Add(new Result { RaceId = race, TeamId = a.TeamIds[0], Placing = 1, Points = 2 });
            db.Results.Add(new Result { RaceId = race, TeamId = a.TeamIds[1], Eliminated = true, Status = ResultStatus.Finished });
            (await db.Races.FindAsync(race))!.IsComplete = true;
            await db.SaveChangesAsync();
        });

        var heat = await (await _f.CreateClient().GetAsync($"/api/competitions/{a.CompetitionId}")).ReadAsync<CompetitionDetail>();
        var results = heat.Sessions.Single(s => s.Id == a.SessionId).Heats.Single().Races.Single().Results;

        Assert.Equal(ResultStatus.Finished, results.Single(r => r.TeamId == a.TeamIds[0]).Status);
        Assert.Equal(ResultStatus.Eliminated, results.Single(r => r.TeamId == a.TeamIds[1]).Status);

        // Re-saving what the scorer saw is no change, so an old elimination is not seen as a different result.
        using var scope = _f.Services.CreateScope();
        var again = await Service(scope).ApplyLegacyAsync(race, new[] { new FinishingPlaceDto(a.TeamIds[0], 1, false), new FinishingPlaceDto(a.TeamIds[1], 0, true) },
            null, null);
        Assert.True(again.IdempotentReplay);
    }

    // ---- referee notes ----

    [Fact]
    public async Task ANoteIsStoredTrimmed_KeptWhenLeftOut_AndClearedWithAnEmptyOne()
    {
        var (a, race) = await ArenaWithRaceAsync(2);
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(race, new[] { Fin(a.TeamIds[0], 1) with { Note = "  Warned for rough riding  " }, Fin(a.TeamIds[1], 2) }, null);
        Assert.Equal("Warned for rough riding", (await StoredAsync(race))[0].RefereeNote);
        Assert.Null((await StoredAsync(race))[1].RefereeNote);

        // A later correction that says nothing about the note keeps it.
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(race, new[] { Fin(a.TeamIds[1], 1), Fin(a.TeamIds[0], 2) }, null, "Order corrected");
        Assert.Equal("Warned for rough riding", (await StoredAsync(race))[0].RefereeNote);

        // An empty note clears it.
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(race, new[] { Fin(a.TeamIds[1], 1), Fin(a.TeamIds[0], 2) with { Note = "" } }, null, "Note withdrawn");
        Assert.Null((await StoredAsync(race))[0].RefereeNote);
    }

    [Fact]
    public async Task ANoteOnItsOwnIsACorrection_WhichNeedsAReason_AndAnUnchangedSaveChangesNothing()
    {
        var (a, race) = await ArenaWithRaceAsync(2);
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(race, new[] { Fin(a.TeamIds[0], 1), Fin(a.TeamIds[1], 2) }, null);

        using (var scope = _f.Services.CreateScope())
            await Assert.ThrowsAsync<ScoreValidationException>(() => Service(scope).ApplyRaceResultsAsync(race,
                new[] { Fin(a.TeamIds[0], 1) with { Note = "Late to the line" }, Fin(a.TeamIds[1], 2) }, null));

        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(race,
                new[] { Fin(a.TeamIds[0], 1) with { Note = "Late to the line" }, Fin(a.TeamIds[1], 2) }, null, "Referee's note added");
        var revision = (await _f.WithDbAsync(db => db.Set<MountedGames.Api.Entities.Operations.RaceScoreState>().SingleAsync(s => s.RaceId == race))).Revision;

        using (var scope = _f.Services.CreateScope())
        {
            var same = await Service(scope).ApplyLegacyAsync(race,
                new[] { new FinishingPlaceDto(a.TeamIds[0], 1, false, null, "Late to the line"), new FinishingPlaceDto(a.TeamIds[1], 2, false) }, null, null);
            Assert.True(same.IdempotentReplay);
            Assert.Equal(revision, same.Revision);
        }
    }

    [Fact]
    public async Task ANoteLongerThanTheLimit_IsRefused()
    {
        var (a, race) = await ArenaWithRaceAsync(2);
        using var scope = _f.Services.CreateScope();

        var ex = await Assert.ThrowsAsync<ScoreValidationException>(() =>
            Service(scope).ApplyRaceResultsAsync(race, new[] { Fin(a.TeamIds[0], 1) with { Note = new string('x', 501) } }, null));
        Assert.Contains("500", ex.Message);
    }

    [Fact]
    public async Task ExpectedResultsAreComparedByPlaceAndStatus_NotByNote()
    {
        var (a, race) = await ArenaWithRaceAsync(3);
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(race, new[]
            {
                Fin(a.TeamIds[0], 1) with { Note = "Clean run" }, Out(a.TeamIds[1], ResultStatus.DidNotFinish), Fin(a.TeamIds[2], 2),
            }, null);

        // The scorer's screen showed places and a DNF (no note): that is what they expected, so the correction goes through.
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyLegacyAsync(race,
                new[] { new FinishingPlaceDto(a.TeamIds[2], 1, false), new FinishingPlaceDto(a.TeamIds[0], 2, false), new FinishingPlaceDto(a.TeamIds[1], 0, true, ResultStatus.Retired) },
                new[] { new FinishingPlaceDto(a.TeamIds[0], 1, false), new FinishingPlaceDto(a.TeamIds[1], 0, true, ResultStatus.DidNotFinish), new FinishingPlaceDto(a.TeamIds[2], 2, false) },
                null, "Retired, not DNF");
        Assert.Equal(ResultStatus.Retired, (await StoredAsync(race))[1].Status);

        // A different status from the one the scorer saw is another device's change.
        using (var scope = _f.Services.CreateScope())
            await Assert.ThrowsAsync<ScoreConflictException>(() => Service(scope).ApplyLegacyAsync(race,
                new[] { new FinishingPlaceDto(a.TeamIds[2], 1, false) },
                new[] { new FinishingPlaceDto(a.TeamIds[2], 1, false), new FinishingPlaceDto(a.TeamIds[0], 2, false), new FinishingPlaceDto(a.TeamIds[1], 0, true, ResultStatus.DidNotFinish) },
                null, "Stale"));
    }

    // ---- who sees the note ----

    [Fact]
    public async Task TheNoteIsInTheStaffScoreRead_NeverInPublicOrLiveResults()
    {
        var (a, race) = await ArenaWithRaceAsync(3);
        var admin = await _f.AdminAsync();
        var put = await admin.PostAsJsonAsync($"/api/races/{race}/results", new SubmitRaceResultsRequest(new[]
        {
            new FinishingPlaceDto(a.TeamIds[0], 1, false, null, "Team protested the start"),
            new FinishingPlaceDto(a.TeamIds[1], 0, true, ResultStatus.DidNotStart, "Pony lame in the collecting ring"),
            new FinishingPlaceDto(a.TeamIds[2], 2, false),
        }));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var heatJson = await put.Content.ReadAsStringAsync();

        // The saved heat the scorer gets back, the public competition, the standings and the printable sheets carry no note.
        var publicJson = await _f.CreateClient().GetStringAsync($"/api/competitions/{a.CompetitionId}");
        var sheetsJson = await admin.GetStringAsync($"/api/event-tools/competitions/{a.CompetitionId}/print/score-sheets");
        foreach (var body in new[] { heatJson, publicJson, sheetsJson })
        {
            Assert.DoesNotContain("Team protested the start", body);
            Assert.DoesNotContain("Pony lame", body);
            Assert.DoesNotContain("refereeNote", body, StringComparison.OrdinalIgnoreCase);
        }
        Assert.Contains("\"status\":2", publicJson);
        Assert.Contains("\"status\":2", sheetsJson);

        // Staff can read it.
        var score = await (await admin.GetAsync($"/api/races/{race}/score")).ReadAsync<RaceScoreDto>();
        Assert.Equal("Team protested the start", score.Results.Single(r => r.TeamId == a.TeamIds[0]).RefereeNote);
        Assert.Equal(ResultStatus.DidNotStart, score.Results.Single(r => r.TeamId == a.TeamIds[1]).Status);
        var history = await (await admin.GetAsync($"/api/races/{race}/score/history")).ReadAsync<List<RaceScoreHistoryDto>>();
        Assert.Equal(ResultStatus.DidNotStart, history.Single().After.Single(r => r.TeamId == a.TeamIds[1]).Status);
    }

    [Fact]
    public async Task TheVersionedScoreEndpointTakesStatusesAndNotes()
    {
        var (a, race) = await ArenaWithRaceAsync(2);
        var admin = await _f.AdminAsync();

        var response = await admin.PutAsJsonAsync($"/api/races/{race}/score", new UpdateRaceScoreRequest(new[]
        {
            new FinishingPlaceDto(a.TeamIds[0], 1, false), new FinishingPlaceDto(a.TeamIds[1], 0, false, ResultStatus.Retired, "Rider unwell"),
        }, 0, "status-1", null));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var score = await response.ReadAsync<RaceScoreDto>();
        var retired = score.Results.Single(r => r.TeamId == a.TeamIds[1]);
        Assert.True(retired.Eliminated);
        Assert.Equal(ResultStatus.Retired, retired.Status);
        Assert.Equal("Rider unwell", retired.RefereeNote);
        Assert.Equal(0, retired.Points);
    }

    [Fact]
    public async Task ANonStaffMemberCannotReadTheScoreRecord()
    {
        var (_, race) = await ArenaWithRaceAsync(2);
        var (member, _) = await _f.SignupAsync("Member");

        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"/api/races/{race}/score")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync($"/api/races/{race}/score")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.TrainerAsync()).GetAsync($"/api/races/{race}/score")).StatusCode);
    }
}
