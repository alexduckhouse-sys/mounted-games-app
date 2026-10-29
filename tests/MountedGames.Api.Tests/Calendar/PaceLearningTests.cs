using MountedGames.Api.Entities;
using MountedGames.Api.Services.Calendar;
namespace MountedGames.Api.Tests.Calendar;

public class PaceLearningTests
{
    [Fact]
    public void ZeroDeviationRejectsLongHold_ButSmallSamplesStayProvisional()
    {
        PaceLearning.Sample S(double minutes) => new(1, "bending", "under 12", SectionFormat.Teams, "Main", minutes, 6);
        Assert.Equal(5, PaceLearning.Clean(new[] { S(3), S(3), S(3), S(3), S(3), S(8) }).Count);
        Assert.Equal(3, PaceLearning.Clean(new[] { S(3), S(3), S(8) }).Count);
        Assert.Empty(PaceLearning.Clean([]));
    }

    [Fact]
    public void FiveInferredFinishesYieldFourSlots_NotFive()
    {
        var start = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
        var heat = new Heat { Id = 1, DurationMinutes = 30, Races = Enumerable.Range(0, 5).Select(i => new Race {
            OrderIndex = i, IsComplete = true, StartedAt = start.AddMinutes(i * 3), FinishedAt = start.AddMinutes(i * 3)
        }).ToList() };
        var samples = PaceLearning.Samples([new Session { Heats = [heat] }]);
        Assert.Equal(4, samples.Count);
        Assert.All(samples, sample => Assert.Equal(3, sample.Minutes));
    }

    [Fact]
    public void ActualHoldCarriesForwardWithoutShorteningLaterHeats_AndResetsNextDay()
    {
        var day = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
        var sessions = new[] {
            new Session { Id = 1, OrderIndex = 1, ArenaName = "Main", ScheduledStart = day, Heats = [
                new Heat { Id = 1, OrderIndex = 1, StartedAt = day, FinishedAt = day.AddMinutes(40), DurationMinutes = 30 },
                new Heat { Id = 2, OrderIndex = 2, ScheduledStart = day.AddMinutes(35), DurationMinutes = 30 }] },
            new Session { Id = 2, OrderIndex = 2, ArenaName = "Main", ScheduledStart = day.AddDays(1), Heats = [new Heat { Id = 3, DurationMinutes = 30 }] }
        };
        var times = TimetableTimes.Compute(sessions, day.AddMinutes(45));
        Assert.Equal(day.AddMinutes(40), times[2].Start);
        Assert.Equal(30, times[2].DurationMinutes);
        Assert.Equal(day.AddDays(1), times[3].Start);
    }
}
