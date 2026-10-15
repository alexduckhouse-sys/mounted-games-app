using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests;

public class SectionFinalistCountTests
{
    private static async Task<AppDbContext> Database()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=:memory:").Options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        return db;
    }

    private static bool IsValid(Type request, int? value)
    {
        var parameter = request.GetConstructors()[0].GetParameters().Single(p => p.Name == "FinalistCount");
        return Validator.TryValidateValue(value, new ValidationContext(new object()) { MemberName = "FinalistCount" }, [],
            parameter.GetCustomAttributes<ValidationAttribute>());
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData(1, true)]
    [InlineData(6, true)]
    [InlineData(50, true)]
    [InlineData(0, false)]
    [InlineData(-3, false)]
    [InlineData(51, false)]
    public void FinalistCountMustBeBetweenOneAndFifty(int? value, bool valid)
    {
        Assert.Equal(valid, IsValid(typeof(CreateSectionRequest), value));
        Assert.Equal(valid, IsValid(typeof(UpdateSectionRequest), value));
    }

    [Fact]
    public void MappingCopiesFinalistCount()
    {
        var section = new CompetitionSection { Id = 4, CompetitionId = 2, AgeGroup = "Seniors", DisplayName = "Seniors", FinalistCount = 6 };
        Assert.Equal(6, section.ToDto().FinalistCount);
        section.FinalistCount = null;
        Assert.Null(section.ToDto().FinalistCount);
    }

    [Fact]
    public void ExistingCallersCanOmitFinalistCount()
    {
        Assert.Null(new CreateSectionRequest(SectionFormat.Teams, "Seniors", null).FinalistCount);
        Assert.Null(new UpdateSectionRequest(null).FinalistCount);
    }

    [Fact]
    public async Task FinalistCountRoundTripsAndCanBeCleared()
    {
        await using var db = await Database();
        var comp = new Competition { Name = "Fake event", StartDate = new DateTime(2030, 6, 1, 0, 0, 0, DateTimeKind.Utc) };
        comp.Sections.Add(new CompetitionSection { AgeGroup = "Seniors", DisplayName = "Seniors", FinalistCount = 6 });
        comp.Sections.Add(new CompetitionSection { AgeGroup = "Juniors", DisplayName = "Juniors" });
        db.Competitions.Add(comp);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var sections = await db.CompetitionSections.OrderBy(s => s.AgeGroup).ToListAsync();
        Assert.Null(sections[0].FinalistCount);
        Assert.Equal(6, sections[1].FinalistCount);

        sections[1].FinalistCount = null;
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.All(await db.CompetitionSections.ToListAsync(), s => Assert.Null(s.FinalistCount));
    }
}
