using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.RaceTemplates;

public class RaceTemplatesEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public RaceTemplatesEndpointsTests(ApiFactory f) => _f = f;

    private static string Unique(string prefix) => $"{prefix} {Guid.NewGuid():N}";

    private Task<int> SeedTemplateAsync(string name, bool builtIn = false)
        => _f.WithDbAsync(async db =>
        {
            var t = new RaceTemplate { Name = name, IsBuiltIn = builtIn };
            db.RaceTemplates.Add(t);
            await db.SaveChangesAsync();
            return t.Id;
        });

    [Fact]
    public async Task List_IsPublic_AndSortedByName()
    {
        var b = await SeedTemplateAsync(Unique("zz-b"));
        var a = await SeedTemplateAsync(Unique("zz-a"));

        var r = await _f.CreateClient().GetAsync("/api/race-templates");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var rows = await r.ReadAsync<List<RaceTemplateDto>>();
        Assert.Contains(rows, x => x.Name == "Two Flag" && x.IsBuiltIn);
        Assert.Equal(rows.Select(x => x.Name).OrderBy(n => n, StringComparer.Ordinal), rows.Select(x => x.Name));
        Assert.True(rows.FindIndex(x => x.Id == a) < rows.FindIndex(x => x.Id == b));
    }

    [Theory]
    [InlineData("One Mug Race (Junior)")]
    [InlineData("Two Bean Bag Race (Junior)")]
    [InlineData("Three Mug and Table (Pairs)")]
    [InlineData("Spell PONY (Juniors)")]
    [InlineData("Ball & Racquet (Old Version)")]
    [InlineData("Four Ball Cone (2002)")]
    public async Task List_IncludesThe2026PonyClubRaces(string name)
    {
        var r = await _f.CreateClient().GetAsync("/api/race-templates");

        var rows = await r.ReadAsync<List<RaceTemplateDto>>();
        var template = Assert.Single(rows, x => x.Name == name);
        Assert.True(template.IsBuiltIn);
        Assert.False(string.IsNullOrWhiteSpace(template.Summary));
        Assert.False(string.IsNullOrWhiteSpace(template.Rules));
        using var diagram = System.Text.Json.JsonDocument.Parse(template.DiagramJson ?? "");
        Assert.Equal(System.Text.Json.JsonValueKind.Array, diagram.RootElement.ValueKind);
    }

    [Fact]
    public async Task Get_Returns404_WhenMissing()
    {
        var r = await _f.CreateClient().GetAsync("/api/race-templates/999999");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Get_ReturnsTemplate()
    {
        var name = Unique("get");
        var id = await SeedTemplateAsync(name);
        var dto = await (await _f.CreateClient().GetAsync($"/api/race-templates/{id}")).ReadAsync<RaceTemplateDto>();
        Assert.Equal(name, dto.Name);
    }

    [Fact]
    public async Task Create_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/race-templates", new { name = "x" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns403_ForTrainer()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PostAsJsonAsync("/api/race-templates", new { name = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns400_WhenNameBlank()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/race-templates", new { name = "  " });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns409_WhenNameExists()
    {
        var name = Unique("dup");
        await SeedTemplateAsync(name);
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/race-templates", new { name });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    [Fact]
    public async Task Create_StoresTrimmedFields_AsNonBuiltIn()
    {
        var admin = await _f.AdminAsync();
        var name = Unique("new");

        var r = await admin.PostAsJsonAsync("/api/race-templates", new
        {
            name = $" {name} ", summary = " sum ", rules = " rules ", category = " cat ", diagramJson = " [] ",
        });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<RaceTemplateDto>();
        Assert.Equal(name, dto.Name);
        Assert.Equal("sum", dto.Summary);
        Assert.Equal("rules", dto.Rules);
        Assert.Equal("cat", dto.Category);
        Assert.Equal("[]", dto.DiagramJson);
        Assert.False(dto.IsBuiltIn);
    }

    [Fact]
    public async Task Create_LeavesOptionalFieldsNull_WhenOmitted()
    {
        var admin = await _f.AdminAsync();
        var dto = await (await admin.PostAsJsonAsync("/api/race-templates",
            new { name = Unique("bare"), diagramJson = "   " })).ReadAsync<RaceTemplateDto>();
        Assert.Null(dto.Summary);
        Assert.Null(dto.Rules);
        Assert.Null(dto.Category);
        Assert.Null(dto.DiagramJson);
    }

    [Fact]
    public async Task Update_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PutAsJsonAsync("/api/race-templates/1", new { name = "x" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns403_ForTrainer()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PutAsJsonAsync("/api/race-templates/1", new { name = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns404_WhenMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync("/api/race-templates/999999", new { name = "x" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns400_WhenNameBlank()
    {
        var id = await SeedTemplateAsync(Unique("upd"));
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync($"/api/race-templates/{id}", new { name = " " });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns409_WhenAnotherTemplateHasTheName()
    {
        var taken = Unique("taken");
        await SeedTemplateAsync(taken);
        var id = await SeedTemplateAsync(Unique("mine"));
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync($"/api/race-templates/{id}", new { name = taken });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    [Fact]
    public async Task Update_AppliesFields_AndAllowsKeepingOwnName()
    {
        var name = Unique("keep");
        var id = await SeedTemplateAsync(name);
        var admin = await _f.AdminAsync();

        var r = await admin.PutAsJsonAsync($"/api/race-templates/{id}", new
        {
            name, summary = " s ", rules = " r ", category = " c ", diagramJson = " [{\"t\":\"pole\"}] ",
        });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<RaceTemplateDto>();
        Assert.Equal("s", dto.Summary);
        Assert.Equal("r", dto.Rules);
        Assert.Equal("c", dto.Category);
        Assert.Equal("[{\"t\":\"pole\"}]", dto.DiagramJson);
        var stored = await _f.WithDbAsync(db => db.RaceTemplates.AsNoTracking().SingleAsync(t => t.Id == id));
        Assert.Equal("s", stored.Summary);
    }

    [Fact]
    public async Task Update_RenamesAndClearsBlankDiagram()
    {
        var id = await SeedTemplateAsync(Unique("old"));
        await _f.WithDbAsync(async db =>
        {
            (await db.RaceTemplates.SingleAsync(t => t.Id == id)).DiagramJson = "[]";
            await db.SaveChangesAsync();
        });
        var newName = Unique("renamed");
        var admin = await _f.AdminAsync();

        var dto = await (await admin.PutAsJsonAsync($"/api/race-templates/{id}", new { name = newName, diagramJson = "" }))
            .ReadAsync<RaceTemplateDto>();

        Assert.Equal(newName, dto.Name);
        Assert.Null(dto.DiagramJson);
    }

    [Fact]
    public async Task Delete_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().DeleteAsync("/api/race-templates/1");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Delete_Returns403_ForTrainer()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.DeleteAsync("/api/race-templates/1");
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Delete_Returns404_WhenMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.DeleteAsync("/api/race-templates/999999");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Delete_Returns400_ForBuiltInTemplate()
    {
        var id = await SeedTemplateAsync(Unique("builtin"), builtIn: true);
        var admin = await _f.AdminAsync();

        var r = await admin.DeleteAsync($"/api/race-templates/{id}");

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.True(await _f.WithDbAsync(db => db.RaceTemplates.AnyAsync(t => t.Id == id)));
    }

    [Fact]
    public async Task Delete_RemovesCustomTemplate()
    {
        var id = await SeedTemplateAsync(Unique("custom"));
        var admin = await _f.AdminAsync();

        var r = await admin.DeleteAsync($"/api/race-templates/{id}");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.RaceTemplates.AnyAsync(t => t.Id == id)));
    }
}
