using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

/// <summary>Standings carry the shared place the tie-break settled, and hors concours / tack check changes reach live screens.</summary>
public class StandingsPlaceAndBroadcastTests : IClassFixture<ApiFactory>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);
    private readonly ApiFactory _f;
    public StandingsPlaceAndBroadcastTests(ApiFactory f) => _f = f;

    private async Task<(int Comp, int Section, int[] Teams)> CompAsync(int teamCount, TieBreakRule rule)
    {
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        await _f.WithDbAsync(db => db.CompetitionSections.Where(s => s.Id == section)
            .ExecuteUpdateAsync(set => set.SetProperty(s => s.TieBreakRule, rule)));
        var club = await _f.SeedClubAsync();
        var teams = new List<int>();
        for (var i = 0; i < teamCount; i++) teams.Add(await _f.SeedTeamAsync(comp, section, club, $"T{i}"));
        return (comp, section, teams.ToArray());
    }

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

    private async Task<List<StandingRow>> StandingsAsync(int comp, int section)
        => await (await _f.CreateClient().GetAsync($"/api/competitions/{comp}/standings?sectionId={section}")).ReadAsync<List<StandingRow>>();

    [Fact]
    public async Task Place_IsSharedOnlyWhileNothingSeparatesTheTeams()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.Countback);
        // Same points, same placings: genuinely level. T2 is clear of them.
        await RaceAsync(comp, section, 1, (t[0], 1, 3), (t[1], 2, 2), (t[2], 3, 1));
        await RaceAsync(comp, section, 2, (t[1], 1, 3), (t[0], 2, 2), (t[2], 3, 1));

        var rows = await StandingsAsync(comp, section);

        Assert.Equal([1, 1, 3], rows.Select(r => r.Place));
        Assert.Equal([true, true, false], rows.Select(r => r.Joint));
    }

    [Fact]
    public async Task Place_IsSeparated_WhenCountbackOrTheOrganisersOrderSettlesTheTie()
    {
        var (comp, section, t) = await CompAsync(3, TieBreakRule.Countback);
        await RaceAsync(comp, section, 1, (t[0], 1, 4), (t[1], 2, 3), (t[2], 3, 2));
        await RaceAsync(comp, section, 2, (t[1], 1, 4), (t[0], 3, 2), (t[2], 2, 3));
        await RaceAsync(comp, section, 3, (t[0], 4, 2), (t[1], null, 1), (t[2], 4, 0));
        var byCountback = await StandingsAsync(comp, section);
        Assert.Equal(t[1], byCountback[0].TeamId);
        Assert.Equal([1, 2], byCountback.Take(2).Select(r => r.Place));
        Assert.All(byCountback.Take(2), r => Assert.False(r.Joint));

        var (comp2, section2, u) = await CompAsync(3, TieBreakRule.RunOff);
        await RaceAsync(comp2, section2, 1, (u[0], 1, 5), (u[1], 2, 5), (u[2], 3, 1));
        Assert.Equal([1, 1], (await StandingsAsync(comp2, section2)).Take(2).Select(r => r.Place));
        var admin = await _f.AdminAsync();
        (await admin.PutAsJsonAsync($"/api/competitions/{comp2}/finals/tie-order", new { teamIds = new[] { u[1], u[0] } })).EnsureSuccessStatusCode();

        var ordered = await StandingsAsync(comp2, section2);

        Assert.Equal([u[1], u[0], u[2]], ordered.Select(r => r.TeamId));
        Assert.Equal([1, 2, 3], ordered.Select(r => r.Place));
        Assert.All(ordered, r => Assert.False(r.Joint));
    }

    private async Task<HubConnection> JoinAsync(int comp)
    {
        _f.CreateClient();
        var conn = new HubConnectionBuilder()
            .WithUrl(new Uri(_f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _f.Server.CreateHandler();
                o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
        await conn.StartAsync();
        await conn.InvokeAsync("JoinCompetition", comp);
        return conn;
    }

    private static Task<JsonElement> NextResultsUpdate(HubConnection conn)
    {
        var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        conn.On<JsonElement>("resultsUpdated", e => tcs.TrySetResult(e));
        return tcs.Task.WaitAsync(Timeout);
    }

    [Fact]
    public async Task HorsConcoursChange_BroadcastsResultsUpdated()
    {
        var arena = await _f.CreateArenaAsync(2);
        await using var conn = await JoinAsync(arena.CompetitionId);
        var update = NextResultsUpdate(conn);

        var put = await (await _f.AdminAsync()).PutAsJsonAsync(
            $"/api/competitions/{arena.CompetitionId}/teams/{arena.TeamIds[0]}", new UpdateTeamInput(IsHorsConcours: true));
        put.EnsureSuccessStatusCode();

        var payload = await update;
        Assert.Equal(arena.TeamIds[0], payload.GetProperty("teamId").GetInt32());
        Assert.True(payload.GetProperty("isHorsConcours").GetBoolean());
    }

    [Fact]
    public async Task TackCheckSettingsAndMarks_BroadcastResultsUpdated()
    {
        var arena = await _f.CreateArenaAsync(2);
        var admin = await _f.AdminAsync();
        await using var conn = await JoinAsync(arena.CompetitionId);
        var url = $"/api/event-tools/competitions/{arena.CompetitionId}/tack-check/sections/{arena.SectionId}";

        var first = NextResultsUpdate(conn);
        var saved = await admin.PutAsJsonAsync(url, new SaveTackCheckSettingsRequest(true, TackCheckMode.BonusPoints, 10,
            [new SaveTackCheckSectorRow(null, "Saddle/Girth")]));
        saved.EnsureSuccessStatusCode();
        Assert.True((await first).GetProperty("tackCheck").GetBoolean());

        var sector = (await saved.ReadAsync<TackCheckSectionDto>()).Sectors[0].Id;
        var second = NextResultsUpdate(conn);
        (await admin.PutAsJsonAsync($"{url}/teams/{arena.TeamIds[0]}", new SaveTackCheckMarksRequest([new TackCheckMarkDto(sector, null, 5)]))).EnsureSuccessStatusCode();
        Assert.Equal(arena.TeamIds[0], (await second).GetProperty("teamId").GetInt32());
    }
}
