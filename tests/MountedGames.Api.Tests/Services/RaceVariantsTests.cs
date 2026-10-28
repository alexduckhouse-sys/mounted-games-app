using System.Net;
using System.Text.Json;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Services;

public class RaceVariantsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public RaceVariantsTests(ApiFactory f) => _f = f;

    [Theory]
    [InlineData("Bending", SectionFormat.Pairs, "Bending (Pairs)")]
    [InlineData("bending", SectionFormat.Pairs, "Bending (Pairs)")]
    [InlineData("Pole Bending", SectionFormat.Pairs, "Bending (Pairs)")]
    [InlineData("Bending", SectionFormat.Teams, "Bending")]
    [InlineData("Bending", null, "Bending")]
    [InlineData("Bending (Pairs)", SectionFormat.Individual, "Bending (Pairs)")]
    [InlineData("A race nobody wrote", SectionFormat.Pairs, "A race nobody wrote")]
    public void Resolve_PicksTheSectionsVersion(string name, SectionFormat? format, string expected)
        => Assert.Equal(expected, RaceVariants.Resolve(name, format));

    [Fact]
    public void Resolve_BendingHasNoIndividualVersion_SoIndividualsRideTheTeamRace()
        => Assert.Equal("Bending", RaceVariants.Resolve("Bending", SectionFormat.Individual));

    [Fact]
    public void Resolve_SponsoredNamesUseTheirBaseRacesVersion()
    {
        var pairs = RaceLibraryVariants.All.Where(v => v.Format == SectionFormat.Pairs)
            .ToDictionary(v => v.BaseName, v => v.Name, StringComparer.OrdinalIgnoreCase);
        foreach (var (sponsored, baseName) in RaceVariants.BaseOf)
        {
            var expected = pairs.TryGetValue(baseName, out var variant) ? variant : sponsored;
            Assert.Equal(expected, RaceVariants.Resolve(sponsored, SectionFormat.Pairs));
        }
    }

    [Fact]
    public void BaseOf_NamesRacesThatExist()
    {
        var names = RaceLibrarySeed.Core.Select(e => e.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        Assert.All(RaceVariants.BaseOf.Values, baseName => Assert.Contains(baseName, names));
    }

    [Fact]
    public void Describe_TellsVariantsAndSponsoredNamesApart()
    {
        Assert.Equal(("Bending", SectionFormat.Pairs), RaceVariants.Describe("Bending (Pairs)"));
        Assert.Equal(("Five Flag", (SectionFormat?)null), RaceVariants.Describe("5 Flag"));
        Assert.Equal(((string?)null, (SectionFormat?)null), RaceVariants.Describe("Bending"));
    }

    [Fact]
    public async Task ByName_WithAPairsFormat_ReturnsThePairsVersion()
    {
        var client = _f.CreateClient();
        var pairs = await client.GetAsync("/api/race-templates/by-name/Bending?format=1");
        Assert.Equal(HttpStatusCode.OK, pairs.StatusCode);
        Assert.Equal("Bending (Pairs)", (await pairs.ReadAsync<JsonElement>()).GetProperty("name").GetString());

        var teams = await client.GetAsync("/api/race-templates/by-name/Bending");
        Assert.Equal("Bending", (await teams.ReadAsync<JsonElement>()).GetProperty("name").GetString());

        var individual = await client.GetAsync("/api/race-templates/by-name/Bending?format=3");
        Assert.Equal("Bending", (await individual.ReadAsync<JsonElement>()).GetProperty("name").GetString());
    }

    [Fact]
    public async Task List_MarksVariantsWithTheirBaseAndFormat()
    {
        var r = await _f.CreateClient().GetAsync("/api/race-templates");
        var list = await r.ReadAsync<List<RaceTemplateDto>>();
        var pairs = Assert.Single(list, t => t.Name == "Bending (Pairs)");
        Assert.Equal("Bending", pairs.BaseName);
        Assert.Equal(SectionFormat.Pairs, pairs.Format);
        var team = Assert.Single(list, t => t.Name == "Bending");
        Assert.Null(team.BaseName);
        Assert.Null(team.Format);
    }

    [Fact]
    public async Task Equipment_PairsSessionsCountThePairsKit()
    {
        var teams = await EquipmentForAsync(SectionFormat.Teams, "Ball and Bucket");
        var pairs = await EquipmentForAsync(SectionFormat.Pairs, "Ball and Bucket");
        int Balls(EquipmentController.EquipmentResponse r) => r.Lines.Where(l => l.Kind == "Ball").Sum(l => l.Count);
        Assert.True(Balls(pairs) > 0);
        Assert.True(Balls(pairs) < Balls(teams), $"pairs {Balls(pairs)} should need fewer balls than teams {Balls(teams)}");
    }

    private async Task<EquipmentController.EquipmentResponse> EquipmentForAsync(SectionFormat format, string race)
    {
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        var teams = new List<int>();
        for (var i = 0; i < 4; i++) teams.Add(await _f.SeedTeamAsync(comp, section, club));
        await _f.WithDbAsync(async db =>
        {
            (await db.CompetitionSections.FindAsync(section))!.Format = format;
            var session = new Session { CompetitionId = comp, CompetitionSectionId = section, Name = "S", OrderIndex = 1, Kind = SessionKind.Race };
            var heat = new Heat { Label = "H1", OrderIndex = 1 };
            for (var e = 0; e < teams.Count; e++) heat.Entries.Add(new HeatEntry { TeamId = teams[e], LaneIndex = e + 1 });
            heat.Races.Add(new Race { Name = race, OrderIndex = 1 });
            session.Heats.Add(heat);
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
        });
        var r = await _f.CreateClient().GetAsync($"/api/competitions/{comp}/equipment");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.ReadAsync<EquipmentController.EquipmentResponse>();
    }
}
