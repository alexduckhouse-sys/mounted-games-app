using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Calendar;

public class ShareEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ShareEndpointsTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task CompetitionCard_HoldsOnlyPublicFacts_AndIsCacheable()
    {
        var arena = await _f.CreateArenaAsync(3);
        await _f.InDbAsync(async db =>
        {
            var c = await db.Competitions.SingleAsync(x => x.Id == arena.CompetitionId);
            c.Name = "Spring Games";
            c.Location = "Tatton Park";
            c.PaymentDestination = "IBAN-SECRET";
            c.OrganiserName = "Organiser Person";
            c.StreamUrl = "https://example.org/stream-secret";
            await db.SaveChangesAsync();
        });

        var r = await _f.CreateClient().GetAsync($"/api/share/competitions/{arena.CompetitionId}");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("public, max-age=60, s-maxage=300, stale-while-revalidate=3600", r.Headers.CacheControl?.ToString());
        var card = await r.ReadAsync<ShareCompetitionDto>();
        Assert.Equal("Spring Games", card.Name);
        Assert.Equal("Tatton Park", card.Location);
        Assert.Equal(3, card.TeamCount);
        var raw = await r.Content.ReadAsStringAsync();
        Assert.DoesNotContain("IBAN-SECRET", raw);
        Assert.DoesNotContain("Organiser Person", raw);
        Assert.DoesNotContain("stream-secret", raw);
        Assert.Equal(5, JsonDocument.Parse(raw).RootElement.EnumerateObject().Count());
    }

    [Fact]
    public async Task CompetitionCard_ReturnsHostileNamesAsPlainJsonData()
    {
        var id = await _f.SeedCompetitionAsync("\"><script>alert(1)</script>");

        var r = await _f.CreateClient().GetAsync($"/api/share/competitions/{id}");

        Assert.Equal("application/json", r.Content.Headers.ContentType?.MediaType);
        Assert.Equal("\"><script>alert(1)</script>", (await r.ReadAsync<ShareCompetitionDto>()).Name);
    }

    [Fact]
    public async Task UnknownCompetitionsAndProfiles_Are404()
    {
        var anon = _f.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync("/api/share/competitions/99999999")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync($"/api/share/team-profiles/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task TeamProfileCard_ShowsNameClubAndEventCountOnly()
    {
        var club = await _f.SeedClubAsync("Cheshire Pony Club");
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        var team = await _f.SeedTeamAsync(comp, section, club);
        var profileId = await _f.InDbAsync(async db =>
        {
            var owner = await db.Users.Select(u => u.Id).FirstAsync();
            var profile = new TeamProfile { OwnerUserId = owner, ClubId = club, Suffix = "A", DisplayName = "Cheshire A" };
            db.Add(profile);
            db.Add(new EventTeamProfileLink { TeamProfile = profile, CompetitionId = comp, TeamId = team, LinkedByUserId = owner });
            await db.SaveChangesAsync();
            return profile.Id;
        });

        var r = await _f.CreateClient().GetAsync($"/api/share/team-profiles/{profileId}");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var card = await r.ReadAsync<ShareTeamProfileDto>();
        Assert.Equal(new ShareTeamProfileDto("Cheshire A", "Cheshire Pony Club", 1), card);
        var owner = await _f.InDbAsync(db => db.Users.Select(u => u.Email).FirstAsync());
        Assert.DoesNotContain(owner!, await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ShareCards_RefuseBlockedAddresses()
    {
        var id = await _f.SeedCompetitionAsync();
        await _f.InDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock { IpAddress = "203.0.113.60" });
            await db.SaveChangesAsync();
        });

        var blocked = new HttpRequestMessage(HttpMethod.Get, $"/api/share/competitions/{id}");
        blocked.Headers.Add("X-Test-Ip", "203.0.113.60");

        Assert.Equal(HttpStatusCode.Forbidden, (await _f.CreateClient().SendAsync(blocked)).StatusCode);
    }
}

/// <summary>A host with a very low public-read limit, to prove the limiter is wired to the new endpoints.</summary>
public class LowPublicLimitFactory : ApiFactory
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("RateLimits:PublicReadsPerMinute", "3");
    }
}

public class PublicReadRateLimitTests : IClassFixture<LowPublicLimitFactory>
{
    private readonly LowPublicLimitFactory _f;
    public PublicReadRateLimitTests(LowPublicLimitFactory f) => _f = f;

    [Fact]
    public async Task PublicReadsAreLimitedPerAddressIncludingCompetitionDetails()
    {
        var id = await _f.SeedCompetitionAsync();
        foreach (var url in new[] { $"/api/share/competitions/{id}", $"/api/competitions/{id}/calendar.ics" })
        {
            HttpResponseMessage last = null!;
            for (var i = 0; i < 4; i++)
            {
                var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.Add("X-Test-Ip", url.Contains("share") ? "198.51.100.1" : "198.51.100.2");
                last = await _f.CreateClient().SendAsync(request);
            }
            Assert.Equal(HttpStatusCode.TooManyRequests, last.StatusCode);
        }

        // Another address has its own allowance; competition details use the same public-read protection.
        var other = new HttpRequestMessage(HttpMethod.Get, $"/api/share/competitions/{id}");
        other.Headers.Add("X-Test-Ip", "198.51.100.3");
        Assert.Equal(HttpStatusCode.OK, (await _f.CreateClient().SendAsync(other)).StatusCode);
        using var details = _f.CreateClient();
        details.DefaultRequestHeaders.Add("X-Test-Ip", "198.51.100.4");
        for (var i = 0; i < 4; i++)
            Assert.Equal(i < 3 ? HttpStatusCode.OK : HttpStatusCode.TooManyRequests,
                (await details.GetAsync($"/api/competitions/{id}")).StatusCode);
    }
}
