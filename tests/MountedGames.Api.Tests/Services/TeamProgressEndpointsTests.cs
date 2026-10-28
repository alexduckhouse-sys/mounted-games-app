using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Services;

public sealed class TeamProgressEndpointsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static string Url(Arena arena, int? teamId = null) =>
        $"/api/competitions/{arena.CompetitionId}/teams/{teamId ?? arena.TeamIds[0]}/progress";

    [Fact]
    public async Task AnonymousSnapshot_HasOnlyPublicFields_AndOneMinuteFreshness()
    {
        var arena = await factory.CreateArenaAsync(2);
        var heat = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds.Reverse());
        await factory.WithDbAsync(async db =>
        {
            var team = await db.Teams.FindAsync(arena.TeamIds[0]);
            Assert.NotNull(team);
            team.DisplayName = "PRIVATE-FAKE-TEAM-NAME";
            team.SupporterJoinKey = "PRIVATE-FAKE-JOIN-KEY";
            var session = await db.Sessions.FindAsync(arena.SessionId);
            Assert.NotNull(session);
            session.ArenaName = "Main arena";
            session.Notes = "PRIVATE-FAKE-ORGANISER-NOTE";
            // Scheduled time alone must not turn Upcoming into InArena.
            session.ScheduledStart = DateTime.UtcNow.AddDays(-1);
            await db.SaveChangesAsync();
        });

        var before = DateTimeOffset.UtcNow;
        var response = await factory.CreateClient().GetAsync(Url(arena));
        response.EnsureSuccessStatusCode();
        var snapshot = await response.ReadAsync<TeamProgressSnapshotDto>();
        Assert.Equal(TeamProgressStatus.Upcoming, snapshot.Progress.Status);
        Assert.Equal(heat.HeatId, snapshot.Progress.HeatId);
        Assert.Equal(2, snapshot.Progress.LaneIndex);
        Assert.Equal(0, snapshot.Progress.HeatsUntil);
        Assert.Equal("Main arena", snapshot.Progress.ArenaName);
        Assert.InRange(snapshot.ObservedAt, before, DateTimeOffset.UtcNow);
        Assert.Equal(TimeSpan.Zero, snapshot.ObservedAt.Offset);
        Assert.Equal(snapshot.ObservedAt.AddSeconds(60), snapshot.StaleAt);
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.True(response.Headers.CacheControl?.NoCache);

        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("PRIVATE-FAKE", body);
        using var json = JsonDocument.Parse(body);
        Assert.Equal(new[] { "observedAt", "progress", "staleAt" },
            json.RootElement.EnumerateObject().Select(p => p.Name).Order());
        var progress = json.RootElement.GetProperty("progress");
        Assert.Equal(JsonValueKind.Number, progress.GetProperty("status").ValueKind);
        Assert.Equal(new[] { "arenaName", "competitionId", "heatId", "heatLabel", "heatsUntil", "laneIndex", "sessionId", "status", "teamId" },
            progress.EnumerateObject().Select(p => p.Name).Order());
    }

    [Fact]
    public async Task CountsOtherSectionsInSameArena_ExcludesOtherArenasAndFinishedRaces()
    {
        var arena = await factory.CreateArenaAsync(3);
        await factory.WithDbAsync(async db =>
        {
            var session = await db.Sessions.FindAsync(arena.SessionId);
            Assert.NotNull(session);
            session.ArenaName = "Main";
            session.OrderIndex = 4;
            await db.SaveChangesAsync();
        });
        await factory.AddHeatAsync(arena.SessionId, [arena.TeamIds[0]]);
        var earlier = await factory.WithDbAsync(async db =>
        {
            var section = new CompetitionSection { CompetitionId = arena.CompetitionId, DisplayName = "Other section" };
            db.CompetitionSections.Add(section);
            await db.SaveChangesAsync();
            var sessions = new[]
            {
                new Session { CompetitionId = arena.CompetitionId, CompetitionSectionId = section.Id, ArenaName = "Main", OrderIndex = 1 },
                new Session { CompetitionId = arena.CompetitionId, CompetitionSectionId = section.Id, ArenaName = "Main", OrderIndex = 2 },
                new Session { CompetitionId = arena.CompetitionId, CompetitionSectionId = section.Id, ArenaName = "Other", OrderIndex = 3 },
            };
            db.Sessions.AddRange(sessions);
            await db.SaveChangesAsync();
            return sessions.Select(s => s.Id).ToArray();
        });
        await factory.AddHeatAsync(earlier[0], [arena.TeamIds[1]]);
        var completed = await factory.AddHeatAsync(earlier[1], [arena.TeamIds[2]]);
        await factory.AddHeatAsync(earlier[2], [arena.TeamIds[2]]);
        await factory.WithDbAsync(async db =>
        {
            await db.Races.Where(r => r.HeatId == completed.HeatId).ExecuteUpdateAsync(s => s.SetProperty(r => r.IsComplete, true));
        });

        var snapshot = await (await factory.CreateClient().GetAsync(Url(arena))).ReadAsync<TeamProgressSnapshotDto>();
        Assert.Equal(TeamProgressStatus.Upcoming, snapshot.Progress.Status);
        Assert.Equal(1, snapshot.Progress.HeatsUntil);
    }

    [Theory]
    [InlineData("race-start", TeamProgressStatus.InArena)]
    [InlineData("heat-start", TeamProgressStatus.InArena)]
    [InlineData("pause", TeamProgressStatus.Paused)]
    [InlineData("finished", TeamProgressStatus.Finished)]
    [InlineData("withdrawn", TeamProgressStatus.Withdrawn)]
    [InlineData("pending-final", TeamProgressStatus.DrawPending)]
    public async Task ReadsRecordedProgressAndPendingDraws(string state, TeamProgressStatus expected)
    {
        var arena = await factory.CreateArenaAsync(1);
        var heat = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        await factory.WithDbAsync(async db =>
        {
            var section = await db.CompetitionSections.FindAsync(arena.SectionId);
            Assert.NotNull(section);
            section.HasFinal = state == "pending-final";
            if (state == "race-start")
                await db.Races.Where(r => r.HeatId == heat.HeatId).ExecuteUpdateAsync(s => s.SetProperty(r => r.StartedAt, DateTime.UtcNow));
            if (state == "heat-start")
                await db.Heats.Where(h => h.Id == heat.HeatId).ExecuteUpdateAsync(s => s.SetProperty(h => h.StartedAt, DateTime.UtcNow));
            if (state == "pause")
                db.Sessions.Add(new Session { CompetitionId = arena.CompetitionId, Kind = SessionKind.Break, OrderIndex = 0, Notes = "[paused:1234]" });
            if (state == "finished")
                await db.Races.Where(r => r.HeatId == heat.HeatId).ExecuteUpdateAsync(s => s.SetProperty(r => r.IsComplete, true));
            if (state == "withdrawn")
                await db.Teams.Where(t => t.Id == arena.TeamIds[0]).ExecuteUpdateAsync(s => s.SetProperty(t => t.EntryStatus, TeamEntryStatus.Withdrawn));
            if (state == "pending-final")
                db.Heats.Add(new Heat { SessionId = arena.SessionId, Label = "A Final", OrderIndex = 0 });
            await db.SaveChangesAsync();
        });

        var snapshot = await (await factory.CreateClient().GetAsync(Url(arena))).ReadAsync<TeamProgressSnapshotDto>();
        Assert.Equal(expected, snapshot.Progress.Status);
    }

    [Fact]
    public async Task MissingOrWrongCompetitionTeam_Returns404()
    {
        var arena = await factory.CreateArenaAsync(1);
        var other = await factory.CreateArenaAsync(1);
        var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Url(arena, other.TeamIds[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Url(arena, int.MaxValue))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.GetAsync($"/api/competitions/{int.MaxValue}/teams/{arena.TeamIds[0]}/progress")).StatusCode);
    }

    [Fact]
    public async Task ManualIpBlock_ProtectsAnonymousProgressRead()
    {
        var arena = await factory.CreateArenaAsync(1);
        await factory.WithDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock { IpAddress = "203.0.113.211" });
            await db.SaveChangesAsync();
        });
        using var request = new HttpRequestMessage(HttpMethod.Get, Url(arena));
        request.Headers.Add("X-Test-Ip", "203.0.113.211");
        Assert.Equal(HttpStatusCode.Forbidden, (await factory.CreateClient().SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task SnapshotIgnoresTrackedEntities_AndUsesInjectedClock()
    {
        var arena = await factory.CreateArenaAsync(1);
        var heat = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        await factory.WithDbAsync(async db =>
        {
            var tracked = await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0]);
            tracked.EntryStatus = TeamEntryStatus.Withdrawn;
            var trackedHeat = await db.Heats.SingleAsync(h => h.Id == heat.HeatId);
            trackedHeat.StartedAt = DateTime.UtcNow;
            var clock = new ManualTimeProvider();
            var controller = new TeamProgressController(db, clock);

            var result = await controller.Get(arena.CompetitionId, arena.TeamIds[0], CancellationToken.None);
            var snapshot = Assert.IsType<TeamProgressSnapshotDto>(result.Value);
            Assert.Equal(TeamProgressStatus.Upcoming, snapshot.Progress.Status);
            Assert.Equal(clock.GetUtcNow(), snapshot.ObservedAt);
            Assert.Equal(clock.GetUtcNow().AddSeconds(60), snapshot.StaleAt);
            Assert.Null(db.Database.CurrentTransaction);
        });
    }
}
