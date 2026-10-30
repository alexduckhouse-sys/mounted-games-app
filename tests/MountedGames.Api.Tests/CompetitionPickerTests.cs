using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests;

public class CompetitionPickerTests
{
    private static readonly DateTime Today = new(2030, 6, 1, 0, 0, 0, DateTimeKind.Utc);

    private static async Task<AppDbContext> Database()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=:memory:").Options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        return db;
    }

    [Fact]
    public async Task PickerSeparatesPastEventsAndRetainsOngoingMultiDayEvents()
    {
        await using var db = await Database();
        db.Competitions.AddRange(
            new Competition { Name = "Future", StartDate = Today.AddDays(2) },
            new Competition { Name = "Today", StartDate = Today },
            new Competition { Name = "Ongoing", StartDate = Today.AddDays(-2), EndDate = Today.AddDays(1) },
            new Competition { Name = "Yesterday", StartDate = Today.AddDays(-1) },
            new Competition { Name = "Archived", StartDate = Today.AddDays(4), IsArchived = true });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var current = await CompetitionPickerQuery.LoadAsync(db, false, 1, 24, Today);
        var past = await CompetitionPickerQuery.LoadAsync(db, true, 1, 24, Today);

        Assert.Equal(new[] { "Ongoing", "Today", "Future" }, current.Items.Select(c => c.Name));
        Assert.Equal(new[] { "Archived", "Yesterday" }, past.Items.Select(c => c.Name));
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task PickerPagesDoNotOverlapAndExposeOnlyCardFields()
    {
        await using var db = await Database();
        db.Competitions.AddRange(Enumerable.Range(1, 5).Select(i => new Competition
        {
            Name = $"Fake event {i}", StartDate = Today, Icon = "ie",
            Description = "Must not be included in the picker response",
        }));
        await db.SaveChangesAsync();
        var first = await CompetitionPickerQuery.LoadAsync(db, false, 1, 2, Today);
        var second = await CompetitionPickerQuery.LoadAsync(db, false, 2, 2, Today);
        var last = await CompetitionPickerQuery.LoadAsync(db, false, 3, 2, Today);
        Assert.True(first.HasMore);
        Assert.True(second.HasMore);
        Assert.False(last.HasMore);
        Assert.Equal(5, first.Items.Concat(second.Items).Concat(last.Items).Select(c => c.Id).Distinct().Count());
        var json = JsonSerializer.SerializeToElement(first.Items[0], new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal(new[] { "ageGroupCount", "endDate", "entriesOpen", "icon", "id", "isDemo", "live", "location", "name", "shortName", "startDate" }, json.EnumerateObject().Select(p => p.Name).Order());
    }

    [Fact]
    public async Task ArchiveFiltersAndFacetsCoverEventsBeyondTheFirstPage()
    {
        await using var db = await Database();
        db.Competitions.AddRange(Enumerable.Range(1, 30).Select(i => new Competition { Name = $"Recent {i}", StartDate = Today.AddDays(-i), Location = "Example North" }));
        db.Competitions.Add(new Competition { Name = "Older target", StartDate = Today.AddYears(-2), Location = "  Example South  " });
        await db.SaveChangesAsync();
        var first = await CompetitionPickerQuery.LoadAsync(db, true, 1, 24, Today);
        Assert.DoesNotContain(first.Items, c => c.Name == "Older target");
        Assert.Contains(2028, first.Years!);
        Assert.Contains("Example South", first.Locations!);
        var filtered = await CompetitionPickerQuery.LoadAsync(db, true, 1, 24, Today, year: 2028, location: "Example South", search: "TARGET");
        Assert.Equal("Older target", Assert.Single(filtered.Items).Name);
        Assert.False(filtered.HasMore);
        Assert.Empty((await CompetitionPickerQuery.LoadAsync(db, true, 1, 24, Today, year: 2029)).Items);
    }

    [Fact]
    public async Task MineIncludesClubMembersAndOwnEntriesButNotCancelledEntriesOrNameMatches()
    {
        await using var db = await Database();
        var club = new Club { Name = "Example club" };
        var user = new AppUser { Id = "example-member", UserName = "example-member", Club = club, FullName = "Example Rider" };
        var other = new AppUser { Id = "example-other", UserName = "example-other", FullName = user.FullName };
        db.Users.AddRange(user, other);
        var clubEvent = new Competition { Name = "Club event", StartDate = Today.AddDays(-1) };
        var clubSection = new CompetitionSection { Competition = clubEvent, DisplayName = "Seniors", AgeGroup = "Senior" };
        db.Teams.Add(new Team { Competition = clubEvent, Section = clubSection, Club = club, DisplayName = "Example team" });
        foreach (var (name, owner, status) in new[] {
            ("Rode here", user, SignupPaymentStatus.Paid), ("Pending entry", user, SignupPaymentStatus.Pending),
            ("Cancelled", user, SignupPaymentStatus.Cancelled), ("Refunded", user, SignupPaymentStatus.Refunded),
            ("Same name only", other, SignupPaymentStatus.Paid) })
        {
            var comp = new Competition { Name = name, StartDate = Today.AddDays(-2) };
            db.SectionSignups.Add(new SectionSignup { User = owner, FullName = "Example Rider", Status = status,
                Section = new CompetitionSection { Competition = comp, DisplayName = "Seniors", AgeGroup = "Senior" } });
        }
        await db.SaveChangesAsync();
        var mine = await CompetitionPickerQuery.LoadAsync(db, true, 1, 24, Today, userId: user.Id);
        Assert.Equal(new[] { "Club event", "Pending entry", "Rode here" }, mine.Items.Select(c => c.Name).Order());
        Assert.Equal("Same name only", Assert.Single((await CompetitionPickerQuery.LoadAsync(db, true, 1, 24, Today, userId: other.Id)).Items).Name);
        Assert.Empty((await CompetitionPickerQuery.LoadAsync(db, true, 1, 24, Today, userId: "missing")).Items);
    }

    private static Session RaceSession(SessionStatus status, int order, string? arena, CompetitionSection? section, params Heat[] heats) => new()
    {
        Name = $"Session {order}", Status = status, OrderIndex = order, ArenaName = arena, Section = section, Heats = heats,
    };

    private static Heat HeatOf(int order, string? label, bool finished = false, params bool[] raceComplete) => new()
    {
        Label = label, OrderIndex = order, FinishedAt = finished ? Today : null,
        Races = raceComplete.Select((done, i) => new Race { Name = $"R{i}", OrderIndex = i, IsComplete = done }).ToList(),
    };

    private static async Task<CompetitionPickerItem> Single(AppDbContext db, bool past = false)
    {
        db.ChangeTracker.Clear();
        return Assert.Single((await CompetitionPickerQuery.LoadAsync(db, past, 1, 24, Today)).Items);
    }

    [Fact]
    public async Task PickerSaysWhichEventsAreTakingEntries()
    {
        await using var db = await Database();
        var section = () => new CompetitionSection { AgeGroup = "U12", DisplayName = "Under 12", Format = SectionFormat.Teams };
        db.Competitions.AddRange(
            new Competition { Name = "Open", StartDate = Today.AddDays(3), Sections = { section() } },
            new Competition { Name = "Locked", StartDate = Today.AddDays(4), SignupsLocked = true, Sections = { section() } },
            new Competition { Name = "No age groups", StartDate = Today.AddDays(5) });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var items = (await CompetitionPickerQuery.LoadAsync(db, false, 1, 24, Today)).Items.ToDictionary(c => c.Name);
        Assert.True(items["Open"].EntriesOpen);
        Assert.False(items["Locked"].EntriesOpen);
        Assert.False(items["No age groups"].EntriesOpen);
    }

    [Fact]
    public async Task PastEventsNeverShowEntriesOpen()
    {
        await using var db = await Database();
        db.Competitions.Add(new Competition
        {
            Name = "Finished", StartDate = Today.AddDays(-5),
            Sections = { new CompetitionSection { AgeGroup = "U12", DisplayName = "Under 12", Format = SectionFormat.Teams } },
        });
        await db.SaveChangesAsync();
        Assert.False((await Single(db, past: true)).EntriesOpen);
    }

    [Fact]
    public async Task PickerReturnsLocationAndAgeGroupCount()
    {
        await using var db = await Database();
        db.Competitions.Add(new Competition
        {
            Name = "Venue event", StartDate = Today.AddDays(3), Location = "Hickstead",
            Sections =
            {
                new CompetitionSection { AgeGroup = "U12", DisplayName = "Under 12", Format = SectionFormat.Teams },
                new CompetitionSection { AgeGroup = "U16", DisplayName = "Under 16", Format = SectionFormat.Teams },
            },
        });
        await db.SaveChangesAsync();
        var item = await Single(db);
        Assert.Equal("Hickstead", item.Location);
        Assert.Equal(2, item.AgeGroupCount);
        Assert.Null(item.Live);
    }

    [Fact]
    public async Task PickerReportsTheRunningHeatSkippingFinishedOnes()
    {
        await using var db = await Database();
        var section = new CompetitionSection { AgeGroup = "Sen", DisplayName = "Senior Teams", Format = SectionFormat.Teams };
        db.Competitions.Add(new Competition
        {
            Name = "Live", StartDate = Today, Sections = { section },
            Sessions =
            {
                RaceSession(SessionStatus.Finished, 0, "Old arena", section, HeatOf(0, "Done")),
                RaceSession(SessionStatus.InArena, 1, "  Main arena ", section,
                    HeatOf(0, "Heat A", finished: true), HeatOf(1, "  ", false, true, true), HeatOf(2, "Final", false, true, false), HeatOf(3, "Later")),
                RaceSession(SessionStatus.InArena, 2, "Other", null, HeatOf(0, "Never reached")),
            },
        });
        await db.SaveChangesAsync();
        var live = (await Single(db)).Live;
        Assert.NotNull(live);
        Assert.Equal("Senior Teams", live.SectionName);
        Assert.Equal("Final", live.HeatLabel);
        Assert.Equal("Main arena", live.ArenaName);
    }

    [Fact]
    public async Task PickerFallsBackToPositionalHeatLabel()
    {
        await using var db = await Database();
        db.Competitions.Add(new Competition
        {
            Name = "Live", StartDate = Today,
            Sessions = { RaceSession(SessionStatus.InArena, 0, " ", null, HeatOf(0, "One", true), HeatOf(1, null)) },
        });
        await db.SaveChangesAsync();
        var live = (await Single(db)).Live;
        Assert.NotNull(live);
        Assert.Equal("Heat 2", live.HeatLabel);
        Assert.Null(live.SectionName);
        Assert.Null(live.ArenaName);
    }

    [Fact]
    public async Task PickerLiveIsNullWhenNotRunningToday()
    {
        await using var db = await Database();
        var running = () => new[] { RaceSession(SessionStatus.InArena, 0, "Arena", null, HeatOf(0, "Heat 1")) };
        db.Competitions.AddRange(
            new Competition { Name = "Future", StartDate = Today.AddDays(2), Sessions = running() },
            new Competition { Name = "NoneRunning", StartDate = Today, Sessions = { RaceSession(SessionStatus.Upcoming, 0, "Arena", null, HeatOf(0, "Heat 1")) } },
            new Competition { Name = "Past", StartDate = Today.AddDays(-3), EndDate = Today.AddDays(-1), Sessions = running() },
            new Competition { Name = "Ongoing", StartDate = Today.AddDays(-1), EndDate = Today.AddDays(1), Sessions = running() });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var current = (await CompetitionPickerQuery.LoadAsync(db, false, 1, 24, Today)).Items.ToDictionary(c => c.Name);
        Assert.Null(current["Future"].Live);
        Assert.Null(current["NoneRunning"].Live);
        Assert.NotNull(current["Ongoing"].Live);

        var past = (await CompetitionPickerQuery.LoadAsync(db, true, 1, 24, Today)).Items;
        Assert.Equal(new[] { "Past" }, past.Select(c => c.Name));
        Assert.All(past, c => Assert.Null(c.Live));
    }

    [Fact]
    public async Task PickerLiveIgnoresRunningBreaksAndBriefings()
    {
        await using var db = await Database();
        var breakSession = RaceSession(SessionStatus.InArena, 0, "Arena", null, HeatOf(0, "Break heat"));
        breakSession.Kind = SessionKind.Break;
        breakSession.IsBreak = true;
        var briefing = RaceSession(SessionStatus.InArena, 1, "Arena", null, HeatOf(0, "Briefing heat"));
        briefing.Kind = SessionKind.Briefing;
        db.Competitions.Add(new Competition { Name = "Lunch", StartDate = Today, Sessions = { breakSession, briefing } });
        await db.SaveChangesAsync();
        Assert.Null((await Single(db)).Live);
    }

    [Fact]
    public async Task SeedCreatesEightSeparateGraphsAndCanBeRepeatedWithoutDuplicates()
    {
        await using var db = await Database();
        Assert.Equal(8, await ReviewCompetitionSeeder.SeedAsync(db, Today));
        Assert.Equal(0, await ReviewCompetitionSeeder.SeedAsync(db, Today));
        Assert.Equal(8, await db.Competitions.CountAsync());
        Assert.Equal(6, (await CompetitionPickerQuery.LoadAsync(db, false, 1, 24, Today)).Items.Count);
        Assert.Equal(2, (await CompetitionPickerQuery.LoadAsync(db, true, 1, 24, Today)).Items.Count);
        var competitions = await db.Competitions.Include(c => c.Sections).Include(c => c.Teams)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .ToListAsync();
        Assert.All(competitions, competition =>
        {
            Assert.InRange(competition.Sections.Count, 3, 6); // large age groups split into A/B
            Assert.All(competition.Sections, section =>
                Assert.InRange(competition.Teams.Count(team => team.CompetitionSectionId == section.Id), 3, 16));
            // A heats session for each age group, and a finals session for each that has a final.
            Assert.Equal(competition.Sections.Sum(x => x.HasFinal ? 2 : 1), competition.Sessions.Count);
            Assert.All(competition.Sessions.SelectMany(s => s.Heats), heat =>
            {
                // A final is drawn only once its heats are scored, so an upcoming event's final has no teams yet.
                Assert.InRange(heat.Entries.Count, heat.Label == "A Final" ? 0 : 1, 6);
                Assert.InRange(heat.Races.Count, 6, 10);
            });
            Assert.All(competition.Sessions.SelectMany(s => s.Heats).SelectMany(h => h.Entries), entry =>
                Assert.Equal(competition.Id, entry.Team!.CompetitionId));
            Assert.All(competition.Sessions.SelectMany(s => s.Heats).SelectMany(h => h.Races).SelectMany(r => r.Results), result =>
                Assert.Contains(result.TeamId, competition.Teams.Select(t => t.Id)));
        });
        Assert.True(await db.Results.AnyAsync());
        Assert.Empty(await db.Users.ToListAsync());
    }

    [Theory]
    [InlineData("flag", true)]
    [InlineData("gb", true)]
    [InlineData("gb-sct", true)]
    [InlineData("za", true)]
    [InlineData("af", true)]
    [InlineData("jp", true)]
    [InlineData("xk", true)]
    [InlineData("zw", true)]
    [InlineData("zz", false)]
    [InlineData("GB", false)]
    [InlineData(null, true)]
    [InlineData("xx", false)]
    [InlineData("../x", false)]
    [InlineData("gb-sct\n", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("unrecognised", false)]
    public void IconValidationAllowsOnlySupportedChoices(string? icon, bool valid)
    {
        var request = new CreateCompetitionRequest("Fake event", null, null, null, null, null, null, Today, null, Icon: icon);
        var parameter = typeof(CreateCompetitionRequest).GetConstructors()[0].GetParameters().Single(p => p.Name == "Icon");
        Assert.Equal(valid, Validator.TryValidateValue(icon, new ValidationContext(request), [], parameter.GetCustomAttributes<ValidationAttribute>()));
    }

    [Fact]
    public async Task ReviewSeedPreservesExistingEvents()
    {
        await using var db = await Database();
        var existing = new Competition { Name = "Existing fake event", Description = "Keep this content", StartDate = Today.AddDays(100) };
        db.Competitions.Add(existing);
        await db.SaveChangesAsync();
        var id = existing.Id;
        await ReviewCompetitionSeeder.SeedAsync(db, Today);
        var unchanged = await db.Competitions.FindAsync(id);
        Assert.Equal("Keep this content", unchanged!.Description);
        Assert.Equal(Today.AddDays(100), unchanged.StartDate);
        Assert.Equal(9, await db.Competitions.CountAsync());
    }
}
