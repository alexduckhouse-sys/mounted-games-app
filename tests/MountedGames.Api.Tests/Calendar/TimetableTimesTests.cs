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
        // The next heat follows the real start, matching the public timetable.
        Assert.Equal(At(9, 37), times[2].Start);
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
    [Fact]
    public void ManualShift_ReplacesInheritedDelay_AndKeepsArenasIndependent()
    {
        var first = NewSession(1, At(9), started: At(9, 10), heats: [NewHeat(1, 1, 30)]);
        first.ArenaName = "Arena A";
        var shifted = NewSession(2, At(10, 15), heats: [NewHeat(2, 1, 30), NewHeat(3, 2, 30, pinned: At(11, 15))]);
        shifted.ArenaName = "Arena A";
        shifted.Notes = "[shift:+15]";
        var other = NewSession(3, At(10), heats: [NewHeat(4, 1, 30)]);
        other.ArenaName = "Arena B";
        var times = TimetableTimes.Compute([first, shifted, other]);
        Assert.Equal(At(10, 15), times[2].Start);
        Assert.Equal(At(11, 15), times[3].Start);
        Assert.Equal(At(10), times[4].Start);
    }

    [Fact]
    public void NegativeShift_StillWaitsForPreviousHeat_AndGlobalBreakWaitsForBothArenas()
    {
        var first = NewSession(1, At(9), heats: [NewHeat(1, 1, 60)]);
        first.ArenaName = "Arena A";
        var shifted = NewSession(2, At(9, 45), heats: [NewHeat(2, 1, 30)]);
        shifted.ArenaName = "Arena A";
        shifted.Notes = "[shift:-15]";
        var other = NewSession(3, At(9), heats: [NewHeat(3, 1, 120)]);
        other.ArenaName = "Arena B";
        var global = NewSession(4, At(10), kind: SessionKind.Break, duration: 15, heats: [NewHeat(4, 1, 15)]);
        var times = TimetableTimes.Compute([first, shifted, other, global]);
        Assert.Equal(At(10), times[2].Start);
        Assert.Equal(At(11), times[4].Start);
    }
    [Fact]
    public void FirstRaceCheckpoint_UsesTwoMinuteAllowance_AndCascadesToLaterSessions()
    {
        var first = NewHeat(1, 1, 30, started: At(9, 10), races: 2);
        first.Races = [new Race { OrderIndex = 2 }, new Race { OrderIndex = 1, FinishedAt = At(9, 10) }];
        var session = NewSession(1, At(9), started: At(9, 10), heats: [first, NewHeat(2, 2, 30)]);
        var next = NewSession(2, At(10), heats: [NewHeat(3, 1, 30)]);
        var times = TimetableTimes.Compute([session, next]);
        Assert.Equal(At(9, 8), times[1].Start);
        Assert.Equal(At(9, 38), times[2].Start);
        Assert.Equal(At(10, 8), times[3].Start);
    }

    [Fact]
    public void ASecondHeatCheckpoint_CascadesEvenWhenTheSessionStartedOnTime()
    {
        var first = NewHeat(1, 1, 30);
        first.Races.First().StartedAt = At(9, 4);
        var second = NewHeat(2, 2, 30, started: At(9, 40));
        second.Races.First().StartedAt = At(9, 40);
        var session = NewSession(1, At(9), started: At(9), heats: [first, second]);
        var next = NewSession(2, At(10), heats: [NewHeat(3, 1, 30)]);
        var times = TimetableTimes.Compute([session, next]);
        Assert.Equal(At(9), times[1].Start);
        Assert.Equal(At(9, 38), times[2].Start);
        Assert.Equal(At(10, 8), times[3].Start);
    }

    [Theory]
    [InlineData(9, false, 0)]
    [InlineData(10, false, 0)]
    [InlineData(14, true, 7)]
    public void HalfwayCheckpoint_OnlyAddsDelayBeyondFiveMinutes(int stampMinute, bool finished, int delay)
    {
        var first = NewHeat(1, 1, 20, races: 4);
        first.Races = Enumerable.Range(1, 4).Select(i => new Race { OrderIndex = i }).ToList();
        first.Races.First().FinishedAt = At(9, 2);
        if (finished) first.Races.ElementAt(1).FinishedAt = At(9, stampMinute);
        else first.Races.ElementAt(1).StartedAt = At(9, stampMinute);
        var session = NewSession(1, At(9), heats: [first]);
        var next = NewSession(2, At(10), heats: [NewHeat(2, 1, 30)]);
        var times = TimetableTimes.Compute([session, next]);
        Assert.Equal(At(10, delay), times[2].Start);
    }

    [Fact]
    public void UnstampedSession_CanStillAcquireFirstRaceDelay()
    {
        var first = NewHeat(1, 1, 30);
        first.Races.First().FinishedAt = At(9, 9);
        var session = NewSession(1, At(9), heats: [first]);
        var next = NewSession(2, At(10), heats: [NewHeat(2, 1, 30)]);
        Assert.Equal(At(10, 7), TimetableTimes.Compute([session, next])[2].Start);
    }

    [Fact]
    public void FinishedSingleRaceWithoutStart_DoesNotReplaceKnownSessionStart()
    {
        var first = NewHeat(1, 1, 30);
        first.FinishedAt = At(9, 20);
        first.Races.First().FinishedAt = At(9, 20);
        var session = NewSession(1, At(9), started: At(9), heats: [first]);
        var next = NewSession(2, At(10), heats: [NewHeat(2, 1, 30)]);
        Assert.Equal(At(10), TimetableTimes.Compute([session, next])[2].Start);
    }

    [Theory]
    [InlineData(0, 10)]
    [InlineData(1, 8)]
    [InlineData(2, 8)]
    [InlineData(3, 8)]
    [InlineData(4, 8)]
    [InlineData(5, 8)]
    [InlineData(6, 8)]
    public void CheckpointsDoNotCompound_AndShortRaceListsStayInBounds(int count, int expectedDelay)
    {
        var first = NewHeat(1, 1, 30, races: count);
        var half = count / 2 - 1;
        first.Races = Enumerable.Range(0, count).Select(i => new Race
        {
            OrderIndex = i + 1,
            FinishedAt = i == 0 ? At(9, 10) : i == half ? At(9).AddMinutes((double)half / count * 30 + 10) : null,
        }).ToList();
        var session = NewSession(1, At(9), started: At(9, 10), heats: [first]);
        var next = NewSession(2, At(10), heats: [NewHeat(2, 1, 30)]);
        Assert.Equal(At(10, expectedDelay), TimetableTimes.Compute([session, next])[2].Start);
        Assert.Equal(At(10, expectedDelay), TimetableTimes.Compute([session, next])[2].Start);
    }

    [Fact]
    public void FirstRaceCheckpoint_AtExactlyFiveMinutesAddsNoDelay()
    {
        var first = NewHeat(1, 1, 30);
        first.Races.First().FinishedAt = At(9, 5);
        var session = NewSession(1, At(9), heats: [first]);
        var next = NewSession(2, At(10), heats: [NewHeat(2, 1, 30)]);
        Assert.Equal(At(10), TimetableTimes.Compute([session, next])[2].Start);
    }

}
