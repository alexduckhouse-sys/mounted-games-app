using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.SignalR.Client;
using MountedGames.Api.Dtos;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Streaming;

/// <summary>An organiser stepping a prize-giving on the stream (<c>POST …/overlays/prize-giving</c>).</summary>
public class PrizeGivingControlTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public PrizeGivingControlTests(ApiFactory f) => _f = f;

    private static string Url(int competitionId) => $"/api/competitions/{competitionId}/overlays/prize-giving";

    /// <summary>A competition owned by a fresh trainer, with one age group of four teams.</summary>
    private async Task<(Arena Arena, HttpClient Owner)> EventAsync()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });
        return (arena, owner);
    }

    private static object Show(Arena a, bool champions = false, params (int Team, int Place, double Points)[] places) =>
        new { action = "show", sectionId = a.SectionId, champions, places = places.Select(p => new { teamId = p.Team, place = p.Place, points = p.Points }) };

    [Fact]
    public async Task OnlyTheEventsStaffMayRunIt()
    {
        var (a, owner) = await EventAsync();
        var (other, _) = await _f.ApprovedTrainerAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var body = Show(a, false, (a.TeamIds[3], 4, 20));

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(Url(a.CompetitionId), body)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync(Url(a.CompetitionId), body)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync(Url(a.CompetitionId), body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync(Url(a.CompetitionId), body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).PostAsJsonAsync(Url(a.CompetitionId), new { action = "clear" })).StatusCode);
    }

    [Fact]
    public async Task RejectsBadSteps_AndTeamsOrAgeGroupsFromElsewhere()
    {
        var (a, owner) = await EventAsync();
        var (elsewhere, _) = await EventAsync();
        async Task<HttpStatusCode> Post(object body) => (await owner.PostAsJsonAsync(Url(a.CompetitionId), body)).StatusCode;

        Assert.Equal(HttpStatusCode.BadRequest, await Post(new { action = "dance" }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(new { action = "show", sectionId = a.SectionId, places = Array.Empty<object>() }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(new { action = "show", places = new[] { new { teamId = a.TeamIds[0], place = 1, points = 3 } } }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Show(a, false, (a.TeamIds[0], 2, 5), (a.TeamIds[0], 1, 6))));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Show(a, true, (a.TeamIds[0], 2, 5))));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Show(a, false, (a.TeamIds[0], 0, 5))));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Show(a, false, (a.TeamIds[0], 3, -1))));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(new { action = "show", sectionId = a.SectionId,
            places = Enumerable.Range(1, 31).Select(i => new { teamId = i, place = i, points = 1 }) }));
        Assert.Equal(HttpStatusCode.NotFound, await Post(Show(elsewhere, false, (elsewhere.TeamIds[0], 1, 5))));
        Assert.Equal(HttpStatusCode.NotFound, await Post(Show(a, false, (elsewhere.TeamIds[0], 1, 5))));
    }

    [Fact]
    public async Task TellsEveryViewer_WithTheEventsOwnNames()
    {
        var (a, owner) = await EventAsync();
        var names = await _f.WithDbAsync(async db =>
        {
            var section = (await db.CompetitionSections.FindAsync(a.SectionId))!;
            section.DisplayName = "Open";
            var team = (await db.Teams.FindAsync(a.TeamIds[0]))!;
            await db.SaveChangesAsync();
            return team.DisplayName;
        });
        await using var viewer = new HubConnectionBuilder()
            .WithUrl(new Uri(_f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _f.Server.CreateHandler();
                o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
        var received = new List<PrizeGivingDto>();
        var two = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        viewer.On<PrizeGivingDto>("prizeGiving", dto => { lock (received) { received.Add(dto); if (received.Count == 2) two.TrySetResult(); } });
        await viewer.StartAsync();
        await viewer.InvokeAsync("JoinCompetition", a.CompetitionId);

        var shown = await owner.PostAsJsonAsync(Url(a.CompetitionId), Show(a, true, (a.TeamIds[1], 2, 40.5), (a.TeamIds[0], 1, 44)));
        Assert.Equal(HttpStatusCode.OK, shown.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsJsonAsync(Url(a.CompetitionId), new { action = "clear" })).StatusCode);

        await two.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var show = received.Single(r => r.Action == "show");
        Assert.Equal(("Open", a.SectionId, true), (show.SectionName, show.SectionId, show.Champions));
        Assert.Equal(new[] { 2, 1 }, show.Places.Select(p => p.Place));
        Assert.Equal((a.TeamIds[0], names, 44d), (show.Places[1].TeamId, show.Places[1].TeamName, show.Places[1].Points));
        Assert.Equal(40.5, show.Places[0].Points);
        var clear = received.Single(r => r.Action == "clear");
        Assert.Empty(clear.Places);
    }
}
