using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Broadcast;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Streaming;

public class BroadcastTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 29, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public async Task PublicSource_IsArenaScopedAndContainsNoPrivateFields()
    {
        var arena = await factory.CreateArenaAsync();
        await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        await factory.WithDbAsync(async db => {
            db.Sessions.Add(new Session { CompetitionId = arena.CompetitionId, Name = "Other arena private programme", ArenaName = "Arena 2" });
            var team = await db.Teams.FindAsync(arena.TeamIds[0]);
            team!.SupporterJoinKey = "fake-private-supporter-key";
            team.CalendarFeedTokenHash = "fake-private-calendar-hash";
            await db.SaveChangesAsync();
        });
        var response = await factory.CreateClient().GetAsync($"/api/competitions/{arena.CompetitionId}/broadcast-snapshot?arena=Arena%201");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("fake-private", text);
        Assert.DoesNotContain("Other arena", text);
        Assert.DoesNotContain("trainerUserId", text);
        var snapshot = await response.ReadAsync<BroadcastSnapshotDto>();
        Assert.NotNull(snapshot.Graphics!.Current);
        Assert.Equal(arena.TeamIds, snapshot.Graphics.Current.Rows.Select(x => x.TeamId));
        Assert.Equal(HttpStatusCode.NotFound, (await factory.CreateClient().GetAsync($"/api/competitions/{arena.CompetitionId}/broadcast-snapshot?arena=unknown")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await factory.CreateClient().GetAsync($"/api/competitions/{arena.CompetitionId}/broadcast-snapshot?arena=Arena%201&delay=121")).StatusCode);
    }

    [Fact]
    public async Task Delay_UsesImmutableNamesAndResults_AndColdJoinIsTransparent()
    {
        var arena = await factory.CreateArenaAsync();
        var heat = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var clock = new Clock();
        await factory.WithDbAsync(async db => {
            var service = new BroadcastService(db, clock);
            var first = await service.ReadAsync(arena.CompetitionId, "Arena 1", null, 30, default);
            Assert.True(first.WarmingUp);
            Assert.Null(first.Graphics);
        });
        await factory.WithDbAsync(async db => {
            (await db.Teams.FindAsync(arena.TeamIds[0]))!.DisplayName = "Changed later";
            (await db.Races.FindAsync(heat.RaceIds[0]))!.Name = "Later race name";
            await db.SaveChangesAsync();
        });
        clock.Now = clock.Now.AddSeconds(31);
        await factory.WithDbAsync(async db => {
            var delayed = await new BroadcastService(db, clock).ReadAsync(arena.CompetitionId, "Arena 1", null, 30, default);
            Assert.False(delayed.WarmingUp);
            Assert.Equal("Team 1", delayed.Graphics!.Current!.Rows[0].Name);
            Assert.Equal("Race 1", delayed.Graphics.Current.RaceName);
            var current = await new BroadcastService(db, clock).ReadAsync(arena.CompetitionId, "Arena 1", null, 0, default);
            Assert.Equal("Changed later", current.Graphics!.Current!.Rows[0].Name);
        });
    }

    [Fact]
    public async Task ScoreCue_IsDurableAndPublic_AndSkipSupersedesShow()
    {
        var arena = await factory.CreateArenaAsync();
        var heat = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var clock = new Clock();
        await factory.WithDbAsync(async db => {
            db.Results.Add(new Result { RaceId = heat.RaceIds[0], TeamId = arena.TeamIds[0], Placing = 1, Points = 4,
                RefereeNote = "fake-private-note", RecordedByUserId = "fake-private-actor" });
            await db.SaveChangesAsync();
            var service = new BroadcastService(db, clock);
            await service.RecordScoreAsync(arena.CompetitionId, new(heat.HeatId, heat.RaceIds[0], "show", [], new Dictionary<int, string>(), 20), default);
            var snapshot = await service.ReadAsync(arena.CompetitionId, "Arena 1", null, 0, default);
            var cue = Assert.Single(snapshot.Graphics!.Cues);
            Assert.Equal("show", cue.Action);
            Assert.DoesNotContain("fake-private", cue.Payload.GetRawText());
            Assert.Equal(4, cue.Payload.GetProperty("rows")[0].GetProperty("points").GetDouble());
        });
        clock.Now = clock.Now.AddSeconds(3);
        await factory.WithDbAsync(async db => {
            var service = new BroadcastService(db, clock);
            await service.RecordScoreAsync(arena.CompetitionId, new(heat.HeatId, heat.RaceIds[0], "skip", [], new Dictionary<int, string>(), null), default);
            var snapshot = await service.ReadAsync(arena.CompetitionId, "Arena 1", null, 0, default);
            Assert.Equal("skip", Assert.Single(snapshot.Graphics!.Cues).Action);
            Assert.Equal(2, await db.Set<BroadcastCue>().CountAsync(c => c.CompetitionId == arena.CompetitionId));
        });
    }

    [Fact]
    public async Task LaneRotationAndSitOutsFollowScoring_HcExcludedFromStandings()
    {
        var arena = await factory.CreateArenaAsync();
        var heat = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        await factory.WithDbAsync(async db => {
            (await db.Sessions.FindAsync(arena.SessionId))!.LanesPerHeat = 3;
            (await db.Races.FindAsync(heat.RaceIds[0]))!.IsComplete = true;
            (await db.Teams.FindAsync(arena.TeamIds[0]))!.IsHorsConcours = true;
            await db.SaveChangesAsync();
            var snapshot = await new BroadcastService(db, new Clock()).ReadAsync(arena.CompetitionId, "Arena 1", null, 0, default);
            Assert.Equal(new[] { arena.TeamIds[3], arena.TeamIds[0], arena.TeamIds[1], arena.TeamIds[2] }, snapshot.Graphics!.Current!.Rows.Select(r => r.TeamId));
            Assert.True(snapshot.Graphics.Current.Rows[^1].SitOut);
            Assert.DoesNotContain(snapshot.Graphics.Standings, r => r.TeamId == arena.TeamIds[0]);
        });
    }

    [Fact]
    public async Task ImmediateHide_RequiresStaffAndClearsOldDelayedHistory()
    {
        var arena = await factory.CreateArenaAsync();
        await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var route = $"/api/competitions/{arena.CompetitionId}/broadcast-snapshot";
        var publicClient = factory.CreateClient();
        var request = new { arena = "Arena 1", hidden = true, expectedRevision = 0 };
        Assert.Equal(HttpStatusCode.Unauthorized, (await publicClient.PutAsJsonAsync(route + "/visibility", request)).StatusCode);
        await publicClient.GetAsync(route + "?arena=Arena%201");
        var admin = await factory.AdminAsync();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync(route + "/visibility", request)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync(route + "/visibility", request)).StatusCode);
        var hidden = await (await publicClient.GetAsync(route + "?arena=Arena%201")).ReadAsync<BroadcastSnapshotDto>();
        Assert.True(hidden.Hidden);
        Assert.Null(hidden.Graphics);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync(route + "/visibility", new { arena = "Arena 1", hidden = false, expectedRevision = 1 })).StatusCode);
        var shown = await (await publicClient.GetAsync(route + "?arena=Arena%201&delay=30")).ReadAsync<BroadcastSnapshotDto>();
        Assert.Null(shown.Graphics);
        Assert.True(shown.WarmingUp);
    }
    [Fact]
    public async Task SupersededCue_DoesNotReturnAfterNewerCueExpires()
    {
        var arena = await factory.CreateArenaAsync();
        var heat = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var clock = new Clock();
        await factory.WithDbAsync(async db => {
            var service = new BroadcastService(db, clock);
            await service.RecordScoreAsync(arena.CompetitionId, new(heat.HeatId, heat.RaceIds[0], "show", [], new Dictionary<int, string>(), 60), default);
            clock.Now = clock.Now.AddSeconds(1);
            await service.RecordScoreAsync(arena.CompetitionId, new(heat.HeatId, heat.RaceIds[0], "show", [], new Dictionary<int, string>(), 3), default);
            clock.Now = clock.Now.AddSeconds(4);
            var snapshot = await service.ReadAsync(arena.CompetitionId, "Arena 1", null, 0, default);
            Assert.Empty(snapshot.Graphics!.Cues);
        });
    }

    [Fact]
    public async Task FinishedEvent_ResolvesDefaultPodiumAndResult_AndHonoursScoreVisibility()
    {
        var arena = await factory.CreateArenaAsync();
        var heat = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var clock = new Clock();
        await factory.WithDbAsync(async db => {
            var race = (await db.Races.FindAsync(heat.RaceIds[0]))!;
            race.IsComplete = true; race.FinishedAt = clock.Now.UtcDateTime.AddMinutes(-10);
            (await db.Heats.FindAsync(heat.HeatId))!.FinishedAt = clock.Now.UtcDateTime.AddMinutes(-5);
            db.Results.Add(new Result { RaceId = race.Id, TeamId = arena.TeamIds[0], Placing = 1, Points = 4 });
            var overlay = new StreamOverlay { CompetitionId = arena.CompetitionId, LookJson = "{\"liveCard\":\"result\"}" };
            db.Add(overlay); await db.SaveChangesAsync();
            var service = new BroadcastService(db, clock);
            var result = await service.ReadAsync(arena.CompetitionId, "Arena 1", null, 0, default, true);
            Assert.Equal(race.Id, result.Graphics!.Score!.RaceId);
            overlay.LookJson = "{\"liveCard\":\"podium\"}"; await db.SaveChangesAsync();
            var podium = await service.ReadAsync(arena.CompetitionId, "Arena 1", null, 0, default, true);
            Assert.NotNull(podium.Graphics!.Podium); Assert.NotEmpty(podium.Graphics.Standings);
            await service.RecordScoreAsync(arena.CompetitionId, new(heat.HeatId, race.Id, "show", [], new Dictionary<int, string>(), 20), default);
            overlay.ScoreCardMode = OverlayMode.Off; await db.SaveChangesAsync();
            var hidden = await service.ReadAsync(arena.CompetitionId, "Arena 1", null, 0, default, true);
            Assert.Null(hidden.Graphics!.Score); Assert.Empty(hidden.Graphics.Cues);
        });
    }

}
