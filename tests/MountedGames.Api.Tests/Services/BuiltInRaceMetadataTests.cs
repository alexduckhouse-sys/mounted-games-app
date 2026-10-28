using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Services;

public class BuiltInRaceMetadataTests
{
    [Fact]
    public void StoredNotesAreNotInventedOfficialRulesForOtherOrganisations()
    {
        var detail = BuiltInRaceMetadata.ToDetailDto(new RaceTemplate { Id = 12, Name = "Test game", Rules = "Test stored race notes.", DiagramJson = "[]" });
        Assert.Equal(4, detail.Rulebooks.Count);
        Assert.All(detail.Rulebooks, book => {
            Assert.Contains("not verified", book.Edition);
            Assert.Equal("Test stored race notes.", book.HowToRide);
            Assert.DoesNotContain("6 m", book.Setup);
            Assert.Contains("rulebook", book.Penalties);
        });
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-json")]
    [InlineData("{}")]
    public void MissingOrLegacyDiagramsRemainReadable(string? json)
    {
        Assert.Equal(json, BuiltInRaceMetadata.NormaliseDiagramJson(json));
        var detail = BuiltInRaceMetadata.ToDetailDto(new RaceTemplate { Name = "Test game", DiagramJson = json });
        Assert.All(detail.Rulebooks, book => Assert.Contains("Race notes", book.HowToRide));
    }

    [Fact]
    public void CanonicalSlotsKeepTheFifthPoleBeyondChangeoverAndCountStackedEquipment()
    {
        const string json = """[{"t":"midline"},{"t":"pole","anchor":"pole1","x":12},{"t":"pole","anchor":"pole3","x":50},{"t":"pole","anchor":"pole5","x":88},{"t":"table","anchor":"beyond","on":[{"t":"item","kind":"mug"}]}]""";
        var detail = BuiltInRaceMetadata.ToDetailDto(new RaceTemplate { Name = "Test game", Rules = "Test setup.", DiagramJson = json });
        Assert.Contains("\"x\":22", detail.DiagramJson);
        Assert.Contains("\"x\":55", detail.DiagramJson);
        Assert.Contains("\"x\":110", detail.DiagramJson);
        Assert.Contains("Mug", detail.Rulebooks[0].Equipment);
        Assert.Contains("Beyond the Changeover line", detail.Rulebooks[0].Setup);
        Assert.Null(BuiltInRaceMetadata.FromBuiltInSeed("missing-test-race"));
        Assert.NotNull(BuiltInRaceMetadata.FromBuiltInSeed(RaceLibrarySeed.All.First().Name));
    }
}
