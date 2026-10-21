using System.Net;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;
using Outline = MountedGames.Api.Controllers.CompetitionsController.SessionOutline;

namespace MountedGames.Api.Tests.Competitions;

/// <summary>The small first answer for phones on a weak signal (<c>GET /api/competitions/{id}/first-view</c>).</summary>
public class FirstViewTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public FirstViewTests(ApiFactory f) => _f = f;

    [Fact]
    public void Picks_OnNow_LastFinished_AndNextTwo_PerArena()
    {
        var ids = CompetitionsController.FirstViewSessionIds(new[]
        {
            new Outline(1, "Main", SessionStatus.Finished, 1),
            new Outline(2, "Main", SessionStatus.Finished, 2),
            new Outline(3, "Main", SessionStatus.InArena, 3),
            new Outline(4, "Main", SessionStatus.Upcoming, 4),
            new Outline(5, "Main", SessionStatus.Upcoming, 5),
            new Outline(6, "Main", SessionStatus.Upcoming, 6),
            new Outline(10, "Arena 2", SessionStatus.Upcoming, 2),
            new Outline(11, "Arena 2", SessionStatus.Upcoming, 1),
            new Outline(12, "Arena 2", SessionStatus.Upcoming, 3),
            new Outline(20, null, SessionStatus.Finished, 1),
        });

        Assert.Equal(new[] { 2, 3, 4, 5, 10, 11, 20 }, ids.Order());
    }

    [Fact]
    public void Picks_Nothing_ForAnEmptyTimetable()
    {
        Assert.Empty(CompetitionsController.FirstViewSessionIds([]));
    }

    [Fact]
    public async Task Returns404_WhenCompetitionMissing()
    {
        var r = await _f.CreateClient().GetAsync("/api/competitions/999999/first-view");

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task ReturnsOnlyTheCurrentSessions_AndTheTeamsRacingInThem()
    {
        var arena = await _f.CreateArenaAsync(teamCount: 4);
        var (onNow, later) = await _f.WithDbAsync(async db =>
        {
            var first = await db.Sessions.FindAsync(arena.SessionId);
            first!.Status = SessionStatus.Finished;
            Session Add(string name, SessionStatus status, int order)
            {
                var s = new Session { CompetitionId = arena.CompetitionId, CompetitionSectionId = arena.SectionId, Name = name, Status = status, OrderIndex = order };
                db.Sessions.Add(s);
                return s;
            }
            Add("Finished last", SessionStatus.Finished, 2);
            var now = Add("On now", SessionStatus.InArena, 3);
            Add("Next", SessionStatus.Upcoming, 4);
            Add("After next", SessionStatus.Upcoming, 5);
            var afterThat = Add("Later", SessionStatus.Upcoming, 6);
            await db.SaveChangesAsync();
            return (now.Id, afterThat.Id);
        });
        await _f.AddHeatAsync(onNow, arena.TeamIds.Take(2), raceCount: 2);
        await _f.AddHeatAsync(later, arena.TeamIds.Skip(2));

        var r = await _f.CreateClient().GetAsync($"/api/competitions/{arena.CompetitionId}/first-view");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var d = await r.ReadAsync<CompetitionDetail>();
        Assert.Equal(new[] { "Finished last", "On now", "Next", "After next" }, d.Sessions.Select(s => s.Name));
        var heat = Assert.Single(d.Sessions.Single(s => s.Name == "On now").Heats);
        Assert.Equal(2, heat.Races.Count);
        Assert.Equal(new[] { "Team 1", "Team 2" }, d.Teams.Select(t => t.DisplayName));
        Assert.Equal(new[] { "Under 12 Teams" }, d.Sections.Select(s => s.DisplayName));
    }

    [Fact]
    public async Task IsCacheableWithAnEtag_LikeTheFullTimetable()
    {
        var arena = await _f.CreateArenaAsync();

        var r = await _f.CreateClient().GetAsync($"/api/competitions/{arena.CompetitionId}/first-view");

        Assert.Equal((true, "no-cache, private"), (r.Headers.ETag!.IsWeak, r.Headers.CacheControl!.ToString()));
    }
}
