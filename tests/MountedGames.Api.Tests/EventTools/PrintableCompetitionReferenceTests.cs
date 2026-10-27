using System.Text.Json;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.EventTools;

public class PrintableCompetitionReferenceTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory]
    [InlineData("print/draw", false)]
    [InlineData("print/score-sheets", false)]
    [InlineData("print/results", false)]
    [InlineData("results-book", false)]
    [InlineData("results-book/organiser", true)]
    [InlineData("print/entries", true)]
    [InlineData("print/tack-check", true)]
    public async Task PrintHeadersCarryTheEventsOwnOptionalReference(string path, bool staffOnly)
    {
        var competitionId = await factory.SeedCompetitionAsync();
        var otherId = await factory.SeedCompetitionAsync();
        await factory.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(competitionId))!.CompetitionNumber = "TEST-EVENT-42";
            (await db.Competitions.FindAsync(otherId))!.CompetitionNumber = "TEST-OTHER-99";
            await db.SaveChangesAsync();
        });
        var client = staffOnly ? await factory.AdminAsync() : factory.CreateClient();
        var url = $"/api/event-tools/competitions/{competitionId}/{path}";

        using (var response = await client.GetAsync(url))
        {
            response.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.Equal("TEST-EVENT-42", json.RootElement.GetProperty("competition").GetProperty("competitionNumber").GetString());
        }

        await factory.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(competitionId))!.CompetitionNumber = null;
            await db.SaveChangesAsync();
        });
        using var withoutReference = await client.GetAsync(url);
        withoutReference.EnsureSuccessStatusCode();
        using var cleared = JsonDocument.Parse(await withoutReference.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Null, cleared.RootElement.GetProperty("competition").GetProperty("competitionNumber").ValueKind);
    }
}
