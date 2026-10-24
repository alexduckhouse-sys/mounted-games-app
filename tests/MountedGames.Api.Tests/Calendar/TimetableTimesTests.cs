using MountedGames.Api.Entities;
using MountedGames.Api.Services.Calendar;

namespace MountedGames.Api.Tests.Calendar;

public class TimetableTimesTests
{
    private static DateTime At(int h, int m = 0) => new(2026, 10, 17, h, m, 0, DateTimeKind.Utc);

    private static Heat NewHeat(int id, int order, int? minutes = null, DateTime? pinned = null, DateTime? started = null, int races = 1) => new()
    {
        Id = id, OrderIndex = order, DurationMinutes = minutes, ScheduledStart = pinned, StartedAt = started,
        Races = Enumerable.Range(1, races).Select(i => new Race { Name = $"R{i}" }).ToList(),
    };

    private static Session NewSession(int order, DateTime? start, SessionKind kind = SessionKind.Race, int? duration = null,
        int? minutesPerHeat = null, DateTime? started = null, params Heat[] heats) => new()
    {
        Id = order, OrderIndex = order, ScheduledStart = start, Kind = kind, DurationMinutes = duration, MinutesPerHeat = minutesPerHeat,
        StartedAt = started, Heats = heats.ToList(),
    };

    [Fact]
    public void HeatsFollowOneAnotherByTheirDurations()
    {
        var session = NewSession(1, At(9), heats: [NewHeat(1, 1, 20), NewHeat(2, 2, 15), NewHeat(3, 3)]);

        var times = TimetableTimes.Compute([session]);

        Assert.Equal(new HeatTime(At(9), 20), times[1]);
        Assert.Equal(new HeatTime(At(9, 20), 15), times[2]);
        Assert.Equal(new HeatTime(At(9, 35), 30), times[3]);
    }

    [Fact]
    public void WithoutAHeatDuration_TheSessionsMinutesPerHeatCoverTheWholeHeat()
    {
        var session = NewSession(1, At(9), minutesPerHeat: 8, heats: [NewHeat(1, 1, races: 3), NewHeat(2, 2, races: 0)]);

        var times = TimetableTimes.Compute([session]);

        Assert.Equal(8, times[1].DurationMinutes);
        Assert.Equal(At(9, 8), times[2].Start);
        Assert.Equal(8, times[2].DurationMinutes);
    }

    [Fact]
    public void APinnedHeatTimeWinsAndResetsTheRunAfterIt()
    {
        var session = NewSession(1, At(9), heats: [NewHeat(1, 1, 10), NewHeat(2, 2, 10, pinned: At(11)), NewHeat(3, 3, 10)]);

        var times = TimetableTimes.Compute([session]);

        Assert.Equal(At(9), times[1].Start);
        Assert.Equal(At(11), times[2].Start);
        Assert.Equal(At(11, 10), times[3].Start);
    }

    [Fact]
    public void ALateSessionShiftsEverySessionAfterIt()
    {
        var first = NewSession(1, At(9), started: At(9, 20), heats: [NewHeat(1, 1, 30)]);
        var second = NewSession(2, At(10), heats: [NewHeat(2, 1, 30)]);

        var times = TimetableTimes.Compute([second, first]);

        Assert.Equal(At(9, 20), times[1].Start);
        Assert.Equal(At(10, 20), times[2].Start);
    }

    [Fact]
    public void AStartedHeatShowsItsRealStart()
    {
        var session = NewSession(1, At(9), heats: [NewHeat(1, 1, 30, started: At(9, 7)), NewHeat(2, 2, 30)]);

        var times = TimetableTimes.Compute([session]);

        Assert.Equal(At(9, 7), times[1].Start);
        // The cascade after a started, unpinned heat continues from the session's cursor, as the timetable does.
        Assert.Equal(At(9, 30), times[2].Start);
    }

    [Fact]
    public void ASessionCannotStartBeforeThePreviousOneEnds()
    {
        var first = NewSession(1, At(9), heats: [NewHeat(1, 1, 60)]);
        var second = NewSession(2, At(9, 30), heats: [NewHeat(2, 1, 10)]);

        var times = TimetableTimes.Compute([first, second]);

        Assert.Equal(At(10), times[2].Start);
    }

    [Fact]
    public void BreaksTakeTheirOwnDuration_AndAnUntimedSessionFollowsThePreviousEnd()
    {
        var race = NewSession(1, At(9), heats: [NewHeat(1, 1, 30)]);
        var lunch = NewSession(2, At(9, 30), kind: SessionKind.Break, duration: 45);
        var untimed = NewSession(3, null, heats: [NewHeat(3, 1, 10)]);

        var times = TimetableTimes.Compute([race, lunch, untimed]);

        Assert.Equal(At(10, 15), times[3].Start);
    }

    [Fact]
    public void ASessionWithNoHeatsUsesItsDuration_AndNoStartMeansNoTime()
    {
        var empty = NewSession(1, At(9), duration: 20);
        var unscheduled = NewSession(2, null, heats: [NewHeat(5, 1, 10)]);
        var after = NewSession(3, null, heats: [NewHeat(6, 1, 10)]);

        var times = TimetableTimes.Compute([unscheduled, empty, after]);

        // Session 2 has no start and comes after the empty one, so it follows its end.
        Assert.Equal(At(9, 20), times[5].Start);
        Assert.Equal(At(9, 30), times[6].Start);

        var nothing = TimetableTimes.Compute([NewSession(1, null, heats: [NewHeat(9, 1, 10)])]);
        Assert.Null(nothing[9].Start);
    }
}
