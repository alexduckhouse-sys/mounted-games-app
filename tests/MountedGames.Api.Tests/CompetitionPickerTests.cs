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
        Assert.Equal(new[] { "endDate", "icon", "id", "name", "startDate" }, json.EnumerateObject().Select(p => p.Name).Order());
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
            Assert.Equal(3, competition.Sections.Count);
            Assert.Equal(12, competition.Teams.Count);
            Assert.Equal(6, competition.Sessions.Count);
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
    [InlineData(null, true)]
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
