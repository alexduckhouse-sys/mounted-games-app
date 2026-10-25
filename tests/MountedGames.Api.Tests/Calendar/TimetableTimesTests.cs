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

    [Fact]
    public void ArenasRunIndependently_AndManualShiftsAndAutoDelaysCascadeWithinEachArena()
    {
        var arena1Session1 = NewSession(1, At(9, 15), heats: [NewHeat(1, 1, 30)]);
        arena1Session1.ArenaName = "Arena 1";
        arena1Session1.Notes = "[shift:+15]";

        var arena2Session1 = NewSession(2, At(9), heats:
        [
            new Heat
            {
                Id = 2,
                OrderIndex = 1,
                DurationMinutes = 20,
                Races =
                [
                    new Race { OrderIndex = 1, FinishedAt = At(9, 2) },
                    new Race { OrderIndex = 2, FinishedAt = At(9, 14) }, // Halfway race expected at 09:05; 9m late -> 7m delay
                    new Race { OrderIndex = 3 },
                    new Race { OrderIndex = 4 },
                ],
            },
        ]);
        arena2Session1.ArenaName = "Arena 2";

        var arena1Session2 = NewSession(3, At(10), heats: [NewHeat(3, 1, 30)]);
        arena1Session2.ArenaName = "Arena 1";

        var arena2Session2 = NewSession(4, At(10), heats: [NewHeat(4, 1, 30)]);
        arena2Session2.ArenaName = "Arena 2";

        var times = TimetableTimes.Compute([arena1Session1, arena2Session1, arena1Session2, arena2Session2]);

        Assert.Equal(At(9, 15), times[1].Start);
        Assert.Equal(At(10, 15), times[3].Start); // Arena 1 carries +15m manual shift
        Assert.Equal(At(10, 7), times[4].Start);  // Arena 2 carries +7m halfway-race auto-delay
    }

    [Fact]
    public void FirstRaceAutoDelay_AndLearnedPaceMultiplier_ScaleAndShiftRemainingHeats()
    {
        var finishedFastHeat = new Heat
        {
            Id = 1,
            OrderIndex = 1,
            DurationMinutes = 30,
            StartedAt = At(9, 10),
            FinishedAt = At(9, 30), // 20m for 5 races = 4m/race -> 20/30 clamped to 0.75x
            Races =
            [
                new Race { OrderIndex = 1, StartedAt = At(9, 10), FinishedAt = At(9, 14), IsComplete = true },
                new Race { OrderIndex = 2, IsComplete = true },
                new Race { OrderIndex = 3, IsComplete = true },
                new Race { OrderIndex = 4, IsComplete = true },
                new Race { OrderIndex = 5, FinishedAt = At(9, 30), IsComplete = true },
            ],
        };
        var upcomingHeat = NewHeat(2, 2, 30, races: 5);
        var session = NewSession(1, At(9), started: At(9, 10), heats: [finishedFastHeat, upcomingHeat]);

        var times = TimetableTimes.Compute([session]);

        // First race was 10m after 09:00 scheduled start -> 10m - 2m = 8m effective delay (09:08).
        Assert.Equal(At(9, 8), times[1].Start);
        // Upcoming 30m heat is scaled by 0.75x to 23m.
        Assert.Equal(23, times[2].DurationMinutes);
    }
}
