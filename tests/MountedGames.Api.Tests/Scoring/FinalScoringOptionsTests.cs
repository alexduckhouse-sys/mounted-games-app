using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

/// <summary>
/// The standard-format switches on a section: <c>HasFinal</c>, <c>CarryPointsIntoFinal</c> and <c>DoublePointsInFinal</c>
/// (see <see cref="SectionScoring"/> and docs/decisions.md, 25 Oct). Every combination of the two scoring switches is
/// checked in the live standings, the printed results and the season publication preview, and the endpoints that set them.
/// </summary>
public class FinalScoringOptionsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public FinalScoringOptionsTests(ApiFactory f) => _f = f;

    /// <summary>Teams 0 to 3. Earlier points 10, 7, 5 and 4. Teams 0 to 2 reach the A Final, which team 2 wins.</summary>
    private sealed record Setup(int CompetitionId, int SectionId, int[] Teams, int FinalSessionId, int FinalHeatId, int FinalRaceId);

    private static readonly double[] Earlier = [10, 7, 5, 4];

    private async Task<Setup> ArrangeAsync(bool carry, bool doubled, bool hasFinal = true, bool raceFinals = false, bool scoreFinal = true)
    {
        var ownerId = await _f.TrainerIdAsync();
        return await _f.WithDbAsync(async db =>
        {
            var competition = new Competition { Name = $"Final options {Guid.NewGuid():N}", StartDate = new DateTime(2033, 6, 1, 0, 0, 0, DateTimeKind.Utc), CreatedByUserId = ownerId };
            var club = new Club { Name = $"Options Club {Guid.NewGuid():N}" };
            db.AddRange(competition, club);
            await db.SaveChangesAsync();
            var section = new CompetitionSection
            {
                CompetitionId = competition.Id, Format = SectionFormat.Teams, AgeGroup = "Under 12", DisplayName = "Under 12",
                HasFinal = hasFinal, CarryPointsIntoFinal = carry, DoublePointsInFinal = doubled, UsesRaceFinals = raceFinals,
            };
            db.Add(section);
            await db.SaveChangesAsync();
            var teams = Enumerable.Range(0, 4).Select(i => new Team
            {
                CompetitionId = competition.Id, CompetitionSectionId = section.Id, ClubId = club.Id, Suffix = i.ToString(), DisplayName = $"Team {i}",
            }).ToArray();
            db.AddRange(teams);
            await db.SaveChangesAsync();

            var qualifying = new Session { CompetitionId = competition.Id, CompetitionSectionId = section.Id, Name = "Heats", OrderIndex = 1 };
            db.Add(qualifying);
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = qualifying.Id, Label = "Heat 1", OrderIndex = 1 };
            db.Add(heat);
            await db.SaveChangesAsync();
            var race = new Race { HeatId = heat.Id, Name = "Race", OrderIndex = 1, IsComplete = true };
            db.Add(race);
            await db.SaveChangesAsync();
            for (var i = 0; i < teams.Length; i++)
            {
                db.Add(new HeatEntry { HeatId = heat.Id, TeamId = teams[i].Id, LaneIndex = i + 1 });
                db.Add(new Result { RaceId = race.Id, TeamId = teams[i].Id, Placing = i + 1, Points = Earlier[i] });
            }

            var finals = new Session { CompetitionId = competition.Id, CompetitionSectionId = section.Id, Name = "Finals", OrderIndex = 2, LanesPerHeat = 3 };
            db.Add(finals);
            await db.SaveChangesAsync();
            var finalHeat = new Heat { SessionId = finals.Id, Label = "A Final", OrderIndex = 1 };
            db.Add(finalHeat);
            await db.SaveChangesAsync();
            var finalRace = new Race { HeatId = finalHeat.Id, Name = "Final race", OrderIndex = 1 };
            db.Add(finalRace);
            for (var i = 0; i < 3; i++) db.Add(new HeatEntry { HeatId = finalHeat.Id, TeamId = teams[i].Id, LaneIndex = i + 1 });
            await db.SaveChangesAsync();
            return new Setup(competition.Id, section.Id, teams.Select(t => t.Id).ToArray(), finals.Id, finalHeat.Id, finalRace.Id);
        }).ContinueWith(async t =>
        {
            var setup = await t;
            if (scoreFinal) await ScoreFinalAsync(setup);
            return setup;
        }).Unwrap();
    }

    /// <summary>Team 2 wins the final, team 1 is second, team 0 third.</summary>
    private async Task ScoreFinalAsync(Setup s)
    {
        using var scope = _f.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<ScoringService>().ApplyRaceResultsAsync(s.FinalRaceId,
            [new FinishingPlace(s.Teams[2], 1, false), new FinishingPlace(s.Teams[1], 2, false), new FinishingPlace(s.Teams[0], 3, false)], null);
    }

    private async Task<List<StandingRow>> StandingsAsync(Setup s)
        => await (await _f.CreateClient().GetAsync($"/api/competitions/{s.CompetitionId}/standings?sectionId={s.SectionId}")).ReadAsync<List<StandingRow>>();

    // ---- standings: every combination of the two scoring switches ----

    [Theory]
    // Final points are 3, 2, 1 for teams 2, 1, 0 (doubled: 6, 4, 2). Team 3 is not in the final.
    [InlineData(true, false, new[] { 0, 1, 2, 3 }, new[] { 11.0, 9.0, 8.0, 4.0 })]
    [InlineData(true, true, new[] { 0, 2, 1, 3 }, new[] { 12.0, 11.0, 11.0, 4.0 })]
    [InlineData(false, false, new[] { 2, 1, 0, 3 }, new[] { 3.0, 2.0, 1.0, 4.0 })]
    [InlineData(false, true, new[] { 2, 1, 0, 3 }, new[] { 6.0, 4.0, 2.0, 4.0 })]
    public async Task Standings_FollowTheCarryAndDoubleSwitches(bool carry, bool doubled, int[] order, double[] totals)
    {
        var s = await ArrangeAsync(carry, doubled);

        var rows = await StandingsAsync(s);

        Assert.Equal(order.Select(i => s.Teams[i]), rows.Select(r => r.TeamId));
        Assert.Equal(totals, rows.Select(r => r.TotalPoints));
        // Finalists always come before the team that missed the final, whatever its points.
        Assert.Equal(new int?[] { 0, 0, 0, null }, rows.Select(r => r.FinalTier));
        // The split is reported for finalists, so a table can show where a total came from.
        var winner = rows.Single(r => r.TeamId == s.Teams[2]);
        Assert.Equal((doubled ? 6.0 : 3.0, 5.0), (winner.FinalPoints, winner.EarlierPoints));
        Assert.Null(rows.Single(r => r.TeamId == s.Teams[3]).FinalPoints);
    }

    [Fact]
    public async Task FinalRacePointsAreDoubledWhenSaved_AndOnlyInTheFinal()
    {
        var s = await ArrangeAsync(carry: true, doubled: true);

        var saved = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => r.RaceId == s.FinalRaceId).ToDictionaryAsync(r => r.TeamId, r => r.Points));
        Assert.Equal((6.0, 4.0, 2.0), (saved[s.Teams[2]], saved[s.Teams[1]], saved[s.Teams[0]]));
        // The qualifying race is untouched.
        var earlier = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => r.Race!.Heat!.Label == "Heat 1" && r.Race.Heat.Session!.CompetitionId == s.CompetitionId)
            .OrderBy(r => r.TeamId).Select(r => r.Points).ToListAsync());
        Assert.Equal(Earlier, earlier);
    }

    [Fact]
    public async Task DoubledDeadHeatAndAdjustmentStayWholeOrHalf_AndAnExplicitScoreIsNotDoubled()
    {
        var s = await ArrangeAsync(carry: true, doubled: true, scoreFinal: false);
        using var scope = _f.Services.CreateScope();
        var scoring = scope.ServiceProvider.GetRequiredService<ScoringService>();

        // Two teams share first: (3 + 2) / 2 = 2.5 each, doubled to 5. Team 0 is third on 1, doubled to 2.
        await scoring.ApplyRaceResultsAsync(s.FinalRaceId,
            [new FinishingPlace(s.Teams[2], 1, false, Note: "[dead-heat]"), new FinishingPlace(s.Teams[1], 1, false, Note: "[dead-heat]"),
             new FinishingPlace(s.Teams[0], 3, false)], null);
        var dead = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => r.RaceId == s.FinalRaceId).ToDictionaryAsync(r => r.TeamId, r => r.Points));
        Assert.Equal((5.0, 5.0, 2.0), (dead[s.Teams[2]], dead[s.Teams[1]], dead[s.Teams[0]]));

        // A referee's [pts:N] is the figure they typed, so it is not doubled; [adj:+N] moves the doubled placing points.
        await scoring.ApplyRaceResultsAsync(s.FinalRaceId,
            [new FinishingPlace(s.Teams[2], 1, false, Note: "[pts:7]"), new FinishingPlace(s.Teams[1], 2, false, Note: "[adj:+1]"),
             new FinishingPlace(s.Teams[0], 3, false)], null, "reason");
        var directives = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => r.RaceId == s.FinalRaceId).ToDictionaryAsync(r => r.TeamId, r => r.Points));
        Assert.Equal((7.0, 5.0, 2.0), (directives[s.Teams[2]], directives[s.Teams[1]], directives[s.Teams[0]]));
    }

    [Fact]
    public async Task HeatHeatFinal_IgnoresEverySwitch()
    {
        // A section set to heat, heat, final stores the switches but never applies them.
        var s = await ArrangeAsync(carry: false, doubled: true, raceFinals: true, scoreFinal: false);
        await _f.WithDbAsync(async db =>
        {
            var heat = await db.Heats.SingleAsync(h => h.Id == s.FinalHeatId);
            heat.Label = "Race · Final";
            heat.RaceRoundStage = RaceRoundStage.Final;
            await db.SaveChangesAsync();
        });
        await ScoreFinalAsync(s);

        var saved = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => r.RaceId == s.FinalRaceId).ToDictionaryAsync(r => r.TeamId, r => r.Points));
        // A race final is scored on its own field of 3, plus one: 4, 3, 2, not doubled.
        Assert.Equal((4.0, 3.0, 2.0), (saved[s.Teams[2]], saved[s.Teams[1]], saved[s.Teams[0]]));
        var rows = await StandingsAsync(s);
        // Earlier and final points simply add up, in points order, with no tiers.
        Assert.Equal(new[] { 12.0, 10.0, 9.0, 4.0 }, rows.Select(r => r.TotalPoints));
        Assert.All(rows, r => Assert.Null(r.FinalTier));
    }

    // ---- ties inside a final ----

    [Fact]
    public async Task WhenPointsDoNotCarry_ATieInTheFinalIsSettledByTheFinalAlone()
    {
        var s = await ArrangeAsync(carry: false, doubled: false, scoreFinal: false);
        using var scope = _f.Services.CreateScope();
        // Teams 1 and 2 finish on the same final points through different placings: 2 and 1 against 1 and 2 over two races.
        await _f.WithDbAsync(async db =>
        {
            db.Add(new Race { HeatId = s.FinalHeatId, Name = "Second final race", OrderIndex = 2 });
            await db.SaveChangesAsync();
        });
        var raceIds = await _f.WithDbAsync(db => db.Races.Where(r => r.HeatId == s.FinalHeatId).OrderBy(r => r.OrderIndex).Select(r => r.Id).ToListAsync());
        var scoring = scope.ServiceProvider.GetRequiredService<ScoringService>();
        await scoring.ApplyRaceResultsAsync(raceIds[0], [new FinishingPlace(s.Teams[1], 1, false), new FinishingPlace(s.Teams[2], 2, false), new FinishingPlace(s.Teams[0], 3, false)], null);
        await scoring.ApplyRaceResultsAsync(raceIds[1], [new FinishingPlace(s.Teams[2], 1, false), new FinishingPlace(s.Teams[1], 2, false), new FinishingPlace(s.Teams[0], 3, false)], null);

        var rows = await StandingsAsync(s);

        // Teams 1 and 2 are level on 5. Team 1's earlier points (7 against 5) must not break the tie: their final
        // placings are identical (one win each), so the order falls to the last race, which team 2 won.
        Assert.Equal(new[] { 5.0, 5.0, 2.0 }, rows.Take(3).Select(r => r.TotalPoints));
        Assert.Equal(s.Teams[2], rows[0].TeamId);
    }

    [Fact]
    public async Task OrganiserTieOrder_UsesTheSameTotalsAsTheStandings()
    {
        var s = await ArrangeAsync(carry: false, doubled: false, scoreFinal: false);
        using (var scope = _f.Services.CreateScope())
        {
            var scoring = scope.ServiceProvider.GetRequiredService<ScoringService>();
            // Teams 0 and 1 share second place in the final: 2.5 each.
            await scoring.ApplyRaceResultsAsync(s.FinalRaceId,
                [new FinishingPlace(s.Teams[2], 1, false), new FinishingPlace(s.Teams[0], 2, false, Note: "[dead-heat]"),
                 new FinishingPlace(s.Teams[1], 2, false, Note: "[dead-heat]")], null);
        }
        var trainer = await _f.TrainerAsync();

        // On the final alone, teams 0 and 1 are level at 1.5 (their earlier 10 and 7 would have separated them).
        var response = await trainer.PutAsJsonAsync($"/api/competitions/{s.CompetitionId}/finals/tie-order", new SetTieOrderRequest([s.Teams[1], s.Teams[0]]));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var rows = await StandingsAsync(s);
        Assert.Equal(new[] { s.Teams[2], s.Teams[1], s.Teams[0] }, rows.Take(3).Select(r => r.TeamId));
    }

    // ---- other places that total a team ----

    [Theory]
    [InlineData(true, new[] { 11.0, 9.0, 8.0, 4.0 })]
    [InlineData(false, new[] { 1.0, 2.0, 3.0, 4.0 })]
    public async Task PrintedResults_TotalAFinalistTheSameWayAsTheStandings(bool carry, double[] totalsByTeam)
    {
        var s = await ArrangeAsync(carry, doubled: false);

        var results = await (await _f.CreateClient().GetAsync($"/api/event-tools/competitions/{s.CompetitionId}/print/results")).ReadAsync<PrintableResultsDto>();

        var rows = Assert.Single(results.Sections).Results;
        Assert.Equal(totalsByTeam, s.Teams.Select(id => rows.Single(r => r.TeamId == id).TotalPoints));
    }

    [Theory]
    [InlineData(true, new[] { 11.0, 9.0, 8.0, 4.0 })]
    [InlineData(false, new[] { 1.0, 2.0, 3.0, 4.0 })]
    public async Task SeasonPreview_TotalsAFinalistTheSameWayAsTheStandings(bool carry, double[] totalsByTeam)
    {
        var s = await ArrangeAsync(carry, doubled: false);
        await _f.WithDbAsync(async db =>
        {
            foreach (var race in await db.Races.Where(r => r.Heat!.Session!.CompetitionId == s.CompetitionId).ToListAsync()) race.IsComplete = true;
            await db.SaveChangesAsync();
            // The preview wants a result for every team in every race.
            var qualifier = await db.Races.SingleAsync(r => r.Heat!.Label == "Heat 1" && r.Heat.Session!.CompetitionId == s.CompetitionId);
            Assert.Equal(4, await db.Results.CountAsync(r => r.RaceId == qualifier.Id));
        });
        var trainer = await _f.TrainerAsync();
        var season = await (await trainer.PostAsJsonAsync("/api/seasons", new CreateSeasonRequest(
            "Options league", 2033, SectionFormat.Teams, "Under 12", null, [new(1, 10), new(2, 8), new(3, 6), new(4, 4)]))).ReadAsync<SeasonDto>();
        var round = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds", new AddSeasonRoundRequest(s.SectionId))).ReadAsync<SeasonRoundDto>();
        await TeamProfilesAsync(trainer, s);

        var response = await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview");
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var preview = await response.ReadAsync<SeasonPublicationPreviewDto>();

        Assert.Equal(totalsByTeam, s.Teams.Select(id => preview.Results.Single(r => r.EventTeamId == id).EventPoints));
    }

    private async Task TeamProfilesAsync(HttpClient trainer, Setup s)
    {
        var ownerId = await _f.TrainerIdAsync();
        await _f.WithDbAsync(async db =>
        {
            var clubId = await db.Teams.Where(t => t.Id == s.Teams[0]).Select(t => t.ClubId).SingleAsync();
            foreach (var id in s.Teams)
            {
                var profile = new TeamProfile { OwnerUserId = ownerId, ClubId = clubId, Suffix = id.ToString(), DisplayName = $"Profile {id}" };
                db.Set<TeamProfile>().Add(profile);
                await db.SaveChangesAsync();
                db.Set<EventTeamProfileLink>().Add(new EventTeamProfileLink { TeamProfileId = profile.Id, CompetitionId = s.CompetitionId, TeamId = id, LinkedByUserId = ownerId });
            }
            await db.SaveChangesAsync();
        });
    }

    // ---- no final ----

    [Fact]
    public async Task WithNoFinal_StandingsAreJustPoints_AndNoFinalCanBeMade()
    {
        var s = await ArrangeAsync(carry: false, doubled: true, hasFinal: false, scoreFinal: false);
        // The arrangement carries a final session as scaffolding; remove it so this is a section that ends with its heats.
        await _f.WithDbAsync(async db =>
        {
            db.Races.RemoveRange(db.Races.Where(r => r.HeatId == s.FinalHeatId));
            db.HeatEntries.RemoveRange(db.HeatEntries.Where(e => e.HeatId == s.FinalHeatId));
            db.Heats.RemoveRange(db.Heats.Where(h => h.Id == s.FinalHeatId));
            await db.SaveChangesAsync();
        });
        var trainer = await _f.TrainerAsync();

        var rows = await StandingsAsync(s);
        Assert.Equal(new[] { 10.0, 7.0, 5.0, 4.0 }, rows.Select(r => r.TotalPoints));
        Assert.All(rows, r => Assert.Null(r.FinalTier));

        var create = new { competitionSectionId = s.SectionId, topN = 3, lanesPerHeat = 3, raceNames = new[] { "Final race" } };
        Assert.Equal(HttpStatusCode.Conflict, (await trainer.PostAsJsonAsync($"/api/competitions/{s.CompetitionId}/finals", create)).StatusCode);
        var scaffold = new { competitionSectionId = s.SectionId, numHeats = 1, lanesPerHeat = 3, raceNames = new[] { "Final race" } };
        Assert.Equal(HttpStatusCode.Conflict, (await trainer.PostAsJsonAsync($"/api/competitions/{s.CompetitionId}/finals/scaffold", scaffold)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await trainer.PostAsync($"/api/competitions/{s.CompetitionId}/sessions/{s.FinalSessionId}/populate-finals", null)).StatusCode);
    }

    [Fact]
    public async Task AFinalCanStillBeMade_WhenTheSectionHasOne()
    {
        var s = await ArrangeAsync(carry: true, doubled: false, scoreFinal: false);
        await _f.WithDbAsync(async db =>
        {
            db.Races.RemoveRange(db.Races.Where(r => r.HeatId == s.FinalHeatId));
            db.HeatEntries.RemoveRange(db.HeatEntries.Where(e => e.HeatId == s.FinalHeatId));
            db.Heats.RemoveRange(db.Heats.Where(h => h.Id == s.FinalHeatId));
            await db.SaveChangesAsync();
        });
        var trainer = await _f.TrainerAsync();

        var response = await trainer.PostAsJsonAsync($"/api/competitions/{s.CompetitionId}/finals/scaffold",
            new { competitionSectionId = s.SectionId, numHeats = 1, lanesPerHeat = 3, raceNames = new[] { "Final race" } });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---- section endpoints ----

    [Fact]
    public async Task NewSections_DefaultToAFinalThatIsScoredOnItsOwnAtSinglePoints()
    {
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        var trainer = await _f.TrainerAsync();

        var response = await trainer.PostAsJsonAsync($"/api/competitions/{competitionId}/sections", new CreateSectionRequest(SectionFormat.Teams, "Under 14", null));
        var section = await response.ReadAsync<CompetitionSectionDto>();

        Assert.Equal((true, false, false), (section.HasFinal, section.CarryPointsIntoFinal, section.DoublePointsInFinal));
    }

    [Fact]
    public async Task SectionsCanBeCreatedAndUpdatedWithTheSwitches_AndOmittedOnesStay()
    {
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        var trainer = await _f.TrainerAsync();
        var created = await (await trainer.PostAsJsonAsync($"/api/competitions/{competitionId}/sections",
            new CreateSectionRequest(SectionFormat.Teams, "Under 16", null, HasFinal: false, CarryPointsIntoFinal: true, DoublePointsInFinal: true))).ReadAsync<CompetitionSectionDto>();
        Assert.Equal((false, true, true), (created.HasFinal, created.CarryPointsIntoFinal, created.DoublePointsInFinal));

        // Only carry is sent: the other two stay.
        var carryOff = await (await trainer.PutAsJsonAsync($"/api/competitions/{competitionId}/sections/{created.Id}",
            new UpdateSectionRequest(null, CarryPointsIntoFinal: false))).ReadAsync<CompetitionSectionDto>();
        Assert.Equal((false, false, true), (carryOff.HasFinal, carryOff.CarryPointsIntoFinal, carryOff.DoublePointsInFinal));

        var hasFinal = await (await trainer.PutAsJsonAsync($"/api/competitions/{competitionId}/sections/{created.Id}",
            new UpdateSectionRequest(null, HasFinal: true, DoublePointsInFinal: false))).ReadAsync<CompetitionSectionDto>();
        Assert.Equal((true, false, false), (hasFinal.HasFinal, hasFinal.CarryPointsIntoFinal, hasFinal.DoublePointsInFinal));
        var listed = await (await trainer.GetAsync($"/api/competitions/{competitionId}")).ReadAsync<CompetitionDetail>();
        Assert.Equal((true, false, false), (listed.Sections[0].HasFinal, listed.Sections[0].CarryPointsIntoFinal, listed.Sections[0].DoublePointsInFinal));
    }

    [Fact]
    public async Task HeatHeatFinalSectionsRefuseTheSwitches()
    {
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        var trainer = await _f.TrainerAsync();
        var url = $"/api/competitions/{competitionId}/sections";
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(url,
            new CreateSectionRequest(SectionFormat.Teams, "A", null, UsesRaceFinals: true, HasFinal: false))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(url,
            new CreateSectionRequest(SectionFormat.Teams, "B", null, UsesRaceFinals: true, CarryPointsIntoFinal: true))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(url,
            new CreateSectionRequest(SectionFormat.Teams, "C", null, UsesRaceFinals: true, DoublePointsInFinal: true))).StatusCode);
        var ok = await (await trainer.PostAsJsonAsync(url, new CreateSectionRequest(SectionFormat.Teams, "D", null, UsesRaceFinals: true))).ReadAsync<CompetitionSectionDto>();

        // Updating: turning heat, heat, final on while setting a switch, or setting one on such a section, is refused.
        var standard = await (await trainer.PostAsJsonAsync(url, new CreateSectionRequest(SectionFormat.Teams, "E", null))).ReadAsync<CompetitionSectionDto>();
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync($"{url}/{standard.Id}",
            new UpdateSectionRequest(null, UsesRaceFinals: true, DoublePointsInFinal: true))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync($"{url}/{ok.Id}", new UpdateSectionRequest(null, HasFinal: false))).StatusCode);
        // Turning switches off (or leaving them) on a heat, heat, final section is fine, and so is the plain old editor payload.
        Assert.Equal(HttpStatusCode.OK, (await trainer.PutAsJsonAsync($"{url}/{ok.Id}", new UpdateSectionRequest(null, UsesRaceFinals: true))).StatusCode);
    }

    [Fact]
    public async Task AFinalThatExistsCannotBeSwitchedOff_AndDoubleCannotChangeOnceScored()
    {
        var s = await ArrangeAsync(carry: false, doubled: false, scoreFinal: false);
        var trainer = await _f.TrainerAsync();
        var url = $"/api/competitions/{s.CompetitionId}/sections/{s.SectionId}";

        // The final exists: it can't be switched off, but nothing is scored, so double can change and carry always can.
        Assert.Equal(HttpStatusCode.Conflict, (await trainer.PutAsJsonAsync(url, new UpdateSectionRequest(null, HasFinal: false))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await trainer.PutAsJsonAsync(url, new UpdateSectionRequest(null, DoublePointsInFinal: true))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await trainer.PutAsJsonAsync(url, new UpdateSectionRequest(null, DoublePointsInFinal: true))).StatusCode);

        await ScoreFinalAsync(s);

        var refused = await trainer.PutAsJsonAsync(url, new UpdateSectionRequest(null, DoublePointsInFinal: false));
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await trainer.PutAsJsonAsync(url, new UpdateSectionRequest(null, DoublePointsInFinal: true))).StatusCode);
        var carry = await trainer.PutAsJsonAsync(url, new UpdateSectionRequest(null, CarryPointsIntoFinal: true));
        Assert.True((await carry.ReadAsync<CompetitionSectionDto>()).CarryPointsIntoFinal);
        var rows = await StandingsAsync(s);
        Assert.Equal(12.0, rows[0].TotalPoints);
    }

    [Fact]
    public async Task SectionSwitches_NeedAStaffMemberOfThatCompetition()
    {
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        var sectionId = await _f.SeedSectionAsync(competitionId);
        var url = $"/api/competitions/{competitionId}/sections/{sectionId}";
        var body = new UpdateSectionRequest(null, DoublePointsInFinal: true);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PutAsJsonAsync(url, body)).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PutAsJsonAsync(url, body)).StatusCode);
        var (other, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync(url, body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).PutAsJsonAsync(url, body)).StatusCode);
    }

    // ---- upgrade ----

    [Fact]
    public async Task ExistingSqliteSectionsGainTheColumns_AndKeepCarryingPointsIntoTheFinal()
    {
        var sectionId = await _f.SeedSectionAsync(await _f.SeedCompetitionAsync());
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE CompetitionSections DROP COLUMN HasFinal; ALTER TABLE CompetitionSections DROP COLUMN CarryPointsIntoFinal; ALTER TABLE CompetitionSections DROP COLUMN DoublePointsInFinal;");

        await DbInitializer.SeedAsync(_f.Services);

        db.ChangeTracker.Clear();
        var section = await db.CompetitionSections.AsNoTracking().SingleAsync(x => x.Id == sectionId);
        Assert.Equal((true, true, false), (section.HasFinal, section.CarryPointsIntoFinal, section.DoublePointsInFinal));
    }
}
