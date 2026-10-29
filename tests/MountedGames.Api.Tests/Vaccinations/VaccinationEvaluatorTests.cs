using MountedGames.Api.Dtos;
using MountedGames.Api.Services.Vaccinations;
namespace MountedGames.Api.Tests.Vaccinations;

public class VaccinationEvaluatorTests
{
    private static DateOnly D(string date) => DateOnly.Parse(date);
    private static VaccinationSettingsDto Settings(string arrival = "2026-10-20", string policy = VaccinationPolicies.PonyClub2026, params VenueVaccinationRule[] venues) => new(1, policy, "arrival", venues, D(arrival));
    private static VaccinationEvaluationDto Check(string arrival, string[] dates, bool complete = true, bool exception = false, VaccinationSettingsDto? settings = null, string? other = null) =>
        VaccinationEvaluator.Evaluate(settings ?? Settings(arrival), dates.Select(D).ToArray(), complete, D(arrival), exception, D("2026-12-31"), other is null ? null : D(other));
    [Theory]
    [InlineData(6, "NeedsAttention")]
    [InlineData(7, "DatesMeetRules")]
    [InlineData(8, "DatesMeetRules")]
    public void PonyClubStandDownAllowsDaySeven(int gap, string expected)
    {
        var date = D("2026-06-01").AddDays(gap).ToString("yyyy-MM-dd");
        Assert.Equal(expected, Check(date, ["2026-05-01", "2026-06-01"]).Status);
    }
    [Theory]
    [InlineData(6, false)]
    [InlineData(7, false)]
    [InlineData(8, true)]
    public void SevenClearDaysNeedsDayEight(int gap, bool allowed)
    {
        var vaccine = D("2026-06-01");
        var venue = new VenueVaccinationRule("Fake venue", "2026", "https://example.com/rules", D("2026-01-01"), D("2026-12-31"), 6, 21, 7, true, false);
        var result = Check(vaccine.AddDays(gap).ToString("yyyy-MM-dd"), ["2026-05-01", "2026-06-01"], settings: Settings(venues: [venue]));
        Assert.Equal(allowed, !result.Mandatory.Any(x => x.Code == "venue-stand-down"));
    }
    [Fact]
    public void EarlierArrivalChangesStandDownAndOtherVaccinationsCount()
    {
        var history = new[] { "2026-05-01", "2026-06-01" };
        Assert.Equal("NeedsAttention", Check("2026-06-06", history, settings: Settings("2026-06-10")).Status);
        Assert.Equal("DatesMeetRules", Check("2026-06-06", history, settings: Settings("2026-06-10") with { ReferenceDateBasis = "event-start" }).Status);
        Assert.Contains(Check("2026-06-10", history, other: "2026-06-09").Mandatory, x => x.Code == "stand-down");
    }
    [Fact]
    public void RecommendationDoesNotFailAnnualRequirement()
    {
        var result = Check("2026-10-20", ["2025-06-01", "2025-07-01", "2025-12-01"]);
        Assert.Equal("DatesMeetRules", result.Status);
        Assert.Single(result.Recommendations);
        Assert.Empty(result.Mandatory);
        Assert.Equal(D("2026-12-01"), result.NextRelevantOn);
    }
    [Theory]
    [InlineData("2024-02-29", 12, 0, "2025-02-28")]
    [InlineData("2026-08-31", 6, 21, "2027-03-21")]
    [InlineData("2026-01-31", 1, 0, "2026-02-28")]
    public void IntervalsUseCalendarMonths(string start, int months, int days, string expected) =>
        Assert.Equal(D(expected), VaccinationEvaluator.CalendarDeadline(D(start), months, days));
    [Fact]
    public void AnnualBoundaryIsInclusiveAndHistoricGapsAreNotHiddenByLatestBooster()
    {
        string[] history = ["2024-01-01", "2024-02-01", "2024-06-01", "2025-06-01"];
        Assert.DoesNotContain(Check("2026-06-01", history).Mandatory, x => x.Code == "annual-overdue");
        Assert.Contains(Check("2026-06-02", history).Mandatory, x => x.Code == "annual-overdue");
        Assert.Contains(Check("2026-06-10", [..history, "2026-06-02"]).Mandatory, x => x.Code == "booster-gap");
    }
    [Fact]
    public void MissingHistoryCannotBeCertifiedAndKnownRecentDateStillFails()
    {
        Assert.Equal("MissingHistory", Check("2026-10-20", ["2026-01-01"]).Status);
        Assert.Equal("MissingHistory", Check("2026-06-10", ["2026-05-01", "2026-06-01"], complete: false).Status);
        Assert.Contains(Check("2026-10-20", ["2026-10-19"], complete: false).Mandatory, x => x.Code == "stand-down");
    }
    [Fact]
    public void PrimaryCourseAndFirstBoosterBoundariesAreEnforced()
    {
        Assert.Contains(Check("2026-06-10", ["2026-05-20", "2026-06-01"]).Mandatory, x => x.Code == "primary-v2");
        Assert.Contains(Check("2026-10-01", ["2026-01-01", "2026-02-01", "2026-03-01"]).Mandatory, x => x.Code == "primary-v3");
        Assert.Contains(Check("2026-10-01", ["2026-01-01", "2026-02-01"]).Mandatory, x => x.Code == "primary-v3-missing");
        Assert.Equal("DatesMeetRules", Check("2026-02-10", ["2026-01-01", "2026-02-01"]).Status);
    }
    [Fact]
    public void HistoricCourseUsesWiderIntervalButCrossingCohortNeedsReview()
    {
        Assert.DoesNotContain(Check("2026-06-01", ["2023-01-01", "2023-04-01", "2023-11-01", "2024-11-01", "2025-11-01"]).Mandatory, x => x.Code.StartsWith("primary"));
        Assert.Contains(Check("2026-06-01", ["2023-12-01", "2024-01-01", "2024-06-01", "2025-06-01"]).Review, x => x.Code == "cohort-review");
    }
    [Fact]
    public void ExceptionsNeverTurnIntoAutomaticPasses()
    {
        Assert.Equal("OfficialReviewNeeded", Check("2026-02-10", ["2026-01-01", "2026-02-01"], exception: true).Status);
        Assert.Contains(Check("2026-06-01", ["2021-01-01", "2021-02-01", "2021-06-01", "2022-10-01", "2023-07-01", "2024-07-01", "2025-07-01"], exception: true).Review, x => x.Code == "documented-exception");
    }
    [Theory]
    [InlineData("manual-v1")]
    [InlineData("fei-2026-unverified-v1")]
    [InlineData("mgagb-unverified-v1")]
    [InlineData("eguk-unverified-v1")]
    [InlineData("struk-unverified-v1")]
    public void UnverifiedOrganisationsRemainManual(string policy) => Assert.Equal("OfficialReviewNeeded", Check("2026-02-10", ["2026-01-01", "2026-02-01"], settings: Settings(policy: policy)).Status);
    [Fact]
    public void FutureDatesInvalidOrderUnknownEditionMissingArrivalAndVenueAreVisible()
    {
        Assert.Contains(Check("2026-10-20", ["2027-01-01", "2027-02-01"]).Mandatory, x => x.Code == "future-date");
        Assert.Contains(Check("2026-10-20", ["2026-01-01", "2026-01-01"]).Mandatory, x => x.Code == "date-order");
        Assert.Equal("NeedsAttention", Check("2026-10-20", ["9999-01-01", "9999-02-01"]).Status);
        Assert.Contains(Check("2027-02-10", ["2026-01-01", "2026-02-01", "2026-07-01"]).Review, x => x.Code == "edition-date");
        Assert.Equal("MissingHistory", VaccinationEvaluator.Evaluate(Settings(), [D("2026-01-01"), D("2026-02-01")], true, null, false, D("2026-10-29")).Status);
        var venue = new VenueVaccinationRule("Fake venue", "2026", "https://example.com/rules", D("2026-01-01"), D("2026-12-31"), 6, 0, 7, false, false);
        var result = Check("2026-10-20", ["2025-06-01", "2025-07-01", "2025-12-01"], settings: Settings(venues: [venue]));
        Assert.Equal("NeedsAttention", result.Status); Assert.Contains(result.Mandatory, x => x.Code == "venue-booster");
        Assert.Contains(Check("2026-10-20", ["2025-06-01", "2025-07-01", "2025-12-01"], settings: Settings(venues: [venue with { ManualReview = true }])).Review, x => x.Code == "venue-review");
    }
}
