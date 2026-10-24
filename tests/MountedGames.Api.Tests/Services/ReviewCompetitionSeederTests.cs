using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Services;

public class ReviewCompetitionSeederTests
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
    public async Task SeedAsync_CreatesSingleSectionPerAgeGroup_WithMultipleHeatsWhenLarge()
    {
        await using var db = await Database();
        var created = await ReviewCompetitionSeeder.SeedAsync(db, Today, Today.AddHours(10));
        Assert.Equal(8, created);

        var competitions = await db.Competitions
            .Include(c => c.Sections)
            .Include(c => c.Teams)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries)
            .ToListAsync();

        Assert.All(competitions, comp =>
        {
            Assert.Equal(3, comp.Sections.Count);
            Assert.Equal(
                new[] { "Juniors", "Novices", "Seniors" },
                comp.Sections.Select(s => s.DisplayName).OrderBy(n => n).ToArray()
            );
            // Never two "Seniors" sections in the same competition.
            Assert.Single(comp.Sections, s => s.AgeGroup == "Seniors");

            foreach (var section in comp.Sections)
            {
                var teamCount = comp.Teams.Count(t => t.CompetitionSectionId == section.Id);
                if (teamCount >= 12)
                {
                    var heatsSession = comp.Sessions.Single(s => s.CompetitionSectionId == section.Id && s.Name.EndsWith("heats"));
                    Assert.True(heatsSession.Heats.Count >= 2);
                }
            }
        });
    }

    [Fact]
    public async Task SeedAsync_ReplacesExistingDemoCompetition_WhenItHadDuplicateSplitSections()
    {
        await using var db = await Database();
        var comp = new Competition { Name = "Demo Meadow Cup", StartDate = Today, EndDate = Today.AddHours(8) };
        comp.Sections.Add(new CompetitionSection { Competition = comp, Format = SectionFormat.Teams, AgeGroup = "Seniors", DisplayName = "Seniors teams A" });
        comp.Sections.Add(new CompetitionSection { Competition = comp, Format = SectionFormat.Teams, AgeGroup = "Seniors", DisplayName = "Seniors teams B" });
        db.Competitions.Add(comp);
        db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { Competition = comp, IsDemo = true });
        await db.SaveChangesAsync();

        await ReviewCompetitionSeeder.SeedAsync(db, Today, Today.AddHours(10));
        db.ChangeTracker.Clear();

        var meadow = await db.Competitions.Include(c => c.Sections).SingleAsync(c => c.Name == "Demo Meadow Cup");
        Assert.Equal(3, meadow.Sections.Count);
        Assert.Single(meadow.Sections, s => s.AgeGroup == "Seniors");
        Assert.Equal("Seniors", meadow.Sections.Single(s => s.AgeGroup == "Seniors").DisplayName);
    }

    [Theory]
    [InlineData(SectionFormat.Teams, "Seniors", "Seniors teams A", "Seniors A")]
    [InlineData(SectionFormat.Teams, "Seniors", "Seniors B", "Seniors B")]
    [InlineData(SectionFormat.Teams, "Seniors", "Senior Teams", "Seniors")]
    [InlineData(SectionFormat.Teams, "Seniors", "Seniors teams", "Seniors")]
    [InlineData(SectionFormat.Pairs, "Juniors", "Junior Pairs A", "Junior Pairs A")]
    public void SectionNamingOf_PreservesDivisionSuffix_AndNormalisesBaseName(
        SectionFormat format, string ageGroup, string storedDisplayName, string expected)
    {
        var section = new CompetitionSection
        {
            Format = format,
            AgeGroup = ageGroup,
            DisplayName = storedDisplayName,
        };
        Assert.Equal(expected, SectionNaming.Of(section));
    }
}
