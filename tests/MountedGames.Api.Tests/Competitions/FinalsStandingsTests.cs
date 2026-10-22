using System.Net.Http.Json;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

/// <summary>
/// Overall standings once finals exist: the final a team is in decides its place before points do,
/// so a B or C finalist can't overtake an A finalist. Covers the live standings, the printable results
/// and the season publication preview, which all use <see cref="FinalsTiers"/>.
/// </summary>
public class FinalsStandingsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public FinalsStandingsTests(ApiFactory f) => _f = f;

    private record Setup(int CompetitionId, int SectionId, int[] Teams, Guid[] Profiles);

    /// <summary>
    /// Five teams in one section. Qualifier points are 10, 6, 8, 4 and 20 (team 4 never reaches a final).
    /// A Final: teams 0 and 1 (2 and 1 points). B Final: teams 2 and 3 (2 and 1 points). Totals: 12, 7, 10, 5, 20,
    /// so by points alone team 2 (B Final) would sit above team 1 (A Final) and team 4 would be first.
    /// </summary>
    private async Task<Setup> ArrangeAsync(bool withFinals = true)
    {
        var ownerId = await _f.TrainerIdAsync();
        return await _f.WithDbAsync(async db =>
        {
            var competition = new Competition { Name = $"Tiers {Guid.NewGuid():N}", StartDate = new DateTime(2032, 6, 1, 0, 0, 0, DateTimeKind.Utc), CreatedByUserId = ownerId };
            var club = new Club { Name = $"Tiers Club {Guid.NewGuid():N}" };
            db.AddRange(competition, club);
            await db.SaveChangesAsync();
            var section = new CompetitionSection { CompetitionId = competition.Id, Format = SectionFormat.Teams, AgeGroup = "Under 12", DisplayName = "Under 12" };
            db.Add(section);
            await db.SaveChangesAsync();
            var teams = Enumerable.Range(0, 5).Select(i => new Team
            {
                CompetitionId = competition.Id, CompetitionSectionId = section.Id, ClubId = club.Id,
                Suffix = i.ToString(), DisplayName = $"Team {i}",
            }).ToArray();
            var profiles = teams.Select((t, i) => new TeamProfile { OwnerUserId = ownerId, ClubId = club.Id, Suffix = i.ToString(), DisplayName = t.DisplayName }).ToArray();
            db.AddRange(teams);
            db.Set<TeamProfile>().AddRange(profiles);
            await db.SaveChangesAsync();
            for (var i = 0; i < teams.Length; i++)
                db.Set<EventTeamProfileLink>().Add(new EventTeamProfileLink { TeamProfileId = profiles[i].Id, CompetitionId = competition.Id, TeamId = teams[i].Id, LinkedByUserId = ownerId });
            await db.SaveChangesAsync();

            await AddScoredHeatAsync(db, competition.Id, section.Id, "Qualifier", 1, "Heat 1",
                teams.Select((t, i) => (t.Id, new[] { 10, 6, 8, 4, 20 }[i])).ToArray());
            if (withFinals)
            {
                var finals = new Session { CompetitionId = competition.Id, CompetitionSectionId = section.Id, Name = "Finals", OrderIndex = 2 };
                db.Add(finals);
                await db.SaveChangesAsync();
                await AddScoredFinalAsync(db, finals.Id, "A Final", 1, (teams[0].Id, 2), (teams[1].Id, 1));
                await AddScoredFinalAsync(db, finals.Id, "B Final", 2, (teams[2].Id, 2), (teams[3].Id, 1));
            }
            return new Setup(competition.Id, section.Id, teams.Select(t => t.Id).ToArray(), profiles.Select(p => p.Id).ToArray());
        });
    }

    private static async Task AddScoredHeatAsync(MountedGames.Api.Data.AppDbContext db, int competitionId, int sectionId,
        string sessionName, int order, string label, (int TeamId, int Points)[] results)
    {
        var session = new Session { CompetitionId = competitionId, CompetitionSectionId = sectionId, Name = sessionName, OrderIndex = order };
        db.Add(session);
        await db.SaveChangesAsync();
        await AddScoredFinalAsync(db, session.Id, label, 1, results);
    }

    private static async Task AddScoredFinalAsync(MountedGames.Api.Data.AppDbContext db, int sessionId, string label, int order,
        params (int TeamId, int Points)[] results)
    {
        var heat = new Heat { SessionId = sessionId, Label = label, OrderIndex = order };
        db.Add(heat);
        await db.SaveChangesAsync();
        var lane = 1;
        foreach (var (teamId, _) in results) db.Add(new HeatEntry { HeatId = heat.Id, TeamId = teamId, LaneIndex = lane++ });
        var race = new Race { HeatId = heat.Id, Name = "Race", OrderIndex = 1, IsComplete = true };
        db.Add(race);
        await db.SaveChangesAsync();
        var place = 1;
        foreach (var (teamId, points) in results.OrderByDescending(r => r.Points))
            db.Add(new Result { RaceId = race.Id, TeamId = teamId, Placing = place++, Points = points });
        await db.SaveChangesAsync();
    }

    // ---- FinalsTiers ----

    [Theory]
    [InlineData("A Final", 0)]
    [InlineData("B Final", 1)]
    [InlineData("c final", 2)]
    [InlineData("  D Final ", 3)]
    public void ParseLabel_ReadsLetteredFinals(string label, int tier)
        => Assert.Equal(tier, FinalsTiers.ParseLabel(label));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Heat 1")]
    [InlineData("Final")]
    [InlineData("1 Final")]
    [InlineData("AB Final")]
    [InlineData("Relay · Final")]
    public void ParseLabel_IgnoresEverythingElse(string? label)
        => Assert.Null(FinalsTiers.ParseLabel(label));

    // ---- live standings ----

    [Fact]
    public async Task Standings_PutAFinalistsAboveBFinalists_ThenPointsWithinEachTier()
    {
        var s = await ArrangeAsync();

        var rows = await (await _f.CreateClient().GetAsync($"/api/competitions/{s.CompetitionId}/standings?sectionId={s.SectionId}"))
            .ReadAsync<List<StandingRow>>();

        // A Final (12, 7), B Final (10, 5), then the team that never reached a final (20).
        Assert.Equal(new[] { s.Teams[0], s.Teams[1], s.Teams[2], s.Teams[3], s.Teams[4] }, rows.Select(r => r.TeamId));
        Assert.Equal(new int?[] { 0, 0, 1, 1, null }, rows.Select(r => r.FinalTier));
        Assert.Equal(new[] { 12, 7, 10, 5, 20 }, rows.Select(r => r.TotalPoints));
    }

    [Fact]
    public async Task Standings_StayInPointsOrder_WhenTheSectionHasNoFinals()
    {
        var s = await ArrangeAsync(withFinals: false);

        var rows = await (await _f.CreateClient().GetAsync($"/api/competitions/{s.CompetitionId}/standings?sectionId={s.SectionId}"))
            .ReadAsync<List<StandingRow>>();

        Assert.Equal(new[] { s.Teams[4], s.Teams[0], s.Teams[2], s.Teams[1], s.Teams[3] }, rows.Select(r => r.TeamId));
        Assert.All(rows, r => Assert.Null(r.FinalTier));
    }

    [Fact]
    public async Task Standings_IgnoreHeatsThatAreNotLetteredFinals()
    {
        var s = await ArrangeAsync(withFinals: false);
        await _f.WithDbAsync(async db =>
        {
            var session = new Session { CompetitionId = s.CompetitionId, CompetitionSectionId = s.SectionId, Name = "Race finals", OrderIndex = 2 };
            db.Add(session);
            await db.SaveChangesAsync();
            // A race-finals heat is a final, but not one of the A/B/C tiers.
            db.Add(new Heat { SessionId = session.Id, Label = "Bending · Final", OrderIndex = 1, RaceRoundStage = RaceRoundStage.Final,
                Entries = { new HeatEntry { TeamId = s.Teams[3], LaneIndex = 1 } } });
            await db.SaveChangesAsync();
        });

        var rows = await (await _f.CreateClient().GetAsync($"/api/competitions/{s.CompetitionId}/standings?sectionId={s.SectionId}"))
            .ReadAsync<List<StandingRow>>();

        Assert.Equal(s.Teams[4], rows[0].TeamId);
        Assert.All(rows, r => Assert.Null(r.FinalTier));
    }

    // ---- printable results ----

    [Fact]
    public async Task PrintableResults_RankByFinalTierFirst()
    {
        var s = await ArrangeAsync();

        var results = await (await _f.CreateClient().GetAsync($"/api/event-tools/competitions/{s.CompetitionId}/print/results"))
            .ReadAsync<PrintableResultsDto>();

        var rows = Assert.Single(results.Sections).Results;
        Assert.Equal(new[] { s.Teams[0], s.Teams[1], s.Teams[2], s.Teams[3], s.Teams[4] }, rows.Select(r => r.TeamId));
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, rows.Select(r => r.Rank));
    }

    [Fact]
    public async Task PrintableResults_DoNotShareARankAcrossFinals()
    {
        var s = await ArrangeAsync();
        await _f.WithDbAsync(async db =>
        {
            // Team 2 (B Final) and team 1 (A Final) now both total 7: different finals, so different ranks.
            var result = db.Results.Single(r => r.TeamId == s.Teams[2] && r.Race!.Heat!.Label == "B Final");
            result.Points = -1;
            await db.SaveChangesAsync();
        });

        var rows = Assert.Single((await (await _f.CreateClient().GetAsync($"/api/event-tools/competitions/{s.CompetitionId}/print/results"))
            .ReadAsync<PrintableResultsDto>()).Sections).Results;

        Assert.Equal(7, rows.Single(r => r.TeamId == s.Teams[1]).TotalPoints);
        Assert.Equal(7, rows.Single(r => r.TeamId == s.Teams[2]).TotalPoints);
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, rows.Select(r => r.Rank));
    }

    [Fact]
    public async Task PrintableResults_StayInPointsOrder_WhenTheSectionHasNoFinals()
    {
        var s = await ArrangeAsync(withFinals: false);

        var rows = Assert.Single((await (await _f.CreateClient().GetAsync($"/api/event-tools/competitions/{s.CompetitionId}/print/results"))
            .ReadAsync<PrintableResultsDto>()).Sections).Results;

        Assert.Equal(new[] { s.Teams[4], s.Teams[0], s.Teams[2], s.Teams[1], s.Teams[3] }, rows.Select(r => r.TeamId));
    }

    // ---- season publication ----

    private async Task<SeasonPublicationPreviewDto> PreviewAsync(Setup s)
    {
        var trainer = await _f.TrainerAsync();
        var season = await (await trainer.PostAsJsonAsync("/api/seasons", new CreateSeasonRequest(
            "Tier league", 2032, SectionFormat.Teams, "Under 12", null,
            [new(1, 10), new(2, 8), new(3, 6), new(4, 4), new(5, 2)]))).ReadAsync<SeasonDto>();
        var round = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds",
            new AddSeasonRoundRequest(s.SectionId))).ReadAsync<SeasonRoundDto>();
        var response = await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview");
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return await response.ReadAsync<SeasonPublicationPreviewDto>();
    }

    [Fact]
    public async Task SeasonPreview_RanksByFinalTierFirst()
    {
        var s = await ArrangeAsync();

        var preview = await PreviewAsync(s);

        Assert.Equal(new[] { s.Teams[0], s.Teams[1], s.Teams[2], s.Teams[3], s.Teams[4] }, preview.Results.Select(r => r.EventTeamId));
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, preview.Results.Select(r => r.EventRank));
        Assert.Equal(new[] { 10, 8, 6, 4, 2 }, preview.Results.Select(r => r.SeasonPoints));
    }

    [Fact]
    public async Task SeasonPreview_StaysInPointsOrder_WhenTheSectionHasNoFinals()
    {
        var s = await ArrangeAsync(withFinals: false);

        var preview = await PreviewAsync(s);

        Assert.Equal(new[] { s.Teams[4], s.Teams[0], s.Teams[2], s.Teams[1], s.Teams[3] }, preview.Results.Select(r => r.EventTeamId));
    }
}
