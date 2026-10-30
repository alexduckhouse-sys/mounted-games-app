using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sponsors;

/// <summary>A competition's sponsors: the public list, logos, organiser management and "shown" counts.</summary>
public class SponsorsEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public SponsorsEndpointsTests(ApiFactory f) => _f = f;

    private static string Url(int competitionId, string tail = "") => $"/api/competitions/{competitionId}/sponsors{tail}";

    internal static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
    internal static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46];
    internal static readonly byte[] Webp = [.. "RIFF"u8, 4, 0, 0, 0, .. "WEBP"u8, 0, 0];

    private static object Body(string name = "Acme Feeds", string? link = "https://acme.example/horses", int tier = 1, int showOn = 63,
        bool enabled = true, DateTime? starts = null, DateTime? ends = null) =>
        new { name, linkUrl = link, tier, showOn, isEnabled = enabled, startsAt = starts, endsAt = ends };

    private async Task<(int Comp, HttpClient Owner)> OwnedCompetitionAsync()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var comp = await _f.SeedCompetitionAsync(ownerUserId: auth.User.Id);
        return (comp, owner);
    }

    private static async Task<SponsorAdminDto> AddAsync(HttpClient owner, int comp, object? body = null)
    {
        var response = await owner.PostAsJsonAsync(Url(comp), body ?? Body());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<SponsorAdminDto>();
    }

    private static Task<HttpResponseMessage> PutLogoAsync(HttpClient client, int comp, int sponsor, byte[] bytes, string contentType = "image/png")
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return client.PutAsync(Url(comp, $"/{sponsor}/logo"), content);
    }

    // ---- access ----

    [Fact]
    public async Task Management_IsForTheCompetitionsStaffOnly()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        var (other, _) = await _f.ApprovedTrainerAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var anon = _f.CreateClient();

        var calls = new (HttpMethod Method, string Path, HttpContent? Body)[]
        {
            (HttpMethod.Get, Url(comp, "/manage"), null),
            (HttpMethod.Post, Url(comp), JsonContent.Create(Body())),
            (HttpMethod.Put, Url(comp, $"/{sponsor.Id}"), JsonContent.Create(Body())),
            (HttpMethod.Delete, Url(comp, $"/{sponsor.Id}"), null),
            (HttpMethod.Put, Url(comp, "/order"), JsonContent.Create(new { ids = new[] { sponsor.Id } })),
            (HttpMethod.Put, Url(comp, $"/{sponsor.Id}/logo"), new ByteArrayContent(Png) { Headers = { ContentType = new("image/png") } }),
            (HttpMethod.Delete, Url(comp, $"/{sponsor.Id}/logo"), null),
            (HttpMethod.Post, Url(comp, "/skip"), null),
        };
        foreach (var (method, path, body) in calls)
        {
            async Task<HttpStatusCode> Send(HttpClient client)
            {
                using var request = new HttpRequestMessage(method, path) { Content = body is null ? null : CloneOf(body) };
                using var response = await client.SendAsync(request);
                return response.StatusCode;
            }
            Assert.Equal(HttpStatusCode.Unauthorized, await Send(anon));
            Assert.Equal(HttpStatusCode.Forbidden, await Send(member));
            Assert.Equal(HttpStatusCode.NotFound, await Send(other));
        }
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync(Url(comp, "/manage"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).GetAsync(Url(comp, "/manage"))).StatusCode);
    }

    private static HttpContent CloneOf(HttpContent content)
    {
        var bytes = content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
        var copy = new ByteArrayContent(bytes);
        foreach (var header in content.Headers) copy.Headers.TryAddWithoutValidation(header.Key, header.Value);
        return copy;
    }

    [Fact]
    public async Task ACompetitionAdminOnTheTeamCanManageSponsors()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var (helper, helperAuth) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await helper.GetAsync(Url(comp, "/manage"))).StatusCode);
        var added = await owner.PostAsJsonAsync($"/api/competitions/{comp}/team", new { email = helperAuth.User.Email });
        Assert.True(added.IsSuccessStatusCode, await added.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, (await helper.GetAsync(Url(comp, "/manage"))).StatusCode);
    }

    [Fact]
    public async Task SponsorsOfAnotherCompetitionAreNotReachable()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var (otherComp, otherOwner) = await OwnedCompetitionAsync();
        var theirs = await AddAsync(otherOwner, otherComp);

        Assert.Equal(HttpStatusCode.NotFound, (await owner.PutAsJsonAsync(Url(comp, $"/{theirs.Id}"), Body())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync(Url(comp, $"/{theirs.Id}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await PutLogoAsync(owner, comp, theirs.Id, Png)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync(Url(comp, $"/{theirs.Id}/logo"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync(Url(comp, $"/{theirs.Id}/logo"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(Url(comp, "/order"), new { ids = new[] { theirs.Id } })).StatusCode);
    }

    // ---- validation ----

    [Theory]
    [InlineData("http://acme.example")]
    [InlineData("javascript:alert(1)")]
    [InlineData("//acme.example")]
    [InlineData("acme.example")]
    [InlineData("https://user:pass@acme.example")]
    [InlineData("data:text/html,hi")]
    public async Task OnlyHttpsLinksAreAccepted(string link)
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(Url(comp), Body(link: link))).StatusCode);
    }

    [Fact]
    public async Task ABlankLinkMeansNoLink_AndALinkIsTidied()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        Assert.Null((await AddAsync(owner, comp, Body(link: "   "))).LinkUrl);
        Assert.Equal("https://acme.example/a?b=1", (await AddAsync(owner, comp, Body(link: " https://acme.example/a?b=1 "))).LinkUrl);
    }

    [Fact]
    public async Task RejectsBadDetails()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var now = DateTime.UtcNow;
        async Task<HttpStatusCode> Post(object body) => (await owner.PostAsJsonAsync(Url(comp), body)).StatusCode;

        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(name: "")));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(name: "   ")));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(name: new string('x', 81))));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(link: "https://acme.example/" + new string('x', 300))));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(tier: 7)));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(showOn: 1 << 20)));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(showOn: -1)));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(starts: now.AddDays(2), ends: now.AddDays(1))));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(Body(starts: now, ends: now)));
    }

    [Fact]
    public async Task ACompetitionHasAtMostThirtySponsors()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        for (var i = 0; i < 30; i++) await AddAsync(owner, comp, Body(name: $"Sponsor {i}"));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(Url(comp), Body())).StatusCode);
    }

    // ---- create, update, delete, reorder ----

    [Fact]
    public async Task AddEditAndDelete()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var first = await AddAsync(owner, comp, Body(name: "  Acme Feeds  "));
        var second = await AddAsync(owner, comp, Body(name: "Bridle Bros"));
        Assert.Equal("Acme Feeds", first.Name);
        Assert.Equal((0, 1), (first.SortOrder, second.SortOrder));
        Assert.Equal((0L, 0L), (first.Views, first.Seconds));

        var starts = DateTime.UtcNow.AddDays(1);
        var put = await owner.PutAsJsonAsync(Url(comp, $"/{first.Id}"), Body(name: "Acme Horse Feeds", tier: 0, showOn: 3, enabled: false, starts: starts));
        var edited = await put.ReadAsync<SponsorAdminDto>();
        Assert.Equal(("Acme Horse Feeds", SponsorTier.Headline, (SponsorPlacement)3, false), (edited.Name, edited.Tier, edited.ShowOn, edited.IsEnabled));
        Assert.Equal(starts, edited.StartsAt!.Value, TimeSpan.FromSeconds(1));
        Assert.Equal(DateTimeKind.Utc, edited.StartsAt.Value.Kind);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync(Url(comp, $"/{second.Id}"))).StatusCode);
        var left = await (await owner.GetAsync(Url(comp, "/manage"))).ReadAsync<List<SponsorAdminDto>>();
        Assert.Equal([first.Id], left.Select(s => s.Id));
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync(Url(comp, $"/{second.Id}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.PutAsJsonAsync(Url(comp, $"/{second.Id}"), Body())).StatusCode);
    }

    [Fact]
    public async Task ReorderingNeedsEverySponsorOnce()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var a = await AddAsync(owner, comp, Body(name: "A"));
        var b = await AddAsync(owner, comp, Body(name: "B"));
        var c = await AddAsync(owner, comp, Body(name: "C"));

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(Url(comp, "/order"), new { ids = new[] { a.Id, b.Id } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(Url(comp, "/order"), new { ids = new[] { a.Id, a.Id, b.Id } })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PutAsJsonAsync(Url(comp, "/order"), new { ids = new[] { c.Id, a.Id, b.Id } })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.PutAsJsonAsync(Url(comp, "/order"), new { ids = new[] { c.Id, a.Id, b.Id } })).StatusCode);

        var listed = await (await owner.GetAsync(Url(comp, "/manage"))).ReadAsync<List<SponsorAdminDto>>();
        Assert.Equal(["C", "A", "B"], listed.Select(s => s.Name));
    }

    // ---- logos ----

    [Theory]
    [MemberData(nameof(GoodLogos))]
    public async Task AcceptsPngJpegAndWebp_AndServesThemWithTheirType(byte[] bytes, string type)
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        Assert.Null(sponsor.LogoUrl);

        var put = await PutLogoAsync(owner, comp, sponsor.Id, bytes, type);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var withLogo = await put.ReadAsync<SponsorAdminDto>();
        Assert.Equal($"/api/competitions/{comp}/sponsors/{sponsor.Id}/logo?v=1", withLogo.LogoUrl);

        var served = await _f.CreateClient().GetAsync(Url(comp, $"/{sponsor.Id}/logo?v=1"));
        Assert.Equal(HttpStatusCode.OK, served.StatusCode);
        Assert.Equal(type, served.Content.Headers.ContentType!.MediaType);
        Assert.Equal(bytes, await served.Content.ReadAsByteArrayAsync());
        Assert.Contains("public", served.Headers.CacheControl!.ToString());
        Assert.Contains("max-age=600", served.Headers.CacheControl.ToString());
    }

    public static IEnumerable<object[]> GoodLogos() =>
    [
        [Png, "image/png"], [Jpeg, "image/jpeg"], [Webp, "image/webp"],
    ];

    [Fact]
    public async Task ARefusedLogoLeavesTheOldOneInPlace()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        await PutLogoAsync(owner, comp, sponsor.Id, Png);

        var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"u8.ToArray();
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await PutLogoAsync(owner, comp, sponsor.Id, svg, "image/svg+xml")).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await PutLogoAsync(owner, comp, sponsor.Id, Png, "image/gif")).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await PutLogoAsync(owner, comp, sponsor.Id, Png, "text/html")).StatusCode);
        // Claiming to be a PNG doesn't make an SVG or a script one.
        Assert.Equal(HttpStatusCode.BadRequest, (await PutLogoAsync(owner, comp, sponsor.Id, svg, "image/png")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PutLogoAsync(owner, comp, sponsor.Id, "<html></html>"u8.ToArray(), "image/webp")).StatusCode);
        // A real JPEG declared as a PNG is a mismatch too.
        Assert.Equal(HttpStatusCode.BadRequest, (await PutLogoAsync(owner, comp, sponsor.Id, Jpeg, "image/png")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PutLogoAsync(owner, comp, sponsor.Id, [], "image/png")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PutLogoAsync(owner, comp, sponsor.Id, Png[..5], "image/png")).StatusCode);

        var current = (await (await owner.GetAsync(Url(comp, "/manage"))).ReadAsync<List<SponsorAdminDto>>()).Single(s => s.Id == sponsor.Id);
        Assert.EndsWith("?v=1", current.LogoUrl);
    }

    [Fact]
    public async Task LogosOverTwoHundredKilobytesAreRefused()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        byte[] Padded(int length) => [.. Png, .. new byte[length - Png.Length]];

        Assert.Equal(HttpStatusCode.OK, (await PutLogoAsync(owner, comp, sponsor.Id, Padded(200 * 1024))).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await PutLogoAsync(owner, comp, sponsor.Id, Padded(200 * 1024 + 1))).StatusCode);

        // A body with no declared length is cut off as it is read.
        using var streamed = new HttpRequestMessage(HttpMethod.Put, Url(comp, $"/{sponsor.Id}/logo"))
        {
            Content = new StreamContent(new MemoryStream(Padded(300 * 1024))) { Headers = { ContentType = new("image/png") } },
        };
        streamed.Headers.TransferEncodingChunked = true;
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await owner.SendAsync(streamed)).StatusCode);
    }

    [Fact]
    public async Task ReplacingOrRemovingALogoChangesItsVersion()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        await PutLogoAsync(owner, comp, sponsor.Id, Png);
        var second = await (await PutLogoAsync(owner, comp, sponsor.Id, Jpeg, "image/jpeg")).ReadAsync<SponsorAdminDto>();
        Assert.EndsWith("?v=2", second.LogoUrl);

        var removed = await (await owner.DeleteAsync(Url(comp, $"/{sponsor.Id}/logo"))).ReadAsync<SponsorAdminDto>();
        Assert.Null(removed.LogoUrl);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync(Url(comp, $"/{sponsor.Id}/logo"))).StatusCode);
    }

    // ---- the public list ----

    [Fact]
    public async Task TheLists_ShowOnlyWhatIsOnShow_HeadlineFirst()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var now = DateTime.UtcNow;
        await AddAsync(owner, comp, Body(name: "Supporter 1", tier: 2));
        var headline = await AddAsync(owner, comp, Body(name: "Headline", tier: 0, link: null));
        await AddAsync(owner, comp, Body(name: "Major", tier: 1));
        await AddAsync(owner, comp, Body(name: "Switched off", enabled: false));
        await AddAsync(owner, comp, Body(name: "Nowhere", showOn: 0));
        await AddAsync(owner, comp, Body(name: "Not yet", starts: now.AddDays(1)));
        await AddAsync(owner, comp, Body(name: "Finished", ends: now.AddDays(-1)));
        await AddAsync(owner, comp, Body(name: "In its dates", starts: now.AddDays(-1), ends: now.AddDays(1), tier: 2));
        await PutLogoAsync(owner, comp, headline.Id, Png);

        var response = await _f.CreateClient().GetAsync(Url(comp));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var listed = await response.ReadAsync<List<SponsorDto>>();
        Assert.Equal(["Headline", "Major", "Supporter 1", "In its dates"], listed.Select(s => s.Name));
        Assert.Equal($"/api/competitions/{comp}/sponsors/{headline.Id}/logo?v=1", listed[0].LogoUrl);
        Assert.Null(listed[0].LinkUrl);
        Assert.Null(listed[1].LogoUrl);
        // The organiser still sees everything.
        Assert.Equal(8, (await (await owner.GetAsync(Url(comp, "/manage"))).ReadAsync<List<SponsorAdminDto>>()).Count);
    }

    [Fact]
    public async Task ALogoIsServedToThePublicOnlyWhileTheSponsorIsOnShow()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var (other, _) = await _f.ApprovedTrainerAsync();
        var now = DateTime.UtcNow;
        var anon = _f.CreateClient();
        async Task<SponsorAdminDto> WithLogo(object body)
        {
            var sponsor = await AddAsync(owner, comp, body);
            await PutLogoAsync(owner, comp, sponsor.Id, Png);
            return sponsor;
        }
        var live = await WithLogo(Body(name: "Live"));
        var off = await WithLogo(Body(name: "Off", enabled: false));
        var later = await WithLogo(Body(name: "Later", starts: now.AddDays(1)));
        var over = await WithLogo(Body(name: "Over", ends: now.AddDays(-1)));
        var inDates = await WithLogo(Body(name: "In dates", starts: now.AddDays(-1), ends: now.AddDays(1)));

        Task<HttpResponseMessage> Fetch(HttpClient client, SponsorAdminDto s) => client.GetAsync(Url(comp, $"/{s.Id}/logo?v=1"));
        foreach (var shown in new[] { live, inDates })
            Assert.Equal(HttpStatusCode.OK, (await Fetch(anon, shown)).StatusCode);
        foreach (var hidden in new[] { off, later, over })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await Fetch(anon, hidden)).StatusCode);
            // Signed in, but not on this competition's staff.
            Assert.Equal(HttpStatusCode.NotFound, (await Fetch(other, hidden)).StatusCode);
            // The organiser's list still shows it.
            var staff = await Fetch(owner, hidden);
            Assert.Equal(HttpStatusCode.OK, staff.StatusCode);
            Assert.Equal(Png, await staff.Content.ReadAsByteArrayAsync());
            Assert.DoesNotContain("public", staff.Headers.CacheControl!.ToString());
            Assert.Equal(HttpStatusCode.OK, (await Fetch(await _f.AdminAsync(), hidden)).StatusCode);
        }

        // Switching a sponsor off takes its logo away from the public at once.
        await owner.PutAsJsonAsync(Url(comp, $"/{live.Id}"), Body(name: "Live", enabled: false));
        Assert.Equal(HttpStatusCode.NotFound, (await Fetch(anon, live)).StatusCode);
    }

    [Fact]
    public async Task ThePublicListHasNoOrganiserFields()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        await AddAsync(owner, comp);
        var json = await (await _f.CreateClient().GetAsync(Url(comp))).Content.ReadAsStringAsync();
        Assert.DoesNotContain("isEnabled", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("startsAt", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("views", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task AnUnknownCompetitionHasNoSponsors() =>
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync(Url(int.MaxValue))).StatusCode);

    // ---- "shown" counts ----

    [Fact]
    public async Task ShownCountsAddUp_ForAnonymousViewers_AndShowInTheOrganisersList()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        var (otherComp, otherOwner) = await OwnedCompetitionAsync();
        var foreign = await AddAsync(otherOwner, otherComp);
        var anon = _f.CreateClient();

        var first = await anon.PostAsJsonAsync(Url(comp, "/exposures"), new
        {
            items = new object[]
            {
                new { sponsorId = sponsor.Id, placement = 1, views = 2, seconds = 0 },
                new { sponsorId = sponsor.Id, placement = 16, views = 1, seconds = 12 },
                new { sponsorId = sponsor.Id, placement = 1, views = 3, seconds = 0 },
                new { sponsorId = foreign.Id, placement = 1, views = 9, seconds = 9 },
                new { sponsorId = 987654, placement = 1, views = 9, seconds = 9 },
            },
        });
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await anon.PostAsJsonAsync(Url(comp, "/exposures"), new
        {
            items = new object[] { new { sponsorId = sponsor.Id, placement = 16, views = 0, seconds = 8 } },
        })).StatusCode);
        // An empty batch, or one with nothing in it, changes nothing.
        Assert.Equal(HttpStatusCode.NoContent, (await anon.PostAsJsonAsync(Url(comp, "/exposures"), new { items = Array.Empty<object>() })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await anon.PostAsJsonAsync(Url(comp, "/exposures"),
            new { items = new[] { new { sponsorId = sponsor.Id, placement = 1, views = 0, seconds = 0 } } })).StatusCode);

        var listed = (await (await owner.GetAsync(Url(comp, "/manage"))).ReadAsync<List<SponsorAdminDto>>()).Single();
        Assert.Equal((6L, 20L), (listed.Views, listed.Seconds));
        var elsewhere = (await (await otherOwner.GetAsync(Url(otherComp, "/manage"))).ReadAsync<List<SponsorAdminDto>>()).Single();
        Assert.Equal((0L, 0L), (elsewhere.Views, elsewhere.Seconds));

        var rows = await _f.InDbAsync(db => db.SponsorExposures.AsNoTracking().Where(e => e.SponsorId == sponsor.Id).ToListAsync());
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.Equal(DateTime.UtcNow.Date, r.Day));
    }

    [Fact]
    public async Task ShownCountsRejectNonsense()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        var anon = _f.CreateClient();
        Task<HttpResponseMessage> Send(params object[] items) => anon.PostAsJsonAsync(Url(comp, "/exposures"), new { items });

        Assert.Equal(HttpStatusCode.BadRequest, (await Send(new { sponsorId = sponsor.Id, placement = 0, views = 1, seconds = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(new { sponsorId = sponsor.Id, placement = 3, views = 1, seconds = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(new { sponsorId = sponsor.Id, placement = 64, views = 1, seconds = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(new { sponsorId = sponsor.Id, placement = 1, views = -1, seconds = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(new { sponsorId = sponsor.Id, placement = 1, views = 501, seconds = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(new { sponsorId = sponsor.Id, placement = 1, views = 1, seconds = 3601 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(Enumerable.Range(0, 41).Select(_ => (object)new { sponsorId = sponsor.Id, placement = 1, views = 1, seconds = 0 }).ToArray())).StatusCode);
        // Each item is within range, but the batch total blows the per-call impressions cap.
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(
            new { sponsorId = sponsor.Id, placement = 1, views = 500, seconds = 0 },
            new { sponsorId = sponsor.Id, placement = 16, views = 500, seconds = 0 },
            new { sponsorId = sponsor.Id, placement = 32, views = 500, seconds = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.PostAsJsonAsync(Url(comp, "/exposures"), new { })).StatusCode);

        var shown = (await (await owner.GetAsync(Url(comp, "/manage"))).ReadAsync<List<SponsorAdminDto>>()).Single();
        Assert.Equal(0, shown.Views);
    }

    [Fact]
    public async Task ShownCountsAreLimitedPerAddress()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        var limited = _f.WithWebHostBuilder(b => b.UseSetting("RateLimits:SponsorExposurePerMinute", "2"));
        var client = limited.CreateClient();

        async Task<HttpStatusCode> Report(string ip)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, Url(comp, "/exposures"))
            {
                Content = JsonContent.Create(new { items = new[] { new { sponsorId = sponsor.Id, placement = 1, views = 1, seconds = 0 } } }),
            };
            request.Headers.Add(TestIpStartupFilter.Header, ip);
            using var response = await client.SendAsync(request);
            return response.StatusCode;
        }

        Assert.Equal(HttpStatusCode.NoContent, await Report("203.0.113.40"));
        Assert.Equal(HttpStatusCode.NoContent, await Report("203.0.113.40"));
        Assert.Equal(HttpStatusCode.TooManyRequests, await Report("203.0.113.40"));
        Assert.Equal(HttpStatusCode.NoContent, await Report("203.0.113.41"));
        var shown = (await (await owner.GetAsync(Url(comp, "/manage"))).ReadAsync<List<SponsorAdminDto>>()).Single();
        Assert.Equal(3, shown.Views);
    }

    [Fact]
    public async Task ConcurrentReportsAllCount()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        var anon = _f.CreateClient();
        var body = new { items = new[] { new { sponsorId = sponsor.Id, placement = 2, views = 1, seconds = 1 } } };

        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => anon.PostAsJsonAsync(Url(comp, "/exposures"), body)));
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.NoContent, r.StatusCode));
        var shown = (await (await owner.GetAsync(Url(comp, "/manage"))).ReadAsync<List<SponsorAdminDto>>()).Single();
        Assert.Equal((8L, 8L), (shown.Views, shown.Seconds));
    }

    [Fact]
    public async Task DeletingASponsorDeletesItsCounts()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var sponsor = await AddAsync(owner, comp);
        await _f.CreateClient().PostAsJsonAsync(Url(comp, "/exposures"),
            new { items = new[] { new { sponsorId = sponsor.Id, placement = 1, views = 1, seconds = 0 } } });
        await owner.DeleteAsync(Url(comp, $"/{sponsor.Id}"));
        Assert.Empty(await _f.InDbAsync(db => db.SponsorExposures.Where(e => e.SponsorId == sponsor.Id).ToListAsync()));
    }

    // ---- the break cards on the live video ----

    [Fact]
    public async Task SkippingTellsEveryViewer()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        await using var viewer = new HubConnectionBuilder()
            .WithUrl(new Uri(_f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _f.Server.CreateHandler();
                o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
        var received = new TaskCompletionSource<SponsorControlDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        viewer.On<SponsorControlDto>("sponsorControl", received.SetResult);
        await viewer.StartAsync();
        await viewer.InvokeAsync("JoinCompetition", comp);

        var response = await owner.PostAsync(Url(comp, "/skip"), null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("skip", (await received.Task.WaitAsync(TimeSpan.FromSeconds(10))).Action);
    }

    [Fact]
    public async Task TheSponsorSwitchIsPartOfTheOverlaySettings()
    {
        var (comp, owner) = await OwnedCompetitionAsync();
        var url = $"/api/competitions/{comp}/overlays";
        object Request(int sponsorMode) => new
        {
            bannerText = (string?)null, bannerStyle = 1, bannerArenas = Array.Empty<string>(), stripMode = 0, scoreCardMode = 0,
            scoreCardDelaySeconds = 4, scoreCardSeconds = 10, look = new { }, sponsorMode,
        };

        Assert.Equal(OverlayMode.Auto, (await (await _f.CreateClient().GetAsync(url)).ReadAsync<StreamOverlayDto>()).SponsorMode);
        var saved = await (await owner.PutAsJsonAsync(url, Request(2))).ReadAsync<StreamOverlayDto>();
        Assert.Equal(OverlayMode.Off, saved.SponsorMode);
        Assert.Equal(OverlayMode.Off, (await (await _f.CreateClient().GetAsync(url)).ReadAsync<StreamOverlayDto>()).SponsorMode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(url, Request(9))).StatusCode);
    }
}
