using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Stats;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Stats;

/// <summary>
/// The browse list behind the filter tabs on /stats. Every test seeds names carrying a unique marker and narrows the
/// list with it, so tests sharing the class database can't see each other's data.
/// </summary>
public class StatsBrowseTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public StatsBrowseTests(ApiFactory f) => _f = f;

    private sealed record Rider(string Name, string? Pony = null, bool InitialsOnly = false, bool Reserve = false);

    /// <summary>One team with one form in an event, scored once unless <paramref name="scored"/> is false.</summary>
    private Task<int> SeedAsync(string competition, DateTime start, SectionFormat format, string club, string team, Rider[] riders,
        bool locked = true, bool scored = true, bool demo = false)
        => _f.WithDbAsync(async db =>
        {
            var comp = new Competition { Name = competition, StartDate = start };
            db.Competitions.Add(comp);
            await db.SaveChangesAsync();
            if (demo) db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { CompetitionId = comp.Id, IsDemo = true });
            var section = new CompetitionSection { CompetitionId = comp.Id, Format = format, AgeGroup = "U14", DisplayName = $"U14 {format}" };
            db.CompetitionSections.Add(section);
            await db.SaveChangesAsync();
            var clubRow = await db.Clubs.FirstOrDefaultAsync(c => c.Name == club) ?? db.Clubs.Add(new Club { Name = club }).Entity;
            var t = new Team { CompetitionId = comp.Id, CompetitionSectionId = section.Id, Club = clubRow, DisplayName = team };
            db.Teams.Add(t);
            await db.SaveChangesAsync();
            var form = new DeclarationForm { TeamId = t.Id, IsLocked = locked, SubmittedAt = DateTime.UtcNow };
            var order = 0;
            foreach (var r in riders)
                form.Riders.Add(new RiderEntry { FullName = r.Name, HorseName = r.Pony, UseInitialOnly = r.InitialsOnly, IsReserve = r.Reserve, OrderIndex = order++ });
            db.DeclarationForms.Add(form);
            await db.SaveChangesAsync();
            if (scored)
            {
                var session = new Session { CompetitionId = comp.Id, CompetitionSectionId = section.Id, Name = "Morning", OrderIndex = 1 };
                db.Sessions.Add(session);
                await db.SaveChangesAsync();
                var heat = new Heat { SessionId = session.Id, Label = "Heat 1", OrderIndex = 1 };
                heat.Entries.Add(new HeatEntry { TeamId = t.Id, LaneIndex = 1 });
                db.Heats.Add(heat);
                await db.SaveChangesAsync();
                var race = new Race { HeatId = heat.Id, Name = "Bending", OrderIndex = 0, IsComplete = true };
                race.Results.Add(new Result { TeamId = t.Id, Placing = 1, Points = 1, Status = ResultStatus.Finished });
                db.Races.Add(race);
                await db.SaveChangesAsync();
            }
            return t.Id;
        });

    private static string Id() => Guid.NewGuid().ToString("N")[..8];

    private static string Browse(int kind, string? q = null, int? page = null)
        => $"/api/stats/browse?kind={kind}" + (q is null ? "" : $"&q={Uri.EscapeDataString(q)}") + (page is null ? "" : $"&page={page}");

    private static async Task<StatsBrowseDto> GetAsync(HttpClient client, string url)
        => await (await client.GetAsync(url)).ReadAsync<StatsBrowseDto>();

    [Fact]
    public async Task Browse_ListsEachKind_MostCompetitionsFirst_ThenByName()
    {
        var u = Id();
        var past = DateTime.UtcNow.Date.AddDays(-20);
        await SeedAsync($"One{u}", past, SectionFormat.Pairs, $"Club{u}", $"Club{u} A",
            [new Rider($"Zed{u} Zane", $"Pony{u}"), new Rider($"Ann{u} Jones", $"Dobbin{u}")]);
        await SeedAsync($"Two{u}", past.AddDays(5), SectionFormat.Individual, $"Club{u}", $"Club{u} A",
            [new Rider($"Zed{u} Zane", $"Pony{u}")]);
        await SeedAsync($"Three{u}", past.AddDays(8), SectionFormat.Pairs, $"Other{u}", $"Other{u} B",
            [new Rider($"Bea{u} Brown", $"Rocket{u}")]);
        var anon = _f.CreateClient();

        var riders = await GetAsync(anon, Browse(0, u));
        Assert.Equal((StatsSubjectKind.Rider, 1, 3), (riders.Kind, riders.Page, riders.Total));
        Assert.Equal(StatsService.BrowsePageSize, riders.PageSize);
        Assert.Equal([$"Zed{u} Zane", $"Ann{u} Jones", $"Bea{u} Brown"], riders.Items.Select(i => i.Name));
        Assert.Equal([2, 1, 1], riders.Items.Select(i => i.Competitions));
        Assert.All(riders.Items, i => Assert.Equal(StatsSubjectKind.Rider, i.Kind));

        var ponies = await GetAsync(anon, Browse(1, u));
        Assert.Equal([$"Pony{u}", $"Dobbin{u}", $"Rocket{u}"], ponies.Items.Select(i => i.Name));
        var teams = await GetAsync(anon, Browse(2, u));
        Assert.Equal([($"Club{u} A", 2), ($"Other{u} B", 1)], teams.Items.Select(i => (i.Name, i.Competitions)));
        var clubs = await GetAsync(anon, Browse(3, u));
        Assert.Equal([($"Club{u}", 2), ($"Other{u}", 1)], clubs.Items.Select(i => (i.Name, i.Competitions)));

        // Typing narrows the list.
        var narrowed = await GetAsync(anon, Browse(0, $"  ANN{u}  "));
        Assert.Equal([$"Ann{u} Jones"], narrowed.Items.Select(i => i.Name));
        Assert.Equal($"ANN{u}", narrowed.Query);

        // With nothing typed the list is already there, up to a page.
        var open = await GetAsync(anon, Browse(0));
        Assert.True(open.Total >= 3);
        Assert.InRange(open.Items.Count, 1, open.PageSize);
        Assert.Equal("", open.Query);

        // A listed key opens the profile.
        var profile = await anon.GetAsync($"/api/stats/riders?name={Uri.EscapeDataString(riders.Items[0].Key)}");
        Assert.Equal(HttpStatusCode.OK, profile.StatusCode);
    }

    [Fact]
    public async Task Browse_Pages()
    {
        var u = Id();
        var size = StatsService.BrowsePageSize;
        var riders = Enumerable.Range(0, size + 6).Select(i => new Rider($"Pg{u}{i:00} Rider")).ToArray();
        await SeedAsync($"Big{u}", DateTime.UtcNow.Date.AddDays(-3), SectionFormat.Individual, $"Club{u}", $"Big{u}", riders);
        var anon = _f.CreateClient();

        var first = await GetAsync(anon, Browse(0, u));
        var second = await GetAsync(anon, Browse(0, u, 2));
        var third = await GetAsync(anon, Browse(0, u, 3));
        Assert.Equal((size + 6, size, 6, 0), (first.Total, first.Items.Count, second.Items.Count, third.Items.Count));
        Assert.Equal((1, 2, 3), (first.Page, second.Page, third.Page));
        Assert.Equal($"Pg{u}00 Rider", first.Items[0].Name);
        Assert.Equal($"Pg{u}{size:00} Rider", second.Items[0].Name);
        Assert.Empty(first.Items.Select(i => i.Key).Intersect(second.Items.Select(i => i.Key)));

        // A page below one is the first page.
        Assert.Equal(1, (await GetAsync(anon, Browse(0, u, 0))).Page);
        Assert.Equal(1, (await GetAsync(anon, Browse(0, u, -4))).Page);
    }

    [Fact]
    public async Task Browse_KeepsThePrivacyRulesOfSearch()
    {
        var u = Id();
        var past = DateTime.UtcNow.Date.AddDays(-9);
        await SeedAsync($"Priv{u}", past, SectionFormat.Pairs, $"Club{u}", $"Club{u} A",
            [new Rider($"Olly{u} Smith{u}", $"Pony{u}", InitialsOnly: true), new Rider($"Res{u} Rider", $"Spare{u}", Reserve: true)]);
        // Not listed: a draft form, and an event that hasn't started or been scored.
        await SeedAsync($"Draft{u}", past, SectionFormat.Individual, $"Club{u}", $"Draft{u} Team", [new Rider($"Draft{u} Rider", $"DraftPony{u}")], locked: false);
        await SeedAsync($"Soon{u}", DateTime.UtcNow.Date.AddDays(20), SectionFormat.Individual, $"Club{u}", $"Soon{u} Team", [new Rider($"Soon{u} Rider")], scored: false);
        var anon = _f.CreateClient();

        var response = await anon.GetAsync(Browse(0, u));
        var raw = await response.Content.ReadAsStringAsync();
        var list = await response.ReadAsync<StatsBrowseDto>();
        Assert.Equal([$"Olly{u} S."], list.Items.Select(i => i.Name));
        Assert.DoesNotContain($"Smith{u}", raw, StringComparison.OrdinalIgnoreCase);
        foreach (var hidden in new[] { $"Res{u}", $"Draft{u} Rider", $"Soon{u} Rider" })
            Assert.DoesNotContain(hidden, raw, StringComparison.OrdinalIgnoreCase);

        // The surname finds nothing for anyone but a site admin, in browse as in search.
        Assert.Empty((await GetAsync(anon, Browse(0, $"smith{u}"))).Items);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Empty((await GetAsync(member, Browse(0, $"smith{u}"))).Items);
        var admin = await _f.AdminAsync();
        Assert.Equal([$"Olly{u} Smith{u}"], (await GetAsync(admin, Browse(0, $"smith{u}"))).Items.Select(i => i.Name));

        // Ponies of reserves and drafts stay out too, and a team browse leaves out the unfinished event's team.
        var ponyRaw = await (await anon.GetAsync(Browse(1, u))).Content.ReadAsStringAsync();
        Assert.Contains($"Pony{u}", ponyRaw);
        Assert.DoesNotContain($"Spare{u}", ponyRaw);
        Assert.DoesNotContain($"DraftPony{u}", ponyRaw);
        var teams = await GetAsync(anon, Browse(2, u));
        Assert.DoesNotContain(teams.Items, t => t.Name.StartsWith($"Soon{u}", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Browse_ExposesNamesAndCountsOnly()
    {
        var u = Id();
        await SeedAsync($"Shape{u}", DateTime.UtcNow.Date.AddDays(-2), SectionFormat.Individual, $"Club{u}", $"Shape{u}", [new Rider($"Shape{u} Rider", $"ShapePony{u}")]);
        foreach (var kind in new[] { 0, 1, 2, 3 })
        {
            using var json = JsonDocument.Parse(await (await _f.CreateClient().GetAsync(Browse(kind, u))).Content.ReadAsStringAsync());
            Assert.Equal(["kind", "query", "page", "pageSize", "total", "items"], json.RootElement.EnumerateObject().Select(p => p.Name));
            Assert.Equal(["kind", "name", "key", "competitions"], json.RootElement.GetProperty("items")[0].EnumerateObject().Select(p => p.Name));
        }
    }

    [Fact]
    public async Task DemoEvents_CountLikeAnyOtherFinishedEvent_AndCarryNoLabel()
    {
        var u = Id();
        await SeedAsync($"Demo{u}", DateTime.UtcNow.Date.AddDays(-4), SectionFormat.Individual, $"Club{u}", $"Demo{u} Team", [new Rider($"Demo{u} Rider", $"DemoPony{u}")], demo: true);
        // A demo event that hasn't been scored still doesn't count, like any other.
        await SeedAsync($"DemoLater{u}", DateTime.UtcNow.Date.AddDays(14), SectionFormat.Individual, $"Club{u}", $"Later{u} Team", [new Rider($"Later{u} Rider")], demo: true, scored: false);
        var anon = _f.CreateClient();

        Assert.Equal([$"Demo{u} Rider"], (await GetAsync(anon, Browse(0, u))).Items.Select(i => i.Name));
        Assert.Equal([$"DemoPony{u}"], (await GetAsync(anon, Browse(1, u))).Items.Select(i => i.Name));
        Assert.Equal([$"Demo{u} Team"], (await GetAsync(anon, Browse(2, u))).Items.Select(i => i.Name));
        Assert.Equal([$"Club{u}"], (await GetAsync(anon, Browse(3, u))).Items.Select(i => i.Name));
        var search = await (await anon.GetAsync($"/api/stats/search?q=demo{u}")).ReadAsync<StatsSearchDto>();
        Assert.Single(search.Riders);
        var response = await anon.GetAsync($"/api/stats/riders?name={Uri.EscapeDataString($"Demo{u} Rider")}");
        var profile = await response.ReadAsync<StatsProfileDto>();
        Assert.Equal((1, 1, 1), (profile.Summary.Competitions, profile.Summary.Entries, profile.Summary.Firsts));
        Assert.DoesNotContain("\"isDemo\"", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Browse_RejectsBadInput()
    {
        var anon = _f.CreateClient();
        foreach (var url in new[] { "/api/stats/browse", "/api/stats/browse?kind=7", "/api/stats/browse?kind=-1", "/api/stats/browse?kind=abc",
                     Browse(0, "x"), Browse(0, ".."), Browse(0, new string('a', 81)) })
            Assert.Equal(HttpStatusCode.BadRequest, (await anon.GetAsync(url)).StatusCode);
        // Blank search words mean no filter.
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync(Browse(0, "   "))).StatusCode);
    }

    [Fact]
    public async Task Browse_WithNothingMatching_IsAnEmptyList()
    {
        var u = Id();
        var anon = _f.CreateClient();
        foreach (var kind in new[] { 0, 1, 2, 3 })
        {
            var result = await GetAsync(anon, Browse(kind, $"nobody{u}"));
            Assert.Equal((0, 1), (result.Total, result.Page));
            Assert.Empty(result.Items);
        }
    }
}
