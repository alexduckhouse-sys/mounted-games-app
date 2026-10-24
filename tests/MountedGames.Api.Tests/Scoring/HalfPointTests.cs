using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

/// <summary>Race points may be whole or half points, and nothing finer.</summary>
public class HalfPointTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public HalfPointTests(ApiFactory f) => _f = f;

    private async Task<(Arena Arena, int Race)> ArenaWithRaceAsync(int teams)
    {
        var a = await _f.CreateArenaAsync(teams);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        return (a, races[0]);
    }

    private static SubmitRaceResultsRequest Request(params FinishingPlaceDto[] places) => new(places);

    [Theory]
    [InlineData(0, true)]
    [InlineData(2.5, true)]
    [InlineData(3, true)]
    [InlineData(1000, true)]
    [InlineData(0.25, false)]
    [InlineData(2.51, false)]
    [InlineData(-0.5, false)]
    [InlineData(1000.5, false)]
    [InlineData(double.NaN, false)]
    [InlineData(double.PositiveInfinity, false)]
    public void OnlyWholeAndHalfPointsAreValid(double value, bool valid)
        => Assert.Equal(valid, PointValues.IsValid(value));

    [Fact]
    public void PointsAreFormattedWithoutTrailingZerosWhateverTheCulture()
    {
        var old = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");
            Assert.Equal("3", PointValues.Format(3));
            Assert.Equal("2.5", PointValues.Format(2.5));
            Assert.Equal("10.5", PointValues.Format(10.5));
        }
        finally { CultureInfo.CurrentCulture = old; }
    }

    [Fact]
    public async Task AHalfPointOverride_RoundTrips_AndIsTotalledInTheStandings()
    {
        var (a, race) = await ArenaWithRaceAsync(3);
        var admin = await _f.AdminAsync();

        var post = await admin.PostAsJsonAsync($"/api/races/{race}/results", Request(
            new FinishingPlaceDto(a.TeamIds[0], 1, false, Points: 2.5),
            new FinishingPlaceDto(a.TeamIds[1], 2, false, Points: 2.5),
            new FinishingPlaceDto(a.TeamIds[2], 3, false)));
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        var stored = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => r.RaceId == race).OrderBy(r => r.Placing).ToListAsync());
        Assert.Equal(new[] { 2.5, 2.5, 1.0 }, stored.Select(r => r.Points));

        var score = await (await admin.GetAsync($"/api/races/{race}/score")).ReadAsync<RaceScoreDto>();
        Assert.Equal(2.5, score.Results.Single(r => r.TeamId == a.TeamIds[0]).Points);

        var rows = await (await _f.CreateClient().GetAsync($"/api/competitions/{a.CompetitionId}/standings")).ReadAsync<List<StandingRow>>();
        Assert.Equal(2.5, rows.Single(r => r.TeamId == a.TeamIds[0]).TotalPoints);
        Assert.Equal(1.0, rows.Single(r => r.TeamId == a.TeamIds[2]).TotalPoints);
    }

    [Fact]
    public async Task HalfPointsAddUp_AcrossRaces()
    {
        var a = await _f.CreateArenaAsync(2);
        var (_, races) = await _f.AddHeatAsync(a.SessionId, a.TeamIds, "Heat", 1, raceCount: 3);
        var admin = await _f.AdminAsync();
        foreach (var race in races)
            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/races/{race}/results", Request(
                new FinishingPlaceDto(a.TeamIds[0], 1, false, Points: 1.5),
                new FinishingPlaceDto(a.TeamIds[1], 2, false, Points: 0.5)))).StatusCode);

        var rows = await (await _f.CreateClient().GetAsync($"/api/competitions/{a.CompetitionId}/standings")).ReadAsync<List<StandingRow>>();
        Assert.Equal(4.5, rows.Single(r => r.TeamId == a.TeamIds[0]).TotalPoints);
        Assert.Equal(1.5, rows.Single(r => r.TeamId == a.TeamIds[1]).TotalPoints);
    }

    [Theory]
    [InlineData(0.25)]
    [InlineData(2.75)]
    [InlineData(-1)]
    [InlineData(1001)]
    public async Task APointsValueThatIsNotAWholeOrHalfNumber_IsRejectedWith400(double points)
    {
        var (a, race) = await ArenaWithRaceAsync(2);
        var admin = await _f.AdminAsync();

        var post = await admin.PostAsJsonAsync($"/api/races/{race}/results", Request(
            new FinishingPlaceDto(a.TeamIds[0], 1, false, Points: points),
            new FinishingPlaceDto(a.TeamIds[1], 2, false)));

        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.Results.Where(r => r.RaceId == race).ToListAsync()));
    }

    [Fact]
    public async Task TeamsLevelOnAHalfPointTotal_AreStillOrderedByTheTieBreak()
    {
        var (a, race) = await ArenaWithRaceAsync(3);
        var admin = await _f.AdminAsync();
        // A and B both finish on 2.5; A has the win, so countback puts A first. C is behind on 1.
        await admin.PostAsJsonAsync($"/api/races/{race}/results", Request(
            new FinishingPlaceDto(a.TeamIds[1], 2, false, Points: 2.5),
            new FinishingPlaceDto(a.TeamIds[0], 1, false, Points: 2.5),
            new FinishingPlaceDto(a.TeamIds[2], 3, false)));

        var rows = await (await _f.CreateClient().GetAsync($"/api/competitions/{a.CompetitionId}/standings")).ReadAsync<List<StandingRow>>();

        Assert.Equal(new[] { a.TeamIds[0], a.TeamIds[1], a.TeamIds[2] }, rows.Select(r => r.TeamId));
        Assert.Equal(rows[0].TotalPoints, rows[1].TotalPoints);
    }

    [Fact]
    public async Task ResubmittingTheSameHalfPoints_IsNoChange_ButADifferentValueNeedsAReason()
    {
        var (a, race) = await ArenaWithRaceAsync(2);
        var admin = await _f.AdminAsync();
        var places = new[]
        {
            new FinishingPlaceDto(a.TeamIds[0], 1, false, Points: 1.5),
            new FinishingPlaceDto(a.TeamIds[1], 2, false),
        };
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/races/{race}/results", Request(places))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/races/{race}/results", Request(places))).StatusCode);

        var changed = new[] { places[0] with { Points = 2 }, places[1] };
        var correction = await admin.PostAsJsonAsync($"/api/races/{race}/results", Request(changed));
        Assert.Equal(HttpStatusCode.BadRequest, correction.StatusCode);
        var withReason = await admin.PostAsJsonAsync($"/api/races/{race}/results", new SubmitRaceResultsRequest(changed, null, "Dead heat judged"));
        Assert.Equal(HttpStatusCode.OK, withReason.StatusCode);
        Assert.Equal(2.0, (await _f.WithDbAsync(db => db.Results.SingleAsync(r => r.RaceId == race && r.TeamId == a.TeamIds[0]))).Points);
    }

    [Fact]
    public async Task AnExistingSqliteIntegerColumn_StoresAHalfPointWithoutLoss()
    {
        // Existing local databases created Results.Points as INTEGER. SQLite's INTEGER affinity keeps 2.5 as a REAL,
        // so they need no schema change; the guard in DbInitializer is deliberately absent.
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using (var create = connection.CreateCommand())
        {
            create.CommandText = "CREATE TABLE T (Points INTEGER NOT NULL); INSERT INTO T VALUES (2.5), (3);";
            await create.ExecuteNonQueryAsync();
        }
        await using var read = connection.CreateCommand();
        read.CommandText = "SELECT SUM(Points), MAX(Points), typeof(Points) FROM T WHERE Points = 2.5";
        await using var reader = await read.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(2.5, reader.GetDouble(0));
        Assert.Equal(2.5, reader.GetDouble(1));
        Assert.Equal("real", reader.GetString(2));
    }
}
