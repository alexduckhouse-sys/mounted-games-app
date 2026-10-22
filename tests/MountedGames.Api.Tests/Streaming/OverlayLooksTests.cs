using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Streaming;

/// <summary>Saved overlay looks reused across events (<c>/api/overlay-looks</c>).</summary>
public class OverlayLooksTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public OverlayLooksTests(ApiFactory f) => _f = f;

    private const string Url = "/api/overlay-looks";
    private static object Body(string name = "EGUK Champs", object? look = null) => new { name, look = look ?? new { accent = "#1E3466" } };

    [Fact]
    public async Task OnlyOrganisersMayUseLooks()
    {
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync(Url, Body())).StatusCode);
    }

    [Fact]
    public async Task TrainersKeepTheirOwnLooks_AndAdminsSeeEveryone()
    {
        var (trainer, _) = await _f.ApprovedTrainerAsync();
        var (other, _) = await _f.ApprovedTrainerAsync();
        var created = await (await trainer.PostAsJsonAsync(Url, Body("  Pony Club Spring  "))).ReadAsync<OverlayLookDto>();
        Assert.Equal(("Pony Club Spring", true, "#1E3466"), (created.Name, created.Mine, created.Look.GetProperty("accent").GetString()));

        Assert.Contains((await trainer.GetFromJsonAsync<List<OverlayLookDto>>(Url))!, l => l.Id == created.Id);
        Assert.DoesNotContain((await other.GetFromJsonAsync<List<OverlayLookDto>>(Url))!, l => l.Id == created.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"{Url}/{created.Id}", Body("Taken"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"{Url}/{created.Id}")).StatusCode);

        var admin = await _f.AdminAsync();
        var seen = (await admin.GetFromJsonAsync<List<OverlayLookDto>>(Url))!.Single(l => l.Id == created.Id);
        Assert.False(seen.Mine);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"{Url}/{created.Id}", Body("Club look"))).StatusCode);
    }

    [Fact]
    public async Task UpdatesAndDeletesALook()
    {
        var (trainer, _) = await _f.ApprovedTrainerAsync();
        var created = await (await trainer.PostAsJsonAsync(Url, Body())).ReadAsync<OverlayLookDto>();

        var updated = await (await trainer.PutAsJsonAsync($"{Url}/{created.Id}", Body("Renamed", new { accent = "#FF0000", size = "large" }))).ReadAsync<OverlayLookDto>();
        Assert.Equal(("Renamed", "large"), (updated.Name, updated.Look.GetProperty("size").GetString()));
        Assert.True(updated.UpdatedAt >= created.UpdatedAt);

        Assert.Equal(HttpStatusCode.NoContent, (await trainer.DeleteAsync($"{Url}/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await trainer.DeleteAsync($"{Url}/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await trainer.PutAsJsonAsync($"{Url}/{created.Id}", Body())).StatusCode);
    }

    [Fact]
    public async Task RejectsBadLooks()
    {
        var (trainer, _) = await _f.ApprovedTrainerAsync();
        async Task<HttpStatusCode> Post(object body) => (await trainer.PostAsJsonAsync(Url, body)).StatusCode;

        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(name: "")));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(name: "   ")));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(name: new string('x', 61))));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(new { name = "List", look = new[] { 1 } }));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(look: new { logoUrl = new string('x', 4000) })));
        var created = await (await trainer.PostAsJsonAsync(Url, Body())).ReadAsync<OverlayLookDto>();
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync($"{Url}/{created.Id}", new { name = "x", look = 3 })).StatusCode);
    }

    [Fact]
    public async Task CapsHowManyLooksOnePersonKeeps()
    {
        var (trainer, auth) = await _f.ApprovedTrainerAsync();
        await _f.WithDbAsync(async db =>
        {
            db.OverlayLooks.AddRange(Enumerable.Range(1, 50).Select(i => new OverlayLook { OwnerUserId = auth.User.Id, Name = $"Look {i}" }));
            await db.SaveChangesAsync();
        });

        var r = await trainer.PostAsJsonAsync(Url, Body());

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsTheLooksTable()
    {
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE OverlayLooks;");

        await DbInitializer.SeedAsync(_f.Services);
        db.OverlayLooks.Add(new OverlayLook { OwnerUserId = "someone", Name = "Back" });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        Assert.Equal("{}", (await db.OverlayLooks.SingleAsync(l => l.Name == "Back")).LookJson);
    }
}
