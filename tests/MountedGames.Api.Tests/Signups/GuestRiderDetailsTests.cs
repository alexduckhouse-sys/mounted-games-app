using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Controllers;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

/// <summary>
/// A parent entering a child as a guest or individual rider gives the rider's name, date of birth and pony, plus their
/// own and an emergency contact's phone. They are kept, shown to the competition's staff and the person who entered,
/// carried into team formation, and never appear anywhere public.
/// </summary>
public class GuestRiderDetailsTests : IClassFixture<ApiFactory>
{
    // Obviously fake details, so a leak is easy to spot in any response body.
    private const string Rider = "Fakerider Testchild";
    private const string Pony = "Synthetic Ponyname";
    private const string Guardian = "Fakeparent Testadult";
    private const string GuardianPhone = "07700 900123";
    private const string Emergency = "Fakeaunt Testcontact";
    private const string EmergencyPhone = "07700 900456";

    private readonly ApiFactory _f;
    public GuestRiderDetailsTests(ApiFactory f) => _f = f;

    private static CreateSectionSignupInput Entry(string? dob = "2015-04-05", bool wholeTeam = false, string? guardianPhone = GuardianPhone,
        string? emergencyPhone = EmergencyPhone) =>
        new("Fakeparent Testadult", "Synthetic Guest Club", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion,
            RequestId: Guid.NewGuid().ToString("N"), WholeTeam: wholeTeam, TeamName: wholeTeam ? "Synthetic Whole Team" : null,
            RiderName: $"  {Rider} ", RiderDateOfBirth: dob, PonyName: Pony,
            GuardianName: Guardian, GuardianPhone: guardianPhone, EmergencyContactName: Emergency, EmergencyContactPhone: emergencyPhone);

    private static Task<HttpResponseMessage> EnterAsync(HttpClient entrant, CompetitionSection section, CreateSectionSignupInput input) =>
        entrant.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups", input);

    private static void AssertNoGuestDetails(string body)
    {
        foreach (var secret in new[] { Pony, Guardian, Emergency, "07700900123", "07700900456", GuardianPhone, EmergencyPhone, "2015-04-05" })
            Assert.DoesNotContain(secret, body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TheDetailsAreSaved_AndShownToTheEntrantAndTheStaff()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Individual, priceMinor: 1000);
        var (entrant, _) = await _f.SignupAsync();

        var response = await EnterAsync(entrant, section, Entry());

        response.EnsureSuccessStatusCode();
        var created = await response.ReadAsync<SectionSignupExtendedDto>();
        var expected = new SignupGuestDetailsDto(Rider, new DateOnly(2015, 4, 5), Pony, Guardian, "07700900123", Emergency, "07700900456");
        Assert.Equal(expected, created.Guest);
        var admin = await _f.AdminAsync();
        var staff = await (await admin.GetAsync($"/api/competitions/{section.CompetitionId}/signups")).ReadAsync<List<SectionSignupExtendedDto>>();
        Assert.Equal(expected, Assert.Single(staff).Guest);
        var mine = await (await entrant.GetAsync("/api/me/signups")).ReadAsync<List<MySignupExtendedDto>>();
        Assert.Equal(expected, Assert.Single(mine).Guest);
        await _f.InDbAsync(async db =>
        {
            var row = await db.Set<SignupGuestDetails>().SingleAsync(x => x.SignupId == created.Id);
            Assert.Equal(new DateTime(2015, 4, 5), row.RiderDateOfBirth);
        });
    }

    [Fact]
    public async Task TheDetails_NeverAppearInPublicResponses_OrToOtherPeople()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Individual, priceMinor: 1000);
        var (entrant, _) = await _f.SignupAsync();
        var created = await (await EnterAsync(entrant, section, Entry())).ReadAsync<SectionSignupExtendedDto>();
        var admin = await _f.AdminAsync();
        (await admin.PostAsync($"/api/competitions/{section.CompetitionId}/signups/{created.Id}/mark-paid", null)).EnsureSuccessStatusCode();
        var anonymous = _f.CreateClient();
        var (stranger, _) = await _f.SignupAsync();

        foreach (var path in new[]
        {
            $"/api/competitions/{section.CompetitionId}",
            $"/api/competitions/{section.CompetitionId}/teams",
            $"/api/competitions/{section.CompetitionId}/matchmaking",
            $"/api/competitions/{section.CompetitionId}/standings",
            $"/api/share/competitions/{section.CompetitionId}",
        })
        {
            foreach (var client in new[] { anonymous, stranger })
            {
                var publicResponse = await client.GetAsync(path);
                AssertNoGuestDetails(await publicResponse.Content.ReadAsStringAsync());
            }
        }

        // Staff-only lists stay staff-only, and someone else's signups don't include this one.
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/competitions/{section.CompetitionId}/signups")).StatusCode);
        Assert.False((await stranger.GetAsync($"/api/competitions/{section.CompetitionId}/signups")).IsSuccessStatusCode);
        AssertNoGuestDetails(await (await stranger.GetAsync("/api/me/signups")).Content.ReadAsStringAsync());
    }

    [Fact]
    public void TheDtosThePublicSees_HaveNoGuestFields()
    {
        // A field added to a public record later would leak these by default, so the shapes are checked too.
        string[] guestFields = ["Guest", "RiderDateOfBirth", "GuardianName", "GuardianPhone", "EmergencyContactName", "EmergencyContactPhone", "PonyName"];
        foreach (var type in new[] { typeof(MountedGames.Api.Dtos.SectionSignupDto), typeof(MatchmakingEntryDto), typeof(MountedGames.Api.Dtos.CompetitionDetail),
                     typeof(MountedGames.Api.Dtos.TeamDto) })
            Assert.Empty(type.GetProperties().Select(p => p.Name).Intersect(guestFields));
    }

    [Fact]
    public async Task TeamFormation_NamesTheRider_NotTheParent()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Individual, priceMinor: 1000);
        var (entrant, _) = await _f.SignupAsync();
        var created = await (await EnterAsync(entrant, section, Entry())).ReadAsync<SectionSignupExtendedDto>();
        var admin = await _f.AdminAsync();

        (await admin.PostAsync($"/api/competitions/{section.CompetitionId}/signups/{created.Id}/mark-paid", null)).EnsureSuccessStatusCode();

        var team = await _f.InDbAsync(db => db.Teams.AsNoTracking().SingleAsync(t => t.CompetitionSectionId == section.Id));
        Assert.Equal(Rider, team.DisplayName);
    }

    [Theory]
    [InlineData("2099-01-01", null, EmergencyPhone)]
    [InlineData("not a date", GuardianPhone, EmergencyPhone)]
    [InlineData("2015-04-05", null, EmergencyPhone)]
    [InlineData("2015-04-05", "12345", EmergencyPhone)]
    [InlineData("2015-04-05", GuardianPhone, "not a phone")]
    public async Task BadDetails_AreRefused_AndNothingIsSaved(string dob, string? guardianPhone, string? emergencyPhone)
    {
        var section = await _f.NewSectionAsync(SectionFormat.Individual);
        var (entrant, _) = await _f.SignupAsync();

        var response = await EnterAsync(entrant, section, Entry(dob, guardianPhone: guardianPhone, emergencyPhone: emergencyPhone));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await _f.InDbAsync(db => db.SectionSignups.Where(s => s.CompetitionSectionId == section.Id).ToListAsync()));
    }

    [Fact]
    public void ParseGuestDetails_RefusesOverlongNames_EvenWithoutModelValidation()
    {
        var error = SignupController.ParseGuestDetails(Entry() with { PonyName = new string('p', SignupGuestDetails.MaxNameLength + 1) },
            DateTime.UtcNow, out var details);

        Assert.Equal("Names must be 120 characters or fewer.", error);
        Assert.Null(details);
    }

    [Fact]
    public async Task AUkDateOfBirth_IsAccepted_AndAnEntryWithNoGuestDetailsStoresNone()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Individual);
        var (entrant, _) = await _f.SignupAsync();

        var uk = await (await EnterAsync(entrant, section, Entry("05/04/2015"))).ReadAsync<SectionSignupExtendedDto>();
        var plain = await (await EnterAsync(entrant, section, new CreateSectionSignupInput("Synthetic Adult Rider", null, null,
            AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, RequestId: Guid.NewGuid().ToString("N")))).ReadAsync<SectionSignupExtendedDto>();

        Assert.Equal(new DateOnly(2015, 4, 5), uk.Guest!.RiderDateOfBirth);
        Assert.Null(plain.Guest);
        Assert.False(await _f.InDbAsync(db => db.Set<SignupGuestDetails>().AnyAsync(x => x.SignupId == plain.Id)));
    }

    [Fact]
    public async Task AWholeTeamEntry_KeepsNoGuestDetails()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Teams);
        var trainer = await _f.TrainerAsync();

        var created = await (await EnterAsync(trainer, section, Entry(wholeTeam: true))).ReadAsync<SectionSignupExtendedDto>();

        Assert.Null(created.Guest);
        Assert.False(await _f.InDbAsync(db => db.Set<SignupGuestDetails>().AnyAsync(x => x.SignupId == created.Id)));
    }

    [Fact]
    public async Task ARetriedSubmit_ReturnsTheSameDetailsOnce()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Individual);
        var (entrant, _) = await _f.SignupAsync();
        var input = Entry();

        var first = await (await EnterAsync(entrant, section, input)).ReadAsync<SectionSignupExtendedDto>();
        var again = await (await EnterAsync(entrant, section, input)).ReadAsync<SectionSignupExtendedDto>();

        Assert.Equal(first.Id, again.Id);
        Assert.Equal(first.Guest, again.Guest);
        Assert.Equal(1, await _f.InDbAsync(db => db.Set<SignupGuestDetails>().CountAsync(x => x.SignupId == first.Id)));
    }

    [Fact]
    public async Task AnExistingSqliteDatabaseGainsTheTable_AndKeepsItsRowsOnRestart()
    {
        using var factory = new ApiFactory();
        var section = await factory.NewSectionAsync(SectionFormat.Individual);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var signup = new SectionSignup { CompetitionSectionId = section.Id, FullName = "Synthetic schema entrant" };
        db.Add(signup);
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE \"SignupGuestDetails\";");

        await EntryExtensionsSqliteSchema.EnsureAsync(db);
        db.Add(new SignupGuestDetails { SignupId = signup.Id, RiderName = "Synthetic schema rider", RiderDateOfBirth = new DateTime(2014, 1, 2) });
        await db.SaveChangesAsync();
        await EntryExtensionsSqliteSchema.EnsureAsync(db); // safe to run again
        db.ChangeTracker.Clear();

        var row = await db.Set<SignupGuestDetails>().SingleAsync(x => x.SignupId == signup.Id);
        Assert.Equal(("Synthetic schema rider", new DateTime(2014, 1, 2)), (row.RiderName, row.RiderDateOfBirth));
        Assert.Equal(1, await db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM pragma_foreign_key_list('SignupGuestDetails')").SingleAsync());
        // The details go with their entry.
        await db.SectionSignups.Where(s => s.Id == signup.Id).ExecuteDeleteAsync();
        Assert.False(await db.Set<SignupGuestDetails>().AnyAsync(x => x.SignupId == signup.Id));
    }
}
