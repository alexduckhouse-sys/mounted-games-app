using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sessions;

public class SessionsCrudTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public SessionsCrudTests(ApiFactory f) => _f = f;

    private static string Url(Arena a, string suffix = "") => $"/api/competitions/{a.CompetitionId}/sessions{suffix}";

    private static CreateSessionRequest NewSession(int? sectionId = null, string name = "New session", int order = 5,
        bool isBreak = false, SessionKind? kind = null)
        => new(sectionId, name, "Arena 1", new DateTime(2030, 5, 1, 9, 0, 0, DateTimeKind.Utc), order, "notes", isBreak, 30, kind, "Main ring");

    // ---- List / Get ----

    [Fact]
    public async Task List_ReturnsSessionsInOrder_ForAnonymous()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        await admin.PostAsJsonAsync(Url(a), NewSession(a.SectionId, "Later", order: 9));
        await admin.PostAsJsonAsync(Url(a), NewSession(a.SectionId, "Earlier", order: 0));

        var r = await _f.CreateClient().GetAsync(Url(a));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var list = await r.ReadAsync<List<SessionDto>>();
        Assert.Equal(new[] { "Earlier", "Session A", "Later" }, list.Select(s => s.Name));
    }

    [Fact]
    public async Task List_ReturnsEmpty_ForUnknownCompetition()
    {
        var r = await _f.CreateClient().GetAsync("/api/competitions/999999/sessions");
        Assert.Empty(await r.ReadAsync<List<SessionDto>>());
    }

    [Fact]
    public async Task Get_ReturnsSessionWithHeats()
    {
        var a = await _f.CreateArenaAsync();
        await _f.AddHeatAsync(a.SessionId, a.TeamIds.Take(2));

        var r = await _f.CreateClient().GetAsync(Url(a, $"/{a.SessionId}"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal("Under 12 Teams", s.SectionName);
        var heat = Assert.Single(s.Heats);
        Assert.Equal(new[] { "Team 1", "Team 2" }, heat.Entries.Select(e => e.TeamName));
    }

    [Fact]
    public async Task Get_Returns404_WhenSessionMissing()
    {
        var a = await _f.CreateArenaAsync();
        var r = await _f.CreateClient().GetAsync(Url(a, "/999999"));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Get_Returns404_WhenSessionBelongsToAnotherCompetition()
    {
        var a = await _f.CreateArenaAsync();
        var b = await _f.CreateArenaAsync();
        var r = await _f.CreateClient().GetAsync(Url(b, $"/{a.SessionId}"));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- Create ----

    [Fact]
    public async Task Create_PersistsRaceSession_WithSectionName()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync(Url(a), NewSession(a.SectionId));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal(SessionKind.Race, s.Kind);
        Assert.False(s.IsBreak);
        Assert.Equal("Under 12 Teams", s.SectionName);
        Assert.Equal("Main ring", s.Location);
        Assert.Equal(SessionStatus.Upcoming, s.Status);
        var stored = await _f.WithDbAsync(db => db.Sessions.SingleAsync(x => x.Id == s.Id));
        Assert.Equal(a.CompetitionId, stored.CompetitionId);
        Assert.Equal(30, stored.DurationMinutes);
    }

    [Fact]
    public async Task Create_DefaultsKindToBreak_WhenIsBreakAndNoKind()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a), NewSession(isBreak: true))).ReadAsync<SessionDto>();

        Assert.Equal(SessionKind.Break, s.Kind);
        Assert.True(s.IsBreak);
        Assert.Null(s.SectionName);
    }

    [Fact]
    public async Task Create_ExplicitKindWinsOverIsBreakFlag()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        var briefing = await (await admin.PostAsJsonAsync(Url(a), NewSession(isBreak: true, kind: SessionKind.Briefing))).ReadAsync<SessionDto>();
        var brk = await (await admin.PostAsJsonAsync(Url(a), NewSession(isBreak: false, kind: SessionKind.Break))).ReadAsync<SessionDto>();

        Assert.Equal(SessionKind.Briefing, briefing.Kind);
        Assert.False(briefing.IsBreak);
        Assert.Equal(SessionKind.Break, brk.Kind);
        Assert.True(brk.IsBreak);
    }

    [Fact]
    public async Task Create_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions/999999/sessions", NewSession());
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- Status ----

    [Fact]
    public async Task SetStatus_InArena_StampsStartedAtOnce_AndPostsSystemMessage()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        var first = await (await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/status"), new UpdateSessionStatusRequest(SessionStatus.InArena))).ReadAsync<SessionDto>();
        Assert.Equal(SessionStatus.InArena, first.Status);
        Assert.NotNull(first.StartedAt);
        Assert.Null(first.FinishedAt);

        // Setting it again must not move the original start time.
        var second = await (await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/status"), new UpdateSessionStatusRequest(SessionStatus.InArena))).ReadAsync<SessionDto>();
        Assert.Equal(first.StartedAt, second.StartedAt);

        var chat = await _f.WithDbAsync(db => db.ChatMessages.Where(m => m.CompetitionId == a.CompetitionId).ToListAsync());
        Assert.Equal(2, chat.Count);
        Assert.All(chat, m =>
        {
            Assert.Equal(ChatMessageType.System, m.Type);
            Assert.Equal("session", m.Tag);
            Assert.Equal("Session A is now in the arena.", m.Body);
        });
    }

    [Fact]
    public async Task SetStatus_Finished_StampsFinishedAtOnce()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var url = Url(a, $"/{a.SessionId}/status");

        var first = await (await admin.PutAsJsonAsync(url, new UpdateSessionStatusRequest(SessionStatus.Finished))).ReadAsync<SessionDto>();
        var second = await (await admin.PutAsJsonAsync(url, new UpdateSessionStatusRequest(SessionStatus.Finished))).ReadAsync<SessionDto>();

        Assert.NotNull(first.FinishedAt);
        Assert.Equal(first.FinishedAt, second.FinishedAt);
        var body = await _f.WithDbAsync(db => db.ChatMessages.Where(m => m.CompetitionId == a.CompetitionId).Select(m => m.Body).Distinct().SingleAsync());
        Assert.Equal("Session A has finished.", body);
    }

    [Fact]
    public async Task SetStatus_BackToUpcoming_UsesUpcomingLabel_AndKeepsTimestamps()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var url = Url(a, $"/{a.SessionId}/status");
        await admin.PutAsJsonAsync(url, new UpdateSessionStatusRequest(SessionStatus.InArena));

        var s = await (await admin.PutAsJsonAsync(url, new UpdateSessionStatusRequest(SessionStatus.Upcoming))).ReadAsync<SessionDto>();

        Assert.Equal(SessionStatus.Upcoming, s.Status);
        Assert.NotNull(s.StartedAt);
        var last = await _f.WithDbAsync(db => db.ChatMessages.Where(m => m.CompetitionId == a.CompetitionId).OrderByDescending(m => m.Id).Select(m => m.Body).FirstAsync());
        Assert.Equal("Session A is upcoming.", last);
    }

    [Fact]
    public async Task SetStatus_Returns404_WhenSessionMissing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync(Url(a, "/999999/status"), new UpdateSessionStatusRequest(SessionStatus.InArena));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- Delete ----

    [Fact]
    public async Task Delete_RemovesSession()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        var r = await admin.DeleteAsync(Url(a, $"/{a.SessionId}"));

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.Sessions.AnyAsync(s => s.Id == a.SessionId)));
    }

    [Fact]
    public async Task Delete_Returns404_WhenSessionInOtherCompetition()
    {
        var a = await _f.CreateArenaAsync();
        var b = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        var r = await admin.DeleteAsync(Url(b, $"/{a.SessionId}"));

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.True(await _f.WithDbAsync(db => db.Sessions.AnyAsync(s => s.Id == a.SessionId)));
    }

    // ---- AddHeat ----

    [Fact]
    public async Task AddHeat_CreatesEntriesAndRaces_SkippingDuplicatesAndBlankNames()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var req = new CreateHeatRequest("Heat X", 3,
            new[] { a.TeamIds[0], a.TeamIds[1], a.TeamIds[0] },
            new[] { " Bending ", "", "  ", "Sack" });

        var r = await admin.PostAsJsonAsync(Url(a, $"/{a.SessionId}/heats"), req);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var heat = await r.ReadAsync<HeatDto>();
        Assert.Equal("Heat X", heat.Label);
        Assert.Equal(3, heat.OrderIndex);
        Assert.Equal(new[] { 1, 2 }, heat.Entries.Select(e => e.LaneIndex));
        Assert.Equal(new[] { "Bending", "Sack" }, heat.Races.Select(x => x.Name));
        Assert.Equal(new[] { 1, 2 }, heat.Races.Select(x => x.OrderIndex));
    }

    [Fact]
    public async Task AddHeat_Returns404_WhenSessionMissing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync(Url(a, "/999999/heats"), new CreateHeatRequest("x", 1, Array.Empty<int>(), Array.Empty<string>()));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- Heat scheduled start ----

    [Fact]
    public async Task UpdateHeatScheduledStart_SetsAndClears()
    {
        var a = await _f.CreateArenaAsync();
        var (heatId, _) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();
        var url = Url(a, $"/{a.SessionId}/heats/{heatId}/scheduled-start");
        var when = new DateTime(2031, 1, 2, 10, 30, 0, DateTimeKind.Utc);

        var set = await (await admin.PutAsJsonAsync(url, new UpdateHeatScheduledStartRequest(when))).ReadAsync<HeatDto>();
        Assert.Equal(when, set.ScheduledStart);

        var cleared = await (await admin.PutAsJsonAsync(url, new UpdateHeatScheduledStartRequest(null))).ReadAsync<HeatDto>();
        Assert.Null(cleared.ScheduledStart);
        Assert.Null((await _f.WithDbAsync(db => db.Heats.SingleAsync(h => h.Id == heatId))).ScheduledStart);
    }

    [Fact]
    public async Task UpdateHeatScheduledStart_Returns404_WhenHeatMissing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heats/999999/scheduled-start"), new UpdateHeatScheduledStartRequest(null));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task UpdateHeatScheduledStart_Returns404_WhenCompetitionDoesNotOwnSession()
    {
        var a = await _f.CreateArenaAsync();
        var b = await _f.CreateArenaAsync();
        var (heatId, _) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        var admin = await _f.AdminAsync();

        var r = await admin.PutAsJsonAsync(Url(b, $"/{a.SessionId}/heats/{heatId}/scheduled-start"), new UpdateHeatScheduledStartRequest(null));

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- Stream / settings / lanes ----

    [Fact]
    public async Task SetStream_TrimsUrl_AndBlankClearsIt()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var url = Url(a, $"/{a.SessionId}/stream");

        var set = await (await admin.PutAsJsonAsync(url, new UpdateSessionStreamRequest("  https://youtu.be/abc  "))).ReadAsync<SessionDto>();
        Assert.Equal("https://youtu.be/abc", set.StreamUrl);

        var cleared = await (await admin.PutAsJsonAsync(url, new UpdateSessionStreamRequest("   "))).ReadAsync<SessionDto>();
        Assert.Null(cleared.StreamUrl);
    }

    [Fact]
    public async Task SetStream_Returns404_WhenSessionMissing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync(Url(a, "/999999/stream"), new UpdateSessionStreamRequest("x"));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task SetSettings_AppliesMinutesAndAlternating_AndLeavesAlternatingWhenOmitted()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var url = Url(a, $"/{a.SessionId}/settings");

        var first = await (await admin.PutAsJsonAsync(url, new UpdateSessionSettingsRequest(12, true))).ReadAsync<SessionDto>();
        Assert.Equal(12, first.MinutesPerHeat);
        Assert.True(first.RaceOrderAlternating);

        var second = await (await admin.PutAsJsonAsync(url, new UpdateSessionSettingsRequest(15, null))).ReadAsync<SessionDto>();
        Assert.Equal(15, second.MinutesPerHeat);
        Assert.True(second.RaceOrderAlternating);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(null)]
    public async Task SetSettings_ClearsMinutes_WhenNotPositive(int? minutes)
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var url = Url(a, $"/{a.SessionId}/settings");
        await admin.PutAsJsonAsync(url, new UpdateSessionSettingsRequest(12, false));

        var s = await (await admin.PutAsJsonAsync(url, new UpdateSessionSettingsRequest(minutes, false))).ReadAsync<SessionDto>();

        Assert.Null(s.MinutesPerHeat);
    }

    [Fact]
    public async Task SetSettings_Returns404_WhenSessionMissing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync(Url(a, "/999999/settings"), new UpdateSessionSettingsRequest(1, null));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task SetLanes_StoresPositiveValue_AndClearsOtherwise()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var url = Url(a, $"/{a.SessionId}/lanes");

        var set = await (await admin.PutAsJsonAsync(url, new UpdateSessionLanesRequest(6))).ReadAsync<SessionDto>();
        Assert.Equal(6, set.LanesPerHeat);

        var cleared = await (await admin.PutAsJsonAsync(url, new UpdateSessionLanesRequest(0))).ReadAsync<SessionDto>();
        Assert.Null(cleared.LanesPerHeat);
    }

    [Fact]
    public async Task SetLanes_Returns404_WhenSessionMissing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync(Url(a, "/999999/lanes"), new UpdateSessionLanesRequest(3));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    // ---- Heat assignments ----

    [Fact]
    public async Task UpdateHeatAssignments_ReassignsTeamsByLabel_AndResetsScoring()
    {
        var a = await _f.CreateArenaAsync();
        var (h1, races1) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[0], a.TeamIds[1] }, "Heat 1", 1);
        var (h2, _) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[2] }, "Heat 2", 2);
        var (h3, _) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[3] }, "Unmentioned", 3);
        await _f.WithDbAsync(async db =>
        {
            db.Results.Add(new Result { RaceId = races1[0], TeamId = a.TeamIds[0], Placing = 1, Points = 2 });
            var race = await db.Races.SingleAsync(r => r.Id == races1[0]);
            race.IsComplete = true;
            race.StartedAt = DateTime.UtcNow;
            race.FinishedAt = DateTime.UtcNow;
            var heat = await db.Heats.SingleAsync(h => h.Id == h1);
            heat.StartedAt = DateTime.UtcNow;
            heat.FinishedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        var req = new UpdateHeatAssignmentsRequest(new[]
        {
            // Label whitespace is ignored and the same label can appear twice (teams merge in order; repeats within one entry drop).
            new HeatAssignmentEntry(" Heat 1 ", new[] { a.TeamIds[3], a.TeamIds[2] }),
            new HeatAssignmentEntry("Heat 1", new[] { a.TeamIds[1] }),
            new HeatAssignmentEntry("Heat 2", new[] { a.TeamIds[0], a.TeamIds[0], a.TeamIds[1] }),
        });

        var r = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments"), req);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        var byId = s.Heats.ToDictionary(h => h.Id);
        Assert.Equal(new[] { a.TeamIds[3], a.TeamIds[2], a.TeamIds[1] }, byId[h1].Entries.Select(e => e.TeamId));
        Assert.Equal(new[] { a.TeamIds[0], a.TeamIds[1] }, byId[h2].Entries.Select(e => e.TeamId));
        Assert.Empty(byId[h3].Entries);
        Assert.Empty(byId[h1].Races.Single().Results);
        Assert.False(byId[h1].Races.Single().IsComplete);
        Assert.Null(byId[h1].Races.Single().StartedAt);
        Assert.Null(byId[h1].Races.Single().FinishedAt);
        Assert.Null(byId[h1].StartedAt);
        Assert.Null(byId[h1].FinishedAt);
    }

    [Fact]
    public async Task UpdateHeatAssignments_MatchesUnlabelledHeatToBlankLabelAssignment()
    {
        var a = await _f.CreateArenaAsync();
        var (h, _) = await _f.AddHeatAsync(a.SessionId, Array.Empty<int>(), label: null!, 1);
        var admin = await _f.AdminAsync();
        var json = $$"""{"assignments":[{"label":"  ","teamIds":[{{a.TeamIds[0]}}]}]}""";

        var r = await admin.PutAsync(Url(a, $"/{a.SessionId}/heat-assignments"),
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal(a.TeamIds[0], s.Heats.Single(x => x.Id == h).Entries.Single().TeamId);
    }

    [Fact]
    public async Task UpdateHeatAssignments_Returns404_WhenSessionMissing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync(Url(a, "/999999/heat-assignments"), new UpdateHeatAssignmentsRequest(Array.Empty<HeatAssignmentEntry>()));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }
}
