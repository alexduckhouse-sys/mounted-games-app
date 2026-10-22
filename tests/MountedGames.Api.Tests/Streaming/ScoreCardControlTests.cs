using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.SignalR.Client;
using MountedGames.Api.Dtos;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Streaming;

/// <summary>A producer's show, skip and edit instructions for a race's score card (<c>POST …/overlays/score-card</c>).</summary>
public class ScoreCardControlTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ScoreCardControlTests(ApiFactory f) => _f = f;

    private static string Url(int competitionId) => $"/api/competitions/{competitionId}/overlays/score-card";

    /// <summary>A competition owned by a fresh trainer, with one heat of two races.</summary>
    private async Task<(int Comp, int Heat, int Race, int[] Teams, HttpClient Owner)> ArenaAsync()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });
        var (heatId, raceIds) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        return (arena.CompetitionId, heatId, raceIds[0], arena.TeamIds, owner);
    }

    [Fact]
    public async Task OnlyBroadcastersMayControlScoreCards()
    {
        var (comp, heat, race, _, owner) = await ArenaAsync();
        var (other, _) = await _f.ApprovedTrainerAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var body = new { heatId = heat, raceId = race, action = "skip" };

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(Url(comp), body)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync(Url(comp), body)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync(Url(comp), body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync(Url(comp), body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).PostAsJsonAsync(Url(comp), body)).StatusCode);
    }

    [Fact]
    public async Task RejectsUnknownActions_LongNames_AndRacesFromElsewhere()
    {
        var (comp, heat, race, teams, owner) = await ArenaAsync();
        var elsewhere = await ArenaAsync();

        async Task<HttpStatusCode> Post(object body) => (await owner.PostAsJsonAsync(Url(comp), body)).StatusCode;

        Assert.Equal(HttpStatusCode.BadRequest, await Post(new { heatId = heat, raceId = race, action = "delete" }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(new { heatId = heat, raceId = race, action = "edit", names = new Dictionary<int, string> { [teams[0]] = new string('x', 61) } }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(new { heatId = heat, raceId = race, action = "edit",
            names = Enumerable.Range(1, 33).ToDictionary(i => i, i => $"Team {i}") }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(new { heatId = heat, raceId = race, action = "edit", seconds = 61 }));
        Assert.Equal(HttpStatusCode.NotFound, await Post(new { heatId = elsewhere.Heat, raceId = elsewhere.Race, action = "skip" }));
        Assert.Equal(HttpStatusCode.NotFound, await Post(new { heatId = heat, raceId = elsewhere.Race, action = "skip" }));
    }

    [Fact]
    public async Task TellsEveryViewer_WithTidiedEdits()
    {
        var (comp, heat, race, teams, owner) = await ArenaAsync();
        await using var viewer = new HubConnectionBuilder()
            .WithUrl(new Uri(_f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _f.Server.CreateHandler();
                o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
        var received = new TaskCompletionSource<ScoreCardControlDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        viewer.On<ScoreCardControlDto>("scoreCardControl", received.SetResult);
        await viewer.StartAsync();
        await viewer.InvokeAsync("JoinCompetition", comp);

        var response = await owner.PostAsJsonAsync(Url(comp), new
        {
            heatId = heat, raceId = race, action = "edit", seconds = 12,
            hiddenTeamIds = new[] { teams[1], teams[1] },
            names = new Dictionary<int, string> { [teams[0]] = "  Pony Club A  ", [teams[2]] = "   " },
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var control = await received.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal((heat, race, "edit", 12), (control.HeatId, control.RaceId, control.Action, control.Seconds));
        Assert.Equal(new[] { teams[1] }, control.HiddenTeamIds);
        Assert.Equal(new Dictionary<int, string> { [teams[0]] = "Pony Club A" }, control.Names);
    }
}
