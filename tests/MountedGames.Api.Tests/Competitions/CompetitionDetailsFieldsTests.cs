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

/// <summary>Postcode, competition number and contact email: stored on create and update, and returned on the detail.</summary>
public class CompetitionDetailsFieldsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CompetitionDetailsFieldsTests(ApiFactory f) => _f = f;

    private static readonly DateTime Start = new(2031, 6, 1, 9, 0, 0, DateTimeKind.Utc);

    private static object Create(string? postcode = null, string? number = null, string? email = null) => new
    {
        name = $"Fields {Guid.NewGuid():N}", startDate = Start, postcode, competitionNumber = number, contactEmail = email,
    };

    private static Dictionary<string, object?> Update(string? postcode = null, string? number = null, string? email = null) => new()
    {
        ["name"] = "Fields updated", ["startDate"] = Start, ["isActive"] = true, ["isArchived"] = false,
        ["postcode"] = postcode, ["competitionNumber"] = number, ["contactEmail"] = email,
    };

    private async Task<int> CreateAsync(HttpClient admin, object body)
    {
        var response = await admin.PostAsJsonAsync("/api/competitions", body);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadAsync<CompetitionSummary>()).Id;
    }

    private Task<Competition> LoadAsync(int id) => _f.InDbAsync(db => db.Competitions.AsNoTracking().SingleAsync(c => c.Id == id));

    [Fact]
    public async Task Create_StoresTheThreeFields_TidiedUp_AndTheDetailReturnsThem()
    {
        var admin = await _f.AdminAsync();
        var id = await CreateAsync(admin, Create(postcode: "  gl19 3be ", number: "  2026-041 ", email: "  Entries@Example.ORG "));

        var stored = await LoadAsync(id);
        Assert.Equal(("GL19 3BE", "2026-041", "entries@example.org"), (stored.Postcode, stored.CompetitionNumber, stored.ContactEmail));

        var detail = await (await _f.CreateClient().GetAsync($"/api/competitions/{id}")).ReadAsync<CompetitionDetail>();
        Assert.Equal(("GL19 3BE", "2026-041", "entries@example.org"), (detail!.Postcode, detail.CompetitionNumber, detail.ContactEmail));
        var first = await (await _f.CreateClient().GetAsync($"/api/competitions/{id}/first-view")).ReadAsync<CompetitionDetail>();
        Assert.Equal("GL19 3BE", first!.Postcode);
    }

    [Fact]
    public async Task Create_StoresNullForBlankValues()
    {
        var admin = await _f.AdminAsync();
        var id = await CreateAsync(admin, Create(postcode: "   ", number: "", email: " "));

        var stored = await LoadAsync(id);
        Assert.Null(stored.Postcode);
        Assert.Null(stored.CompetitionNumber);
        Assert.Null(stored.ContactEmail);
    }

    [Fact]
    public async Task Update_ChangesClearsAndLeavesAlone()
    {
        var admin = await _f.AdminAsync();
        var id = await CreateAsync(admin, Create(postcode: "SW1A 1AA", number: "A1", email: "a@example.org"));

        // Null leaves all three as they are: older clients never send them.
        (await admin.PutAsJsonAsync($"/api/competitions/{id}", Update())).EnsureSuccessStatusCode();
        var untouched = await LoadAsync(id);
        Assert.Equal(("SW1A 1AA", "A1", "a@example.org"), (untouched.Postcode, untouched.CompetitionNumber, untouched.ContactEmail));

        (await admin.PutAsJsonAsync($"/api/competitions/{id}", Update(postcode: " ec1a 1bb", number: " B2 ", email: "B@Example.org"))).EnsureSuccessStatusCode();
        var changed = await LoadAsync(id);
        Assert.Equal(("EC1A 1BB", "B2", "b@example.org"), (changed.Postcode, changed.CompetitionNumber, changed.ContactEmail));

        // A blank value clears.
        (await admin.PutAsJsonAsync($"/api/competitions/{id}", Update(postcode: " ", number: "", email: ""))).EnsureSuccessStatusCode();
        var cleared = await LoadAsync(id);
        Assert.Null(cleared.Postcode);
        Assert.Null(cleared.CompetitionNumber);
        Assert.Null(cleared.ContactEmail);
    }

    [Theory]
    [InlineData("not an email")]
    [InlineData("a@b")]
    [InlineData("Jo <jo@example.org>")]
    public async Task ContactEmail_MustLookLikeAnAddress_OnCreateAndUpdate(string email)
    {
        var admin = await _f.AdminAsync();
        var created = await admin.PostAsJsonAsync("/api/competitions", Create(email: email));
        Assert.Equal(HttpStatusCode.BadRequest, created.StatusCode);
        Assert.Contains("contact email", await created.Content.ReadAsStringAsync());

        var id = await CreateAsync(admin, Create(email: "ok@example.org"));
        var updated = await admin.PutAsJsonAsync($"/api/competitions/{id}", Update(email: email));
        Assert.Equal(HttpStatusCode.BadRequest, updated.StatusCode);
        Assert.Equal("ok@example.org", (await LoadAsync(id)).ContactEmail);
    }

    [Fact]
    public async Task TooLongValues_AreRefused()
    {
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/competitions", Create(postcode: new string('A', 13)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/competitions", Create(number: new string('1', 41)))).StatusCode);
        var id = await CreateAsync(admin, Create());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/competitions/{id}", Update(postcode: new string('A', 13)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/competitions/{id}", Update(number: new string('1', 41)))).StatusCode);
    }

    [Fact]
    public async Task AnExistingSqliteDatabaseGainsTheColumns_WithoutLosingData()
    {
        var id = await _f.SeedCompetitionAsync();
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var name = await db.Competitions.AsNoTracking().Where(c => c.Id == id).Select(c => c.Name).SingleAsync();
        foreach (var column in new[] { "Postcode", "CompetitionNumber", "ContactEmail" })
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE Competitions DROP COLUMN {column};");

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services); // safe to run again

        db.ChangeTracker.Clear();
        var c = await db.Competitions.SingleAsync(x => x.Id == id);
        Assert.Equal(name, c.Name);
        c.Postcode = "AB1 2CD";
        c.CompetitionNumber = "N1";
        c.ContactEmail = "x@example.org";
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Equal("AB1 2CD", (await db.Competitions.SingleAsync(x => x.Id == id)).Postcode);
    }
}
