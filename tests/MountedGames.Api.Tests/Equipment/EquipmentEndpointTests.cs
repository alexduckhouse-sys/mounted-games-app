using System.Net;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Controllers;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Equipment;

public class EquipmentEndpointTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public EquipmentEndpointTests(ApiFactory f) => _f = f;

    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    private Task SeedTemplateAsync(string name, string? diagram)
        => _f.WithDbAsync(async db =>
        {
            db.RaceTemplates.Add(new RaceTemplate { Name = name, DiagramJson = diagram });
            await db.SaveChangesAsync();
        });

    /// <summary>One race session whose heats have the given entry counts, each heat running every named race.</summary>
    private async Task<int> SeedSessionAsync(int comp, int[] heatSizes, string[] raceNames, SessionKind kind = SessionKind.Race)
    {
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        var teams = new List<int>();
        for (var i = 0; i < heatSizes.Max(); i++) teams.Add(await _f.SeedTeamAsync(comp, section, club));
        return await _f.WithDbAsync(async db =>
        {
            var s = new Session { CompetitionId = comp, CompetitionSectionId = section, Name = "S", OrderIndex = 1, Kind = kind };
            for (var h = 0; h < heatSizes.Length; h++)
            {
                var heat = new Heat { Label = $"H{h}", OrderIndex = h + 1 };
                for (var e = 0; e < heatSizes[h]; e++) heat.Entries.Add(new HeatEntry { TeamId = teams[e], LaneIndex = e + 1 });
                for (var r = 0; r < raceNames.Length; r++) heat.Races.Add(new Race { Name = raceNames[r], OrderIndex = r + 1 });
                s.Heats.Add(heat);
            }
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
            return s.Id;
        });
    }

    private async Task<EquipmentController.EquipmentResponse> GetAsync(int comp)
    {
        var r = await _f.CreateClient().GetAsync($"/api/competitions/{comp}/equipment");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.ReadAsync<EquipmentController.EquipmentResponse>();
    }

    private static int CountOf(EquipmentController.EquipmentResponse r, string kind, string bucket)
        => r.Lines.SingleOrDefault(l => l.Kind == kind && l.Bucket == bucket)?.Count ?? 0;

    [Fact]
    public async Task Compute_ReturnsEmptyResult_ForCompetitionWithoutSessions()
    {
        var comp = await _f.SeedCompetitionAsync();
        var r = await GetAsync(comp);
        Assert.Empty(r.Lines);
        Assert.Equal(0, r.Sessions);
        Assert.Equal(0, r.RacesCounted);
    }

    [Fact]
    public async Task Compute_IsPublic()
    {
        var r = await _f.CreateClient().GetAsync("/api/competitions/999999/equipment");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Compute_ClassifiesElementsIntoBuckets()
    {
        var race = Unique("buckets");
        await SeedTemplateAsync(race, """
            [
              {"t":"pole"},
              {"t":"cone","kind":"litter","anchor":"start"},
              {"t":"item","kind":"flag","anchor":"changeover"},
              {"t":"item","kind":"bucket","anchor":"finish"},
              {"t":"item","kind":"ball","anchor":"pole3"},
              {"t":"item","kind":"hat","anchor":"midline"},
              {"t":"item","kind":"mystery","anchor":"somewhere"},
              {"t":"in","x":5},
              {"t":"table","x":90},
              {"t":"cone","x":50},
              {"t":"cone","x":"left"},
              {"t":"cone"},
              {"t":"midline"},
              {"kind":"no-type"}
            ]
            """);
        var comp = await _f.SeedCompetitionAsync();
        await SeedSessionAsync(comp, new[] { 2 }, new[] { race });

        var r = await GetAsync(comp);

        Assert.Equal(1, r.RacesCounted);
        Assert.Equal(2, CountOf(r, "Pole", "Lane"));
        Assert.Equal(2, CountOf(r, "Litter", "Start"));
        Assert.Equal(2, CountOf(r, "Flag", "Top"));
        Assert.Equal(2, CountOf(r, "Bucket", "Top"));
        Assert.Equal(2, CountOf(r, "Ball", "Lane"));
        Assert.Equal(2, CountOf(r, "Hat", "Mid"));
        Assert.Equal(2, CountOf(r, "Mystery", "Other"));
        Assert.Equal(2, CountOf(r, "In / station", "Start"));
        Assert.Equal(2, CountOf(r, "In / station", "Top"));
        // x=50 -> Mid; a non-numeric x and no position at all -> Other
        Assert.Equal(2, CountOf(r, "Cone", "Mid"));
        Assert.Equal(4, CountOf(r, "Cone", "Other"));
        Assert.DoesNotContain(r.Lines, l => l.Kind == "No-type" || l.Kind == "Midline");
    }

    [Fact]
    public async Task Compute_OrdersLinesByBucketThenKind()
    {
        var race = Unique("order");
        await SeedTemplateAsync(race, """[{"t":"item","kind":"b","anchor":"top"},{"t":"item","kind":"a","anchor":"top"},{"t":"pole"}]""");
        var comp = await _f.SeedCompetitionAsync();
        await SeedSessionAsync(comp, new[] { 1 }, new[] { race });

        var r = await GetAsync(comp);

        Assert.Equal(new[] { ("A", "Top"), ("B", "Top"), ("Pole", "Lane") }.OrderBy(x => x.Item2, StringComparer.Ordinal).ThenBy(x => x.Item1, StringComparer.Ordinal),
            r.Lines.Select(l => (l.Kind, l.Bucket)));
    }

    [Fact]
    public async Task Compute_IncludesStackedChildren_InParentBucket()
    {
        var race = Unique("stack");
        await SeedTemplateAsync(race, """
            [{"t":"cone","kind":"tall","anchor":"start","on":[
                {"t":"pole"},{"t":"in"},{"t":"table"},{"t":"midline"},{"kind":"untyped"},
                {"t":"item","kind":"ring"},{"t":"item","kind":null},{"t":"widget"}
            ]},
            {"t":"cone","kind":"flat","anchor":"top","on":"not-an-array"}]
            """);
        var comp = await _f.SeedCompetitionAsync();
        await SeedSessionAsync(comp, new[] { 3 }, new[] { race });

        var r = await GetAsync(comp);

        Assert.Equal(3, CountOf(r, "Tall", "Start"));
        Assert.Equal(3, CountOf(r, "Pole", "Start"));
        Assert.Equal(6, CountOf(r, "In / station", "Start"));
        Assert.Equal(3, CountOf(r, "Ring", "Start"));
        Assert.Equal(3, CountOf(r, "Item", "Start"));
        Assert.Equal(3, CountOf(r, "Widget", "Start"));
        Assert.Equal(3, CountOf(r, "Flat", "Top"));
    }

    [Fact]
    public async Task Compute_UsesLargestHeat_AndCountsRaceOncePerSession()
    {
        var race = Unique("largest");
        await SeedTemplateAsync(race, """[{"t":"pole"}]""");
        var comp = await _f.SeedCompetitionAsync();
        await SeedSessionAsync(comp, new[] { 2, 4, 3 }, new[] { race });

        var r = await GetAsync(comp);

        Assert.Equal(4, CountOf(r, "Pole", "Lane"));
        Assert.Equal(1, r.RacesCounted);
        Assert.Equal(1, r.Sessions);
    }

    [Fact]
    public async Task Compute_TakesMaxAcrossSessions_NotTheSum()
    {
        var race = Unique("max");
        await SeedTemplateAsync(race, """[{"t":"pole"}]""");
        var comp = await _f.SeedCompetitionAsync();
        await SeedSessionAsync(comp, new[] { 2 }, new[] { race });
        await SeedSessionAsync(comp, new[] { 5 }, new[] { race });

        var r = await GetAsync(comp);

        Assert.Equal(5, CountOf(r, "Pole", "Lane"));
        Assert.Equal(2, r.Sessions);
        Assert.Equal(2, r.RacesCounted);
    }

    [Fact]
    public async Task Compute_SumsDistinctRacesWithinASession()
    {
        var one = Unique("sum1");
        var two = Unique("sum2");
        await SeedTemplateAsync(one, """[{"t":"pole"}]""");
        await SeedTemplateAsync(two, """[{"t":"pole"},{"t":"pole"}]""");
        var comp = await _f.SeedCompetitionAsync();
        await SeedSessionAsync(comp, new[] { 2 }, new[] { one, two });

        var r = await GetAsync(comp);

        Assert.Equal(6, CountOf(r, "Pole", "Lane")); // (1 + 2 poles) x 2 riders
        Assert.Equal(2, r.RacesCounted);
    }

    [Fact]
    public async Task Compute_IgnoresNonRaceSessions_EmptyHeats_AndRacesWithoutTemplates()
    {
        var comp = await _f.SeedCompetitionAsync();
        var known = Unique("known");
        await SeedTemplateAsync(known, """[{"t":"pole"}]""");
        await SeedSessionAsync(comp, new[] { 3 }, new[] { known }, SessionKind.Break);
        await SeedSessionAsync(comp, new[] { 3 }, new[] { Unique("no-template") });
        await _f.WithDbAsync(async db =>
        {
            var s = new Session { CompetitionId = comp, Name = "Empty", OrderIndex = 5 };
            s.Heats.Add(new Heat { Label = "H", OrderIndex = 1, Races = { new Race { Name = known, OrderIndex = 1 } } });
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
        });

        var r = await GetAsync(comp);

        Assert.Empty(r.Lines);
        Assert.Equal(2, r.Sessions); // the break is excluded, the empty and untemplated race sessions count
        Assert.Equal(0, r.RacesCounted);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    [InlineData("{ not json")]
    [InlineData("""{"t":"pole"}""")]
    public async Task Compute_CountsRaceButFindsNoEquipment_ForUnusableDiagrams(string? diagram)
    {
        var race = Unique("bad");
        await SeedTemplateAsync(race, diagram);
        var comp = await _f.SeedCompetitionAsync();
        await SeedSessionAsync(comp, new[] { 2 }, new[] { race });

        var r = await GetAsync(comp);

        Assert.Empty(r.Lines);
        Assert.Equal(1, r.RacesCounted);
    }

    [Fact]
    public async Task Compute_HandlesEmptyKindStrings()
    {
        var race = Unique("emptykind");
        await SeedTemplateAsync(race, """[{"t":"cone","kind":""}]""");
        var comp = await _f.SeedCompetitionAsync();
        await SeedSessionAsync(comp, new[] { 1 }, new[] { race });

        var r = await GetAsync(comp);

        Assert.Equal(1, CountOf(r, "", "Other"));
    }
}
