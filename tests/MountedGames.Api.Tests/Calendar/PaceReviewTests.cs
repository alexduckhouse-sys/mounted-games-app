using System.Net;
using MountedGames.Api.Controllers;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;
namespace MountedGames.Api.Tests.Calendar;

public class PaceReviewTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task ReviewRequiresCompetitionStaff()
    {
        var arena = await factory.CreateArenaAsync();
        var url = $"/api/competitions/{arena.CompetitionId}/pace-review";
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await factory.TrainerAsync()).GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await factory.AdminAsync()).GetAsync(url)).StatusCode);
    }
    private static Session Slots(string age, params double[] minutes)
    {
        var at = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
        var raceList = new List<Race>();
        foreach (var minute in minutes) {
            raceList.Add(new Race { Name = "Bending", OrderIndex = raceList.Count, StartIsExplicit = true, StartedAt = at, FinishedAt = at.AddMinutes(minute) });
            at = at.AddMinutes(minute);
        }
        return new Session { Section = new CompetitionSection { AgeGroup = age, Format = SectionFormat.Teams }, ArenaName = "Main",
            Heats = [new Heat { Id = 1, Races = raceList }] };
    }
    [Fact]
    public void ComparableHistoryRejectsHold_AndUnknownAgeGroupsStaySeparate()
    {
        var current = Slots("Novice test", 3);
        var history = Slots("Novice test", 3, 3, 3, 3, 3, 8, 12);
        var row = Assert.Single(PaceReviewController.Review([current], [history]));
        Assert.Equal(3, row.MinutesPerSlot);
        Assert.Equal(2, row.ExcludedHolds);
        Assert.NotNull(row.TypicalErrorMinutes);
        var unrelated = Assert.Single(PaceReviewController.Review([Slots("Unusual age", 3)], [history]));
        Assert.Null(unrelated.MinutesPerSlot);
    }
    [Fact]
    public void FewerThanFiveSlotsCannotSuggestDuration()
    {
        Assert.Null(Assert.Single(PaceReviewController.Review([Slots("Under 12", 3, 3, 3, 3)], [])).MinutesPerSlot);
        Assert.Equal(3, Assert.Single(PaceReviewController.Review([Slots("Under 12", 3, 3, 3, 3, 3)], [])).MinutesPerSlot);
    }
}
