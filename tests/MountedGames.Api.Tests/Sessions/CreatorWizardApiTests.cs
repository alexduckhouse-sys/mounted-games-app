using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sessions;

/// <summary>What the competition creator needs: structure on a session before any heat exists, and the naming rule.</summary>
public class CreatorWizardApiTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CreatorWizardApiTests(ApiFactory f) => _f = f;

    private static string Url(Arena a, string suffix = "") => $"/api/competitions/{a.CompetitionId}/sessions{suffix}";

    private static CreateSessionRequest Planned(int sectionId, params string[] races)
        => new(sectionId, "Open Teams", "Main arena", null, 1, null, false, 90, SessionKind.Race, null,
            LanesPerHeat: 6, MinutesPerHeat: 8, PlannedRaces: races);

    [Fact]
    public async Task Create_KeepsHeatSizeMinutesAndThePlannedRaces()
    {
        var a = await _f.CreateArenaAsync(0);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a), Planned(a.SectionId, " Bending ", "", "Bottle"))).ReadAsync<SessionDto>();

        Assert.Equal(6, s.LanesPerHeat);
        Assert.Equal(8, s.MinutesPerHeat);
        Assert.Equal(new[] { "Bending", "Bottle" }, s.PlannedRaces);
        Assert.Empty(s.Heats);
    }

    [Fact]
    public async Task Create_WithNoRaces_LeavesThemNotChosen()
    {
        var a = await _f.CreateArenaAsync(0);
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync(Url(a), Planned(a.SectionId))).ReadAsync<SessionDto>();

        Assert.Null(s.PlannedRaces);
    }

    [Fact]
    public async Task Create_IgnoresPlannedRaces_OnABreak()
    {
        var a = await _f.CreateArenaAsync(0);
        var admin = await _f.AdminAsync();
        var req = new CreateSessionRequest(null, "Lunch", null, null, 2, null, true, 30, SessionKind.Break, null, PlannedRaces: ["x"]);

        var s = await (await admin.PostAsJsonAsync(Url(a), req)).ReadAsync<SessionDto>();

        Assert.Null(s.PlannedRaces);
    }

    [Fact]
    public async Task Update_ChangesStructureAndTheEstimate_WhileNothingIsScored()
    {
        var a = await _f.CreateArenaAsync(0);
        var admin = await _f.AdminAsync();
        var s = await (await admin.PostAsJsonAsync(Url(a), Planned(a.SectionId, "Bending"))).ReadAsync<SessionDto>();

        var r = await admin.PutAsJsonAsync(Url(a, $"/{s.Id}"), new UpdateSessionRequest(
            LanesPerHeat: 4, MinutesPerHeat: 5, DurationMinutes: 45, PlannedRaces: ["Bottle", "Litter"]));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var updated = await r.ReadAsync<SessionDto>();
        Assert.Equal(4, updated.LanesPerHeat);
        Assert.Equal(5, updated.MinutesPerHeat);
        Assert.Equal(45, updated.DurationMinutes);
        Assert.Equal(new[] { "Bottle", "Litter" }, updated.PlannedRaces);

        var cleared = await (await admin.PutAsJsonAsync(Url(a, $"/{s.Id}"), new UpdateSessionRequest(PlannedRaces: []))).ReadAsync<SessionDto>();
        Assert.Null(cleared.PlannedRaces);
    }

    [Fact]
    public async Task Update_RefusesStructureChanges_OnceARaceIsScored_ButStillAllowsRenamingAndMinutes()
    {
        var a = await _f.CreateArenaAsync(2);
        var admin = await _f.AdminAsync();
        var (_, raceIds) = await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        await _f.InDbAsync(async db =>
        {
            var race = await db.Races.FirstAsync(x => x.Id == raceIds[0]);
            race.IsComplete = true;
            await db.SaveChangesAsync();
        });

        var lanes = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}"), new UpdateSessionRequest(LanesPerHeat: 3));
        var races = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}"), new UpdateSessionRequest(PlannedRaces: ["New"]));
        var fine = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}"), new UpdateSessionRequest("Renamed", MinutesPerHeat: 9));

        Assert.Equal(HttpStatusCode.Conflict, lanes.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, races.StatusCode);
        Assert.Equal(HttpStatusCode.OK, fine.StatusCode);
        Assert.Equal(9, (await fine.ReadAsync<SessionDto>()).MinutesPerHeat);
    }

    [Fact]
    public async Task Update_AllowsRepeatingTheSameStructure_OnAScoredSession()
    {
        var a = await _f.CreateArenaAsync(2);
        var admin = await _f.AdminAsync();
        await _f.InDbAsync(async db =>
        {
            var s = await db.Sessions.FirstAsync(x => x.Id == a.SessionId);
            s.Status = SessionStatus.InArena;
            s.LanesPerHeat = 4;
            s.PlannedRaces = PlannedRaceList.Write(["Bending"]);
            await db.SaveChangesAsync();
        });

        var r = await admin.PutAsJsonAsync(Url(a, $"/{a.SessionId}"), new UpdateSessionRequest(LanesPerHeat: 4, PlannedRaces: ["Bending"]));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Delete_RefusesASessionThatHasStartedOrBeenScored_AndRemovesAPlannedOne()
    {
        var a = await _f.CreateArenaAsync(2);
        var admin = await _f.AdminAsync();
        await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        await _f.InDbAsync(async db =>
        {
            var s = await db.Sessions.FirstAsync(x => x.Id == a.SessionId);
            s.Status = SessionStatus.Finished;
            await db.SaveChangesAsync();
        });
        var planned = await (await admin.PostAsJsonAsync(Url(a), Planned(a.SectionId, "Bending"))).ReadAsync<SessionDto>();

        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync(Url(a, $"/{a.SessionId}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync(Url(a, $"/{planned.Id}"))).StatusCode);
    }

    [Fact]
    public async Task TheCompetitionList_CountsSessionsThatHaveHeatsSeparately()
    {
        var a = await _f.CreateArenaAsync(2);
        var admin = await _f.AdminAsync();
        await admin.PostAsJsonAsync(Url(a), Planned(a.SectionId, "Bending"));
        await _f.AddHeatAsync(a.SessionId, a.TeamIds);

        var row = (await (await admin.GetAsync("/api/competitions")).ReadAsync<List<CompetitionSummary>>()).Single(c => c.Id == a.CompetitionId);

        Assert.Equal(2, row.SessionCount);
        Assert.Equal(1, row.HeatedSessionCount);
    }

    [Fact]
    public async Task AddSection_NamesItByTheRule_AndIgnoresTheClientsName()
    {
        var a = await _f.CreateArenaAsync(0);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/sections",
            new CreateSectionRequest(SectionFormat.Individual, "Juniors", "Individual Juniors"));

        Assert.Equal("Junior Individuals", (await r.ReadAsync<CompetitionSectionDto>()).DisplayName);
    }

    [Fact]
    public async Task SavingASection_BringsAnOldNameInLine()
    {
        var a = await _f.CreateArenaAsync(0);
        var admin = await _f.AdminAsync();
        await _f.InDbAsync(async db =>
        {
            var s = await db.CompetitionSections.FirstAsync(x => x.Id == a.SectionId);
            s.AgeGroup = "Seniors";
            s.DisplayName = "Seniors";
            await db.SaveChangesAsync();
        });

        var r = await admin.PutAsJsonAsync($"/api/competitions/{a.CompetitionId}/sections/{a.SectionId}", new UpdateSectionRequest(null));

        Assert.Equal("Senior Teams", (await r.ReadAsync<CompetitionSectionDto>()).DisplayName);
    }

    [Fact]
    public async Task StartingUp_RenamesOlderSections_AndLeavesOthersAlone()
    {
        var a = await _f.CreateArenaAsync(0);
        await _f.InDbAsync(async db =>
        {
            db.CompetitionSections.Add(new CompetitionSection { CompetitionId = a.CompetitionId, Format = SectionFormat.Pairs, AgeGroup = "Novices", DisplayName = "Pairs Novices" });
            db.CompetitionSections.Add(new CompetitionSection { CompetitionId = a.CompetitionId, Format = 0, AgeGroup = "", DisplayName = "Odd one" });
            await db.SaveChangesAsync();
        });

        using (var scope = _f.Services.CreateScope())
        {
            await DbInitializer.NormaliseSectionNamesAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>());
            await DbInitializer.NormaliseSectionNamesAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>());
        }

        var names = await _f.WithDbAsync(db => db.CompetitionSections.Where(s => s.CompetitionId == a.CompetitionId).Select(s => s.DisplayName).ToListAsync());
        Assert.Contains("Novice Pairs", names);
        Assert.Contains("Odd one", names);
    }

    [Fact]
    public async Task AnExistingSqliteDatabaseGainsPlannedRaces_WithoutLosingData()
    {
        var a = await _f.CreateArenaAsync(2);
        await _f.AddHeatAsync(a.SessionId, a.TeamIds);
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var before = await db.Sessions.AsNoTracking().Where(s => s.Id == a.SessionId).Select(s => s.Name).SingleAsync();

        await db.Database.ExecuteSqlRawAsync("ALTER TABLE Sessions DROP COLUMN PlannedRaces;");
        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services);

        db.ChangeTracker.Clear();
        var session = await db.Sessions.FirstAsync(s => s.Id == a.SessionId);
        session.PlannedRaces = PlannedRaceList.Write(["Bending"]);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        var after = await db.Sessions.AsNoTracking().SingleAsync(s => s.Id == a.SessionId);
        Assert.Equal(before, after.Name);
        Assert.Equal(new[] { "Bending" }, PlannedRaceList.Read(after.PlannedRaces));
        Assert.Equal(1, await db.Heats.CountAsync(h => h.SessionId == a.SessionId));
    }
}

public class SectionNamingTests
{
    [Theory]
    [InlineData(SectionFormat.Individual, "Juniors", "Junior Individuals")]
    [InlineData(SectionFormat.Pairs, "Novices", "Novice Pairs")]
    [InlineData(SectionFormat.Teams, "Open", "Open Teams")]
    [InlineData(SectionFormat.Teams, "Seniors", "Senior Teams")]
    [InlineData(SectionFormat.Teams, "Under 12", "Under 12 Teams")]
    [InlineData(SectionFormat.Teams, "Mixed Beginners", "Mixed Beginner Teams")]
    [InlineData(SectionFormat.Teams, "Senior Teams", "Senior Teams")]
    [InlineData(SectionFormat.Pairs, "Pairs", "Pairs")]
    [InlineData(SectionFormat.Individual, "  ", "Individuals")]
    [InlineData(SectionFormat.Teams, "Class", "Class Teams")]
    public void DisplayName_PutsTheAgeGroupFirstAndTheFormatInThePlural(SectionFormat format, string age, string expected)
        => Assert.Equal(expected, SectionNaming.DisplayName(format, age));

    [Fact]
    public void Of_KeepsTheSavedName_WhenTheFormatOrAgeGroupIsUnknown()
    {
        Assert.Equal("Odd one", SectionNaming.Of(new CompetitionSection { Format = 0, AgeGroup = "Juniors", DisplayName = "Odd one" }));
        Assert.Equal("Saved", SectionNaming.Of(new CompetitionSection { Format = SectionFormat.Teams, AgeGroup = " ", DisplayName = "Saved" }));
        Assert.Equal(string.Empty, SectionNaming.Of(null));
        Assert.Equal("Junior Pairs", SectionNaming.Of(new CompetitionSection { Format = SectionFormat.Pairs, AgeGroup = "Juniors", DisplayName = "x" }));
    }

    [Fact]
    public void PlannedRaceList_ReadsOnlyValidJson_AndCapsTheList()
    {
        Assert.Null(PlannedRaceList.Read(null));
        Assert.Null(PlannedRaceList.Read("not json"));
        Assert.Equal(PlannedRaceList.MaxRaces, PlannedRaceList.Read(PlannedRaceList.Write(Enumerable.Range(0, 60).Select(i => $"R{i}")))!.Count);
        Assert.Null(PlannedRaceList.Write(null));
        Assert.Equal(120, PlannedRaceList.Read(PlannedRaceList.Write([new string('x', 200)]))![0].Length);
    }
}
