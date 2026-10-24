using System.Net;
using MountedGames.Api.Controllers;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests;

public class EquipmentCalculatorTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public EquipmentCalculatorTests(ApiFactory f) => _f = f;

    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    private Task SeedTemplateAsync(string name, string? diagram)
        => _f.WithDbAsync(async db =>
        {
            db.RaceTemplates.Add(new RaceTemplate { Name = name, DiagramJson = diagram });
            await db.SaveChangesAsync();
        });

    private async Task SeedArenaSessionAsync(int comp, string? arenaName, int heatSize, params string[] raceNames)
    {
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        var teams = new List<int>();
        for (var i = 0; i < heatSize; i++) teams.Add(await _f.SeedTeamAsync(comp, section, club));
        await _f.WithDbAsync(async db =>
        {
            var s = new Session
            {
                CompetitionId = comp,
                CompetitionSectionId = section,
                Name = $"Session {arenaName}",
                ArenaName = arenaName,
                OrderIndex = 1,
                Kind = SessionKind.Race,
            };
            var heat = new Heat { Label = "H1", OrderIndex = 1 };
            for (var e = 0; e < heatSize; e++) heat.Entries.Add(new HeatEntry { TeamId = teams[e], LaneIndex = e + 1 });
            for (var r = 0; r < raceNames.Length; r++) heat.Races.Add(new Race { Name = raceNames[r], OrderIndex = r + 1 });
            s.Heats.Add(heat);
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
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
    public async Task Compute_SumsAcrossDistinctArenas_AndTakesMaxWithinSameArena()
    {
        var race = Unique("MultiArena");
        await SeedTemplateAsync(race, """[{"t":"pole"},{"t":"pole"},{"t":"pole"},{"t":"pole"}]""");
        var comp = await _f.SeedCompetitionAsync();

        // Arena 1 has two sequential sessions (4 lanes and 6 lanes -> max = 24 poles).
        await SeedArenaSessionAsync(comp, "Arena 1", 4, race);
        await SeedArenaSessionAsync(comp, "arena 1", 6, race);
        // Arena 2 runs concurrently (5 lanes -> 20 poles).
        await SeedArenaSessionAsync(comp, "Arena 2", 5, race);

        var r = await GetAsync(comp);

        // Total across Arena 1 (24) + Arena 2 (20) = 44 poles.
        Assert.Equal(44, CountOf(r, "Pole", "Lane"));
        Assert.Equal(3, r.Sessions);
    }

    [Fact]
    public async Task Compute_SkipsLaneElements_AndWalksArbitraryStackDepth()
    {
        var race = Unique("DeepStack");
        await SeedTemplateAsync(race, """
            [
              {"t":"lane","poles":4},
              {"t":"in","anchor":"beyond","x":96,"on":[
                {"t":"item","kind":"bucket","on":[
                  {"t":"item","kind":"box","on":[
                    {"t":"item","kind":"ball"}
                  ]}
                ]}
              ]}
            ]
            """);
        var comp = await _f.SeedCompetitionAsync();
        await SeedArenaSessionAsync(comp, "Main Arena", 4, race);

        var r = await GetAsync(comp);

        Assert.DoesNotContain(r.Lines, l => l.Kind.Equals("Lane", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(4, CountOf(r, "In / station", "Top"));
        Assert.Equal(4, CountOf(r, "Bucket", "Top"));
        Assert.Equal(4, CountOf(r, "Box", "Top"));
        Assert.Equal(4, CountOf(r, "Ball", "Top"));
    }

    [Fact]
    public async Task Compute_UsesNonPositionalLabelWhenKindIsMissing_AndIgnoresPositionalLabels()
    {
        var race = Unique("Labels");
        await SeedTemplateAsync(race, """
            [
              {"t":"item","label":"Gibbet","anchor":"beyond","x":96},
              {"t":"cone","label":"1","anchor":"pole1","x":17},
              {"t":"cone","label":"P2","anchor":"pole2","x":39},
              {"t":"cone","label":"Cone 3","anchor":"pole3","x":61}
            ]
            """);
        var comp = await _f.SeedCompetitionAsync();
        await SeedArenaSessionAsync(comp, "Main Arena", 2, race);

        var r = await GetAsync(comp);

        Assert.Equal(2, CountOf(r, "Gibbet", "Top"));
        Assert.Equal(6, CountOf(r, "Cone", "Lane"));
    }

    [Fact]
    public async Task Compute_ClassifiesBeyondAndGapAnchorsByCoordinates()
    {
        var race = Unique("GapBuckets");
        await SeedTemplateAsync(race, """
            [
              {"t":"item","kind":"baton","anchor":"gap0","x":8.5},
              {"t":"item","kind":"sock","anchor":"gap0"},
              {"t":"item","kind":"bucket","anchor":"gap2","x":50},
              {"t":"item","kind":"bin","anchor":"gap2"},
              {"t":"item","kind":"ball","anchor":"gap4","x":91.5},
              {"t":"item","kind":"flag","anchor":"beyond","x":96},
              {"t":"item","kind":"mug","x":30}
            ]
            """);
        var comp = await _f.SeedCompetitionAsync();
        await SeedArenaSessionAsync(comp, "Main Arena", 2, race);

        var r = await GetAsync(comp);

        Assert.Equal(2, CountOf(r, "Baton", "Start"));
        Assert.Equal(2, CountOf(r, "Sock", "Start"));
        Assert.Equal(2, CountOf(r, "Bucket", "Lane"));
        Assert.Equal(2, CountOf(r, "Bin", "Lane"));
        Assert.Equal(2, CountOf(r, "Ball", "Top"));
        Assert.Equal(2, CountOf(r, "Flag", "Top"));
        Assert.Equal(2, CountOf(r, "Mug", "Lane"));
    }

    [Fact]
    public async Task Official2026RaceTemplates_Reflect2026RulebookAndDiagrams()
    {
        var templates = MountedGames.Api.Services.RaceLibrarySeed.All
            .ToDictionary(t => t.Name, StringComparer.OrdinalIgnoreCase);
        var updates = MountedGames.Api.Services.RaceLibraryUpdates.ByName;

        Assert.Contains("bucket on the Centre Line", templates["Old Sock"].Rules, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("bucket on the Centre Line", updates["Old Sock"].Rules!, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(templates["Old Sock"].DiagramJson, updates["Old Sock"].DiagramJson);

        Assert.Contains("Penny Dish containing four sock-balls", templates["Old Sock (JV)"].Rules, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Bucket is placed on the Centre Line", updates["Old Sock (JV)"].Rules!, StringComparison.OrdinalIgnoreCase);

        Assert.Contains("3 m behind the Changeover Line", templates["Five Flag"].Rules, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("3 metres behind the Changeover Line", updates["Five Flag"].Rules!, StringComparison.OrdinalIgnoreCase);

        Assert.Contains("four hooks facing", templates["Spell EGUK (JV)"].Rules, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Bending Pole is placed on the Centre Line", templates["STRUK Pole (JV)"].Rules, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("14 m from the Start/Finish Line", templates["Bending"].Rules, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("14 m from the line", updates["Bending"].Rules!, StringComparison.OrdinalIgnoreCase);

        var comp = await _f.SeedCompetitionAsync();
        await SeedArenaSessionAsync(comp, "Main Arena", 4, "Old Sock", "Five Flag", "STRUK Pole (JV)");
        var r = await GetAsync(comp);

        Assert.Equal(4, CountOf(r, "Pole", "Lane"));
        Assert.Equal(8, CountOf(r, "Bucket", "Lane") + CountOf(r, "Bucket", "Top"));
        Assert.Equal(16, CountOf(r, "Sock", "Top"));
        Assert.Equal(4, CountOf(r, "Sock", "Start"));
        Assert.Equal(4, CountOf(r, "Flag", "Start"));
    }
}
