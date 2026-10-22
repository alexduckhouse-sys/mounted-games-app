using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Streaming;

/// <summary>Overlay settings for a competition's live video (<c>/api/competitions/{id}/overlays</c>).</summary>
public class StreamOverlaysTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public StreamOverlaysTests(ApiFactory f) => _f = f;

    private static string Url(int competitionId) => $"/api/competitions/{competitionId}/overlays";

    private static object Request(string? banner = "Lunch break until 1pm", int? expected = null, object? look = null,
        int bannerStyle = 1, int stripMode = 0, string[]? arenas = null, int delay = 4, int seconds = 10) => new
    {
        bannerText = banner, bannerStyle, bannerArenas = arenas ?? ["Arena 1"], stripMode, scoreCardMode = 0,
        scoreCardDelaySeconds = delay, scoreCardSeconds = seconds, look = look ?? new { accent = "#F5B82E", viewerCount = true },
        expectedRevision = expected,
    };

    /// <summary>A competition owned by a freshly approved trainer, with that trainer's client.</summary>
    private async Task<(int CompetitionId, HttpClient Owner)> OwnedCompetitionAsync()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync();
        await _f.WithDbAsync(async db =>
        {
            var comp = await db.Competitions.FindAsync(arena.CompetitionId);
            comp!.CreatedByUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });
        return (arena.CompetitionId, owner);
    }

    [Fact]
    public async Task Get_ReturnsDefaults_BeforeAnythingIsSaved()
    {
        var arena = await _f.CreateArenaAsync();

        var r = await _f.CreateClient().GetAsync(Url(arena.CompetitionId));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var d = await r.ReadAsync<StreamOverlayDto>();
        Assert.Equal((null, OverlayBannerStyle.Ticker, 0, OverlayMode.Auto, 4, 10, 0, null),
            (d.BannerText, d.BannerStyle, d.BannerArenas.Count, d.StripMode, d.ScoreCardDelaySeconds, d.ScoreCardSeconds, d.Revision, d.UpdatedAt));
        Assert.Equal(JsonValueKind.Object, d.Look.ValueKind);
        Assert.Empty(d.Look.EnumerateObject());
    }

    [Fact]
    public async Task Get_Returns404_ForAMissingCompetition()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync(Url(999_999))).StatusCode);
    }

    [Fact]
    public async Task Get_IsCacheableWithAnEtag()
    {
        var arena = await _f.CreateArenaAsync();

        var r = await _f.CreateClient().GetAsync(Url(arena.CompetitionId));

        Assert.Equal((true, "no-cache, private"), (r.Headers.ETag!.IsWeak, r.Headers.CacheControl!.ToString()));
    }

    [Fact]
    public async Task Update_OnlyBroadcastersMayChangeOverlays()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var (other, _) = await _f.ApprovedTrainerAsync();
        var (member, _) = await _f.SignupAsync("Member");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PutAsJsonAsync(Url(comp), Request())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PutAsJsonAsync(Url(comp), Request())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync(Url(comp), Request())).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.PutAsJsonAsync(Url(comp), Request())).StatusCode);
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync(Url(comp), Request(expected: 1))).StatusCode);
    }

    [Fact]
    public async Task Update_SavesEverything_AndViewersReadItBack()
    {
        var (comp, owner) = await OwnedCompetitionAsync();

        var saved = await (await owner.PutAsJsonAsync(Url(comp),
            Request(banner: "  Prize giving at 4.30pm  ", bannerStyle: 2, stripMode: 2, arenas: [" Arena 1 ", "Arena 1", "", "Arena 2"], delay: 6, seconds: 12))).ReadAsync<StreamOverlayDto>();
        var read = await (await _f.CreateClient().GetAsync(Url(comp))).ReadAsync<StreamOverlayDto>();

        foreach (var d in new[] { saved, read })
        {
            Assert.Equal(("Prize giving at 4.30pm", OverlayBannerStyle.Alert, OverlayMode.Off, 6, 12, 1),
                (d.BannerText, d.BannerStyle, d.StripMode, d.ScoreCardDelaySeconds, d.ScoreCardSeconds, d.Revision));
            Assert.Equal(new[] { "Arena 1", "Arena 2" }, d.BannerArenas);
            Assert.Equal("#F5B82E", d.Look.GetProperty("accent").GetString());
            Assert.NotNull(d.UpdatedAt);
        }
    }

    [Fact]
    public async Task Update_ClearsABlankBanner_AndDefaultsAMissingLook()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var body = new { bannerText = "   ", bannerStyle = 0, stripMode = 1, scoreCardMode = 2, scoreCardDelaySeconds = 0, scoreCardSeconds = 3 };

        var d = await (await owner.PutAsJsonAsync(Url(comp), body)).ReadAsync<StreamOverlayDto>();

        Assert.Equal((null, 0, OverlayMode.On, OverlayMode.Off), (d.BannerText, d.BannerArenas.Count, d.StripMode, d.ScoreCardMode));
        Assert.Empty(d.Look.EnumerateObject());
    }

    [Fact]
    public async Task Update_RefusesAStaleRevision_AndReturnsTheCurrentSettings()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        await owner.PutAsJsonAsync(Url(comp), Request(banner: "First"));

        var r = await owner.PutAsJsonAsync(Url(comp), Request(banner: "Second", expected: 0));

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        var current = await r.ReadAsync<StreamOverlayDto>();
        Assert.Equal(("First", 1), (current.BannerText, current.Revision));
    }

    [Theory]
    [InlineData("bannerStyle")]
    [InlineData("stripMode")]
    [InlineData("scoreCardMode")]
    public async Task Update_RejectsUnknownOptions(string field)
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var body = new Dictionary<string, object?>
        {
            ["bannerText"] = "x", ["bannerStyle"] = 0, ["stripMode"] = 0, ["scoreCardMode"] = 0,
            ["scoreCardDelaySeconds"] = 4, ["scoreCardSeconds"] = 10,
        };
        body[field] = 9;

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(Url(comp), body)).StatusCode);
    }

    [Fact]
    public async Task Update_RejectsBadInput()
    {
        var (comp, owner) = await OwnedCompetitionAsync();

        async Task<HttpStatusCode> Put(object body) => (await owner.PutAsJsonAsync(Url(comp), body)).StatusCode;

        Assert.Equal(HttpStatusCode.BadRequest, await Put(Request(banner: new string('x', 141))));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Request(look: new[] { 1, 2 })));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Request(look: new { logo = new string('x', 4000) })));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Request(arenas: Enumerable.Range(1, 13).Select(i => $"Arena {i}").ToArray())));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Request(arenas: [new string('a', 81)])));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Request(delay: 31)));
        Assert.Equal(HttpStatusCode.BadRequest, await Put(Request(seconds: 2)));
    }

    [Fact]
    public async Task Update_TellsEveryViewerOfTheCompetition()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        await using var viewer = new HubConnectionBuilder()
            .WithUrl(new Uri(_f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _f.Server.CreateHandler();
                o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
        var received = new TaskCompletionSource<StreamOverlayDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        viewer.On<StreamOverlayDto>("overlayUpdated", received.SetResult);
        await viewer.StartAsync();
        await viewer.InvokeAsync("JoinCompetition", comp);

        await owner.PutAsJsonAsync(Url(comp), Request(banner: "Arena 2 is closed"));

        var update = await received.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(("Arena 2 is closed", 1), (update.BannerText, update.Revision));
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsTheOverlayTable()
    {
        var arena = await _f.CreateArenaAsync();
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE StreamOverlays;");

        await DbInitializer.SeedAsync(_f.Services);
        db.StreamOverlays.Add(new StreamOverlay { CompetitionId = arena.CompetitionId, BannerText = "Back on", Revision = 1 });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var saved = await db.StreamOverlays.SingleAsync(o => o.CompetitionId == arena.CompetitionId);
        Assert.Equal(("Back on", "[]", "{}", 4, 10), (saved.BannerText, saved.BannerArenas, saved.LookJson, saved.ScoreCardDelaySeconds, saved.ScoreCardSeconds));
    }
}
