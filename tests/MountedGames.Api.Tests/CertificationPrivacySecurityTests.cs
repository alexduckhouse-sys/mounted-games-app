using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests;

public class CertificationPrivacySecurityTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private async Task<CertifiedHorse> Certificate()
    {
        var cert = new CertifiedHorse
        {
            PassportCode = "FAKE-" + Guid.NewGuid().ToString("N").ToUpperInvariant(), HorseName = "Fake Pony", HorseKey = "fake pony",
            OwnerFullName = "Fake Owner", OwnerKey = "fake owner", InspectedByName = "Fake Inspector",
            OfficialNotes = "Fake private inspection notes", InspectorRole = "Vet",
            LastFluVaccineDate = "2030-01-01", FluValidUntil = "2032-01-01",
            LastTetanusDate = "2030-01-01", TetanusValidUntil = "2032-01-01",
        };
        await f.WithDbAsync(async db => { db.Set<CertifiedHorse>().Add(cert); await db.SaveChangesAsync(); });
        return cert;
    }

    private async Task<int> Declare(int competition, CertifiedHorse cert, bool passport = true)
    {
        var section = await f.SeedSectionAsync(competition);
        var club = await f.SeedClubAsync();
        var team = await f.SeedTeamAsync(competition, section, club, "Fake team");
        await f.WithDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = team, IsLocked = true,
                Riders = [new RiderEntry { FullName = "Fake Rider", HorseName = cert.HorseName,
                    PonyPassportNumber = passport ? cert.PassportCode : null, PonyOwnerFullName = cert.OwnerFullName }],
            });
            await db.SaveChangesAsync();
        });
        return team;
    }

    private static string Lookup(CertifiedHorse cert, int? competition = null) =>
        $"/api/event-tools/certified-horses/lookup?passportCode={cert.PassportCode}"
        + (competition is null ? "" : $"&competitionId={competition}");

    private static void AssertMinimal(CertifiedHorseLookupDto dto)
    {
        Assert.True(dto.Found);
        Assert.Null(dto.PassportCode);
        Assert.Null(dto.HorseName);
        Assert.Null(dto.OwnerFullName);
        Assert.Null(dto.LastFluVaccineDate);
        Assert.Null(dto.FluValidUntil);
        Assert.Null(dto.LastTetanusDate);
        Assert.Null(dto.TetanusValidUntil);
        Assert.Null(dto.InspectorRole);
        Assert.Null(dto.InspectedByName);
        Assert.Null(dto.InspectedAt);
        Assert.Null(dto.OfficialNotes);
    }

    [Fact]
    public async Task MemberAndUnrelatedStaffSeeOnlyStatusEvenWithCompetitionId()
    {
        var cert = await Certificate();
        var (_, ownerAuth) = await f.ApprovedTrainerAsync();
        var competition = await f.SeedCompetitionAsync(ownerUserId: ownerAuth.User.Id);
        await Declare(competition, cert);
        var (member, _) = await f.SignupAsync("Member");
        var (outsider, _) = await f.ApprovedTrainerAsync();
        foreach (var client in new[] { member, outsider })
            AssertMinimal(await (await client.GetAsync(Lookup(cert, competition))).ReadAsync<CertifiedHorseLookupDto>());
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync(Lookup(cert))).StatusCode);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task EventOwnerGetsDetailsOnlyAfterMatchingHorseIsDeclared(bool passport)
    {
        var cert = await Certificate();
        var (owner, auth) = await f.ApprovedTrainerAsync();
        var competition = await f.SeedCompetitionAsync(ownerUserId: auth.User.Id);
        AssertMinimal(await (await owner.GetAsync(Lookup(cert, competition))).ReadAsync<CertifiedHorseLookupDto>());
        await Declare(competition, cert, passport);
        var dto = await (await owner.GetAsync(Lookup(cert, competition))).ReadAsync<CertifiedHorseLookupDto>();
        Assert.Equal(cert.PassportCode, dto.PassportCode);
        Assert.Equal(cert.OfficialNotes, dto.OfficialNotes);
        Assert.Equal(cert.InspectedByName, dto.InspectedByName);
        // Supplying a known horse alongside an unrelated passport must not authorise that passport's result.
        var unrelated = await Certificate();
        await f.WithDbAsync(async db =>
        {
            var row = await db.Set<CertifiedHorse>().FindAsync(unrelated.Id);
            row!.HorseName = "Other Fake Pony"; row.HorseKey = "other fake pony";
            await db.SaveChangesAsync();
        });
        var spoof = Lookup(unrelated, competition) + "&ponyName=Fake%20Pony&ownerFullName=Fake%20Owner";
        AssertMinimal(await (await owner.GetAsync(spoof)).ReadAsync<CertifiedHorseLookupDto>());
    }

    [Fact]
    public async Task AdminCanInspectCertificateWithoutAnEvent()
    {
        var cert = await Certificate();
        using var admin = await f.AdminAsync();
        var dto = await (await admin.GetAsync(Lookup(cert))).ReadAsync<CertifiedHorseLookupDto>();
        Assert.Equal(cert.PassportCode, dto.PassportCode);
        Assert.Equal(cert.OwnerFullName, dto.OwnerFullName);
        Assert.Equal(cert.OfficialNotes, dto.OfficialNotes);
    }
}
