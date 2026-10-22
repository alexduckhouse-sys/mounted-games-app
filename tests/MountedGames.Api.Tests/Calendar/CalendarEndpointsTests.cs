using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Calendar;

public class CalendarEndpointsTests : IClassFixture<ApiFactory>
{
    private const string SecretPayment = "IBAN-GB00-SECRET-PAYMENT";
    private const string SecretRider = "Rider Hidden-Name";
    private const string SecretJoinKey = "JOINKEY99";

    private readonly ApiFactory _f;
    public CalendarEndpointsTests(ApiFactory f) => _f = f;

    private record Setup(int CompetitionId, int TeamId, int OtherTeamId, int HeatId, int SessionId, string TrainerId);

    /// <summary>A competition at 9:00 on a fixed day with one heat holding the team and another team.</summary>
    private async Task<Setup> SeedAsync(string? name = null, string? ownerId = null, string? teamTrainerId = null)
    {
        var arena = await _f.CreateArenaAsync(2);
        var (heatId, _) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, "Heat 1");
        var trainer = await _f.TrainerIdAsync();
        await _f.InDbAsync(async db =>
        {
            var c = await db.Competitions.SingleAsync(x => x.Id == arena.CompetitionId);
            if (name is not null) c.Name = name;
            c.Location = "Tatton Park, Knutsford";
            c.Description = "A friendly day, with ponies";
            c.StartDate = new DateTime(2026, 10, 17, 8, 0, 0, DateTimeKind.Utc);
            c.EndDate = new DateTime(2026, 10, 17, 17, 0, 0, DateTimeKind.Utc);
            c.PaymentDestination = SecretPayment;
            c.CreatedByUserId = ownerId;
            var s = await db.Sessions.SingleAsync(x => x.Id == arena.SessionId);
            s.ScheduledStart = new DateTime(2026, 10, 17, 9, 0, 0, DateTimeKind.Utc);
            s.ArenaName = "Arena 2";
            var team = await db.Teams.SingleAsync(x => x.Id == arena.TeamIds[0]);
            team.TrainerUserId = teamTrainerId;
            team.SupporterJoinKey = SecretJoinKey;
            var form = new DeclarationForm { TeamId = team.Id, Riders = [new RiderEntry { FullName = SecretRider, HorseName = "Secret Pony" }] };
            db.DeclarationForms.Add(form);
            await db.SaveChangesAsync();
        });
        return new Setup(arena.CompetitionId, arena.TeamIds[0], arena.TeamIds[1], heatId, arena.SessionId, trainer);
    }

    private Task UpdateSessionAsync(int sessionId, Action<Session> change) => _f.InDbAsync(async db =>
    {
        change(await db.Sessions.SingleAsync(x => x.Id == sessionId));
        await db.SaveChangesAsync();
    });

    private static async Task<string> TextAsync(HttpResponseMessage r) => await r.Content.ReadAsStringAsync();

    private async Task<CalendarFeedCreatedDto> CreateFeedAsync(HttpClient client, int teamId)
    {
        var r = await client.PostAsync($"/api/teams/{teamId}/calendar-feed", null);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.ReadAsync<CalendarFeedCreatedDto>();
    }

    // ----- Competition file -----

    [Fact]
    public async Task CompetitionIcs_IsPublic_AndHasTheEventDetails()
    {
        var s = await SeedAsync(name: "Spring Games");

        var r = await _f.CreateClient().GetAsync($"/api/competitions/{s.CompetitionId}/calendar.ics?site=https://app.example.org");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("text/calendar", r.Content.Headers.ContentType?.MediaType);
        Assert.Equal("Spring-Games.ics", r.Content.Headers.ContentDisposition?.FileName);
        var body = await TextAsync(r);
        Assert.Contains("\r\nUID:competition-" + s.CompetitionId + "@mg-app\r\n", body);
        Assert.Contains("\r\nSUMMARY:Spring Games\r\n", body);
        Assert.Contains("\r\nDTSTART:20261017T080000Z\r\n", body);
        Assert.Contains("\r\nDTEND:20261017T170000Z\r\n", body);
        Assert.Contains("\r\nLOCATION:Tatton Park\\, Knutsford\r\n", body);
        Assert.Contains($"URL:https://app.example.org/competitions/{s.CompetitionId}\r\n", body);
        Assert.Contains("A friendly day\\, with ponies", body.Replace("\r\n ", ""));
        Assert.True(r.Headers.CacheControl?.Private);
        Assert.Equal(TimeSpan.FromSeconds(60), r.Headers.CacheControl?.MaxAge);
    }

    [Fact]
    public async Task CompetitionIcs_KeepsPrivateFieldsOut_AndIgnoresAHostileSite()
    {
        var s = await SeedAsync();

        var r = await _f.CreateClient().GetAsync($"/api/competitions/{s.CompetitionId}/calendar.ics?site=javascript:alert(1)");
        var body = await TextAsync(r);

        Assert.DoesNotContain(SecretPayment, body);
        Assert.DoesNotContain(SecretRider, body);
        Assert.DoesNotContain(SecretJoinKey, body);
        Assert.DoesNotContain("javascript", body);
        Assert.DoesNotContain("URL:", body);
    }

    [Fact]
    public async Task CompetitionIcs_CannotBeBrokenByTheCompetitionName()
    {
        var s = await SeedAsync(name: "\"><script>alert(1)</script>\r\nEND:VEVENT\r\nBEGIN:VEVENT;X=1,2");

        var r = await _f.CreateClient().GetAsync($"/api/competitions/{s.CompetitionId}/calendar.ics");
        var body = await TextAsync(r);

        var lines = body.Replace("\r\n ", "").Split("\r\n");
        Assert.Single(lines, l => l == "BEGIN:VEVENT");
        Assert.Single(lines, l => l == "END:VEVENT");
        Assert.Contains(lines, l => l.StartsWith("SUMMARY:\"><script>alert(1)</script>\\nEND:VEVENT\\nBEGIN:VEVENT\\;X=1\\,2"));
        Assert.All(body.Split("\r\n"), l => Assert.True(System.Text.Encoding.UTF8.GetByteCount(l) <= 75));
        Assert.DoesNotContain("filename=\"\"", r.Content.Headers.ContentDisposition?.ToString());
    }

    [Fact]
    public async Task CompetitionIcs_WithoutAnEndDate_LastsEightHours_AndUnknownIdsAre404()
    {
        var s = await SeedAsync();
        await _f.InDbAsync(async db =>
        {
            (await db.Competitions.SingleAsync(c => c.Id == s.CompetitionId)).EndDate = null;
            await db.SaveChangesAsync();
        });

        var body = await TextAsync(await _f.CreateClient().GetAsync($"/api/competitions/{s.CompetitionId}/calendar.ics"));

        Assert.Contains("\r\nDTEND:20261017T160000Z\r\n", body);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync("/api/competitions/99999999/calendar.ics")).StatusCode);
    }

    // ----- Team feed: the secret link -----

    [Fact]
    public async Task Feed_NeedsTheToken_AndAnswersWrongOnesTheSameAsMissingTeams()
    {
        var s = await SeedAsync();
        var admin = await _f.AdminAsync();
        var created = await CreateFeedAsync(admin, s.TeamId);
        var anon = _f.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync(created.Path)).StatusCode);
        var wrong = await anon.GetAsync($"/api/calendar/teams/{s.TeamId}/{new string('A', 43)}.ics");
        var otherTeam = await anon.GetAsync($"/api/calendar/teams/{s.OtherTeamId}/{created.Token}.ics");
        var missing = await anon.GetAsync($"/api/calendar/teams/99999999/{created.Token}.ics");
        var short_ = await anon.GetAsync($"/api/calendar/teams/{s.TeamId}/abc.ics");
        foreach (var r in new[] { wrong, otherTeam, missing, short_ })
        {
            Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
            Assert.DoesNotContain("BEGIN:VCALENDAR", await TextAsync(r));
        }
    }

    [Fact]
    public async Task Feed_IsOffUntilCreated_AndStoresOnlyAHash()
    {
        var s = await SeedAsync();
        var admin = await _f.AdminAsync();
        Assert.False((await (await admin.GetAsync($"/api/teams/{s.TeamId}/calendar-feed")).ReadAsync<CalendarFeedStatusDto>()).Enabled);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"/api/calendar/teams/{s.TeamId}/{new string('B', 43)}.ics")).StatusCode);

        var created = await CreateFeedAsync(admin, s.TeamId);

        Assert.Equal(43, created.Token.Length);
        Assert.Matches("^[A-Za-z0-9_-]+$", created.Token);
        Assert.Equal($"/api/calendar/teams/{s.TeamId}/{created.Token}.ics", created.Path);
        Assert.True((await (await admin.GetAsync($"/api/teams/{s.TeamId}/calendar-feed")).ReadAsync<CalendarFeedStatusDto>()).Enabled);
        var stored = await _f.InDbAsync(db => db.Teams.Where(t => t.Id == s.TeamId).Select(t => t.CalendarFeedTokenHash).SingleAsync());
        Assert.NotNull(stored);
        Assert.NotEqual(created.Token, stored);
        Assert.DoesNotContain(created.Token, stored);
        Assert.Equal(64, stored!.Length);
    }

    [Fact]
    public async Task Regenerating_StopsTheOldLink_AndTurningOffStopsThemAll()
    {
        var s = await SeedAsync();
        var admin = await _f.AdminAsync();
        var first = await CreateFeedAsync(admin, s.TeamId);
        var second = await CreateFeedAsync(admin, s.TeamId);
        var anon = _f.CreateClient();

        Assert.NotEqual(first.Token, second.Token);
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync(first.Path)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync(second.Path)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/teams/{s.TeamId}/calendar-feed")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync(second.Path)).StatusCode);
        Assert.False((await (await admin.GetAsync($"/api/teams/{s.TeamId}/calendar-feed")).ReadAsync<CalendarFeedStatusDto>()).Enabled);
    }

    [Fact]
    public async Task ManagingTheLink_NeedsTheTeamsTrainerTheCompetitionOwnerOrAnAdmin()
    {
        var trainerId = await _f.TrainerIdAsync();
        var coached = await SeedAsync(teamTrainerId: trainerId);
        var (otherTrainer, other) = await _f.ApprovedTrainerAsync();
        var owned = await SeedAsync(ownerId: other.User.Id);
        var member = (await _f.SignupAsync("Member")).Client;
        var anon = _f.CreateClient();

        // Anonymous callers are turned away.
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PostAsync($"/api/teams/{coached.TeamId}/calendar-feed", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync($"/api/teams/{coached.TeamId}/calendar-feed")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.DeleteAsync($"/api/teams/{coached.TeamId}/calendar-feed")).StatusCode);

        // The seeded trainer coaches the first team; another trainer, a member and the owner of a different competition can't touch it.
        var trainer = await _f.TrainerAsync();
        Assert.Equal(HttpStatusCode.OK, (await trainer.PostAsync($"/api/teams/{coached.TeamId}/calendar-feed", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTrainer.PostAsync($"/api/teams/{coached.TeamId}/calendar-feed", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.PostAsync($"/api/teams/{coached.TeamId}/calendar-feed", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTrainer.GetAsync($"/api/teams/{coached.TeamId}/calendar-feed")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTrainer.DeleteAsync($"/api/teams/{coached.TeamId}/calendar-feed")).StatusCode);

        // The trainer who created the competition can manage its teams, and a missing team is a 404.
        Assert.Equal(HttpStatusCode.OK, (await otherTrainer.PostAsync($"/api/teams/{owned.TeamId}/calendar-feed", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await trainer.PostAsync($"/api/teams/{owned.TeamId}/calendar-feed", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await trainer.PostAsync("/api/teams/99999999/calendar-feed", null)).StatusCode);
    }

    [Fact]
    public async Task ACompetitionAdminOnTheTeamCanManageItsTeamsLinks_AndNobodyElseOnAnotherCompetitionCan()
    {
        var s = await SeedAsync();
        var (helper, auth) = await _f.SignupAsync("Member");
        var (stranger, _) = await _f.SignupAsync("Member");
        await _f.InDbAsync(async db =>
        {
            db.CompetitionCollaborators.Add(new CompetitionCollaborator
            {
                CompetitionId = s.CompetitionId, UserId = auth.User.Id, Role = CollaboratorRole.CompetitionAdmin,
                AddedByUserId = auth.User.Id, AddedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.OK, (await helper.PostAsync($"/api/teams/{s.TeamId}/calendar-feed", null)).StatusCode);
        Assert.True((await (await helper.GetAsync($"/api/teams/{s.TeamId}/calendar-feed")).ReadAsync<CalendarFeedStatusDto>()).Enabled);
        Assert.Equal(HttpStatusCode.NoContent, (await helper.DeleteAsync($"/api/teams/{s.TeamId}/calendar-feed")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsync($"/api/teams/{s.TeamId}/calendar-feed", null)).StatusCode);
    }

    // ----- Team feed: the content -----

    [Fact]
    public async Task Feed_ListsTheTeamsHeats_WithoutPrivateData()
    {
        var s = await SeedAsync(name: "Spring Games");
        var created = await CreateFeedAsync(await _f.AdminAsync(), s.TeamId);

        var r = await _f.CreateClient().GetAsync(created.Path + "?site=https://app.example.org");
        var body = await TextAsync(r);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("text/calendar", r.Content.Headers.ContentType?.MediaType);
        Assert.True(r.Headers.CacheControl?.Private);
        Assert.True(r.Headers.CacheControl?.NoCache);
        var unfolded = body.Replace("\r\n ", "");
        Assert.Contains($"\r\nUID:heat-{s.HeatId}-team-{s.TeamId}@mg-app\r\n", body);
        Assert.Contains("\r\nDTSTART:20261017T090000Z\r\n", body);
        Assert.Contains("\r\nDTEND:20261017T093000Z\r\n", body);
        Assert.Contains("SEQUENCE:0\r\n", body);
        Assert.Contains("LOCATION:Arena 2\\, Tatton Park\\, Knutsford\r\n", unfolded);
        Assert.Contains("Starting lane: 1", unfolded.Replace("\\n", " "));
        Assert.Contains("REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n", body);
        Assert.Contains($"URL:https://app.example.org/competitions/{s.CompetitionId}\r\n", body);
        Assert.Single(body.Split("BEGIN:VEVENT"), x => x.Contains("UID")); // one heat, one event
        var summary = unfolded.Split("\r\n").Single(l => l.StartsWith("SUMMARY:"));
        Assert.Contains("Heat 1", summary);

        Assert.DoesNotContain(SecretRider, body);
        Assert.DoesNotContain("Secret Pony", body);
        Assert.DoesNotContain(SecretPayment, body);
        Assert.DoesNotContain(SecretJoinKey, body);
        Assert.DoesNotContain("trainer@mg.local", body);
        // The other team in the heat is on the public timetable, but this is one team's feed.
        Assert.DoesNotContain($"Team 2", body);
    }

    [Fact]
    public async Task Feed_KeepsTheSameIdentityWhileTheHeatIsUnchanged_AndRaisesTheSequenceWhenItMoves()
    {
        var s = await SeedAsync();
        var created = await CreateFeedAsync(await _f.AdminAsync(), s.TeamId);
        var anon = _f.CreateClient();

        var first = await TextAsync(await anon.GetAsync(created.Path));
        var again = await TextAsync(await anon.GetAsync(created.Path));
        Assert.Equal(first, again);
        Assert.Contains("SEQUENCE:0\r\n", first);

        await UpdateSessionAsync(s.SessionId, x => x.ScheduledStart = new DateTime(2026, 10, 17, 9, 45, 0, DateTimeKind.Utc));
        var moved = await TextAsync(await anon.GetAsync(created.Path));
        Assert.Contains($"UID:heat-{s.HeatId}-team-{s.TeamId}@mg-app\r\n", moved);
        Assert.Contains("DTSTART:20261017T094500Z\r\n", moved);
        Assert.Contains("SEQUENCE:1\r\n", moved);

        var movedAgain = await TextAsync(await anon.GetAsync(created.Path));
        Assert.Equal(moved, movedAgain);

        // A heat that starts late (the session started 10 minutes behind) changes it again.
        await _f.InDbAsync(async db =>
        {
            foreach (var v in db.CalendarHeatVersions.Where(v => v.TeamId == s.TeamId)) v.ModifiedAt = new DateTime(2026, 10, 1, 12, 0, 0, DateTimeKind.Utc);
            await db.SaveChangesAsync();
        });
        await UpdateSessionAsync(s.SessionId, x => x.StartedAt = new DateTime(2026, 10, 17, 9, 55, 0, DateTimeKind.Utc));
        var late = await TextAsync(await anon.GetAsync(created.Path));
        Assert.Contains("DTSTART:20261017T095500Z\r\n", late);
        Assert.Contains("SEQUENCE:2\r\n", late);
        Assert.NotEqual("LAST-MODIFIED:20261001T120000Z", Line(late, "LAST-MODIFIED"));
        Assert.Equal(Line(late, "LAST-MODIFIED"), Line(late, "DTSTAMP").Replace("DTSTAMP", "LAST-MODIFIED"));
    }

    private static string Line(string ics, string name) => ics.Split("\r\n").First(l => l.StartsWith(name + ":"));

    [Fact]
    public async Task Feed_UsesEntityTagsSoUnchangedFeedsAnswer304()
    {
        var s = await SeedAsync();
        var created = await CreateFeedAsync(await _f.AdminAsync(), s.TeamId);
        var anon = _f.CreateClient();

        var first = await anon.GetAsync(created.Path);
        var etag = first.Headers.ETag;
        Assert.NotNull(etag);

        var request = new HttpRequestMessage(HttpMethod.Get, created.Path);
        request.Headers.IfNoneMatch.Add(new EntityTagHeaderValue(etag!.Tag));
        var second = await anon.SendAsync(request);
        Assert.Equal(HttpStatusCode.NotModified, second.StatusCode);

        await UpdateSessionAsync(s.SessionId, x => x.ScheduledStart = new DateTime(2026, 10, 17, 11, 0, 0, DateTimeKind.Utc));
        var third = new HttpRequestMessage(HttpMethod.Get, created.Path);
        third.Headers.IfNoneMatch.Add(new EntityTagHeaderValue(etag.Tag));
        Assert.Equal(HttpStatusCode.OK, (await anon.SendAsync(third)).StatusCode);
    }

    [Fact]
    public async Task Feed_SkipsBreaksAndHeatsThatAreNotTheTeams_AndAllowsAnEmptyFeed()
    {
        var s = await SeedAsync();
        await _f.InDbAsync(async db =>
        {
            var lunch = new Session { CompetitionId = s.CompetitionId, Name = "Lunch", Kind = SessionKind.Break, OrderIndex = 2, DurationMinutes = 30 };
            db.Sessions.Add(lunch);
            await db.SaveChangesAsync();
            db.Heats.Add(new Heat { SessionId = lunch.Id, Label = "Not a race", OrderIndex = 1, Entries = [new HeatEntry { TeamId = s.TeamId, LaneIndex = 1 }] });
            await db.SaveChangesAsync();
        });
        var created = await CreateFeedAsync(await _f.AdminAsync(), s.OtherTeamId);
        var otherTeamBody = await TextAsync(await _f.CreateClient().GetAsync(created.Path));
        Assert.Contains($"heat-{s.HeatId}-team-{s.OtherTeamId}@mg-app", otherTeamBody);

        var lonely = await _f.CreateArenaAsync(1);
        var feed = await CreateFeedAsync(await _f.AdminAsync(), lonely.TeamIds[0]);
        var empty = await TextAsync(await _f.CreateClient().GetAsync(feed.Path));
        Assert.Contains("BEGIN:VCALENDAR", empty);
        Assert.DoesNotContain("BEGIN:VEVENT", empty);

        var withBreak = await TextAsync(await _f.CreateClient().GetAsync((await CreateFeedAsync(await _f.AdminAsync(), s.TeamId)).Path));
        Assert.DoesNotContain("Not a race", withBreak);
    }

    [Fact]
    public async Task DeletingAHeatRemovesItsEventAndTheStoredVersion()
    {
        var s = await SeedAsync();
        var created = await CreateFeedAsync(await _f.AdminAsync(), s.TeamId);
        var anon = _f.CreateClient();
        await anon.GetAsync(created.Path);
        Assert.Equal(1, await _f.InDbAsync(db => db.CalendarHeatVersions.CountAsync(v => v.HeatId == s.HeatId)));

        await _f.InDbAsync(async db =>
        {
            db.Heats.Remove(await db.Heats.SingleAsync(h => h.Id == s.HeatId));
            await db.SaveChangesAsync();
        });

        Assert.DoesNotContain("BEGIN:VEVENT", await TextAsync(await anon.GetAsync(created.Path)));
        Assert.Equal(0, await _f.InDbAsync(db => db.CalendarHeatVersions.CountAsync(v => v.HeatId == s.HeatId)));
    }

    // ----- Blocked addresses -----

    [Fact]
    public async Task BlockedAddresses_AreRefusedOnEveryPublicCalendarEndpoint()
    {
        var s = await SeedAsync();
        var created = await CreateFeedAsync(await _f.AdminAsync(), s.TeamId);
        await _f.InDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock { IpAddress = "203.0.113.50", Reason = "test" });
            await db.SaveChangesAsync();
        });

        foreach (var url in new[] { $"/api/competitions/{s.CompetitionId}/calendar.ics", created.Path })
        {
            var blocked = new HttpRequestMessage(HttpMethod.Get, url);
            blocked.Headers.Add("X-Test-Ip", "203.0.113.50");
            Assert.Equal(HttpStatusCode.Forbidden, (await _f.CreateClient().SendAsync(blocked)).StatusCode);

            var fine = new HttpRequestMessage(HttpMethod.Get, url);
            fine.Headers.Add("X-Test-Ip", "203.0.113.51");
            Assert.Equal(HttpStatusCode.OK, (await _f.CreateClient().SendAsync(fine)).StatusCode);
        }
    }
}
