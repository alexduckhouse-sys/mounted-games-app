using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.DecForms;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests;

public class PassportVaccineTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static readonly DateTime EventStart = new(2031, 5, 20, 0, 0, 0, DateTimeKind.Utc);

    private async Task<(int Comp, int Section, int Club, int Team)> SeedEnabledCompetitionAsync(DateTime? start = null)
    {
        var comp = await f.SeedCompetitionAsync(start: start ?? EventStart);
        var section = await f.SeedSectionAsync(comp, "Under 15");
        var club = await f.SeedClubAsync();
        var team = await f.SeedTeamAsync(comp, section, club, "Rovers A");
        await f.WithDbAsync(async db =>
        {
            var c = await db.Competitions.FindAsync(comp);
            c!.EnablePassportCheck = true;
            await db.SaveChangesAsync();
        });
        return (comp, section, club, team);
    }

    private Task DeclarePonyAsync(int team, string riderName, string ponyName, string? passport = null, string? owner = null)
        => f.WithDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = team,
                SubmittedAt = EventStart,
                IsLocked = true,
                Riders =
                [
                    new RiderEntry
                    {
                        FullName = riderName,
                        HorseName = ponyName,
                        PonyPassportNumber = passport,
                        PonyOwnerFullName = owner,
                        OrderIndex = 1,
                    },
                ],
            });
            await db.SaveChangesAsync();
        });

    [Fact]
    public async Task LegacyCertificateNeverCertifiesAnotherEvent()
    {
        var (comp, _, _, team) = await SeedEnabledCompetitionAsync();
        await DeclarePonyAsync(team, "Fake Rider", "Fake Pony", "FAKE-PASSPORT", "Fake Owner");
        await f.WithDbAsync(async db => { db.Add(new CertifiedHorse { HorseName = "Fake Pony", HorseKey = "fake pony", PassportCode = "FAKE-PASSPORT", LastFluVaccineDate = "2031-01-01" }); await db.SaveChangesAsync(); });
        using var admin = await f.AdminAsync();
        var board = await (await admin.GetAsync($"/api/event-tools/competitions/{comp}/passport-check")).ReadAsync<PassportCheckBoardDto>();
        var pony = Assert.Single(board.Sections.Single().Teams.Single().Ponies);
        Assert.False(pony.Certified); Assert.Equal("Unchecked", pony.Status); Assert.Null(pony.LastFluVaccineDate); Assert.Equal(0, board.Checked);
        Assert.Equal(HttpStatusCode.Gone, (await admin.GetAsync("/api/event-tools/certified-horses/lookup?passportCode=FAKE-PASSPORT")).StatusCode);
    }

    [Theory]
    [InlineData("Oliver S", true)]
    [InlineData("Oliver S.", true)]
    [InlineData("  Maisie   J. ", true)]
    [InlineData("Oliver Smith", false)]
    [InlineData("Oliver", false)]
    public void HasSingleLetterSurnameInitial_DetectsInitialSurnames_AndSetsPrivacyFlags(string fullName, bool expected)
    {
        Assert.Equal(expected, DecFormRules.HasSingleLetterSurnameInitial(fullName));

        var entry = new RiderEntry { HorseName = "Pickle", PonyHeightHands = 13.2m };
        var input = new RiderEntryInput(
            SavedRiderId: null,
            FullName: fullName,
            DateOfBirth: new DateTime(2016, 4, 5, 0, 0, 0, DateTimeKind.Utc),
            HorseName: "Pickle",
            BibColour: null,
            IsCaptain: false,
            IsReserve: false,
            OrderIndex: 0,
            UseInitialOnly: false,
            PonyHeightHands: 13.2m,
            PonyOwnerFullName: "Jane Doe");
        var err = DecFormRules.Apply(DecFormConfig.Standard, lenient: false, input, isReserve: false, entry, 2031);
        Assert.Null(err);
        Assert.Equal(expected, entry.UseInitialOnly);
        Assert.Equal("Jane Doe", entry.PonyOwnerFullName);
    }

    [Fact]
    public async Task CompetitionDetail_RedactsPaymentDestinationForAnonymousCallers_AndIncludesItWhenAuthenticated()
    {
        var comp = await f.SeedCompetitionAsync();
        await f.WithDbAsync(async db =>
        {
            var c = await db.Competitions.FindAsync(comp);
            c!.PaymentDestination = "Sort code 12-34-56 Acc 12345678";
            await db.SaveChangesAsync();
        });

        var anon = f.CreateClient();
        var anonDetail = await (await anon.GetAsync($"/api/competitions/{comp}")).ReadAsync<CompetitionDetail>();
        var anonFirstView = await (await anon.GetAsync($"/api/competitions/{comp}/first-view")).ReadAsync<CompetitionDetail>();
        Assert.Null(anonDetail.PaymentDestination);
        Assert.Null(anonFirstView.PaymentDestination);

        var (member, _) = await f.SignupAsync("Member");
        var authedDetail = await (await member.GetAsync($"/api/competitions/{comp}")).ReadAsync<CompetitionDetail>();
        var authedFirstView = await (await member.GetAsync($"/api/competitions/{comp}/first-view")).ReadAsync<CompetitionDetail>();
        Assert.Equal("Sort code 12-34-56 Acc 12345678", authedDetail.PaymentDestination);
        Assert.Equal("Sort code 12-34-56 Acc 12345678", authedFirstView.PaymentDestination);
    }
}
