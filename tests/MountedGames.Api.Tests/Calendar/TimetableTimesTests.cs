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

    [Fact]
    public void PauseAppliesOnceAcrossUntimedSessionsAndWholeEventItems()
    {
        var first = NewSession(1, At(9), heats: [NewHeat(1, 1, 30)]);
        var second = NewSession(2, null, heats: [NewHeat(2, 1, 30)]);
        var third = NewSession(3, null, heats: [NewHeat(3, 1, 30)]);
        var global = NewSession(4, At(11), heats: [NewHeat(4, 1, 30)]);
        foreach (var session in new[] { first, second, third, global })
            session.Notes = $"[paused:{new DateTimeOffset(At(9, 10)).ToUnixTimeMilliseconds()}]";
        first.ArenaName = second.ArenaName = third.ArenaName = "A";
        var times = TimetableTimes.Compute([first, second, third, global], At(9, 25));
        Assert.Equal(At(9, 15), times[1].Start);
        Assert.Equal(At(9, 45), times[2].Start);
        Assert.Equal(At(10, 15), times[3].Start);
        Assert.Equal(At(11, 15), times[4].Start);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void PausePreservesActualHeatTimesAndDelaysRemainingHeatsOnce(bool finished)
    {
        var first = NewHeat(1, 1, 30, started: At(9));
        if (finished) first.FinishedAt = At(9, 30);
        var session = NewSession(1, At(9), started: At(9), heats: [first, NewHeat(2, 2, 30), NewHeat(3, 3, 30)]);
        session.Status = SessionStatus.InArena;
        session.Notes = $"[paused:{new DateTimeOffset(At(9, 10)).ToUnixTimeMilliseconds()}]";
        var times = TimetableTimes.Compute([session], At(9, 25));
        Assert.Equal(At(9), times[1].Start);
        Assert.Equal(At(9, 45), times[2].Start);
        Assert.Equal(At(10, 15), times[3].Start);
    }

    [Fact]
    public void PaceUsesEachHeatsRaceTimestampsBeforeTheSessionStart()
    {
        var first = NewHeat(1, 1, 30, races: 5);
        var second = NewHeat(2, 2, 30, races: 5);
        foreach (var heat in new[] { first, second })
        {
            var index = 0;
            foreach (var race in heat.Races)
            {
                race.IsComplete = true;
                race.StartedAt = At(9).AddMinutes((heat.OrderIndex - 1) * 30 + index * 5);
                race.FinishedAt = race.StartedAt.Value.AddMinutes(5);
                index++;
            }
        }
        var pace = TimetableTimes.PredictPace([NewSession(1, At(9), started: At(9), heats: [first, second])]);
        Assert.Equal(5, pace.AvgMinutesPerRace);
        Assert.Equal(2, pace.SampleHeats);
        Assert.Equal(25.0 / 30, pace.Multiplier, 8);
    }

    [Fact]
    public void DayOneDelayDoesNotShiftDayTwoSessions()
    {
        var day1Late = NewSession(1, At(9), started: At(9, 45), heats: [NewHeat(1, 1, 30)]);
        var day1Next = NewSession(2, At(10), heats: [NewHeat(2, 1, 30)]);
        var day2Morning = NewSession(3, At(9).AddDays(1), heats: [NewHeat(3, 1, 30)]);

        var times = TimetableTimes.Compute([day1Late, day1Next, day2Morning]);

        Assert.Equal(At(10, 45), times[2].Start);
        Assert.Equal(At(9).AddDays(1), times[3].Start);
    }

    [Fact]
    public void SessionJustAfterUkMidnightBelongsToTheNextUkDay()
    {
        // 23:30 UTC on 17 October is 00:30 BST on the 18th, so day one's delay must not reach it.
        var day1Late = NewSession(1, At(9), started: At(9, 45), heats: [NewHeat(1, 1, 30)]);
        var afterMidnight = NewSession(2, At(23, 30), heats: [NewHeat(2, 1, 30)]);

        var times = TimetableTimes.Compute([day1Late, afterMidnight]);

        Assert.Equal(At(23, 30), times[2].Start);
    }
}
