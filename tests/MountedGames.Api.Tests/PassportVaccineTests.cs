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
    public async Task VetInspection_CertifiesHorseAcrossCompetitions_AndSupportsLiveLookup()
    {
        var (comp1, _, club, team1) = await SeedEnabledCompetitionAsync(EventStart);
        await DeclarePonyAsync(team1, "Amy Archer", "Bramble", passport: "GBR-826099111", owner: "Sarah Clarke");
        var admin = await f.AdminAsync();

        var r = await admin.PutAsJsonAsync($"/api/event-tools/competitions/{comp1}/passport-check/teams/{team1}",
            new SetPassportCheckRequest(
                PonyName: "Bramble",
                Checked: true,
                PassportCode: "gbr-826099111",
                OwnerFullName: "Sarah Clarke",
                LastFluVaccineDate: "2031-01-10",
                FluValidUntil: null, // defaults to +12m -> 2032-01-10
                LastTetanusDate: "2030-06-01",
                TetanusValidUntil: null, // defaults to +24m -> 2032-06-01
                InspectorRole: "Vet",
                OfficialNotes: "Passports and boosters verified"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var pony = await r.ReadAsync<PassportCheckPonyDto>();
        Assert.True(pony.Certified);
        Assert.Equal("Certified", pony.Status);
        Assert.NotNull(pony.CheckedAt);
        Assert.Equal("GBR-826099111", pony.PassportCode);
        Assert.Equal("Sarah Clarke", pony.OwnerFullName);
        Assert.Equal("2032-01-10", pony.FluValidUntil);
        Assert.Equal("2032-06-01", pony.TetanusValidUntil);
        Assert.Equal("Vet", pony.InspectorRole);
        Assert.Equal("Passports and boosters verified", pony.OfficialNotes);

        // Live lookup by passportCode
        var lookupByCode = await (await admin.GetAsync($"/api/event-tools/certified-horses/lookup?passportCode=gbr-826099111&competitionId={comp1}"))
            .ReadAsync<CertifiedHorseLookupDto>();
        Assert.True(lookupByCode.Found);
        Assert.True(lookupByCode.Certified);
        Assert.Equal("Certified", lookupByCode.Status);
        Assert.Equal("Passports and boosters verified", lookupByCode.OfficialNotes);

        // Live lookup by ponyName + ownerFullName
        var lookupByOwner = await (await admin.GetAsync($"/api/event-tools/certified-horses/lookup?ponyName=Bramble&ownerFullName=Sarah%20Clarke&competitionId={comp1}"))
            .ReadAsync<CertifiedHorseLookupDto>();
        Assert.True(lookupByOwner.Found);
        Assert.True(lookupByOwner.Certified);
        Assert.Equal("GBR-826099111", lookupByOwner.PassportCode);

        // Second competition while vaccine dates are still valid: automatically certified on the board!
        var (comp2, _, _, team2) = await SeedEnabledCompetitionAsync(EventStart.AddMonths(2));
        await DeclarePonyAsync(team2, "Amy Archer", "Bramble", owner: "Sarah Clarke");
        var board2 = await (await admin.GetAsync($"/api/event-tools/competitions/{comp2}/passport-check")).ReadAsync<PassportCheckBoardDto>();
        Assert.Equal(1, board2.Checked);
        var pony2 = Assert.Single(board2.Sections.Single().Teams.Single().Ponies);
        Assert.True(pony2.Certified);
        Assert.Equal("Certified", pony2.Status);
        Assert.Equal("Passports and boosters verified", pony2.OfficialNotes);
    }

    [Fact]
    public async Task AutoExpiry_RemovesCertifiedTickWhenVaccineOrTetanusDateRunsOut_KeepingNotesVisible()
    {
        var (comp1, _, _, team1) = await SeedEnabledCompetitionAsync(EventStart);
        await DeclarePonyAsync(team1, "Ben Brook", "Pepper", passport: "GBR-826000222", owner: "Tom Brook");
        var admin = await f.AdminAsync();

        // Inspect at comp1 with FluValidUntil before a future competition
        var r = await admin.PutAsJsonAsync($"/api/event-tools/competitions/{comp1}/passport-check/teams/{team1}",
            new SetPassportCheckRequest(
                PonyName: "Pepper",
                Checked: true,
                PassportCode: "GBR-826000222",
                OwnerFullName: "Tom Brook",
                LastFluVaccineDate: "2030-04-01",
                FluValidUntil: "2031-04-01", // already expired relative to EventStart (2031-05-20)!
                LastTetanusDate: "2030-04-01",
                TetanusValidUntil: "2032-04-01",
                InspectorRole: "Vet",
                OfficialNotes: "Annual booster due after April 2031"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var expiredPony = await r.ReadAsync<PassportCheckPonyDto>();
        Assert.False(expiredPony.Certified);
        Assert.Equal("Expired", expiredPony.Status);
        Assert.Null(expiredPony.CheckedAt); // tick is automatically removed!
        Assert.Equal("2030-04-01", expiredPony.LastFluVaccineDate);
        Assert.Equal("2031-04-01", expiredPony.FluValidUntil);
        Assert.Equal("Vet", expiredPony.InspectorRole);
        Assert.Equal("Annual booster due after April 2031", expiredPony.OfficialNotes);

        var board = await (await admin.GetAsync($"/api/event-tools/competitions/{comp1}/passport-check")).ReadAsync<PassportCheckBoardDto>();
        Assert.Equal(0, board.Checked);

        var lookup = await (await admin.GetAsync($"/api/event-tools/certified-horses/lookup?passportCode=GBR-826000222&competitionId={comp1}"))
            .ReadAsync<CertifiedHorseLookupDto>();
        Assert.True(lookup.Found);
        Assert.False(lookup.Certified);
        Assert.Equal("Expired", lookup.Status);
        Assert.Equal("Annual booster due after April 2031", lookup.OfficialNotes);
    }

    [Fact]
    public async Task SevenDayPostVaccinationRule_FlagsTooRecentFluBooster()
    {
        var (comp, _, _, team) = await SeedEnabledCompetitionAsync(EventStart);
        await DeclarePonyAsync(team, "Chloe Cole", "Acorn", passport: "GBR-826000333");
        var admin = await f.AdminAsync();

        // Flu booster given 3 days before EventStart (2031-05-17 vs 2031-05-20)
        var r = await admin.PutAsJsonAsync($"/api/event-tools/competitions/{comp}/passport-check/teams/{team}",
            new SetPassportCheckRequest(
                PonyName: "Acorn",
                Checked: true,
                PassportCode: "GBR-826000333",
                LastFluVaccineDate: "2031-05-17",
                InspectorRole: "Official",
                OfficialNotes: "Booster given 3 days before arrival"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<PassportCheckPonyDto>();
        Assert.False(dto.Certified);
        Assert.Equal("TooRecent", dto.Status);
        Assert.Null(dto.CheckedAt);
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
