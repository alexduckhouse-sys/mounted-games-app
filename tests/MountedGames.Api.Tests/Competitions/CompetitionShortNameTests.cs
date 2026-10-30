using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

/// <summary>The optional short name: stored tidied, cleared by a blank value, limited to 40 characters, and carried to the events list.</summary>
public class CompetitionShortNameTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CompetitionShortNameTests(ApiFactory f) => _f = f;

    private static readonly DateTime Start = new(2031, 7, 1, 9, 0, 0, DateTimeKind.Utc);

    private static object Create(string? shortName, string? name = null) => new
    {
        name = name ?? $"Midlands Area Mounted Games Pairs and Individuals Championship {Guid.NewGuid():N}", startDate = Start, shortName,
    };

    private static Dictionary<string, object?> Update(string? shortName) => new()
    {
        ["name"] = "Official name stays", ["startDate"] = Start, ["isActive"] = true, ["isArchived"] = false, ["shortName"] = shortName,
    };

    private async Task<CompetitionSummary> CreateAsync(HttpClient admin, object body)
    {
        var response = await admin.PostAsJsonAsync("/api/competitions", body);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<CompetitionSummary>();
    }

    private Task<string?> StoredAsync(int id) => _f.InDbAsync(db => db.Competitions.AsNoTracking().Where(c => c.Id == id).Select(c => c.ShortName).SingleAsync());

    [Fact]
    public async Task Create_StoresTheShortNameTrimmed_AndReturnsItOnTheSummaryDetailAndPicker()
    {
        var admin = await _f.AdminAsync();
        var name = $"Midlands Area Mounted Games Pairs and Individuals Championship {Guid.NewGuid():N}";
        var created = await CreateAsync(admin, Create("  Midlands Pairs  ", name));

        Assert.Equal("Midlands Pairs", created.ShortName);
        Assert.Equal("Midlands Pairs", await StoredAsync(created.Id));

        var detail = await (await _f.CreateClient().GetAsync($"/api/competitions/{created.Id}")).ReadAsync<CompetitionDetail>();
        Assert.Equal("Midlands Pairs", detail!.ShortName);
        Assert.StartsWith("Midlands Area Mounted Games", detail.Name);

        var picker = await (await _f.CreateClient().GetAsync($"/api/competitions/picker?pageSize=50&search={name}")).ReadAsync<CompetitionPickerPage>();
        var item = Assert.Single(picker.Items, i => i.Id == created.Id);
        Assert.Equal("Midlands Pairs", item.ShortName);
        Assert.Equal(detail.Name, item.Name);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_StoresNullForABlankShortName(string? blank)
    {
        var admin = await _f.AdminAsync();
        var created = await CreateAsync(admin, Create(blank));
        Assert.Null(created.ShortName);
        Assert.Null(await StoredAsync(created.Id));
    }

    [Fact]
    public async Task Update_ChangesClearsAndLeavesAlone()
    {
        var admin = await _f.AdminAsync();
        var id = (await CreateAsync(admin, Create("First"))).Id;

        // Null leaves it as it is: older clients never send the field.
        (await admin.PutAsJsonAsync($"/api/competitions/{id}", Update(null))).EnsureSuccessStatusCode();
        Assert.Equal("First", await StoredAsync(id));

        var changed = await admin.PutAsJsonAsync($"/api/competitions/{id}", Update("  Second "));
        changed.EnsureSuccessStatusCode();
        Assert.Equal("Second", (await changed.ReadAsync<CompetitionSummary>()).ShortName);
        Assert.Equal("Second", await StoredAsync(id));

        // A blank value clears it.
        (await admin.PutAsJsonAsync($"/api/competitions/{id}", Update("  "))).EnsureSuccessStatusCode();
        Assert.Null(await StoredAsync(id));
    }

    [Fact]
    public async Task TheLimitIsFortyCharacters_OnCreateAndUpdate()
    {
        var admin = await _f.AdminAsync();
        var forty = new string('A', 40);
        var created = await CreateAsync(admin, Create(forty));
        Assert.Equal(forty, created.ShortName);

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/competitions", Create(new string('A', 41)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/competitions/{created.Id}", Update(new string('B', 41)))).StatusCode);
        Assert.Equal(forty, await StoredAsync(created.Id));
    }

    [Fact]
    public async Task AnExistingSqliteDatabaseGainsTheColumn_WithoutLosingData()
    {
        var id = await _f.SeedCompetitionAsync();
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var name = await db.Competitions.AsNoTracking().Where(c => c.Id == id).Select(c => c.Name).SingleAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE Competitions DROP COLUMN ShortName;");

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services); // safe to run again

        db.ChangeTracker.Clear();
        var c = await db.Competitions.SingleAsync(x => x.Id == id);
        Assert.Equal(name, c.Name);
        Assert.Null(c.ShortName);
        c.ShortName = "Back again";
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Equal("Back again", (await db.Competitions.SingleAsync(x => x.Id == id)).ShortName);
    }
}
