using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sessions;

/// <summary>A drawn session that has not started keeps its lanes but its time stays editable; a started one does not.</summary>
public class SessionTimeEditTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public SessionTimeEditTests(ApiFactory f) => _f = f;

    private static readonly DateTime Start = new(2030, 6, 1, 10, 0, 0, DateTimeKind.Utc);
    private static string Url(Arena a, int id) => $"/api/competitions/{a.CompetitionId}/sessions/{id}";

    /// <summary>A drawn session: two heats pinned at 10:00 and 10:10, ten minutes a heat.</summary>
    private async Task<(Arena Arena, int Heat1, int Heat2)> DrawnAsync()
    {
        var a = await _f.CreateArenaAsync();
        var h1 = await _f.AddHeatAsync(a.SessionId, a.TeamIds.Take(2), "Heat 1");
        var h2 = await _f.AddHeatAsync(a.SessionId, a.TeamIds.Skip(2), "Heat 2");
        await _f.WithDbAsync(async db =>
        {
            var s = await db.Sessions.Include(x => x.Heats).SingleAsync(x => x.Id == a.SessionId);
            s.ScheduledStart = Start;
            s.MinutesPerHeat = 10;
            s.Heats.Single(h => h.Id == h1.HeatId).ScheduledStart = Start;
            s.Heats.Single(h => h.Id == h2.HeatId).ScheduledStart = Start.AddMinutes(10);
            await db.SaveChangesAsync();
        });
        return (a, h1.HeatId, h2.HeatId);
    }

    private Task<Dictionary<int, DateTime?>> HeatTimesAsync(int sessionId) =>
        _f.InDbAsync(async db => await db.Heats.Where(h => h.SessionId == sessionId).ToDictionaryAsync(h => h.Id, h => h.ScheduledStart));

    [Fact]
    public async Task ChangingTheStartOfADrawnSession_MovesItsHeatsWithIt_AndKeepsTheLanes()
    {
        var (a, h1, h2) = await DrawnAsync();
        var admin = await _f.AdminAsync();

        var res = await admin.PutAsJsonAsync(Url(a, a.SessionId), new { scheduledStart = Start.AddMinutes(45) });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var times = await HeatTimesAsync(a.SessionId);
        Assert.Equal(Start.AddMinutes(45), times[h1]);
        Assert.Equal(Start.AddMinutes(55), times[h2]);
        var entries = await _f.InDbAsync(db => db.Heats.Where(h => h.SessionId == a.SessionId).SelectMany(h => h.Entries).CountAsync());
        Assert.Equal(a.TeamIds.Length, entries);
    }

    [Fact]
    public async Task ChangingTheTimePerHeat_LaysTheHeatsEndToEndAgain()
    {
        var (a, h1, h2) = await DrawnAsync();
        var admin = await _f.AdminAsync();

        var res = await admin.PutAsJsonAsync(Url(a, a.SessionId), new { minutesPerHeat = 25 });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var times = await HeatTimesAsync(a.SessionId);
        Assert.Equal(Start, times[h1]);
        Assert.Equal(Start.AddMinutes(25), times[h2]);
    }

    [Fact]
    public async Task SwappingTwoDrawnSessions_ReTimesTheHeatsOfBoth()
    {
        var (a, h1, _) = await DrawnAsync();
        var second = await _f.WithDbAsync(async db =>
        {
            var s = new Session { CompetitionId = a.CompetitionId, CompetitionSectionId = a.SectionId, Name = "Session B", ArenaName = "Arena 1", OrderIndex = 9, ScheduledStart = Start.AddMinutes(60), MinutesPerHeat = 10 };
            s.Heats.Add(new Heat { Label = "B Heat 1", OrderIndex = 0, ScheduledStart = Start.AddMinutes(60) });
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
            return (s.Id, HeatId: s.Heats.Single().Id);
        });
        var admin = await _f.AdminAsync();

        // What the timetable page sends for a swap: each takes the other's slot.
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync(Url(a, a.SessionId), new { scheduledStart = Start.AddMinutes(30) })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync(Url(a, second.Id), new { scheduledStart = Start })).StatusCode);

        Assert.Equal(Start.AddMinutes(30), (await HeatTimesAsync(a.SessionId))[h1]);
        Assert.Equal(Start, (await HeatTimesAsync(second.Id))[second.HeatId]);
    }

    [Fact]
    public async Task AStartedSession_CannotHaveItsStartRewritten_AndItsHeatTimesStay()
    {
        var (a, h1, h2) = await DrawnAsync();
        await _f.WithDbAsync(async db =>
        {
            var s = await db.Sessions.SingleAsync(x => x.Id == a.SessionId);
            s.Status = SessionStatus.InArena;
            s.StartedAt = Start;
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();

        var res = await admin.PutAsJsonAsync(Url(a, a.SessionId), new { scheduledStart = Start.AddMinutes(45) });

        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        var times = await HeatTimesAsync(a.SessionId);
        Assert.Equal(Start, times[h1]);
        Assert.Equal(Start.AddMinutes(10), times[h2]);
    }

    [Fact]
    public async Task ASessionWithAScoredRace_IsLockedToo()
    {
        var (a, _, _) = await DrawnAsync();
        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.FirstAsync(r => r.Heat!.SessionId == a.SessionId);
            race.IsComplete = true;
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();

        var res = await admin.PutAsJsonAsync(Url(a, a.SessionId), new { scheduledStart = Start.AddMinutes(45) });

        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task MoveEverythingLater_StillMovesTheRemainingHeatsOfAStartedSession()
    {
        var (a, h1, h2) = await DrawnAsync();
        await _f.WithDbAsync(async db =>
        {
            var s = await db.Sessions.Include(x => x.Heats).SingleAsync(x => x.Id == a.SessionId);
            s.Status = SessionStatus.InArena;
            s.StartedAt = Start;
            s.Heats.Single(h => h.Id == h1).StartedAt = Start;
            s.Heats.Single(h => h.Id == h1).FinishedAt = Start.AddMinutes(9);
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();

        var res = await admin.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/sessions/shift-times", new { deltaMinutes = 15 });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var times = await HeatTimesAsync(a.SessionId);
        Assert.Equal(Start, times[h1]);
        Assert.Equal(Start.AddMinutes(25), times[h2]);
    }
}
