using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

public class ScoringServiceTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ScoringServiceTests(ApiFactory f) => _f = f;

    private ScoringService Service(IServiceScope scope) => scope.ServiceProvider.GetRequiredService<ScoringService>();

    [Theory]
    [InlineData(1, 5, false, 5)]
    [InlineData(2, 5, false, 4)]
    [InlineData(5, 5, false, 1)]
    [InlineData(6, 5, false, 0)]   // beyond the field
    [InlineData(0, 5, false, 0)]   // no place recorded
    [InlineData(-1, 5, false, 0)]
    [InlineData(1, 5, true, 0)]    // eliminated teams never score
    [InlineData(1, 0, false, 0)]   // empty session
    public void PointsForPlace_AwardsFieldSizeMinusPlacePlusOne(int place, int sessionBase, bool eliminated, int expected)
    {
        var svc = new ScoringService(null!);
        Assert.Equal(expected, svc.PointsForPlace(place, sessionBase, eliminated));
    }

    [Fact]
    public async Task GetSessionBase_IsZero_ForSessionWithoutHeats()
    {
        var a = await _f.CreateArenaAsync();
        using var scope = _f.Services.CreateScope();
        Assert.Equal(0, await Service(scope).GetSessionBaseAsync(a.SessionId));
    }

    [Fact]
    public async Task GetSessionBase_IsLargestHeat()
    {
        var a = await _f.CreateArenaAsync(5);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds.Take(2), "Small", 1);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Big", 2);
        using var scope = _f.Services.CreateScope();
        Assert.Equal(5, await Service(scope).GetSessionBaseAsync(a.SessionId));
    }

    [Fact]
    public async Task ApplyRaceResults_Throws_WhenRaceMissing()
    {
        using var scope = _f.Services.CreateScope();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Service(scope).ApplyRaceResultsAsync(999999, Array.Empty<FinishingPlace>(), null));
        Assert.Equal("Race not found", ex.Message);
    }

    [Fact]
    public async Task ApplyRaceResults_ScoresByPlace_AndRecordsUser()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[] { new FinishingPlace(a.TeamIds[1], 1, false), new FinishingPlace(a.TeamIds[0], 2, false), new FinishingPlace(a.TeamIds[2], 9, true) },
            "user-1");

        Assert.Equal(new[] { 3.0, 2.0, 0.0 }, fresh.Select(r => r.Points));
        Assert.All(fresh, r => Assert.Equal("user-1", r.RecordedByUserId));
        Assert.Null(fresh[2].Placing);
        Assert.True(fresh[2].Eliminated);
        var race = await _f.WithDbAsync(db => db.Races.SingleAsync(r => r.Id == races[0]));
        Assert.True(race.IsComplete);
    }

    [Fact]
    public async Task ApplyRaceResults_IgnoresTeamsNotInTheHeat()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds.Take(2));
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[] { new FinishingPlace(a.TeamIds[2], 1, false), new FinishingPlace(a.TeamIds[0], 2, false) }, null);

        Assert.Equal(a.TeamIds[0], Assert.Single(fresh).TeamId);
    }

    [Fact]
    public async Task ApplyRaceResults_WithNoPlaces_ClearsResultsButMarksComplete()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(races[0], new[] { new FinishingPlace(a.TeamIds[0], 1, false) }, null);

        using (var scope = _f.Services.CreateScope())
            await Service(scope).ApplyRaceResultsAsync(
                races[0], Array.Empty<FinishingPlace>(), null, "Results withdrawn after review");

        Assert.Empty(await _f.WithDbAsync(db => db.Results.Where(r => r.RaceId == races[0]).ToListAsync()));
        Assert.True((await _f.WithDbAsync(db => db.Races.SingleAsync(r => r.Id == races[0]))).IsComplete);
    }

    [Fact]
    public async Task ApplyRaceResults_UsesHeatSize_WhenSessionBaseIsZero()
    {
        // Only possible when the race's own heat has no entries: nothing can score, but it must not throw.
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, Array.Empty<int>());
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0], new[] { new FinishingPlace(a.TeamIds[0], 1, false) }, null);

        Assert.Empty(fresh);
    }

    [Fact]
    public async Task ApplyRaceResults_QualifierHeat_ScoresOnePerFinisher_RegardlessOfPlace()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Q", 1, stage: RaceRoundStage.Qualifier, roundId: 1);
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[]
            {
                new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 4, false),
                new FinishingPlace(a.TeamIds[2], 2, true),
            }, null);

        Assert.Equal(new[] { 1.0, 1.0, 0.0 }, fresh.Select(r => r.Points));
    }

    [Fact]
    public async Task ApplyRaceResults_FinalHeat_IsScoredOnItsOwnFieldPlusOne()
    {
        var a = await _f.CreateArenaAsync(4, raceFinals: true);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Final", 1, stage: RaceRoundStage.Final, roundId: 1);
        using var scope = _f.Services.CreateScope();

        var fresh = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[] { new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 2, false) }, null);

        // A final is scored on its own field of four: 5 for the win, down to 2 for last (one more than a qualifier's 1).
        Assert.Equal(new[] { 5.0, 4.0 }, fresh.Select(r => r.Points));
    }

    [Fact]
    public async Task ApplyRaceResults_KeepsExistingClockTimes()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var started = DateTime.UtcNow.AddMinutes(-5);
        var finished = DateTime.UtcNow.AddMinutes(-4);
        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.SingleAsync(r => r.Id == races[0]);
            race.StartedAt = started;
            race.FinishedAt = finished;
            await db.SaveChangesAsync();
        });
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(races[0], new[] { new FinishingPlace(a.TeamIds[0], 1, false) }, null);

        var race2 = await _f.WithDbAsync(db => db.Races.SingleAsync(r => r.Id == races[0]));
        Assert.Equal(started, race2.StartedAt);
        Assert.Equal(finished, race2.FinishedAt);
    }

    [Fact]
    public async Task ApplyRaceResults_StampsClockTimes_WhenNoneRecorded()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(races[0], new[] { new FinishingPlace(a.TeamIds[0], 1, false) }, null);

        var race = await _f.WithDbAsync(db => db.Races.SingleAsync(r => r.Id == races[0]));
        Assert.NotNull(race.StartedAt);
        Assert.NotNull(race.FinishedAt);
    }

    [Fact]
    public async Task ApplyRaceResults_TransitionsSessionToInArena_AndFinishedWhenAllRacesComplete()
    {
        var a = await _f.CreateArenaAsync(2);
        var (heatId, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, raceCount: 2);
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(races[0],
            new[] { new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 2, false) }, null);

        var midSession = await _f.WithDbAsync(db => db.Sessions.SingleAsync(s => s.Id == a.SessionId));
        var midHeat = await _f.WithDbAsync(db => db.Heats.SingleAsync(h => h.Id == heatId));
        Assert.Equal(SessionStatus.InArena, midSession.Status);
        Assert.NotNull(midSession.StartedAt);
        Assert.NotNull(midHeat.StartedAt);
        Assert.Null(midHeat.FinishedAt);

        await Service(scope).ApplyRaceResultsAsync(races[1],
            new[] { new FinishingPlace(a.TeamIds[1], 1, false), new FinishingPlace(a.TeamIds[0], 2, false) }, null);

        var endSession = await _f.WithDbAsync(db => db.Sessions.SingleAsync(s => s.Id == a.SessionId));
        var endHeat = await _f.WithDbAsync(db => db.Heats.SingleAsync(h => h.Id == heatId));
        Assert.Equal(SessionStatus.Finished, endSession.Status);
        Assert.NotNull(endSession.FinishedAt);
        Assert.NotNull(endHeat.FinishedAt);
    }

    [Fact]
    public async Task ApplyRaceResults_AutoPopulatesFinalHeat_WhenBothQualifiersComplete()
    {
        var a = await _f.CreateArenaAsync(6, raceFinals: true);
        var (_, q1Races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds[..3], "Q1", 1, stage: RaceRoundStage.Qualifier, roundId: 1);
        var (_, q2Races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds[3..], "Q2", 2, stage: RaceRoundStage.Qualifier, roundId: 1);
        var (finalHeatId, _) = await _f.AddHeatAsync(a.SessionId, Array.Empty<int>(), "Final", 3, stage: RaceRoundStage.Final, roundId: 1);
        using var scope = _f.Services.CreateScope();

        await Service(scope).ApplyRaceResultsAsync(q1Races[0],
            new[] { new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 2, false), new FinishingPlace(a.TeamIds[2], 3, false) }, null);
        await Service(scope).ApplyRaceResultsAsync(q2Races[0],
            new[] { new FinishingPlace(a.TeamIds[3], 1, false), new FinishingPlace(a.TeamIds[4], 2, false), new FinishingPlace(a.TeamIds[5], 3, false) }, null);

        var finalEntries = await _f.WithDbAsync(db => db.HeatEntries
            .Where(e => e.HeatId == finalHeatId)
            .OrderBy(e => e.LaneIndex)
            .Select(e => e.TeamId)
            .ToListAsync());
        Assert.Equal(new[] { a.TeamIds[0], a.TeamIds[3], a.TeamIds[1], a.TeamIds[4], a.TeamIds[2], a.TeamIds[5] }, finalEntries);
    }

    [Fact]
    public async Task ApplyRaceResults_HorsConcoursScoresZero_AndCompactsCompetitivePlacings()
    {
        var a = await _f.CreateArenaAsync(3);
        await _f.WithDbAsync(async db =>
        {
            (await db.Teams.SingleAsync(t => t.Id == a.TeamIds[0])).IsHorsConcours = true;
            await db.SaveChangesAsync();
        });
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();

        // Team 0 (HC) finishes 1st physically, Team 1 finishes 2nd, Team 2 finishes 3rd.
        var results = await Service(scope).ApplyRaceResultsAsync(races[0],
            new[]
            {
                new FinishingPlace(a.TeamIds[0], 1, false),
                new FinishingPlace(a.TeamIds[1], 2, false),
                new FinishingPlace(a.TeamIds[2], 3, false),
            }, null);

        var byTeam = results.ToDictionary(r => r.TeamId, r => r.Points);
        Assert.Equal(0, byTeam[a.TeamIds[0]]);
        Assert.Equal(3, byTeam[a.TeamIds[1]]);
        Assert.Equal(2, byTeam[a.TeamIds[2]]);
    }

    [Fact]
    public async Task OverrideRacePoints_AndAdjustTeamPoints_ApplyCustomAndDeltaPoints()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();
        var svc = Service(scope);

        await svc.ApplyRaceResultsAsync(races[0],
            new[]
            {
                new FinishingPlace(a.TeamIds[0], 1, false),
                new FinishingPlace(a.TeamIds[1], 2, false),
                new FinishingPlace(a.TeamIds[2], 3, false),
            }, null);

        var overridden = await svc.OverrideRacePointsAsync(races[0], a.TeamIds[1], 10, "Combined heat bonus", null);
        Assert.Equal(10, overridden.Results.Single(r => r.TeamId == a.TeamIds[1]).Points);

        var adjusted = await svc.AdjustTeamPointsAsync(races[0], a.TeamIds[0], -2, "Jury penalty", null);
        Assert.Equal(1, adjusted.Results.Single(r => r.TeamId == a.TeamIds[0]).Points);
    }

    [Fact]
    public async Task PointDirectives_TakeHalves_ReplaceEachOther_AndSurviveAReSave()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();
        var svc = Service(scope);
        double PointsOf(MountedGames.Api.Dtos.RaceScoreDto score, int teamId) => score.Results.Single(r => r.TeamId == teamId).Points;

        await svc.ApplyRaceResultsAsync(races[0], new[]
        {
            new FinishingPlace(a.TeamIds[0], 1, false),
            new FinishingPlace(a.TeamIds[1], 2, false),
            new FinishingPlace(a.TeamIds[2], 3, false),
        }, null);

        var half = await svc.OverrideRacePointsAsync(races[0], a.TeamIds[2], 2.5, "Dead heat for second", null);
        Assert.Equal(2.5, PointsOf(half, a.TeamIds[2]));

        // Placing points for first are 3. A second adjustment replaces the first rather than adding to it.
        await svc.AdjustTeamPointsAsync(races[0], a.TeamIds[0], 1, "Bonus", null);
        var replaced = await svc.AdjustTeamPointsAsync(races[0], a.TeamIds[0], -0.5, "Bonus withdrawn, half-point penalty", null);
        Assert.Equal(2.5, PointsOf(replaced, a.TeamIds[0]));
        // Adjusting one team doesn't re-apply another team's directive.
        Assert.Equal(2.5, PointsOf(replaced, a.TeamIds[2]));

        // Re-saving the heat with the same places and notes keeps both.
        var notes = replaced.Results.ToDictionary(r => r.TeamId, r => r.RefereeNote);
        var resaved = await svc.ApplyRaceResultsAsync(races[0], new[]
        {
            new FinishingPlace(a.TeamIds[0], 1, false, Note: notes[a.TeamIds[0]]),
            new FinishingPlace(a.TeamIds[1], 2, false, Note: notes[a.TeamIds[1]]),
            new FinishingPlace(a.TeamIds[2], 3, false, Note: notes[a.TeamIds[2]]),
        }, null, reason: "Re-save");
        Assert.Equal(2.5, resaved.Single(r => r.TeamId == a.TeamIds[0]).Points);
        Assert.Equal(2, resaved.Single(r => r.TeamId == a.TeamIds[1]).Points);
        Assert.Equal(2.5, resaved.Single(r => r.TeamId == a.TeamIds[2]).Points);

        await Assert.ThrowsAsync<ScoreValidationException>(() =>
            svc.OverrideRacePointsAsync(races[0], a.TeamIds[1], 2.25, "Quarter points aren't a thing", null));
        await Assert.ThrowsAsync<ScoreValidationException>(() =>
            svc.AdjustTeamPointsAsync(races[0], a.TeamIds[1], -5, "Would go below zero", null));
    }

    [Fact]
    public async Task SetUnderReview_WithANote_KeepsThePointsDirective()
    {
        var a = await _f.CreateArenaAsync(3);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();
        var svc = Service(scope);
        await svc.ApplyRaceResultsAsync(races[0], new[]
        {
            new FinishingPlace(a.TeamIds[0], 1, false),
            new FinishingPlace(a.TeamIds[1], 2, false),
            new FinishingPlace(a.TeamIds[2], 3, false),
        }, null);
        await svc.OverrideRacePointsAsync(races[0], a.TeamIds[2], 2.5, "Dead heat for second", null);

        var flagged = await svc.SetUnderReviewAsync(races[0], a.TeamIds[2], true, "Lane interference");
        var row = flagged.Results.Single(r => r.TeamId == a.TeamIds[2]);
        Assert.Equal(2.5, row.Points);
        Assert.Contains("[under-review]", row.RefereeNote);
        Assert.Contains("[pts:2.5]", row.RefereeNote);

        var cleared = await svc.SetUnderReviewAsync(races[0], a.TeamIds[2], false);
        Assert.Equal(2.5, cleared.Results.Single(r => r.TeamId == a.TeamIds[2]).Points);
    }

    [Fact]
    public async Task ApplyRaceResults_CombinedSectionsHeat_ScoresBySectionOrCombined()
    {
        // 4 teams total: 2 in U12 (original section) and 2 moved into a new U14 section.
        var a = await _f.CreateArenaAsync(4);
        await _f.WithDbAsync(async db =>
        {
            var u14 = new CompetitionSection
            {
                CompetitionId = a.CompetitionId,
                Format = SectionFormat.Teams,
                AgeGroup = "Under 14",
                DisplayName = "Under 14 Teams",
            };
            db.CompetitionSections.Add(u14);
            await db.SaveChangesAsync();

            var t2 = await db.Teams.SingleAsync(t => t.Id == a.TeamIds[2]);
            var t3 = await db.Teams.SingleAsync(t => t.Id == a.TeamIds[3]);
            t2.CompetitionSectionId = u14.Id;
            t3.CompetitionSectionId = u14.Id;

            var session = await db.Sessions.SingleAsync(s => s.Id == a.SessionId);
            session.Notes = ScoringService.ApplyScoringModeTag(session.Notes, CombinedHeatScoringMode.BySection);
            await db.SaveChangesAsync();
        });

        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, raceCount: 2);
        using var scope = _f.Services.CreateScope();
        var svc = Service(scope);

        // Arena finish order: 1st = U14 (TeamIds[2]), 2nd = U12 (TeamIds[0]), 3rd = U14 (TeamIds[3]), 4th = U12 (TeamIds[1]).
        // Option A (BySection): 1st in U12 (TeamIds[0]) gets full 1st-place points for its 2-team section (2 pts),
        // and 2nd in U12 (TeamIds[1]) gets 1 pt; 1st in U14 gets 2 pts and 2nd in U14 gets 1 pt.
        var bySectionResults = await svc.ApplyRaceResultsAsync(races[0],
            new[]
            {
                new FinishingPlace(a.TeamIds[2], 1, false),
                new FinishingPlace(a.TeamIds[0], 2, false),
                new FinishingPlace(a.TeamIds[3], 3, false),
                new FinishingPlace(a.TeamIds[1], 4, false),
            }, null);

        var bySectionPts = bySectionResults.ToDictionary(r => r.TeamId, r => r.Points);
        Assert.Equal(2, bySectionPts[a.TeamIds[2]]); // 1st in U14
        Assert.Equal(2, bySectionPts[a.TeamIds[0]]); // 1st in U12 (despite finishing 2nd in the arena)
        Assert.Equal(1, bySectionPts[a.TeamIds[3]]); // 2nd in U14
        Assert.Equal(1, bySectionPts[a.TeamIds[1]]); // 2nd in U12

        // Switch session to Option B (Combined): scored across all 4 teams in the heat (4, 3, 2, 1 pts).
        await _f.WithDbAsync(async db =>
        {
            var session = await db.Sessions.SingleAsync(s => s.Id == a.SessionId);
            session.Notes = ScoringService.ApplyScoringModeTag(session.Notes, CombinedHeatScoringMode.Combined);
            await db.SaveChangesAsync();
        });

        var combinedResults = await svc.ApplyRaceResultsAsync(races[1],
            new[]
            {
                new FinishingPlace(a.TeamIds[2], 1, false),
                new FinishingPlace(a.TeamIds[0], 2, false),
                new FinishingPlace(a.TeamIds[3], 3, false),
                new FinishingPlace(a.TeamIds[1], 4, false),
            }, null);

        var combinedPts = combinedResults.ToDictionary(r => r.TeamId, r => r.Points);
        Assert.Equal(4, combinedPts[a.TeamIds[2]]);
        Assert.Equal(3, combinedPts[a.TeamIds[0]]);
        Assert.Equal(2, combinedPts[a.TeamIds[3]]);
        Assert.Equal(1, combinedPts[a.TeamIds[1]]);
    }

    [Fact]
    public async Task ClearRaceForRerun_AndSetUnderReview_WorkAsExpected()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();
        var svc = Service(scope);

        await svc.ApplyRaceResultsAsync(races[0],
            new[]
            {
                new FinishingPlace(a.TeamIds[0], 1, false),
                new FinishingPlace(a.TeamIds[1], 0, true),
            }, null);

        var flagged = await svc.SetUnderReviewAsync(races[0], a.TeamIds[1], true, "Checking video on changeover");
        var team1Result = flagged.Results.Single(r => r.TeamId == a.TeamIds[1]);
        Assert.True(ScoringService.IsUnderReview(team1Result.RefereeNote));
        Assert.Contains("Checking video on changeover", team1Result.RefereeNote);

        var unflagged = await svc.SetUnderReviewAsync(races[0], a.TeamIds[1], false);
        Assert.False(ScoringService.IsUnderReview(unflagged.Results.Single(r => r.TeamId == a.TeamIds[1]).RefereeNote));

        var cleared = await svc.ClearRaceForRerunAsync(races[0], "admin", "Stopped race for fallen pole");
        Assert.Empty(cleared.Results);
        var raceEntity = await _f.WithDbAsync(db => db.Races.SingleAsync(r => r.Id == races[0]));
        Assert.False(raceEntity.IsComplete);
        Assert.Null(raceEntity.StartedAt);
        Assert.Null(raceEntity.FinishedAt);
    }

    [Fact]
    public async Task SessionsDayControlsEndpoints_ChangeCancelRace_ClearRerun_CombineHeat_AndHold()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, raceCount: 2);
        var client = await _f.AdminAsync();

        // 1. Mid-session change race name across heats
        var changeResp = await client.PutAsJsonAsync(
            $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}/races/{races[0]}",
            new ChangeSessionRaceRequest("Speed Weave", true));
        changeResp.EnsureSuccessStatusCode();
        var updatedSession = await changeResp.Content.ReadFromJsonAsync<SessionDto>();
        Assert.Equal("Speed Weave", updatedSession!.Heats[0].Races.First(r => r.Id == races[0]).Name);

        // 2. Score race 1, flag under review, then clear for re-run via DELETE /api/sessions/races/{raceId}/results
        using (var scope = _f.Services.CreateScope())
        {
            await Service(scope).ApplyRaceResultsAsync(races[0],
                new[] { new FinishingPlace(a.TeamIds[0], 1, false), new FinishingPlace(a.TeamIds[1], 2, false) }, null);
        }

        var reviewResp = await client.PutAsJsonAsync(
            $"/api/sessions/races/{races[0]}/results/{a.TeamIds[1]}/under-review",
            new SetUnderReviewRequest(true, "Line judge review"));
        reviewResp.EnsureSuccessStatusCode();

        var rerunResp = await client.DeleteAsync($"/api/sessions/races/{races[0]}/results");
        rerunResp.EnsureSuccessStatusCode();
        var rerunScore = await rerunResp.Content.ReadFromJsonAsync<RaceScoreDto>();
        Assert.Empty(rerunScore!.Results);

        // 3. Cancel race 2 across session
        var cancelResp = await client.DeleteAsync(
            $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}/races/{races[1]}");
        cancelResp.EnsureSuccessStatusCode();
        var afterCancel = await cancelResp.Content.ReadFromJsonAsync<SessionDto>();
        Assert.Single(afterCancel!.Heats[0].Races);

        // 4. Hold competition with custom resume time
        await _f.WithDbAsync(async db =>
        {
            var s = await db.Sessions.SingleAsync(x => x.Id == a.SessionId);
            s.Status = SessionStatus.Upcoming;
            s.StartedAt = null;
            s.ScheduledStart = new DateTime(2026, 6, 1, 13, 0, 0, DateTimeKind.Utc);
            await db.SaveChangesAsync();
        });
        var holdResp = await client.PostAsJsonAsync(
            $"/api/competitions/{a.CompetitionId}/sessions/hold",
            new HoldCompetitionRequest(ResumeTime: "14:30", PostAnnouncement: true));
        holdResp.EnsureSuccessStatusCode();
        var heldSessions = await holdResp.Content.ReadFromJsonAsync<List<SessionDto>>();
        // 14:30 is UK time, and on 1 June the UK is on BST, so it is 13:30 UTC.
        Assert.Equal(13, heldSessions!.Single(s => s.Id == a.SessionId).ScheduledStart!.Value.Hour);
        Assert.Equal(30, heldSessions!.Single(s => s.Id == a.SessionId).ScheduledStart!.Value.Minute);

        // 5. Toggle combined scoring mode on session and combine heats
        var modeResp = await client.PutAsJsonAsync(
            $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}/combined-scoring",
            new SetCombinedScoringRequest("BySection"));
        modeResp.EnsureSuccessStatusCode();
        var modeSession = await modeResp.Content.ReadFromJsonAsync<SessionDto>();
        Assert.Contains("[scoring:by-section]", modeSession!.Notes);

        var combineResp = await client.PostAsJsonAsync(
            $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}/combine-heat",
            new CombineHeatRequest(TeamIds: a.TeamIds, ScoringMode: "Combined"));
        combineResp.EnsureSuccessStatusCode();
        var combinedSession = await combineResp.Content.ReadFromJsonAsync<SessionDto>();
        Assert.Contains("[scoring:combined]", combinedSession!.Notes);
    }

    [Fact]
    public async Task ApplyRaceResults_LetteredFinalHeat_UsesOwnHeatEntryCountInsteadOfLargestSessionHeat()
    {
        var a = await _f.CreateArenaAsync(10);
        var (_, aFinalRaces) = await _f.AddHeatAsync(a.SessionId, a.TeamIds.Take(6), "A Final", 1);
        var (_, bFinalRaces) = await _f.AddHeatAsync(a.SessionId, a.TeamIds.Skip(6).Take(4), "B Final Part 1", 2);
        using var scope = _f.Services.CreateScope();
        var svc = Service(scope);

        var aResults = await svc.ApplyRaceResultsAsync(aFinalRaces[0],
            a.TeamIds.Take(6).Select((id, idx) => new FinishingPlace(id, idx + 1, false)).ToArray(), null);
        var bResults = await svc.ApplyRaceResultsAsync(bFinalRaces[0],
            a.TeamIds.Skip(6).Take(4).Select((id, idx) => new FinishingPlace(id, idx + 1, false)).ToArray(), null);

        Assert.Equal(new[] { 6.0, 5.0, 4.0, 3.0, 2.0, 1.0 }, aResults.Select(r => r.Points));
        // B Final has 4 teams so 1st place scores 4 points, not 6.
        Assert.Equal(new[] { 4.0, 3.0, 2.0, 1.0 }, bResults.Select(r => r.Points));
    }

    [Fact]
    public async Task DeadHeatPointsForPlace_SplitsTiedPlaces_AndSupportsDeadHeatDirective()
    {
        var a = await _f.CreateArenaAsync(4);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();
        var svc = Service(scope);

        Assert.Equal(4.5, svc.DeadHeatPointsForPlace(1, 2, 5, false));
        Assert.Equal(2.5, svc.DeadHeatPointsForPlace(2, 2, 4, false));

        var results = await svc.ApplyRaceResultsAsync(races[0],
            new[]
            {
                new FinishingPlace(a.TeamIds[0], 1, false, Note: "[dead-heat] Dead heat for 1st"),
                new FinishingPlace(a.TeamIds[1], 1, false, Note: "[dead-heat] Dead heat for 1st"),
                new FinishingPlace(a.TeamIds[2], 3, false),
                new FinishingPlace(a.TeamIds[3], 4, false),
            }, null);

        var byTeam = results.ToDictionary(r => r.TeamId, r => r.Points);
        Assert.Equal(3.5, byTeam[a.TeamIds[0]]);
        Assert.Equal(3.5, byTeam[a.TeamIds[1]]);
        Assert.Equal(2.0, byTeam[a.TeamIds[2]]);
        Assert.Equal(1.0, byTeam[a.TeamIds[3]]);
    }
    [Fact]
    public async Task LetteredFinal_KeepsProtectedFieldBaseAfterWithdrawal()
    {
        var arena = await _f.CreateArenaAsync(4);
        var (_, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, "A Final");
        using var scope = _f.Services.CreateScope();
        var service = Service(scope);
        var places = arena.TeamIds.Select((id, index) => new FinishingPlace(id, index + 1, false)).ToList();
        var original = await service.ApplyRaceResultsAsync(races[0], places, null);
        Assert.Equal(4, original.Single(r => r.TeamId == arena.TeamIds[0]).Points);
        await _f.WithDbAsync(async db =>
        {
            (await db.Teams.FindAsync(arena.TeamIds[3]))!.EntryStatus = TeamEntryStatus.Withdrawn;
            await db.SaveChangesAsync();
        });
        using var correctedScope = _f.Services.CreateScope();
        var corrected = await Service(correctedScope).ApplyRaceResultsAsync(races[0], places, null);
        Assert.Equal(4, corrected.Single(r => r.TeamId == arena.TeamIds[0]).Points);
    }
    [Fact]
    public async Task DeadHeat_InCombinedHeat_SplitsOnlyPlacesWithinTheScoredSection()
    {
        var arena = await _f.CreateArenaAsync(4);
        await _f.WithDbAsync(async db =>
        {
            var section = new CompetitionSection { CompetitionId = arena.CompetitionId, DisplayName = "Synthetic second section" };
            db.CompetitionSections.Add(section);
            await db.SaveChangesAsync();
            foreach (var id in arena.TeamIds.Skip(2)) (await db.Teams.FindAsync(id))!.CompetitionSectionId = section.Id;
            (await db.Sessions.FindAsync(arena.SessionId))!.Notes = ScoringService.ApplyScoringModeTag(null, CombinedHeatScoringMode.BySection);
            await db.SaveChangesAsync();
        });
        var (_, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        using var scope = _f.Services.CreateScope();
        var results = await Service(scope).ApplyRaceResultsAsync(races[0],
            [new(arena.TeamIds[0], 1, false, Note: "[dead-heat]"), new(arena.TeamIds[1], 3, false),
             new(arena.TeamIds[2], 1, false, Note: "[dead-heat]"), new(arena.TeamIds[3], 4, false)], null);
        Assert.Equal(2, results.Single(r => r.TeamId == arena.TeamIds[0]).Points);
        Assert.Equal(2, results.Single(r => r.TeamId == arena.TeamIds[2]).Points);
    }
}
