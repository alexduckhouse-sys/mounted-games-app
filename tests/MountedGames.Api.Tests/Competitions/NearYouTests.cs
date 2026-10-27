using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Security;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

/// <summary>
/// The upcoming list ordered for one viewer: nearest first when their rough place is known (from the website's keyed proxy
/// headers or their own history), never asked for, never stored, and never mixed into the public cached list.
/// </summary>
public class NearYouTests : IClassFixture<NearYouTests.ProxyApiFactory>
{
    public sealed class ProxyApiFactory : ApiFactory
    {
        public const string Key = "near-you-proxy-key-0123456789-0123456789-ab";
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Security:ProxyKey", Key);
        }
    }

    private readonly ProxyApiFactory _f;
    public NearYouTests(ProxyApiFactory f) => _f = f;

    private static readonly DateTime Today = DateTime.UtcNow.Date;

    private async Task<int> EventAsync(string name, int daysAhead, double? lat, double? lon, int length = 0, bool locked = false)
        => await _f.InDbAsync(async db =>
        {
            var c = new Competition
            {
                Name = name, StartDate = Today.AddDays(daysAhead), EndDate = length > 0 ? Today.AddDays(daysAhead + length) : null,
                Latitude = lat, Longitude = lon, SignupsLocked = locked,
            };
            c.Sections.Add(new CompetitionSection { Format = SectionFormat.Teams, AgeGroup = "U12", DisplayName = "U12" });
            db.Competitions.Add(c);
            await db.SaveChangesAsync();
            return c.Id;
        });

    private async Task FreshAsync()
        => await _f.InDbAsync(db => db.Competitions.ExecuteUpdateAsync(s => s.SetProperty(c => c.IsArchived, true)));

    private async Task<(CompetitionNearYouPage Page, HttpResponseMessage Response)> GetAsync(
        string query = "", string? key = ProxyApiFactory.Key, string? lat = null, string? lon = null, HttpClient? client = null)
    {
        client ??= _f.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/competitions/picker/near-you" + query);
        if (key is not null) request.Headers.Add(ProxyClientIpMiddleware.KeyHeader, key);
        if (lat is not null) request.Headers.Add(ProxyClientIpMiddleware.LatitudeHeader, lat);
        if (lon is not null) request.Headers.Add(ProxyClientIpMiddleware.LongitudeHeader, lon);
        if (client.DefaultRequestHeaders.Authorization is { } auth) request.Headers.Authorization = auth;
        var response = await client.SendAsync(request);
        return (await response.ReadAsync<CompetitionNearYouPage>(), response);
    }

    private async Task SeedAsync()
    {
        await FreshAsync();
        await EventAsync("Edinburgh", 2, 55.95, -3.19);
        await EventAsync("Nowhere known", 3, null, null);
        await EventAsync("Exeter", 5, 50.72, -3.53);
        await EventAsync("Birmingham", 9, 52.48, -1.9);
    }

    [Fact]
    public async Task WithoutAnyPlaceTheListIsInDateOrderWithNoDistances()
    {
        await SeedAsync();
        var (page, response) = await GetAsync(key: null);
        Assert.False(page.LocationKnown);
        Assert.Equal("soonest", page.Sort);
        Assert.Empty(page.Distances);
        Assert.Equal(["Edinburgh", "Nowhere known", "Exeter", "Birmingham"], page.Items.Select(i => i.Name));
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
    }

    [Fact]
    public async Task AKeyedPlaceSortsNearestFirst_UnplacedLast_WithRoundedDistances()
    {
        await SeedAsync();
        var (page, _) = await GetAsync(lat: "51.4545", lon: "-2.5879"); // Bristol
        Assert.True(page.LocationKnown);
        Assert.Equal("nearest", page.Sort);
        Assert.Equal(["Exeter", "Birmingham", "Edinburgh", "Nowhere known"], page.Items.Select(i => i.Name));
        var exeter = page.Items[0].Id;
        Assert.InRange(page.Distances.Single(d => d.Id == exeter).Miles, 60, 80);
        Assert.DoesNotContain(page.Distances, d => d.Id == page.Items[3].Id);
    }

    [Fact]
    public async Task ThePlaceIsIgnoredWithoutTheKey_OrWhenItIsNotARealPlace()
    {
        await SeedAsync();
        foreach (var (key, lat, lon) in new (string?, string?, string?)[]
                 { (null, "51.4", "-2.6"), ("wrong-key-0123456789-0123456789-0123456789", "51.4", "-2.6"), (ProxyApiFactory.Key, "95", "-2.6"),
                   (ProxyApiFactory.Key, "x", "y"), (ProxyApiFactory.Key, "51.4", null) })
        {
            var (page, _) = await GetAsync(key: key, lat: lat, lon: lon);
            Assert.False(page.LocationKnown);
            Assert.Equal("Edinburgh", page.Items[0].Name);
        }
    }

    [Fact]
    public async Task SoonestFirstKeepsDateOrderButStillGivesDistances()
    {
        await SeedAsync();
        var (page, _) = await GetAsync("?sort=soonest", lat: "51.5", lon: "-2.6");
        Assert.True(page.LocationKnown);
        Assert.Equal("soonest", page.Sort);
        Assert.Equal(["Edinburgh", "Nowhere known", "Exeter", "Birmingham"], page.Items.Select(i => i.Name));
        Assert.Equal(3, page.Distances.Count);
    }

    [Fact]
    public async Task EventsOnTodayStayAtTheTop_AndPagesCutTheWholeSortedSet()
    {
        await FreshAsync();
        await EventAsync("Far today", 0, 57.1, -2.1, length: 1);
        await EventAsync("Near later", 4, 51.5, -2.5);
        await EventAsync("Mid later", 6, 52.5, -1.9);
        await EventAsync("Far later", 8, 56.0, -3.2);
        await EventAsync("Unplaced", 1, null, null);

        var (first, _) = await GetAsync("?pageSize=2", lat: "51.5", lon: "-2.6");
        var (second, _) = await GetAsync("?pageSize=2&page=2", lat: "51.5", lon: "-2.6");
        var (third, _) = await GetAsync("?pageSize=2&page=3", lat: "51.5", lon: "-2.6");
        Assert.Equal(["Far today", "Near later"], first.Items.Select(i => i.Name));
        Assert.True(first.HasMore);
        Assert.Equal(["Mid later", "Far later"], second.Items.Select(i => i.Name));
        Assert.True(second.HasMore);
        Assert.Equal(["Unplaced"], third.Items.Select(i => i.Name));
        Assert.False(third.HasMore);
    }

    [Fact]
    public async Task ASignedInPersonsHistoryBeatsTheConnection()
    {
        await FreshAsync();
        var home = await EventAsync("Home venue (past)", -20, 50.7, -3.5);
        await EventAsync("Close to home", 5, 50.9, -3.4);
        await EventAsync("Close to the connection", 3, 55.9, -3.2);
        var (client, auth) = await _f.ApprovedTrainerAsync();
        await _f.InDbAsync(async db =>
        {
            var section = await db.CompetitionSections.FirstAsync(s => s.CompetitionId == home);
            var club = new Club { Name = $"Club {Guid.NewGuid():N}" };
            db.Clubs.Add(club);
            await db.SaveChangesAsync();
            db.Teams.Add(new Team { CompetitionId = home, CompetitionSectionId = section.Id, ClubId = club.Id, Suffix = "A", DisplayName = "Mine", TrainerUserId = auth.User.Id });
            await db.SaveChangesAsync();
        });
        var (page, _) = await GetAsync(lat: "55.9", lon: "-3.2", client: client); // connection says Edinburgh
        Assert.Equal("Close to home", page.Items[0].Name);
        Assert.True(page.LocationKnown);
        // The same person on a connection with no place still has one: their own history.
        var (alone, _) = await GetAsync(key: null, client: client);
        Assert.Equal("Close to home", alone.Items[0].Name);
        // Someone with no history and a keyed connection uses the connection.
        var (other, _) = await GetAsync(lat: "55.9", lon: "-3.2", client: (await _f.SignupAsync("Member")).Client);
        Assert.Equal("Close to the connection", other.Items[0].Name);
    }

    [Fact]
    public async Task BadPagingIsRefused_AndThePublicPickerIsUntouched()
    {
        var client = _f.CreateClient();
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await client.GetAsync("/api/competitions/picker/near-you?page=0")).StatusCode);
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await client.GetAsync("/api/competitions/picker/near-you?pageSize=51")).StatusCode);
        // The plain picker never reads the place headers, so every viewer still sees the same cacheable answer.
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/competitions/picker");
        request.Headers.Add(ProxyClientIpMiddleware.KeyHeader, ProxyApiFactory.Key);
        request.Headers.Add(ProxyClientIpMiddleware.LatitudeHeader, "55.9");
        request.Headers.Add(ProxyClientIpMiddleware.LongitudeHeader, "-3.2");
        var located = await (await client.SendAsync(request)).Content.ReadAsStringAsync();
        var plain = await (await client.GetAsync("/api/competitions/picker")).Content.ReadAsStringAsync();
        Assert.Equal(plain, located);
        Assert.DoesNotContain("distance", plain, StringComparison.OrdinalIgnoreCase);
    }
}
