using System.Net;
using System.Net.Http.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Operations;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sessions;

public class HeatBibOverrideTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public HeatBibOverrideTests(ApiFactory f) => _f = f;

    private async Task<(HttpClient Staff, Arena Arena, int HeatId)> CreateClashWorldAsync()
    {
        var (staff, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync(teamCount: 4);
        var (heatId, _) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);

        await _f.WithDbAsync(async db =>
        {
            var comp = (await db.Competitions.FindAsync(arena.CompetitionId))!;
            comp.CreatedByUserId = auth.User.Id;

            var teams = await db.Teams
                .Where(t => arena.TeamIds.Contains(t.Id))
                .ToDictionaryAsync(t => t.Id);

            // Team 0 and Team 1 clash on Red; Team 2 wears Blue; Team 3 also clashes on Red.
            teams[arena.TeamIds[0]].BibColour = "Red";
            teams[arena.TeamIds[1]].BibColour = "Red";
            teams[arena.TeamIds[2]].BibColour = "Blue";
            teams[arena.TeamIds[3]].BibColour = "red bibs";
            await db.SaveChangesAsync();
        });

        return (staff, arena, heatId);
    }

    [Fact]
    public async Task SetAndClearBibOverride_UpdatesEffectiveBibColourAndRestoresTeamBibColour()
    {
        var (staff, arena, heatId) = await CreateClashWorldAsync();
        var clashingTeamId = arena.TeamIds[1];

        var setRes = await staff.PutAsJsonAsync(
            $"/api/heats/{heatId}/entries/{clashingTeamId}/bib-override",
            new SetBibOverrideRequest("yellow"));
        Assert.Equal(HttpStatusCode.OK, setRes.StatusCode);

        var updatedHeat = await setRes.ReadAsync<HeatDto>();
        var overriddenEntry = Assert.Single(updatedHeat.Entries, e => e.TeamId == clashingTeamId);
        Assert.Equal("yellow", overriddenEntry.BibColour);
        Assert.Equal("yellow", overriddenEntry.BibColourOverride);

        // First team still has its original Red bib with no override.
        var firstEntry = Assert.Single(updatedHeat.Entries, e => e.TeamId == arena.TeamIds[0]);
        Assert.Equal("Red", firstEntry.BibColour);
        Assert.Null(firstEntry.BibColourOverride);

        // Clearing the override via the competition-scoped route restores the team's usual Red bib.
        var clearRes = await staff.PutAsJsonAsync(
            $"/api/competitions/{arena.CompetitionId}/heats/{heatId}/entries/{clashingTeamId}/bib-override",
            new SetBibOverrideRequest("   "));
        Assert.Equal(HttpStatusCode.OK, clearRes.StatusCode);

        var clearedHeat = await clearRes.ReadAsync<HeatDto>();
        var restoredEntry = Assert.Single(clearedHeat.Entries, e => e.TeamId == clashingTeamId);
        Assert.Equal("Red", restoredEntry.BibColour);
        Assert.Null(restoredEntry.BibColourOverride);
    }

    [Fact]
    public async Task ResolveBibClashes_AssignsNonClashingSpareBibColoursInLaneOrder()
    {
        var (staff, arena, heatId) = await CreateClashWorldAsync();

        var res = await staff.PostAsync(
            $"/api/competitions/{arena.CompetitionId}/heats/{heatId}/resolve-bib-clashes",
            content: null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var heat = await res.ReadAsync<HeatDto>();
        var byLane = heat.Entries.OrderBy(e => e.LaneIndex).ToList();
        Assert.Equal(4, byLane.Count);

        // Lane 1 keeps Red (no override); Lane 3 keeps Blue (no override).
        Assert.Equal("Red", byLane[0].BibColour);
        Assert.Null(byLane[0].BibColourOverride);

        Assert.Equal("Blue", byLane[2].BibColour);
        Assert.Null(byLane[2].BibColourOverride);

        // Lanes 2 and 4 were clashing on Red; since 'red' and 'blue' are already in use in this heat,
        // they receive the next spare bib colours ('yellow' and 'green').
        Assert.Equal("yellow", byLane[1].BibColour);
        Assert.Equal("yellow", byLane[1].BibColourOverride);

        Assert.Equal("green", byLane[3].BibColour);
        Assert.Equal("green", byLane[3].BibColourOverride);

        // Calling resolve-bib-clashes a second time via /api/heats/{heatId}/resolve-bib-clashes is idempotent.
        var secondRes = await staff.PostAsync($"/api/heats/{heatId}/resolve-bib-clashes", content: null);
        Assert.Equal(HttpStatusCode.OK, secondRes.StatusCode);
        var secondHeat = await secondRes.ReadAsync<HeatDto>();
        Assert.Equal(
            byLane.Select(e => (e.TeamId, e.BibColour, e.BibColourOverride)),
            secondHeat.Entries.OrderBy(e => e.LaneIndex).Select(e => (e.TeamId, e.BibColour, e.BibColourOverride)));
    }

    [Fact]
    public async Task UpdateHeatAssignments_PreservesExistingBibColourOverridesForRemainingTeams()
    {
        var (staff, arena, heatId) = await CreateClashWorldAsync();
        var clashingTeamId = arena.TeamIds[1];

        var setRes = await staff.PutAsJsonAsync(
            $"/api/heats/{heatId}/entries/{clashingTeamId}/bib-override",
            new SetBibOverrideRequest("orange"));
        Assert.Equal(HttpStatusCode.OK, setRes.StatusCode);

        // Reverse the lane order via heat-assignments.
        var reversedTeams = arena.TeamIds.Reverse().ToList();
        var assignRes = await staff.PutAsJsonAsync(
            $"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/heat-assignments",
            new UpdateHeatAssignmentsRequest([new HeatAssignmentEntry("Heat 1", reversedTeams)]));
        Assert.Equal(HttpStatusCode.OK, assignRes.StatusCode);

        var sessionDto = await assignRes.ReadAsync<SessionDto>();
        var heatDto = Assert.Single(sessionDto.Heats, h => h.Id == heatId);
        var preserved = Assert.Single(heatDto.Entries, e => e.TeamId == clashingTeamId);
        Assert.Equal("orange", preserved.BibColourOverride);
        Assert.Equal("orange", preserved.BibColour);
    }

    [Fact]
    public async Task Endpoints_EnforceStaffAccessAndValidateInput()
    {
        var (staff, arena, heatId) = await CreateClashWorldAsync();
        var teamId = arena.TeamIds[0];

        var anon = _f.CreateClient();
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await anon.PutAsJsonAsync($"/api/heats/{heatId}/entries/{teamId}/bib-override", new SetBibOverrideRequest("yellow"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await anon.PostAsync($"/api/competitions/{arena.CompetitionId}/heats/{heatId}/resolve-bib-clashes", null)).StatusCode);

        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.PutAsJsonAsync($"/api/heats/{heatId}/entries/{teamId}/bib-override", new SetBibOverrideRequest("yellow"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.PostAsync($"/api/competitions/{arena.CompetitionId}/heats/{heatId}/resolve-bib-clashes", null)).StatusCode);

        var (otherTrainer, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await otherTrainer.PutAsJsonAsync($"/api/heats/{heatId}/entries/{teamId}/bib-override", new SetBibOverrideRequest("yellow"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await otherTrainer.PostAsync($"/api/competitions/{arena.CompetitionId}/heats/{heatId}/resolve-bib-clashes", null)).StatusCode);

        // Team not in heat -> 404
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await staff.PutAsJsonAsync($"/api/heats/{heatId}/entries/999999/bib-override", new SetBibOverrideRequest("yellow"))).StatusCode);

        // Overly long bib colour -> 400
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await staff.PutAsJsonAsync($"/api/heats/{heatId}/entries/{teamId}/bib-override", new SetBibOverrideRequest(new string('a', 81)))).StatusCode);
    }

    [Fact]
    public async Task SqliteSchema_AddsBibColourOverrideColumnToLegacyHeatEntriesTable()
    {
        await using var conn = new SqliteConnection("Data Source=:memory:");
        await conn.OpenAsync();

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                CREATE TABLE "HeatEntries" (
                    "Id" INTEGER NOT NULL CONSTRAINT "PK_HeatEntries" PRIMARY KEY AUTOINCREMENT,
                    "HeatId" INTEGER NOT NULL,
                    "TeamId" INTEGER NOT NULL,
                    "LaneIndex" INTEGER NOT NULL
                );
                """;
            await cmd.ExecuteNonQueryAsync();
        }

        var opts = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;
        await using var db = new AppDbContext(opts);

        await OperationsSqliteSchema.EnsureAsync(db);
        // Second call is idempotent.
        await OperationsSqliteSchema.EnsureAsync(db);

        var hasColumn = await db.Database
            .SqlQueryRaw<int>("""SELECT COUNT(*) AS "Value" FROM pragma_table_info('HeatEntries') WHERE name = 'BibColourOverride'""")
            .SingleAsync();
        Assert.Equal(1, hasColumn);
    }
}
