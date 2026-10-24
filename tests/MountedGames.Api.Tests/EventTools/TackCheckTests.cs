using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.EventTools;

/// <summary>Tack check per age group: set-up, marks, the Tack &amp; Turnout table, bonus points in standings and the printable form.</summary>
public class TackCheckTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public TackCheckTests(ApiFactory f) => _f = f;

    private static string Base(int id) => $"/api/event-tools/competitions/{id}";

    /// <summary>A competition owned by a fresh trainer, with three teams who have ridden one race: 3, 2 and 1 points.</summary>
    private async Task<(Arena Arena, HttpClient Owner)> WorldAsync(bool scored = true)
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync(3);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });
        if (scored)
        {
            var (_, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, "Heat 1", 1);
            (await (await _f.AdminAsync()).PostAsJsonAsync($"/api/races/{races[0]}/results", new SubmitRaceResultsRequest(new[]
            {
                new FinishingPlaceDto(arena.TeamIds[0], 1, false), new FinishingPlaceDto(arena.TeamIds[1], 2, false),
                new FinishingPlaceDto(arena.TeamIds[2], 3, false),
            }))).EnsureSuccessStatusCode();
        }
        return (arena, owner);
    }

    private static SaveTackCheckSettingsRequest Settings(TackCheckMode mode, bool enabled = true, int max = 10, params SaveTackCheckSectorRow[] sectors)
        => new(enabled, mode, max, sectors.Length > 0 ? sectors : [new SaveTackCheckSectorRow(null, "Saddle/Girth"), new SaveTackCheckSectorRow(null, "Turnout")]);

    private static async Task<TackCheckSectionDto> SetUpAsync(HttpClient client, Arena arena, TackCheckMode mode)
    {
        var response = await client.PutAsJsonAsync($"{Base(arena.CompetitionId)}/tack-check/sections/{arena.SectionId}", Settings(mode));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<TackCheckSectionDto>();
    }

    private static Task<HttpResponseMessage> MarkAsync(HttpClient client, Arena arena, int teamId, params TackCheckMarkDto[] marks)
        => client.PutAsJsonAsync($"{Base(arena.CompetitionId)}/tack-check/sections/{arena.SectionId}/teams/{teamId}", new SaveTackCheckMarksRequest(marks));

    private async Task<List<StandingRow>> StandingsAsync(Arena arena)
        => await (await _f.CreateClient().GetAsync($"/api/competitions/{arena.CompetitionId}/standings?sectionId={arena.SectionId}")).ReadAsync<List<StandingRow>>();

    // ---- who may call what ----

    [Fact]
    public async Task StaffEndpoints_RefuseAnonymousMembersAndOtherTrainers()
    {
        var (arena, owner) = await WorldAsync(scored: false);
        var id = arena.CompetitionId;
        var (member, _) = await _f.SignupAsync("Member");
        var other = await _f.TrainerAsync();
        var anonymous = _f.CreateClient();
        var settings = Settings(TackCheckMode.PassFail);
        var marks = new SaveTackCheckMarksRequest([]);

        foreach (var url in new[] { $"{Base(id)}/tack-check", $"{Base(id)}/print/tack-check" })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).GetAsync(url)).StatusCode);
        }
        var settingsUrl = $"{Base(id)}/tack-check/sections/{arena.SectionId}";
        var marksUrl = $"{settingsUrl}/teams/{arena.TeamIds[0]}";
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PutAsJsonAsync(settingsUrl, settings)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PutAsJsonAsync(settingsUrl, settings)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync(settingsUrl, settings)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PutAsJsonAsync(marksUrl, marks)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync(marksUrl, marks)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PutAsJsonAsync(settingsUrl, settings)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.AdminAsync()).GetAsync($"{Base(999999)}/print/tack-check")).StatusCode);
    }

    // ---- set-up ----

    [Fact]
    public async Task Board_ShowsTheDefaultSectorsUntilSetUp()
    {
        var (arena, owner) = await WorldAsync(scored: false);
        var board = await (await owner.GetAsync($"{Base(arena.CompetitionId)}/tack-check")).ReadAsync<TackCheckBoardDto>();
        var section = Assert.Single(board.Sections);
        Assert.False(section.Configured);
        Assert.False(section.IsEnabled);
        Assert.Equal(TackCheckMode.PassFail, section.Mode);
        Assert.Equal(10, section.MaxPoints);
        Assert.Equal(["Saddle/Girth", "Bridle/Bit", "Rider Hat/Boots", "Turnout"], section.Sectors.Select(s => s.Name));
        Assert.All(section.Sectors, s => Assert.Equal(0, s.Id));
        Assert.Equal(3, section.Teams.Count);
    }

    [Fact]
    public async Task Settings_AreValidated()
    {
        var (arena, owner) = await WorldAsync(scored: false);
        var url = $"{Base(arena.CompetitionId)}/tack-check/sections/{arena.SectionId}";
        async Task<HttpStatusCode> Put(SaveTackCheckSettingsRequest r, string? at = null) => (await owner.PutAsJsonAsync(at ?? url, r)).StatusCode;

        Assert.Equal(HttpStatusCode.BadRequest, await Put(new SaveTackCheckSettingsRequest(true, TackCheckMode.PassFail, 10, [])));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Settings(TackCheckMode.PassFail, sectors: [new(null, "Bit"), new(null, " bit ")])));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Settings(TackCheckMode.PassFail, sectors: [new(null, "  ")])));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Settings((TackCheckMode)9)));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Settings(TackCheckMode.Leaderboard, max: 0)));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Settings(TackCheckMode.PassFail, sectors: [new(424242, "Bit")])));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(new SaveTackCheckSettingsRequest(true, TackCheckMode.PassFail, 10,
            Enumerable.Range(1, 13).Select(i => new SaveTackCheckSectorRow(null, $"S{i}")).ToList())));
        Assert.Equal(HttpStatusCode.NotFound, await Put(Settings(TackCheckMode.PassFail), $"{Base(arena.CompetitionId)}/tack-check/sections/999999"));
    }

    [Fact]
    public async Task Settings_RenameKeepsMarks_AndARemovedSectorTakesItsMarksWithIt()
    {
        var (arena, owner) = await WorldAsync(scored: false);
        var section = await SetUpAsync(owner, arena, TackCheckMode.Leaderboard);
        Assert.True(section.Configured);
        var saddle = section.Sectors[0].Id;
        var turnout = section.Sectors[1].Id;
        Assert.Equal(HttpStatusCode.OK, (await MarkAsync(owner, arena, arena.TeamIds[0], new TackCheckMarkDto(saddle, null, 7), new TackCheckMarkDto(turnout, null, 4))).StatusCode);

        var url = $"{Base(arena.CompetitionId)}/tack-check/sections/{arena.SectionId}";
        var renamed = await (await owner.PutAsJsonAsync(url, Settings(TackCheckMode.Leaderboard, sectors:
            [new SaveTackCheckSectorRow(turnout, "Turnout and plaits"), new SaveTackCheckSectorRow(null, "Hat")]))).ReadAsync<TackCheckSectionDto>();

        Assert.Equal(["Turnout and plaits", "Hat"], renamed.Sectors.Select(s => s.Name));
        Assert.Equal(turnout, renamed.Sectors[0].Id);
        var team = renamed.Teams.Single(t => t.TeamId == arena.TeamIds[0]);
        Assert.Equal(4, Assert.Single(team.Marks).Points);
        Assert.Equal(4, team.Total);
        Assert.Equal(0, await _f.WithDbAsync(db => db.Set<TackCheckMark>().CountAsync(m => m.TackCheckSectorId == saddle)));
    }

    // ---- marks ----

    [Fact]
    public async Task Marks_AreRefusedUntilTheCheckIsOn_AndValidated()
    {
        var (arena, owner) = await WorldAsync(scored: false);
        Assert.Equal(HttpStatusCode.Conflict, (await MarkAsync(owner, arena, arena.TeamIds[0])).StatusCode);
        var off = await (await owner.PutAsJsonAsync($"{Base(arena.CompetitionId)}/tack-check/sections/{arena.SectionId}",
            Settings(TackCheckMode.PassFail, enabled: false))).ReadAsync<TackCheckSectionDto>();
        Assert.Equal(HttpStatusCode.Conflict, (await MarkAsync(owner, arena, arena.TeamIds[0], new TackCheckMarkDto(off.Sectors[0].Id, true, null))).StatusCode);

        var section = await SetUpAsync(owner, arena, TackCheckMode.BonusPoints);
        var sector = section.Sectors[0].Id;
        Assert.Equal(HttpStatusCode.BadRequest, (await MarkAsync(owner, arena, arena.TeamIds[0], new TackCheckMarkDto(sector, null, 11))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await MarkAsync(owner, arena, arena.TeamIds[0], new TackCheckMarkDto(424242, null, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await MarkAsync(owner, arena, arena.TeamIds[0], new TackCheckMarkDto(sector, null, 1), new TackCheckMarkDto(sector, null, 2))).StatusCode);

        var otherTeam = (await _f.CreateArenaAsync(1)).TeamIds[0];
        Assert.Equal(HttpStatusCode.NotFound, (await MarkAsync(owner, arena, otherTeam, new TackCheckMarkDto(sector, null, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.PutAsJsonAsync($"{Base(arena.CompetitionId)}/tack-check/sections/999999/teams/{arena.TeamIds[0]}",
            new SaveTackCheckMarksRequest([]))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await MarkAsync(owner, arena, arena.TeamIds[0], new TackCheckMarkDto(sector, null, null, [11]))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await MarkAsync(owner, arena, arena.TeamIds[0], new TackCheckMarkDto(sector, null, null, Enumerable.Repeat((int?)5, 11).ToList()))).StatusCode);
    }

    [Fact]
    public async Task PerRiderMarks_SumIntoSectorAndTeamTotals_AndExposeDeclaredOrDefaultRiders()
    {
        var (arena, owner) = await WorldAsync(scored: false);
        await _f.WithDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = arena.TeamIds[0], SubmittedAt = DateTime.UtcNow,
                Riders =
                {
                    new RiderEntry { FullName = "Amy Archer", OrderIndex = 1 },
                    new RiderEntry { FullName = "Ben Brook", OrderIndex = 2 },
                },
            });
            await db.SaveChangesAsync();
        });
        var section = await SetUpAsync(owner, arena, TackCheckMode.Leaderboard);
        var (saddle, turnout) = (section.Sectors[0].Id, section.Sectors[1].Id);

        Assert.Equal(["Amy Archer", "Ben Brook"], section.Teams.Single(t => t.TeamId == arena.TeamIds[0]).Riders);
        Assert.Equal(["Rider 1", "Rider 2", "Rider 3", "Rider 4"], section.Teams.Single(t => t.TeamId == arena.TeamIds[1]).Riders);

        var saved = await (await MarkAsync(owner, arena, arena.TeamIds[0],
            new TackCheckMarkDto(saddle, null, null, [8, 9]),
            new TackCheckMarkDto(turnout, null, null, [7, 10]))).ReadAsync<TackCheckSectionDto>();
        var team = saved.Teams.Single(t => t.TeamId == arena.TeamIds[0]);
        Assert.Equal(34, team.Total);
        Assert.Equal([8, 9], team.Marks.Single(m => m.SectorId == saddle).RiderPoints);
        Assert.Equal(17, team.Marks.Single(m => m.SectorId == saddle).Points);
        Assert.Equal([7, 10], team.Marks.Single(m => m.SectorId == turnout).RiderPoints);
        Assert.Equal(17, team.Marks.Single(m => m.SectorId == turnout).Points);

        // Sending the same rider scores again keeps the row unchanged; sending all nulls clears it.
        var unchanged = await (await MarkAsync(owner, arena, arena.TeamIds[0],
            new TackCheckMarkDto(saddle, null, null, [8, 9]))).ReadAsync<TackCheckSectionDto>();
        Assert.Equal(17, unchanged.Teams.Single(t => t.TeamId == arena.TeamIds[0]).Total);

        var cleared = await (await MarkAsync(owner, arena, arena.TeamIds[0],
            new TackCheckMarkDto(saddle, null, null, [null, null]))).ReadAsync<TackCheckSectionDto>();
        Assert.Empty(cleared.Teams.Single(t => t.TeamId == arena.TeamIds[0]).Marks);
    }

    [Fact]
    public async Task PassFailMarks_AreSavedReplacedAndCleared()
    {
        var (arena, owner) = await WorldAsync(scored: false);
        var section = await SetUpAsync(owner, arena, TackCheckMode.PassFail);
        var (saddle, turnout) = (section.Sectors[0].Id, section.Sectors[1].Id);
        var team = arena.TeamIds[1];

        var saved = await (await MarkAsync(owner, arena, team, new TackCheckMarkDto(saddle, true, null), new TackCheckMarkDto(turnout, false, null))).ReadAsync<TackCheckSectionDto>();
        var row = saved.Teams.Single(t => t.TeamId == team);
        Assert.Equal((1, 1), (row.Passed, row.Failed));
        var firstTime = await _f.WithDbAsync(db => db.Set<TackCheckMark>().Where(m => m.TeamId == team && m.TackCheckSectorId == saddle).Select(m => m.RecordedAt).SingleAsync());

        // Sending the same saddle mark again leaves it alone; leaving turnout out clears it.
        var replaced = await (await MarkAsync(owner, arena, team, new TackCheckMarkDto(saddle, true, null))).ReadAsync<TackCheckSectionDto>();
        row = replaced.Teams.Single(t => t.TeamId == team);
        Assert.Equal((1, 0), (row.Passed, row.Failed));
        Assert.Equal(firstTime, await _f.WithDbAsync(db => db.Set<TackCheckMark>().Where(m => m.TeamId == team && m.TackCheckSectorId == saddle).Select(m => m.RecordedAt).SingleAsync()));

        var cleared = await (await MarkAsync(owner, arena, team, new TackCheckMarkDto(saddle, null, null))).ReadAsync<TackCheckSectionDto>();
        Assert.Empty(cleared.Teams.Single(t => t.TeamId == team).Marks);

        // Pass-or-fail sections never reach the public table.
        var board = await (await _f.CreateClient().GetAsync($"{Base(arena.CompetitionId)}/tack-check/leaderboard")).ReadAsync<TackLeaderboardDto>();
        Assert.Empty(board.Sections);
    }

    // ---- standings ----

    [Fact]
    public async Task BonusPoints_AreAddedToStandings_AndShownSeparately()
    {
        var (arena, owner) = await WorldAsync();
        var section = await SetUpAsync(owner, arena, TackCheckMode.BonusPoints);
        await MarkAsync(owner, arena, arena.TeamIds[2], new TackCheckMarkDto(section.Sectors[0].Id, null, 3), new TackCheckMarkDto(section.Sectors[1].Id, null, 2));

        var rows = await StandingsAsync(arena);
        Assert.Equal(arena.TeamIds[2], rows[0].TeamId);
        Assert.Equal((6, 5), (rows[0].TotalPoints, rows[0].BonusPoints));
        Assert.Equal(0, rows[0].Wins);
        Assert.Equal((3, 0), (rows[1].TotalPoints, rows[1].BonusPoints));

        // The printable results and the results book agree.
        var printed = await (await _f.CreateClient().GetAsync($"{Base(arena.CompetitionId)}/print/results")).ReadAsync<PrintableResultsDto>();
        var top = printed.Sections.Single().Results[0];
        Assert.Equal((arena.TeamIds[2], 6, 5), (top.TeamId, top.TotalPoints, top.BonusPoints));
        var book = await (await _f.CreateClient().GetAsync($"{Base(arena.CompetitionId)}/results-book")).ReadAsync<ResultsBookDto>();
        Assert.Equal((6, 5), (book.Sections[0].Standings[0].TotalPoints, book.Sections[0].Standings[0].BonusPoints));
    }

    [Fact]
    public async Task OnlyAnEnabledBonusSection_ChangesStandings()
    {
        var (arena, owner) = await WorldAsync();
        var section = await SetUpAsync(owner, arena, TackCheckMode.Leaderboard);
        await MarkAsync(owner, arena, arena.TeamIds[2], new TackCheckMarkDto(section.Sectors[0].Id, null, 9));
        Assert.All(await StandingsAsync(arena), r => Assert.Equal(0, r.BonusPoints));
        Assert.Equal(1, (await StandingsAsync(arena)).Single(r => r.TeamId == arena.TeamIds[2]).TotalPoints);

        var url = $"{Base(arena.CompetitionId)}/tack-check/sections/{arena.SectionId}";
        var sectors = section.Sectors.Select(s => new SaveTackCheckSectorRow(s.Id, s.Name)).ToArray();
        (await owner.PutAsJsonAsync(url, Settings(TackCheckMode.BonusPoints, sectors: sectors))).EnsureSuccessStatusCode();
        Assert.Equal(10, (await StandingsAsync(arena)).Single(r => r.TeamId == arena.TeamIds[2]).TotalPoints);

        (await owner.PutAsJsonAsync(url, Settings(TackCheckMode.BonusPoints, enabled: false, sectors: sectors))).EnsureSuccessStatusCode();
        Assert.Equal(1, (await StandingsAsync(arena)).Single(r => r.TeamId == arena.TeamIds[2]).TotalPoints);
    }

    [Fact]
    public async Task Bonus_NeverLiftsATeamPastAHigherFinal_AndHorsConcoursStaysOut()
    {
        var (arena, owner) = await WorldAsync();
        await _f.AddHeatAsync(arena.SessionId, arena.TeamIds.Take(2), "A Final", 2);
        await _f.AddHeatAsync(arena.SessionId, arena.TeamIds.Skip(2), "B Final", 3);
        var section = await SetUpAsync(owner, arena, TackCheckMode.BonusPoints);
        await MarkAsync(owner, arena, arena.TeamIds[2], new TackCheckMarkDto(section.Sectors[0].Id, null, 10), new TackCheckMarkDto(section.Sectors[1].Id, null, 10));

        var rows = await StandingsAsync(arena);
        Assert.Equal(arena.TeamIds[2], rows[2].TeamId);
        Assert.Equal((21, 20, 1), (rows[2].TotalPoints, rows[2].BonusPoints, rows[2].FinalTier));

        await _f.WithDbAsync(async db =>
        {
            (await db.Teams.FindAsync(arena.TeamIds[2]))!.IsHorsConcours = true;
            await db.SaveChangesAsync();
        });
        Assert.DoesNotContain(await StandingsAsync(arena), r => r.TeamId == arena.TeamIds[2]);
    }

    // ---- public table ----

    [Fact]
    public async Task Leaderboard_IsPublic_RanksTiesTogether_AndListsHorsConcoursLast()
    {
        var (arena, owner) = await WorldAsync(scored: false);
        await _f.WithDbAsync(async db =>
        {
            (await db.Teams.FindAsync(arena.TeamIds[0]))!.IsHorsConcours = true;
            await db.SaveChangesAsync();
        });
        var section = await SetUpAsync(owner, arena, TackCheckMode.Leaderboard);
        var (saddle, turnout) = (section.Sectors[0].Id, section.Sectors[1].Id);
        await MarkAsync(owner, arena, arena.TeamIds[0], new TackCheckMarkDto(saddle, null, 10), new TackCheckMarkDto(turnout, null, 10));
        await MarkAsync(owner, arena, arena.TeamIds[1], new TackCheckMarkDto(saddle, null, 6));
        await MarkAsync(owner, arena, arena.TeamIds[2], new TackCheckMarkDto(turnout, null, 6));

        var board = await (await _f.CreateClient().GetAsync($"{Base(arena.CompetitionId)}/tack-check/leaderboard")).ReadAsync<TackLeaderboardDto>();
        var table = Assert.Single(board.Sections);
        Assert.Equal(TackCheckMode.Leaderboard, table.Mode);
        Assert.Equal(["Saddle/Girth", "Turnout"], table.Sectors);
        Assert.Equal([1, 1, null], table.Rows.Select(r => r.Rank));
        Assert.Equal(arena.TeamIds[0], table.Rows[2].TeamId);
        Assert.True(table.Rows[2].IsHorsConcours);
        Assert.Equal([6, null], table.Rows.Single(r => r.TeamId == arena.TeamIds[1]).Points);

        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"{Base(999999)}/tack-check/leaderboard")).StatusCode);
    }

    // ---- printable form ----

    [Fact]
    public async Task PrintableForm_ListsEachTeamsRidersAndPonies_WithTheSectionsSectors()
    {
        var (arena, owner) = await WorldAsync(scored: false);
        var second = await _f.WithDbAsync(async db =>
        {
            var other = new CompetitionSection { CompetitionId = arena.CompetitionId, Format = SectionFormat.Teams, AgeGroup = "Open", DisplayName = "Open Teams" };
            db.CompetitionSections.Add(other);
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = arena.TeamIds[0], SubmittedAt = DateTime.UtcNow.AddHours(-2),
                Riders = { new RiderEntry { FullName = "Old Rider", HorseName = "Old Pony" } },
            });
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = arena.TeamIds[0], SubmittedAt = DateTime.UtcNow,
                Riders =
                {
                    new RiderEntry { FullName = "Ruby Reserve", HorseName = "Pepper", IsReserve = true, OrderIndex = 0 },
                    new RiderEntry { FullName = "Amy Archer", HorseName = "  Bramble ", IsCaptain = true, OrderIndex = 1 },
                    new RiderEntry { FullName = "Ben Brook", HorseName = "", OrderIndex = 2 },
                },
            });
            await db.SaveChangesAsync();
            return other.Id;
        });
        var url = $"{Base(arena.CompetitionId)}/tack-check/sections/{arena.SectionId}";
        (await owner.PutAsJsonAsync(url, Settings(TackCheckMode.BonusPoints, max: 5, sectors: [new SaveTackCheckSectorRow(null, "Boots")]))).EnsureSuccessStatusCode();

        var form = await (await owner.GetAsync($"{Base(arena.CompetitionId)}/print/tack-check")).ReadAsync<PrintableTackCheckDto>();
        Assert.Equal(["Open Teams", "Under 12 Teams"], form.Sections.Select(s => s.SectionName));
        var open = form.Sections.Single(s => s.SectionId == second);
        Assert.False(open.IsEnabled);
        Assert.Equal(4, open.Sectors.Count);
        var u12 = form.Sections.Single(s => s.SectionId == arena.SectionId);
        Assert.True(u12.IsEnabled);
        Assert.Equal((TackCheckMode.BonusPoints, 5), (u12.Mode, u12.MaxPoints));
        Assert.Equal(["Boots"], u12.Sectors);
        var riders = u12.Teams.Single(t => t.TeamId == arena.TeamIds[0]).Riders;
        Assert.Equal(["Amy Archer", "Ben Brook", "Ruby Reserve"], riders.Select(r => r.Name));
        Assert.Equal(["Bramble", null, "Pepper"], riders.Select(r => r.Pony));
        Assert.Empty(u12.Teams.Single(t => t.TeamId == arena.TeamIds[1]).Riders);
    }
}
