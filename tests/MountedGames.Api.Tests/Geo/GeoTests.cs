using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Geo;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Geo;

public class UkTimeTests
{
    private static DateTime Utc(int y, int m, int d, int h, int min = 0) => new(y, m, d, h, min, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData(2026, 3, 29, 0, 59, 0, 59)]   // still GMT: the change is at 01:00 UTC
    [InlineData(2026, 3, 29, 1, 0, 2, 0)]     // BST begins
    [InlineData(2026, 10, 25, 0, 59, 1, 59)]  // BST still
    [InlineData(2026, 10, 25, 1, 0, 1, 0)]    // GMT again
    [InlineData(2026, 7, 1, 12, 0, 13, 0)]
    [InlineData(2026, 1, 1, 12, 0, 12, 0)]
    public void ConvertsAcrossBothClockChanges_ByTheZoneAndByTheHandRule(int y, int m, int d, int h, int min, int ukHour, int ukMinute)
    {
        var utc = Utc(y, m, d, h, min);
        var expected = new DateTime(y, m, d, ukHour, ukMinute, 0);
        if (ukHour < h) expected = expected.AddDays(0);
        Assert.Equal(expected, UkTime.ToUk(utc));
        Assert.Equal(expected, UkTime.ToUkByRule(utc));
    }

    [Theory]
    [InlineData(2026, 10, 24, 18, 17)]  // 18:00 BST
    [InlineData(2026, 10, 25, 18, 18)]  // 18:00 GMT, the evening after the change
    [InlineData(2026, 3, 29, 18, 17)]
    [InlineData(2026, 1, 15, 18, 18)]
    public void WallClockBackToUtc_ByTheZoneAndByTheHandRule(int y, int m, int d, int ukHour, int utcHour)
    {
        var local = new DateTime(y, m, d, ukHour, 0, 0);
        Assert.Equal(Utc(y, m, d, utcHour), UkTime.FromUk(local));
        Assert.Equal(Utc(y, m, d, utcHour), UkTime.FromUkByRule(local));
    }

    [Fact]
    public void DateKeyIsTheUkDate_NotTheUtcDate()
    {
        Assert.Equal("2026-10-25", UkTime.DateKey(Utc(2026, 10, 24, 23, 30))); // 00:30 BST on the 25th
        Assert.Equal("2026-10-25", UkTime.DateKey(Utc(2026, 10, 25, 23, 30))); // 23:30 GMT on the 25th
    }

    [Theory]
    [InlineData(0, 0, "12am")]
    [InlineData(12, 0, "12pm")]
    [InlineData(18, 0, "6pm")]
    [InlineData(9, 30, "9:30am")]
    [InlineData(23, 5, "11:05pm")]
    public void ClockTextIsPlain(int hour, int minute, string expected)
        => Assert.Equal(expected, UkTime.ClockText(new DateTime(2026, 1, 1, hour, minute, 0)));
}

public class GeoPointTests
{
    [Theory]
    [InlineData("51.4545", "-2.5879", 51.5, -2.6)]
    [InlineData("0", "0", 0, 0)]
    [InlineData("-90", "180", -90, 180)]
    [InlineData(" 53.05 ", "-1.04", 53.0, -1.0)]
    public void ReadsAndRoundsToOneDecimalPlace(string lat, string lon, double expectedLat, double expectedLon)
    {
        Assert.True(GeoPoint.TryParse(lat, lon, out var point));
        Assert.Equal(expectedLat, point.Latitude);
        Assert.Equal(expectedLon, point.Longitude);
    }

    [Theory]
    [InlineData(null, "1")]
    [InlineData("1", null)]
    [InlineData("", "")]
    [InlineData("abc", "1")]
    [InlineData("91", "0")]
    [InlineData("-91", "0")]
    [InlineData("0", "181")]
    [InlineData("0", "-181")]
    [InlineData("NaN", "0")]
    [InlineData("0", "Infinity")]
    public void RefusesAnythingThatIsNotARealPlace(string? lat, string? lon)
        => Assert.False(GeoPoint.TryParse(lat, lon, out _));

    [Fact]
    public void DistanceIsInMiles()
    {
        var london = new GeoPoint(51.5, -0.1);
        Assert.InRange(london.MilesTo(55.95, -3.19), 325, 335);   // Edinburgh
        Assert.Equal(0, london.MilesTo(51.5, -0.1), 6);
    }

    [Fact]
    public void VisitorGeoReadsOnlyWhatTheMiddlewareStored()
    {
        var context = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        Assert.Null(VisitorGeo.Get(context));
        context.Items[VisitorGeo.ItemKey] = "not a point";
        Assert.Null(VisitorGeo.Get(context));
        context.Items[VisitorGeo.ItemKey] = new GeoPoint(1, 2);
        Assert.Equal(new GeoPoint(1, 2), VisitorGeo.Get(context));
    }
}

/// <summary>Where someone seems to be, from the venues of events they entered, trained for or supported.</summary>
public class LocationInferenceTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public LocationInferenceTests(ApiFactory f) => _f = f;

    private async Task<(int CompetitionId, int SectionId)> VenueAsync(double? lat, double? lon, int daysAgo = 30, bool demo = false)
    {
        var section = await _f.NewSectionAsync();
        await _f.InDbAsync(async db =>
        {
            var c = await db.Competitions.SingleAsync(x => x.Id == section.CompetitionId);
            c.Latitude = lat; c.Longitude = lon; c.StartDate = DateTime.UtcNow.Date.AddDays(-daysAgo);
            if (demo) db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { CompetitionId = c.Id, IsDemo = true });
            await db.SaveChangesAsync();
        });
        return (section.CompetitionId, section.Id);
    }

    private async Task<GeoPoint?> ForAsync(string? userId)
    {
        using var scope = _f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<LocationInference>().FromHistoryAsync(userId, CancellationToken.None);
    }

    private async Task<GeoPoint?> ForAddressAsync(string address)
    {
        using var scope = _f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<LocationInference>().ForAddressAsync(address, CancellationToken.None);
    }

    [Fact]
    public async Task NoHistoryMeansNoPlace()
    {
        Assert.Null(await ForAsync(null));
        Assert.Null(await ForAsync(Guid.NewGuid().ToString()));
        Assert.Null(await ForAddressAsync("not an address"));
    }

    [Fact]
    public async Task EntriesByAccountAreAveraged_ButDemoCancelledUnplacedVenuesAndOtherPeoplesAddressesAreNot()
    {
        var userId = (await _f.SignupAsync("Member")).Auth.User.Id;
        var email = $"parent-{Guid.NewGuid():N}@example.org";
        var a = await VenueAsync(50.0, -2.0);
        var b = await VenueAsync(52.0, -4.0);
        var demo = await VenueAsync(10.0, 10.0, demo: true);
        var unplaced = await VenueAsync(null, null);
        var cancelled = await VenueAsync(30.0, 30.0);
        await _f.InDbAsync(async db =>
        {
            db.SectionSignups.AddRange(
                new SectionSignup { CompetitionSectionId = a.SectionId, FullName = "P", UserId = userId, Status = SignupPaymentStatus.Paid },
                new SectionSignup { CompetitionSectionId = b.SectionId, FullName = "P", ContactEmail = email, Status = SignupPaymentStatus.Pending },
                new SectionSignup { CompetitionSectionId = demo.SectionId, FullName = "P", UserId = userId, Status = SignupPaymentStatus.Paid },
                new SectionSignup { CompetitionSectionId = unplaced.SectionId, FullName = "P", UserId = userId, Status = SignupPaymentStatus.Paid },
                new SectionSignup { CompetitionSectionId = cancelled.SectionId, FullName = "P", UserId = userId, Status = SignupPaymentStatus.Cancelled });
            await db.SaveChangesAsync();
        });
        // Signed in: only the account's own entries count. The entry that merely names this address as its contact doesn't.
        var point = await ForAsync(userId);
        Assert.NotNull(point);
        Assert.Equal(50.0, point!.Value.Latitude, 6);
        Assert.Equal(-2.0, point.Value.Longitude, 6);
        // The opt-in path (an email to that same mailbox) does use the address.
        var byAddress = await ForAddressAsync(email);
        Assert.Equal(52.0, byAddress!.Value.Latitude, 6);
    }

    [Fact]
    public async Task TrainingAndSupportingCountToo_AndAnOptInAddressIsMatchedToAnAccount()
    {
        var (trainerClient, auth) = await _f.ApprovedTrainerAsync();
        var supporter = await _f.SignupAsync("Member");
        var trained = await VenueAsync(54.0, -1.0);
        var supported = await VenueAsync(56.0, -3.0);
        var address = $"stable-{Guid.NewGuid():N}@example.org";
        await _f.InDbAsync(async db =>
        {
            var club = new Club { Name = $"Club {Guid.NewGuid():N}" };
            db.Clubs.Add(club);
            await db.SaveChangesAsync();
            var team1 = new Team { CompetitionId = trained.CompetitionId, CompetitionSectionId = trained.SectionId, ClubId = club.Id, Suffix = "A", DisplayName = "T1", TrainerUserId = auth.User.Id };
            var team2 = new Team { CompetitionId = supported.CompetitionId, CompetitionSectionId = supported.SectionId, ClubId = club.Id, Suffix = "A", DisplayName = "T2" };
            db.Teams.AddRange(team1, team2);
            await db.SaveChangesAsync();
            db.TeamSupporters.AddRange(
                new TeamSupporter { TeamId = team2.Id, UserId = supporter.Item2.User.Id, Status = TeamSupporterStatus.Accepted },
                new TeamSupporter { TeamId = team1.Id, UserId = supporter.Item2.User.Id, Status = TeamSupporterStatus.Pending });
            var user = await db.Users.SingleAsync(u => u.Id == auth.User.Id);
            user.Email = address; user.NormalizedEmail = address.ToUpperInvariant();
            await db.SaveChangesAsync();
        });

        var trainerPoint = await ForAsync(auth.User.Id);
        Assert.Equal(54.0, trainerPoint!.Value.Latitude, 6);
        var supporterPoint = await ForAsync(supporter.Item2.User.Id);
        Assert.Equal(56.0, supporterPoint!.Value.Latitude, 6);   // the pending follow doesn't count
        using var scope = _f.Services.CreateScope();
        var byAddress = await scope.ServiceProvider.GetRequiredService<LocationInference>().ForAddressAsync(address, CancellationToken.None);
        Assert.Equal(54.0, byAddress!.Value.Latitude, 6);
        Assert.NotNull(trainerClient);
    }

    [Fact]
    public async Task OnlyTheLatestTenVenuesAreAveraged()
    {
        var userId = (await _f.SignupAsync("Member")).Item2.User.Id;
        var venues = new List<(int CompetitionId, int SectionId)>();
        for (var i = 0; i < 12; i++) venues.Add(await VenueAsync(i < 2 ? 0.0 : 10.0, 0.0, daysAgo: i < 2 ? 500 : 10 + i));
        await _f.InDbAsync(async db =>
        {
            db.SectionSignups.AddRange(venues.Select(v => new SectionSignup { CompetitionSectionId = v.SectionId, FullName = "P", UserId = userId, Status = SignupPaymentStatus.Paid }));
            await db.SaveChangesAsync();
        });
        Assert.Equal(10.0, (await ForAsync(userId))!.Value.Latitude, 6);
    }
}
