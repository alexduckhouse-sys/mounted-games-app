using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sessions;

/// <summary>Pausing racing for weather (the reason tag and the announcement that goes with it) and the hold resume-time fix.</summary>
public class WeatherPauseTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public WeatherPauseTests(ApiFactory f) => _f = f;

    private static string Url(Arena a, string suffix) => $"/api/competitions/{a.CompetitionId}/sessions{suffix}";

    private async Task<List<ChatMessageDto>> ChatAsync(Arena a)
        => await (await _f.CreateClient().GetAsync($"/api/competitions/{a.CompetitionId}/chat")).ReadAsync<List<ChatMessageDto>>();

    private Task SetNotesAsync(Arena a, string? notes) => _f.WithDbAsync(async db =>
    {
        var s = await db.Sessions.SingleAsync(x => x.Id == a.SessionId);
        s.Notes = notes;
        await db.SaveChangesAsync();
    });

    // ---- Hold: typed times are UK clock times ----

    private async Task<SessionDto> HoldAsync(DateTime scheduledUtc, string resumeTime)
    {
        var a = await _f.CreateArenaAsync();
        await _f.WithDbAsync(async db =>
        {
            var s = await db.Sessions.SingleAsync(x => x.Id == a.SessionId);
            s.Status = SessionStatus.Upcoming;
            s.StartedAt = null;
            s.ScheduledStart = scheduledUtc;
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        var response = await admin.PostAsJsonAsync(Url(a, "/hold"), new HoldCompetitionRequest(ResumeTime: resumeTime, PostAnnouncement: false));
        response.EnsureSuccessStatusCode();
        return (await response.ReadAsync<List<SessionDto>>()).Single(s => s.Id == a.SessionId);
    }

    [Fact]
    public async Task Hold_ReadsTheTypedTimeAsUkTime_InSummer()
    {
        // 13:00 UTC is 14:00 BST. "14:30" means 14:30 BST, which is 13:30 UTC (not 14:30 UTC, an hour late).
        var held = await HoldAsync(new DateTime(2030, 7, 6, 13, 0, 0, DateTimeKind.Utc), "14:30");
        Assert.Equal(new DateTime(2030, 7, 6, 13, 30, 0, DateTimeKind.Utc), held.ScheduledStart);
    }

    [Fact]
    public async Task Hold_ReadsTheTypedTimeAsUkTime_InWinter()
    {
        // In GMT the two clocks agree.
        var held = await HoldAsync(new DateTime(2030, 12, 7, 13, 0, 0, DateTimeKind.Utc), "14:30");
        Assert.Equal(new DateTime(2030, 12, 7, 14, 30, 0, DateTimeKind.Utc), held.ScheduledStart);
    }

    [Fact]
    public async Task Hold_ReadsAFullDateTimeWithNoZoneAsUkTime_AndKeepsAZonedOneAsItIs()
    {
        var plain = await HoldAsync(new DateTime(2030, 7, 6, 13, 0, 0, DateTimeKind.Utc), "2030-07-06 14:30");
        Assert.Equal(new DateTime(2030, 7, 6, 13, 30, 0, DateTimeKind.Utc), plain.ScheduledStart);
        var zoned = await HoldAsync(new DateTime(2030, 7, 6, 13, 0, 0, DateTimeKind.Utc), "2030-07-06T14:30:00Z");
        Assert.Equal(new DateTime(2030, 7, 6, 14, 30, 0, DateTimeKind.Utc), zoned.ScheduledStart);
    }

    [Fact]
    public async Task Hold_WithoutAScheduledSession_PlacesTheFirstSessionOnTheEventDayInUkTime()
    {
        var a = await _f.CreateArenaAsync();
        await _f.WithDbAsync(async db =>
        {
            var comp = await db.Competitions.SingleAsync(c => c.Id == a.CompetitionId);
            comp.StartDate = new DateTime(2030, 7, 6, 0, 0, 0, DateTimeKind.Utc);
            var s = await db.Sessions.SingleAsync(x => x.Id == a.SessionId);
            s.Status = SessionStatus.Upcoming;
            s.StartedAt = null;
            s.ScheduledStart = null;
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        var response = await admin.PostAsJsonAsync(Url(a, "/hold"), new HoldCompetitionRequest(ResumeTime: "09:00", PostAnnouncement: false));
        response.EnsureSuccessStatusCode();
        var held = (await response.ReadAsync<List<SessionDto>>()).Single(s => s.Id == a.SessionId);
        Assert.Equal(new DateTime(2030, 7, 6, 8, 0, 0, DateTimeKind.Utc), held.ScheduledStart);
    }

    // ---- Pause and resume for weather ----

    [Fact]
    public async Task Pause_WithAReason_TagsTheSession_AndResumeClearsBothTags()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        await SetNotesAsync(a, "Keep this");

        var pause = await admin.PostAsJsonAsync(Url(a, "/pause"), new { reason = "thunder" });
        Assert.Equal(HttpStatusCode.OK, pause.StatusCode);
        var paused = (await pause.ReadAsync<List<SessionDto>>()).Single(s => s.Id == a.SessionId);
        Assert.Contains("[paused:", paused.Notes);
        Assert.Contains("[pausefor:thunder]", paused.Notes);
        Assert.Contains("Keep this", paused.Notes);

        var resume = await admin.PostAsJsonAsync(Url(a, "/resume"), new { });
        Assert.Equal(HttpStatusCode.OK, resume.StatusCode);
        var resumed = (await resume.ReadAsync<List<SessionDto>>()).Single(s => s.Id == a.SessionId);
        Assert.DoesNotContain("[paused:", resumed.Notes ?? string.Empty);
        Assert.DoesNotContain("pausefor", resumed.Notes ?? string.Empty);
        Assert.Contains("Keep this", resumed.Notes);
    }

    [Fact]
    public async Task Pause_WithoutAReason_LeavesNoReasonTag()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        await SetNotesAsync(a, null);
        var paused = (await (await admin.PostAsJsonAsync(Url(a, "/pause"), new { })).ReadAsync<List<SessionDto>>()).Single(s => s.Id == a.SessionId);
        Assert.Contains("[paused:", paused.Notes);
        Assert.DoesNotContain("pausefor", paused.Notes);
    }

    [Fact]
    public async Task Pause_OfAnAlreadyPausedSession_KeepsItsPauseTimeAndAddsTheReason()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var earlier = DateTimeOffset.UtcNow.AddMinutes(-10).ToUnixTimeMilliseconds();
        await SetNotesAsync(a, $"[paused:{earlier}] [pausefor:rain]");

        var paused = (await (await admin.PostAsJsonAsync(Url(a, "/pause"), new { reason = "thunder" })).ReadAsync<List<SessionDto>>()).Single(s => s.Id == a.SessionId);

        Assert.Contains($"[paused:{earlier}]", paused.Notes);
        Assert.Contains("[pausefor:thunder]", paused.Notes);
        Assert.DoesNotContain("[pausefor:rain]", paused.Notes);
    }

    [Fact]
    public async Task Pause_RejectsAnUnknownReasonAndAnOverlongAnnouncement()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(Url(a, "/pause"), new { reason = "snow" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(Url(a, "/pause"), new { announcement = new string('x', 2001) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(Url(a, "/resume"), new { announcement = new string('x', 2001) })).StatusCode);
    }

    [Fact]
    public async Task Pause_WithAnAnnouncement_PostsItToEveryoneInTheSameRequest()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var text = $"Thunder is close, ponies back to the lorries {Guid.NewGuid():N}";

        (await admin.PostAsJsonAsync(Url(a, "/pause"), new { reason = "thunder", announcement = text })).EnsureSuccessStatusCode();

        var posted = Assert.Single(await ChatAsync(a), m => m.Body == text);
        Assert.Equal(ChatMessageType.Announcement, posted.Type);
        Assert.Equal("weather", posted.Tag);
        Assert.False(posted.AdminOnly);
    }

    [Fact]
    public async Task Resume_WithAnAnnouncement_PostsIt_AndABlankOneIsIgnored()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var before = (await ChatAsync(a)).Count;
        (await admin.PostAsJsonAsync(Url(a, "/pause"), new { announcement = "   " })).EnsureSuccessStatusCode();
        Assert.Equal(before, (await ChatAsync(a)).Count);

        var text = $"Racing restarts at 15:50 {Guid.NewGuid():N}";
        (await admin.PostAsJsonAsync(Url(a, "/resume"), new { announcement = text })).EnsureSuccessStatusCode();
        Assert.Single(await ChatAsync(a), m => m.Body == text && m.Tag == "weather");
    }

    [Fact]
    public async Task AnOrganisingTrainer_CanPauseAndTellEveryone_ThroughBothAnnouncementRoutes()
    {
        var a = await _f.CreateArenaAsync();
        var (client, auth) = await _f.ApprovedTrainerAsync();
        await _f.WithDbAsync(async db =>
        {
            var comp = await db.Competitions.SingleAsync(c => c.Id == a.CompetitionId);
            comp.CreatedByUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });
        var text = $"Pausing for thunder {Guid.NewGuid():N}";

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Url(a, "/pause"), new { reason = "thunder", announcement = text })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(Url(a, "/weather-notice"), new { body = text + " again" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await client.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/chat/announcement", new AnnouncementRequest("x", null))).StatusCode);
        Assert.Contains((await ChatAsync(a)), m => m.Body == text + " again");
    }

    // ---- Weather notice (tell everyone without pausing) ----

    [Fact]
    public async Task WeatherNotice_PostsAnAnnouncement_AndLeavesTheTimetableAlone()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        await SetNotesAsync(a, "untouched");
        var text = $"Heavy rain from about 13:00 {Guid.NewGuid():N}";

        var response = await admin.PostAsJsonAsync(Url(a, "/weather-notice"), new { body = text });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var dto = await response.ReadAsync<ChatMessageDto>();
        Assert.Equal(text, dto.Body);
        Assert.Equal("weather", dto.Tag);
        Assert.Equal("untouched", await _f.WithDbAsync(db => db.Sessions.Where(s => s.Id == a.SessionId).Select(s => s.Notes).SingleAsync()));
    }

    [Fact]
    public async Task WeatherNotice_RequiresAnOrganiser_AndAValidBody()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var otherTrainer = await _f.ApprovedTrainerAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(Url(a, "/weather-notice"), new { body = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTrainer.Client.PostAsJsonAsync(Url(a, "/weather-notice"), new { body = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(Url(a, "/weather-notice"), new { body = "  " })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(Url(a, "/weather-notice"), new { body = new string('x', 2001) })).StatusCode);
    }

    [Fact]
    public async Task WeatherNotice_ForAnUnknownCompetition_IsNotFound()
    {
        var admin = await _f.AdminAsync();
        var response = await admin.PostAsJsonAsync("/api/competitions/999999/sessions/weather-notice", new { body = "x" });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task PauseAndResume_WithTheNewFields_StillRequireCompetitionAccess()
    {
        var a = await _f.CreateArenaAsync();
        var otherTrainer = await _f.ApprovedTrainerAsync();
        var response = await otherTrainer.Client.PostAsJsonAsync(Url(a, "/pause"), new { reason = "thunder", announcement = "x" });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- The hold and steward-call announcements get the same checks as a typed one ----

    [Fact]
    public async Task Hold_RefusesAResumeTimeTooLongToBeATime_AndPostsNothing()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        var response = await admin.PostAsJsonAsync(Url(a, "/hold"), new HoldCompetitionRequest(ResumeTime: new string('x', 101)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain(await ChatAsync(a), m => m.Tag == "hold");
    }

    [Fact]
    public async Task Hold_MasksSwearWordsInTheAnnouncement_WhenTheResumeTimeIsFreeText()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();

        var response = await admin.PostAsJsonAsync(Url(a, "/hold"), new HoldCompetitionRequest(ResumeTime: "when the bloody rain stops"));

        response.EnsureSuccessStatusCode();
        var hold = Assert.Single(await ChatAsync(a), m => m.Tag == "hold");
        Assert.Contains("b***** rain", hold.Body);
        Assert.DoesNotContain("bloody", hold.Body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StewardCall_MasksSwearWordsInTheCustomMessage_AndKeepsTheLengthLimit()
    {
        var a = await _f.CreateArenaAsync();
        var admin = await _f.AdminAsync();
        var shiftId = await _f.WithDbAsync(async db =>
        {
            var shift = new MountedGames.Api.Entities.Operations.VolunteerShift
            {
                CompetitionId = a.CompetitionId, Role = "Start line steward", AssignedTeamId = a.TeamIds[0],
            };
            db.Add(shift);
            await db.SaveChangesAsync();
            return shift.Id;
        });
        var url = $"/api/competitions/{a.CompetitionId}/volunteer-shifts/{shiftId}/call-missing";

        var tooLong = await admin.PostAsJsonAsync(url, new CallMissingStewardRequest(new string('x', 401)));
        var response = await admin.PostAsJsonAsync(url, new CallMissingStewardRequest("Where is the bloody steward?"));

        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        response.EnsureSuccessStatusCode();
        var call = await response.ReadAsync<CallMissingStewardResultDto>();
        Assert.Equal("Where is the b***** steward?", call.Announcement.Body);
    }
}
