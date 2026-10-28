using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

/// <summary>The sign-up tick (parental consent plus event terms) and the organiser's terms text.</summary>
public class TermsTickTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public TermsTickTests(ApiFactory f) => _f = f;

    private static string SignupUrl(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/signups";

    private static CreateSectionSignupRequest Entry(string name, bool accept, string? version)
        => new(name, null, null, null, false, accept, version);

    [Fact]
    public async Task Signup_WithoutTheTick_IsRefused_AndNothingIsSaved()
    {
        var section = await _f.NewSectionAsync();
        var trainer = await _f.TrainerAsync();

        var none = await trainer.PostAsJsonAsync(SignupUrl(section), new CreateSectionSignupRequest("Parent", null, null));
        var noVersion = await trainer.PostAsJsonAsync(SignupUrl(section), Entry("Parent", true, null));
        var stale = await trainer.PostAsJsonAsync(SignupUrl(section), Entry("Parent", true, "2020-01-v0"));

        Assert.Equal([HttpStatusCode.BadRequest, HttpStatusCode.BadRequest, HttpStatusCode.BadRequest],
            [none.StatusCode, noVersion.StatusCode, stale.StatusCode]);
        Assert.Contains("tick", await none.Content.ReadAsStringAsync());
        Assert.Contains("reload", await stale.Content.ReadAsStringAsync());
        Assert.False(await _f.WithDbAsync(db => db.SectionSignups.AnyAsync(s => s.CompetitionSectionId == section.Id)));
    }

    [Fact]
    public async Task Signup_WithTheTick_RecordsWhoWhenAndWhichWording()
    {
        var section = await _f.NewSectionAsync();
        var me = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        var before = DateTime.UtcNow.AddSeconds(-2);

        var response = await _f.WithToken(me.Token).PostAsJsonAsync(SignupUrl(section), Entry("  Pat Parent ", true, SignupTerms.WordingVersion));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var dto = await response.ReadAsync<SectionSignupDto>();
        Assert.True(dto.TermsAccepted);
        Assert.Equal($"{SignupTerms.WordingVersion}+terms:default", dto.TermsWordingVersion);
        var row = await _f.WithDbAsync(db => db.SectionSignups.AsNoTracking().SingleAsync(s => s.Id == dto.Id));
        Assert.Equal((me.User.Id, "Pat Parent"), (row.TermsAcceptedByUserId, row.TermsAcceptedByName));
        Assert.InRange(row.TermsAcceptedAt!.Value, before, DateTime.UtcNow.AddSeconds(2));
    }

    [Fact]
    public async Task Signup_VersionNamesTheTermsThatWereShown()
    {
        var section = await _f.NewSectionAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(section.CompetitionId))!.TermsText = "Plain test terms.";
            await db.SaveChangesAsync();
        });
        var trainer = await _f.TrainerAsync();

        var dto = await (await trainer.PostAsJsonAsync(SignupUrl(section), Entry("Pat", true, SignupTerms.WordingVersion)))
            .ReadAsync<SectionSignupDto>();

        Assert.StartsWith($"{SignupTerms.WordingVersion}+terms:", dto.TermsWordingVersion);
        Assert.DoesNotContain("default", dto.TermsWordingVersion);
        Assert.Equal(dto.TermsWordingVersion, SignupTerms.VersionFor(new Competition { TermsText = " Plain test terms. " }));
        Assert.NotEqual(dto.TermsWordingVersion, SignupTerms.VersionFor(new Competition { TermsText = "Different terms." }));
    }

    [Fact]
    public async Task Terms_AreEditedByTheOrganiser_AndShownOnTheCompetition()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync(1);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });
        var url = $"/api/competitions/{arena.CompetitionId}";
        var detail = await (await _f.CreateClient().GetAsync(url)).ReadAsync<CompetitionDetail>();
        Assert.Null(detail.TermsText);

        UpdateCompetitionRequest Update(string? terms) =>
            new(detail.Name, null, null, null, null, null, null, detail.StartDate, null, true, false, TermsText: terms);
        Assert.Equal(HttpStatusCode.OK, (await owner.PutAsJsonAsync(url, Update("  Riders must wear hats.\nNo exceptions.  "))).StatusCode);

        var after = await (await _f.CreateClient().GetAsync(url)).ReadAsync<CompetitionDetail>();
        Assert.Equal("Riders must wear hats.\nNo exceptions.", after.TermsText);
        var first = await (await _f.CreateClient().GetAsync($"{url}/first-view")).ReadAsync<CompetitionDetail>();
        Assert.Equal(after.TermsText, first.TermsText);

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(url, Update(new string('x', CompetitionTerms.MaxLength + 1)))).StatusCode);
        await owner.PutAsJsonAsync(url, Update("   "));
        Assert.Null((await (await _f.CreateClient().GetAsync(url)).ReadAsync<CompetitionDetail>()).TermsText);

        var other = await _f.TrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync(url, Update("Mine now"))).StatusCode);
    }

    [Fact]
    public async Task NewCompetition_CanCarryTerms()
    {
        var admin = await _f.AdminAsync();
        var created = await admin.PostAsJsonAsync("/api/competitions",
            new CreateCompetitionRequest($"Terms event {Guid.NewGuid():N}", null, null, null, null, null, null, DateTime.UtcNow.AddDays(5), null, TermsText: " Terms at creation "));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var summary = await created.ReadAsync<CompetitionSummary>();

        var detail = await (await _f.CreateClient().GetAsync($"/api/competitions/{summary.Id}")).ReadAsync<CompetitionDetail>();

        Assert.Equal("Terms at creation", detail.TermsText);
    }

    [Fact]
    public async Task OrganiserSignupList_ShowsTheTick()
    {
        var section = await _f.NewSectionAsync();
        var trainer = await _f.TrainerAsync();
        await trainer.PostAsJsonAsync(SignupUrl(section), Entry("Pat", true, SignupTerms.WordingVersion));
        var admin = await _f.AdminAsync();

        var list = await (await admin.GetAsync($"/api/competitions/{section.CompetitionId}/signups")).ReadAsync<List<SectionSignupDto>>();

        Assert.True(Assert.Single(list).TermsAccepted);
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsTheTermsColumns_WithoutLosingRows()
    {
        var section = await _f.NewSectionAsync();
        var trainer = await _f.TrainerAsync();
        var signup = await (await trainer.PostAsJsonAsync(SignupUrl(section), Entry("Survivor", true, SignupTerms.WordingVersion)))
            .ReadAsync<SectionSignupDto>();
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        foreach (var (table, column) in new[]
                 {
                     ("Competitions", "TermsText"), ("SectionSignups", "TermsAccepted"), ("SectionSignups", "TermsAcceptedAt"),
                     ("SectionSignups", "TermsAcceptedByUserId"), ("SectionSignups", "TermsAcceptedByName"), ("SectionSignups", "TermsWordingVersion"),
                 })
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" DROP COLUMN \"{column}\"");

        await DbInitializer.SeedAsync(_f.Services);
        db.ChangeTracker.Clear();

        var row = await db.SectionSignups.AsNoTracking().SingleAsync(s => s.Id == signup.Id);
        Assert.Equal(("Survivor", false), (row.FullName, row.TermsAccepted));   // old rows have no recorded tick
        Assert.Null(row.TermsAcceptedAt);
        Assert.Null((await db.Competitions.AsNoTracking().FirstAsync()).TermsText);
    }
}
