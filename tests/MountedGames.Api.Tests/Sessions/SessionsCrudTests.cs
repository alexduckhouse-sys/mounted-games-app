using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
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
    public async Task Create_Returns400_WhenSectionNotInCompetition()
    {
        var a = await _f.CreateArenaAsync();
        var other = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        var missing = await admin.PostAsJsonAsync(Url(a), NewSession(999999));
        var foreign = await admin.PostAsJsonAsync(Url(a), NewSession(other.SectionId));

        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
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

    // ---- Update ----

    [Fact]
    public async Task Update_RenamesMovesAndTimesASession_LeavingOtherFieldsAlone()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var start = new DateTime(2030, 6, 1, 9, 30, 0, DateTimeKind.Utc);

        var r = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}"), new UpdateSessionRequest("  Seniors · Session 2  ", " Arena 2 ", start));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<SessionDto>();
        Assert.Equal("Seniors · Session 2", dto.Name);
        Assert.Equal("Arena 2", dto.ArenaName);
        Assert.Equal(start, dto.ScheduledStart);

        var again = await (await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}"), new UpdateSessionRequest(ArenaName: ""))).ReadAsync<SessionDto>();
        Assert.Equal("Seniors · Session 2", again.Name);
        Assert.True(string.IsNullOrEmpty(again.ArenaName));
        Assert.Equal(start, again.ScheduledStart);
    }

    [Fact]
    public async Task Update_Refuses_ABlankName()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}"), new UpdateSessionRequest("   "));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns404_WhenSessionIsMissingOrInAnotherCompetition()
    {
        var a = await _f.CreateArenaAsync();
        var b = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync(Url(a, "/999999"), new UpdateSessionRequest("x"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync(Url(b, $"/{a.SessionId}"), new UpdateSessionRequest("x"))).StatusCode);
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

    // ---- Settings / lanes ----

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

    /// <summary>Two heats of two teams, each with one completed, scored race. Heat 1 has T0/T1, Heat 2 has T2/T3.</summary>
    private async Task<(Arena A, int H1, int H2, int[] Races)> ScoredTwoHeatSessionAsync()
    {
        var a = await _f.CreateArenaAsync();
        var (h1, r1) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[0], a.TeamIds[1] }, "Heat 1", 1);
        var (h2, r2) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[2], a.TeamIds[3] }, "Heat 2", 2);
        await _f.WithDbAsync(async db =>
        {
            foreach (var (raceId, first, second) in new[] { (r1[0], a.TeamIds[0], a.TeamIds[1]), (r2[0], a.TeamIds[2], a.TeamIds[3]) })
            {
                db.Results.Add(new Result { RaceId = raceId, TeamId = first, Placing = 1, Points = 2 });
                db.Results.Add(new Result { RaceId = raceId, TeamId = second, Placing = 2, Points = 1 });
                var race = await db.Races.SingleAsync(r => r.Id == raceId);
                race.IsComplete = true;
                race.StartedAt = DateTime.UtcNow;
                race.FinishedAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync();
        });
        return (a, h1, h2, new[] { r1[0], r2[0] });
    }

    [Fact]
    public async Task UpdateHeatAssignments_KeepsScoresInHeatsThatDidNotChange()
    {
        var (a, h1, h2, _) = await ScoredTwoHeatSessionAsync();
        var admin = await _f.AdminAsync();
        // Heat 1 is sent back exactly as it is; Heat 2 swaps its lanes.
        var req = new UpdateHeatAssignmentsRequest(new[]
        {
            new HeatAssignmentEntry("Heat 1", new[] { a.TeamIds[0], a.TeamIds[1] }),
            new HeatAssignmentEntry("Heat 2", new[] { a.TeamIds[3], a.TeamIds[2] }),
        });

        var r = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments"), req);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var byId = (await r.ReadAsync<SessionDto>()).Heats.ToDictionary(h => h.Id);
        var scored = byId[h1].Races.Single();
        Assert.True(scored.IsComplete);
        Assert.NotNull(scored.StartedAt);
        Assert.Equal(new[] { a.TeamIds[0], a.TeamIds[1] }, scored.Results.OrderBy(x => x.Placing).Select(x => x.TeamId));
        Assert.Equal(new[] { a.TeamIds[0], a.TeamIds[1] }, byId[h1].Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
        // The changed heat is rewritten: new lane order, results cleared.
        Assert.Equal(new[] { a.TeamIds[3], a.TeamIds[2] }, byId[h2].Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
        Assert.Equal(new[] { 1, 2 }, byId[h2].Entries.OrderBy(e => e.LaneIndex).Select(e => e.LaneIndex));
        Assert.Empty(byId[h2].Races.Single().Results);
        Assert.False(byId[h2].Races.Single().IsComplete);
    }

    [Fact]
    public async Task UpdateHeatAssignments_MatchesUnlabelledHeatsByPosition()
    {
        var a = await _f.CreateArenaAsync();
        var (h1, _) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[0], a.TeamIds[1] }, null!, 1);
        var (h2, _) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[2], a.TeamIds[3] }, null!, 2);
        var admin = await _f.AdminAsync();
        // The web editor names unlabelled heats "Heat 1", "Heat 2" by position.
        var req = new UpdateHeatAssignmentsRequest(new[]
        {
            new HeatAssignmentEntry("Heat 1", new[] { a.TeamIds[0], a.TeamIds[1] }),
            new HeatAssignmentEntry("Heat 2", new[] { a.TeamIds[3], a.TeamIds[2] }),
        });

        var byId = (await (await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments"), req)).ReadAsync<SessionDto>())
            .Heats.ToDictionary(h => h.Id);

        Assert.Equal(new[] { a.TeamIds[0], a.TeamIds[1] }, byId[h1].Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
        Assert.Equal(new[] { a.TeamIds[3], a.TeamIds[2] }, byId[h2].Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
    }

    [Fact]
    public async Task UpdateHeatAssignments_ResendingEverythingUnchanged_ChangesNothing()
    {
        var (a, _, _, _) = await ScoredTwoHeatSessionAsync();
        var admin = await _f.AdminAsync();
        var req = new UpdateHeatAssignmentsRequest(new[]
        {
            new HeatAssignmentEntry("Heat 1", new[] { a.TeamIds[0], a.TeamIds[1] }),
            new HeatAssignmentEntry("Heat 2", new[] { a.TeamIds[2], a.TeamIds[3] }),
        });

        var r = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments"), req);

        var s = await r.ReadAsync<SessionDto>();
        Assert.All(s.Heats, h => Assert.Equal(2, h.Races.Single().Results.Count));
        Assert.All(s.Heats, h => Assert.True(h.Races.Single().IsComplete));
    }

    [Fact]
    public async Task UpdateHeatAssignments_MovingATeamBetweenHeats_ClearsOnlyThoseTwoHeats()
    {
        var a = await _f.CreateArenaAsync(teamCount: 5);
        var (h1, r1) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[0], a.TeamIds[1] }, "Heat 1", 1);
        var (h2, r2) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[2], a.TeamIds[3] }, "Heat 2", 2);
        var (h3, r3) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[4] }, "Heat 3", 3);
        await _f.WithDbAsync(async db =>
        {
            foreach (var (raceId, team) in new[] { (r1[0], a.TeamIds[0]), (r2[0], a.TeamIds[2]), (r3[0], a.TeamIds[4]) })
            {
                db.Results.Add(new Result { RaceId = raceId, TeamId = team, Placing = 1, Points = 2 });
                (await db.Races.SingleAsync(r => r.Id == raceId)).IsComplete = true;
            }
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        var req = new UpdateHeatAssignmentsRequest(new[]
        {
            new HeatAssignmentEntry("Heat 1", new[] { a.TeamIds[0] }),
            new HeatAssignmentEntry("Heat 2", new[] { a.TeamIds[2], a.TeamIds[3], a.TeamIds[1] }),
            new HeatAssignmentEntry("Heat 3", new[] { a.TeamIds[4] }),
        });

        var byId = (await (await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments"), req)).ReadAsync<SessionDto>())
            .Heats.ToDictionary(h => h.Id);

        Assert.Empty(byId[h1].Races.Single().Results);
        Assert.Empty(byId[h2].Races.Single().Results);
        Assert.Single(byId[h3].Races.Single().Results);
        Assert.True(byId[h3].Races.Single().IsComplete);
    }

    [Fact]
    public async Task UpdateHeatAssignments_Returns409AndSavesNothing_WhenAChangedHeatIsSignedOff()
    {
        var (a, h1, h2, races) = await ScoredTwoHeatSessionAsync();
        await _f.WithDbAsync(async db =>
        {
            db.Add(new RaceScoreState { RaceId = races[0], Revision = 1, IsSignedOff = true, SignedOffAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        // Heat 1 is signed off and its lanes change; Heat 2 would also change.
        var req = new UpdateHeatAssignmentsRequest(new[]
        {
            new HeatAssignmentEntry("Heat 1", new[] { a.TeamIds[1], a.TeamIds[0] }),
            new HeatAssignmentEntry("Heat 2", new[] { a.TeamIds[3], a.TeamIds[2] }),
        });

        var r = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments"), req);

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Contains("Heat 1", (await r.ReadAsync<System.Text.Json.JsonElement>()).GetProperty("message").GetString());
        var s = await (await admin.GetAsync(Url(a, $"/{a.SessionId}"))).ReadAsync<SessionDto>();
        var byId = s.Heats.ToDictionary(h => h.Id);
        Assert.Equal(new[] { a.TeamIds[0], a.TeamIds[1] }, byId[h1].Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
        Assert.Equal(new[] { a.TeamIds[2], a.TeamIds[3] }, byId[h2].Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
        Assert.Equal(2, byId[h2].Races.Single().Results.Count);
    }

    [Fact]
    public async Task UpdateHeatAssignments_AllowsEditingOtherHeats_WhenASignedOffHeatIsUntouched()
    {
        var (a, h1, h2, races) = await ScoredTwoHeatSessionAsync();
        await _f.WithDbAsync(async db =>
        {
            db.Add(new RaceScoreState { RaceId = races[0], Revision = 1, IsSignedOff = true, SignedOffAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        var req = new UpdateHeatAssignmentsRequest(new[]
        {
            new HeatAssignmentEntry("Heat 1", new[] { a.TeamIds[0], a.TeamIds[1] }),
            new HeatAssignmentEntry("Heat 2", new[] { a.TeamIds[3], a.TeamIds[2] }),
        });

        var r = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments"), req);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var byId = (await r.ReadAsync<SessionDto>()).Heats.ToDictionary(h => h.Id);
        Assert.Equal(2, byId[h1].Races.Single().Results.Count);
        Assert.Empty(byId[h2].Races.Single().Results);
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

    [Theory]
    [InlineData("remove")]
    [InlineData("reorder")]
    [InlineData("append")]
    public async Task UpdateHeatAssignments_PreserveRejectsHistoricalMembershipChangesAtomically(string change)
    {
        var (a, _, _, _) = await ScoredTwoHeatSessionAsync();
        var admin = await _f.AdminAsync();
        var before = await admin.GetStringAsync(Url(a, $"/{a.SessionId}"));
        var ids = change switch
        {
            "remove" => new[] { a.TeamIds[0] },
            "reorder" => new[] { a.TeamIds[1], a.TeamIds[0] },
            _ => new[] { a.TeamIds[0], a.TeamIds[1], a.TeamIds[2] },
        };
        var req = new UpdateHeatAssignmentsRequest(new[]
        {
            new HeatAssignmentEntry("Heat 1", ids),
            new HeatAssignmentEntry("Heat 2", new[] { a.TeamIds[3], a.TeamIds[2] }),
        });

        var response = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments?preserveCompletedScores=true"), req);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("Nothing was saved", await response.Content.ReadAsStringAsync());
        Assert.Equal(before, await admin.GetStringAsync(Url(a, $"/{a.SessionId}")));
    }

    [Fact]
    public async Task UpdateHeatAssignments_PreserveAllowsUntouchedHeatChangesBesideUnchangedProtectedHeat()
    {
        var (a, h1, h2, raceIds) = await ScoredTwoHeatSessionAsync();
        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.Include(r => r.Results).SingleAsync(r => r.Id == raceIds[1]);
            db.Results.RemoveRange(race.Results);
            race.IsComplete = false;
            race.StartedAt = null;
            race.FinishedAt = null;
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        var before = await (await admin.GetAsync(Url(a, $"/{a.SessionId}"))).ReadAsync<SessionDto>();
        var req = new UpdateHeatAssignmentsRequest(new[]
        {
            new HeatAssignmentEntry("Heat 1", new[] { a.TeamIds[0], a.TeamIds[1] }),
            new HeatAssignmentEntry("Heat 2", new[] { a.TeamIds[3], a.TeamIds[2] }),
        });

        var response = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments?preserveCompletedScores=true"), req);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var after = await response.ReadAsync<SessionDto>();
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(before.Heats.Single(h => h.Id == h1)),
            System.Text.Json.JsonSerializer.Serialize(after.Heats.Single(h => h.Id == h1)));
        Assert.Equal(new[] { a.TeamIds[3], a.TeamIds[2] }, after.Heats.Single(h => h.Id == h2).Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UpdateHeatAssignments_PreserveProtectsStartedOrPreviouslyScoredRaceWithoutResults(bool revisionOnly)
    {
        var a = await _f.CreateArenaAsync();
        var (_, races) = await _f.AddHeatAsync(a.SessionId, new[] { a.TeamIds[0], a.TeamIds[1] }, "Heat 1", 1);
        await _f.WithDbAsync(async db =>
        {
            if (revisionOnly) db.Set<RaceScoreState>().Add(new RaceScoreState { RaceId = races[0], Revision = 1 });
            else (await db.Races.SingleAsync(r => r.Id == races[0])).StartedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        var before = await admin.GetStringAsync(Url(a, $"/{a.SessionId}"));
        var req = new UpdateHeatAssignmentsRequest(new[] { new HeatAssignmentEntry("Heat 1", new[] { a.TeamIds[1], a.TeamIds[0] }) });

        var response = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/heat-assignments?preserveCompletedScores=true"), req);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(before, await admin.GetStringAsync(Url(a, $"/{a.SessionId}")));
    }

    [Fact]
    public async Task UpdateSessionRaces_ReplacesUncompletedRaces_AndKeepsCompletedRaces()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var heat = await (await admin.PostAsJsonAsync(Url(a, $"/{a.SessionId}/heats"),
            new CreateHeatRequest("Heat 1", 1, new[] { a.TeamIds[0], a.TeamIds[1] }, new[] { "Bending", "Sack" }))).ReadAsync<HeatDto>();
        await _f.WithDbAsync(async db =>
        {
            var r1 = await db.Races.SingleAsync(r => r.Id == heat.Races[0].Id);
            r1.IsComplete = true;
            await db.SaveChangesAsync();
        });

        var res = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}/races"), new { raceNames = new[] { "Bending", "Mug", "Flag" } });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var updated = await res.ReadAsync<SessionDto>();
        var races = updated.Heats.Single(h => h.Id == heat.Id).Races.OrderBy(r => r.OrderIndex).ToList();
        Assert.Equal(new[] { "Bending", "Mug", "Flag" }, races.Select(r => r.Name));
        Assert.True(races[0].IsComplete);
        Assert.False(races[1].IsComplete);
        Assert.False(races[2].IsComplete);
    }

    [Fact]
    public async Task ShiftSessionTimes_ShiftsUncompletedSessionsByDeltaMinutes()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var start = new DateTime(2030, 6, 1, 10, 0, 0, DateTimeKind.Utc);
        await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}"), new UpdateSessionRequest("Session A", "Arena 1", start));

        var res = await admin.PostAsJsonAsync(Url(a, "/shift-times"), new { deltaMinutes = 15, arenaName = "Arena 1" });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var sessions = await res.ReadAsync<List<SessionDto>>();
        Assert.Equal(start.AddMinutes(15), sessions.Single(s => s.Id == a.SessionId).ScheduledStart);
    }
    [Fact]
    public async Task UpdateSessionRaces_UnchangedFullProgramme_PreservesEveryHeatAndRaceId()
    {
        var arena = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var first = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, "Heat 1", raceCount: 2);
        var second = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, "Heat 2", raceCount: 2);
        await _f.WithDbAsync(async db =>
        {
            (await db.Races.FindAsync(first.RaceIds[0]))!.IsComplete = true;
            await db.SaveChangesAsync();
        });
        var names = await _f.InDbAsync(db => db.Races.Where(r => first.RaceIds.Contains(r.Id)).OrderBy(r => r.OrderIndex).Select(r => r.Name).ToListAsync());
        var response = await admin.PutAsJsonAsync(Url(arena, $"/{arena.SessionId}/races"), new { raceNames = names });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.ReadAsync<SessionDto>();
        Assert.Equal(first.RaceIds, updated.Heats.Single(h => h.Id == first.HeatId).Races.OrderBy(r => r.OrderIndex).Select(r => r.Id));
        Assert.Equal(second.RaceIds, updated.Heats.Single(h => h.Id == second.HeatId).Races.OrderBy(r => r.OrderIndex).Select(r => r.Id));
        Assert.Equal(names, updated.Heats.Single(h => h.Id == second.HeatId).Races.OrderBy(r => r.OrderIndex).Select(r => r.Name));
    }

    [Fact]
    public async Task UpdateSessionRaces_OutOfOrderCompletedRace_KeepsItsOriginalPositionAndRejectsChanges()
    {
        var arena = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var heat = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        await _f.WithDbAsync(async db =>
        {
            (await db.Races.FindAsync(heat.RaceIds[1]))!.IsComplete = true;
            await db.SaveChangesAsync();
        });
        var names = await _f.InDbAsync(db => db.Races.Where(r => heat.RaceIds.Contains(r.Id)).OrderBy(r => r.OrderIndex).Select(r => r.Name).ToListAsync());
        var response = await admin.PutAsJsonAsync(Url(arena, $"/{arena.SessionId}/races"), new { raceNames = new[] { "New unscored game", names[1], "Extra game" } });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var races = (await response.ReadAsync<SessionDto>()).Heats.Single().Races.OrderBy(r => r.OrderIndex).ToList();
        Assert.Equal(heat.RaceIds[0], races[0].Id);
        Assert.Equal(heat.RaceIds[1], races[1].Id);
        Assert.True(races[1].IsComplete);
        var rejected = await admin.PutAsJsonAsync(Url(arena, $"/{arena.SessionId}/races"), new { raceNames = new[] { names[1] } });
        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        Assert.Contains("nothing was saved", await rejected.Content.ReadAsStringAsync());
    }
}
