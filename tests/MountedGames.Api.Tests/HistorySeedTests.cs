using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests;

/// <summary>
/// The history seeder (<c>npm run db:seed-history</c>): fictional clubs, riders, past competitions, a season and
/// shop listings. The first group runs on its own in-memory SQLite with foreign keys on, so a removal in the wrong
/// order fails here, as in <see cref="ReviewSeedFreshTests"/>.
/// </summary>
public class HistorySeedTests
{
    private static readonly DateTime Today = new(2030, 6, 1, 0, 0, 0, DateTimeKind.Utc);

    private static async Task<AppDbContext> Database()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=:memory:").Options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        return db;
    }

    private static async Task<int[]> CountsAsync(AppDbContext db)
    {
        db.ChangeTracker.Clear();
        return new[]
        {
            await db.Competitions.CountAsync(), await db.CompetitionSections.CountAsync(), await db.Teams.CountAsync(),
            await db.RiderEntries.CountAsync(), await db.DeclarationForms.CountAsync(), await db.Sessions.CountAsync(),
            await db.Heats.CountAsync(), await db.Races.CountAsync(), await db.Results.CountAsync(),
            await db.Clubs.CountAsync(), await db.SavedRiders.CountAsync(), await db.Set<Season>().CountAsync(),
            await db.Set<SeasonRound>().CountAsync(), await db.Set<SeasonRoundResult>().CountAsync(),
            await db.Set<TeamProfile>().CountAsync(), await db.Set<EventTeamProfileLink>().CountAsync(),
            await db.ShopPosts.CountAsync(), await db.Set<CatalogueItem>().CountAsync(), await db.Set<CompetitionListing>().CountAsync(),
            await db.Set<EventCommerceSettings>().CountAsync(), await db.Users.CountAsync(),
        };
    }

    [Fact]
    public async Task SeedsTheBackCatalogueOnSqlite()
    {
        await using var db = await Database();
        var result = await HistorySeeder.SeedAsync(db, Today);
        db.ChangeTracker.Clear();

        Assert.Equal(0, result.Removed);
        Assert.Equal(9, result.Competitions);
        Assert.Equal(12, result.Clubs);
        Assert.InRange(result.Riders, 150, 200);
        Assert.Equal(await db.SavedRiders.CountAsync(), result.Riders);
        Assert.Equal(1, result.Seasons);
        Assert.Equal(12, result.TeamProfiles);

        var past = await db.Competitions
            .Include(c => c.Sections).Include(c => c.Teams).ThenInclude(t => t.DeclarationForms).ThenInclude(f => f.Riders)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .Where(c => c.IsArchived).AsSplitQuery().ToListAsync();
        Assert.Equal(8, past.Count);
        Assert.DoesNotContain(past, c => c.Name.Contains("Demo", StringComparison.OrdinalIgnoreCase));
        Assert.True(past.Select(c => c.Icon).Distinct().Count() >= 4);
        Assert.True(past.Select(c => c.Location).Distinct().Count() == 8);
        // Spread over roughly the last eight months, none in the future.
        Assert.All(past, c => Assert.True(c.StartDate < Today && c.StartDate > Today.AddDays(-270)));

        foreach (var comp in past)
        {
            Assert.InRange(comp.Sections.Count, 2, 4);
            Assert.NotEmpty(comp.Teams);
            // Every team has a locked declaration form with riders and ponies.
            Assert.All(comp.Teams, t =>
            {
                var form = Assert.Single(t.DeclarationForms);
                Assert.True(form.IsLocked);
                Assert.True(form.Riders.Count >= 2);
                Assert.All(form.Riders, r => Assert.False(string.IsNullOrWhiteSpace(r.HorseName)));
                Assert.All(form.Riders, r => Assert.False(r.UseInitialOnly));
            });
            // Finished by the stats rule, and genuinely: every race scored, every entrant has a result.
            var races = comp.Sessions.SelectMany(s => s.Heats).SelectMany(h => h.Races).ToList();
            Assert.NotEmpty(races);
            Assert.All(races, r => Assert.True(r.IsComplete));
            Assert.All(comp.Sessions, s => Assert.Equal(SessionStatus.Finished, s.Status));
            foreach (var heat in comp.Sessions.SelectMany(s => s.Heats))
                foreach (var race in heat.Races)
                    Assert.Equal(heat.Entries.Select(e => e.TeamId).Order(), race.Results.Select(x => x.TeamId).Order());
        }

        var allResults = await db.Results.ToListAsync();
        Assert.Contains(allResults, r => r.Status == ResultStatus.Eliminated);
        Assert.Contains(allResults, r => r.Status is ResultStatus.DidNotStart or ResultStatus.DidNotFinish or ResultStatus.Retired);
        Assert.All(allResults.Where(r => r.Status != ResultStatus.Finished), r => Assert.True(r.Eliminated && r.Points == 0 && r.Placing is null));
        Assert.All(allResults.Where(r => r.Status == ResultStatus.Finished), r => Assert.True(r.Placing >= 1 && r.Points >= 1));
        Assert.Contains(await db.Heats.Select(h => h.Label).ToListAsync(), l => l == "A Final");
        Assert.Contains(await db.Heats.Select(h => h.Label).ToListAsync(), l => l == "B Final");
        Assert.Contains(await db.CompetitionSections.Select(s => s.Format).ToListAsync(), f => f == SectionFormat.Pairs);

        // Marked as sample data, so the review seeder and this one can find them.
        var upcoming = await db.Competitions.SingleAsync(c => !c.IsArchived);
        Assert.True(upcoming.StartDate > Today);
        Assert.Equal(9, await db.Set<EventCommerceSettings>().CountAsync(x => x.IsDemo));

        // Riders and ponies recur across events, so stats have something to add up.
        var perRider = await db.RiderEntries.GroupBy(r => r.FullName).Select(g => g.Count()).ToListAsync();
        Assert.True(perRider.Count(n => n >= 3) > 100);
        var perPony = await db.RiderEntries.GroupBy(r => r.HorseName).Select(g => g.Count()).ToListAsync();
        Assert.True(perPony.Count(n => n >= 3) > 100);

        // The fictional accounts can't be signed in to.
        var users = await db.Users.Where(u => u.Id.StartsWith("history-seed-")).ToListAsync();
        Assert.Equal(4, users.Count);
        Assert.All(users, u =>
        {
            Assert.Null(u.PasswordHash);
            Assert.EndsWith("@history-seed.invalid", u.Email);
            Assert.True(u.LockoutEnd > DateTimeOffset.UtcNow.AddYears(100));
        });
    }

    [Fact]
    public async Task TheSeasonHasPublishedStandingsAndTeamProfiles()
    {
        await using var db = await Database();
        await HistorySeeder.SeedAsync(db, Today);
        db.ChangeTracker.Clear();
        var season = await db.Set<Season>().Include(s => s.Rounds).ThenInclude(r => r.Publications).SingleAsync();
        Assert.Equal("Under 14", season.AgeGroup);
        Assert.Equal(SectionFormat.Teams, season.Format);
        Assert.Equal(4, season.Rounds.Count);
        Assert.All(season.Rounds, r => Assert.Single(r.Publications));

        var standings = await SeasonStandingsCalculator.CalculateAsync(db, season.Id, CancellationToken.None);
        Assert.NotNull(standings);
        Assert.True(standings!.Standings.Count >= 8);
        Assert.Equal(1, standings.Standings[0].Rank);
        Assert.True(standings.Standings[0].TotalPoints > 0);
        Assert.All(standings.Standings, s => Assert.True(s.Rounds.Count >= 1));
        Assert.Contains(standings.Standings, s => s.Rounds.Count == 4);
        // Placed teams of the first round are the ones in the profile list.
        Assert.Equal(12, await db.Set<TeamProfile>().CountAsync());
    }

    [Fact]
    public async Task ShopHasPostsAndEventListingsWithNoImages()
    {
        await using var db = await Database();
        var result = await HistorySeeder.SeedAsync(db, Today);
        db.ChangeTracker.Clear();
        Assert.InRange(result.ShopPosts + result.CatalogueItems, 15, 25);
        var posts = await db.ShopPosts.ToListAsync();
        Assert.All(posts, p => Assert.True(p.ImageBase64 is null && p.PriceMinor > 0 && !p.IsDeleted));
        var items = await db.Set<CatalogueItem>().ToListAsync();
        Assert.All(items, i => Assert.True(i.ImageUrl is null && i.PriceMinor > 0 && i.IsActive));
        var upcoming = await db.Competitions.SingleAsync(c => !c.IsArchived);
        var listings = await db.Set<CompetitionListing>().ToListAsync();
        Assert.Equal(items.Count, listings.Count);
        Assert.All(listings, l => Assert.True(l.CompetitionId == upcoming.Id && l.Status == CommerceListingStatus.Approved));
    }

    [Fact]
    public async Task RunningItTwiceGivesTheSameCounts()
    {
        await using var db = await Database();
        var first = await HistorySeeder.SeedAsync(db, Today);
        var before = await CountsAsync(db);
        var second = await HistorySeeder.SeedAsync(db, Today);
        var after = await CountsAsync(db);

        Assert.Equal(before, after);
        Assert.Equal(9, second.Removed);
        Assert.Equal(first with { Removed = 9 }, second);
    }

    [Fact]
    public async Task LeavesEverythingElseAlone()
    {
        await using var db = await Database();
        // A real organiser's event, club, listing, post and season, made before the seed runs.
        var realUser = new AppUser { Id = "real-user", UserName = "real@example.com", Email = "real@example.com", FullName = "Real Organiser" };
        db.Users.Add(realUser);
        var club = new Club { Name = "Real Pony Club" };
        var comp = new Competition { Name = "Real Spring Show", StartDate = Today.AddDays(5), CreatedByUserId = realUser.Id };
        var section = new CompetitionSection { Competition = comp, Format = SectionFormat.Teams, AgeGroup = "Under 14", DisplayName = "Under 14 Teams" };
        var team = new Team { Competition = comp, Section = section, Club = club, DisplayName = "Real U14" };
        db.Teams.Add(team);
        db.ShopPosts.Add(new ShopPost { AuthorUserId = realUser.Id, AuthorName = "Real", Title = "Real saddle", Body = "Real", PriceMinor = 100 });
        var item = new CatalogueItem { SellerUserId = realUser.Id, Title = "Real mug", Description = "Real", PriceMinor = 500, Category = CommerceItemCategory.Merchandise };
        db.Set<CatalogueItem>().Add(item);
        db.Set<CompetitionListing>().Add(new CompetitionListing { Competition = comp, CatalogueItem = item, SellerUserId = realUser.Id, Status = CommerceListingStatus.Approved });
        var season = new Season { OwnerUserId = realUser.Id, Title = "Real Series", Year = 2030, Format = SectionFormat.Teams, AgeGroup = "Under 14" };
        db.Set<Season>().Add(season);
        await db.SaveChangesAsync();
        var realCounts = new[]
        {
            await db.Competitions.CountAsync(c => c.Name == "Real Spring Show"), await db.Teams.CountAsync(t => t.DisplayName == "Real U14"),
            await db.Clubs.CountAsync(c => c.Name == "Real Pony Club"), await db.ShopPosts.CountAsync(p => p.AuthorUserId == "real-user"),
            await db.Set<CatalogueItem>().CountAsync(i => i.SellerUserId == "real-user"),
            await db.Set<CompetitionListing>().CountAsync(l => l.SellerUserId == "real-user"),
            await db.Set<Season>().CountAsync(s => s.OwnerUserId == "real-user"), await db.Users.CountAsync(u => u.Id == "real-user"),
        };

        await HistorySeeder.SeedAsync(db, Today);
        await HistorySeeder.SeedAsync(db, Today);
        db.ChangeTracker.Clear();
        Assert.Equal(realCounts, new[]
        {
            await db.Competitions.CountAsync(c => c.Name == "Real Spring Show"), await db.Teams.CountAsync(t => t.DisplayName == "Real U14"),
            await db.Clubs.CountAsync(c => c.Name == "Real Pony Club"), await db.ShopPosts.CountAsync(p => p.AuthorUserId == "real-user"),
            await db.Set<CatalogueItem>().CountAsync(i => i.SellerUserId == "real-user"),
            await db.Set<CompetitionListing>().CountAsync(l => l.SellerUserId == "real-user"),
            await db.Set<Season>().CountAsync(s => s.OwnerUserId == "real-user"), await db.Users.CountAsync(u => u.Id == "real-user"),
        });

        // Removing it all leaves exactly the real data, and the fictional accounts and clubs go with their data.
        Assert.Equal(9, await HistorySeeder.RemoveAsync(db));
        db.ChangeTracker.Clear();
        Assert.Equal(1, await db.Competitions.CountAsync());
        Assert.Equal(1, await db.Clubs.CountAsync());
        Assert.Equal(1, await db.ShopPosts.CountAsync());
        Assert.Equal(1, await db.Set<CatalogueItem>().CountAsync());
        Assert.Equal(1, await db.Set<Season>().CountAsync());
        Assert.Equal(0, await db.SavedRiders.CountAsync());
        Assert.Equal(0, await db.Set<TeamProfile>().CountAsync());
        Assert.Equal(0, await db.Set<EventCommerceSettings>().CountAsync());
    }

    [Fact]
    public async Task AnUnmarkedSameNamedEventStopsTheRunWithNothingChanged()
    {
        await using var db = await Database();
        await HistorySeeder.SeedAsync(db, Today);
        // Someone replaced one of the seeded events with their own: no demo mark.
        var id = await db.Competitions.Where(c => c.Name == "British Pairs Championships").Select(c => c.Id).SingleAsync();
        await db.Set<EventCommerceSettings>().Where(x => x.CompetitionId == id).ExecuteDeleteAsync();
        var before = await CountsAsync(db);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => HistorySeeder.SeedAsync(db, Today));
        Assert.Contains("British Pairs Championships", error.Message);
        Assert.Equal(before, await CountsAsync(db));
    }

    [Fact]
    public async Task ASeasonRoundFromAnotherEventStopsTheRemoval()
    {
        await using var db = await Database();
        await HistorySeeder.SeedAsync(db, Today);
        var season = await db.Set<Season>().SingleAsync();
        var comp = new Competition { Name = "Someone else's event", StartDate = Today };
        var section = new CompetitionSection { Competition = comp, Format = SectionFormat.Teams, AgeGroup = "Under 14", DisplayName = "Under 14 Teams" };
        db.Set<SeasonRound>().Add(new SeasonRound { SeasonId = season.Id, Competition = comp, CompetitionSection = section, OrderIndex = 9 });
        await db.SaveChangesAsync();
        var before = await CountsAsync(db);

        await Assert.ThrowsAsync<InvalidOperationException>(() => HistorySeeder.RemoveAsync(db));
        Assert.Equal(before, await CountsAsync(db));
    }

    [Fact]
    public async Task ReseedReviewStillWorksAfterTheHistorySeed()
    {
        await using var db = await Database();
        var now = Today.AddHours(13);
        await ReviewCompetitionSeeder.SeedAsync(db, Today, now);
        await HistorySeeder.SeedAsync(db, Today);
        db.ChangeTracker.Clear();
        var reviewNames = ReviewCompetitionSeeder.EventNames;
        var historyNames = await db.Competitions.Where(c => !reviewNames.Contains(c.Name)).Select(c => c.Name).OrderBy(n => n).ToListAsync();
        Assert.Equal(9, historyNames.Count);

        // The history events are in a season, but they aren't among the review names, so the guard isn't hit.
        var result = await ReviewCompetitionSeeder.ReseedAsync(db, now);
        Assert.Equal(8, result.Removed);
        Assert.Equal(8, result.Created);
        Assert.Empty(result.Skipped);
        db.ChangeTracker.Clear();
        Assert.Equal(historyNames, await db.Competitions.Where(c => !reviewNames.Contains(c.Name)).Select(c => c.Name).OrderBy(n => n).ToListAsync());
        Assert.Equal(1, await db.Set<Season>().CountAsync());
        Assert.Equal(4, await db.Set<SeasonRound>().CountAsync());
        Assert.Equal(17, await db.Competitions.CountAsync());
    }
}

/// <summary>The same data through the real host: the public endpoints a reviewer's pages read.</summary>
public class HistorySeedEndpointsTests : IClassFixture<ApiFactory>
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly HashSet<ApiFactory> Seeded = new();

    private readonly ApiFactory _f;
    public HistorySeedEndpointsTests(ApiFactory f) => _f = f;

    private async Task SeedOnceAsync()
    {
        await Gate.WaitAsync();
        try
        {
            if (Seeded.Contains(_f)) return;
            await _f.WithDbAsync(db => HistorySeeder.SeedAsync(db, DateTime.UtcNow));
            Seeded.Add(_f);
        }
        finally { Gate.Release(); }
    }

    [Fact]
    public async Task SeasonEndpointsShowTheSeriesAndStandings()
    {
        await SeedOnceAsync();
        var anon = _f.CreateClient();
        var seasons = await (await anon.GetAsync("/api/seasons")).ReadAsync<List<SeasonDto>>();
        var series = Assert.Single(seasons, s => s.Title.EndsWith("Autumn Series"));
        Assert.Equal(4, series.Rounds.Count);

        var detail = await (await anon.GetAsync($"/api/seasons/{series.Id}")).ReadAsync<SeasonDto>();
        Assert.Equal(series.Id, detail.Id);
        var standings = await (await anon.GetAsync($"/api/seasons/{series.Id}/standings")).ReadAsync<SeasonStandingsDto>();
        Assert.True(standings.Standings.Count >= 8);
        Assert.Equal(1, standings.Standings[0].Rank);

        var profiles = await (await anon.GetAsync("/api/team-profiles")).ReadAsync<List<TeamProfileDto>>();
        Assert.True(profiles.Count(p => p.DisplayName.EndsWith(" U14")) >= 12);
        var history = await anon.GetAsync($"/api/team-profiles/{standings.Standings[0].TeamProfileId}/history");
        history.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ShopPostsAndEventListingsHaveNoImages()
    {
        await SeedOnceAsync();
        var anon = _f.CreateClient();
        // Author ids are only returned to signed-in callers, so use an admin client to
        // pick out the seeded posts; image stripping is the same on every read path.
        var admin = await _f.AdminAsync();
        var posts = await (await admin.GetAsync("/api/shop/posts?take=200")).ReadAsync<List<ShopPostDto>>();
        var ours = posts.Where(p => p.AuthorUserId is not null && p.AuthorUserId.StartsWith("history-seed-")).ToList();
        Assert.Equal(15, ours.Count);
        Assert.All(ours, p => Assert.True(string.IsNullOrEmpty(p.ImageBase64) && p.PriceMinor > 0));

        var eventId = await _f.WithDbAsync(db => db.Competitions.Where(c => c.Name == "EGUK Winter Indoor Classic").Select(c => c.Id).SingleAsync());
        var listings = await (await anon.GetAsync($"/api/commerce/competitions/{eventId}/listings")).ReadAsync<List<PublicCompetitionListingDto>>();
        Assert.Equal(10, listings.Count);
        Assert.All(listings, l => Assert.True(string.IsNullOrEmpty(l.ImageUrl) && l.PriceMinor > 0));
        Assert.Contains(listings, l => l.Category == CommerceItemCategory.Camping);
        Assert.Contains(listings, l => l.Category == CommerceItemCategory.Merchandise);
    }

    /// <summary>
    /// The past events are finished by the stats rule: archived, over, every race scored. Whether the stats hub also
    /// counts events carrying the demo mark is another change's decision, so this test drops the mark first and
    /// checks the riders turn up in the public search on the finished rule alone. It passes either way.
    /// </summary>
    [Fact]
    public async Task PastEventsCountAsFinishedInTheStatsHub()
    {
        await SeedOnceAsync();
        var finished = await _f.WithDbAsync(async db =>
        {
            var past = await db.Competitions.Where(c => c.IsArchived && db.Set<EventCommerceSettings>().Any(x => x.CompetitionId == c.Id && x.IsDemo))
                .Select(c => new { c.Id, c.EndDate, Open = db.Races.Any(r => r.Heat!.Session!.CompetitionId == c.Id && !r.IsComplete) }).ToListAsync();
            await db.Set<EventCommerceSettings>().Where(x => past.Select(p => p.Id).Contains(x.CompetitionId)).ExecuteDeleteAsync();
            return past;
        });
        Assert.Equal(8, finished.Count);
        Assert.All(finished, c => Assert.True(c.EndDate < DateTime.UtcNow && !c.Open));

        var rider = await _f.WithDbAsync(db => db.RiderEntries
            .Where(r => r.DeclarationForm!.Team!.Competition!.IsArchived && !r.FullName.Contains("'"))
            .Select(r => r.FullName).FirstAsync());
        var surname = rider.Split(' ')[^1];
        var search = await (await _f.CreateClient().GetAsync($"/api/stats/search?q={Uri.EscapeDataString(surname)}")).ReadAsync<StatsSearchDto>();
        Assert.NotEmpty(search.Riders);
        Assert.All(search.Riders, h => Assert.Contains(surname, h.Name, StringComparison.OrdinalIgnoreCase));
        Assert.True(search.Riders.Sum(h => h.Competitions) >= 1);
        var clubs = await (await _f.CreateClient().GetAsync("/api/stats/search?q=Central%20Warwickshire")).ReadAsync<StatsSearchDto>();
        Assert.NotEmpty(clubs.Clubs);
        Assert.NotEmpty(clubs.Teams);
    }
}
