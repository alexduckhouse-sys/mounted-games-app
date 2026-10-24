using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.TackCheck;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests;

public class PassportDateRangeSecurityTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Theory]
    [InlineData("9999-01-01", null)]
    [InlineData(null, "9998-01-01")]
    public async Task InspectionRejectsUnrepresentableInferredExpiry(string? flu, string? tetanus)
    {
        var competition = await f.SeedCompetitionAsync();
        var section = await f.SeedSectionAsync(competition);
        var club = await f.SeedClubAsync();
        var team = await f.SeedTeamAsync(competition, section, club, "Fake team");
        await f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(competition))!.EnablePassportCheck = true;
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = team, IsLocked = true,
                Riders = [new RiderEntry { FullName = "Fake Rider", HorseName = "Fake Pony" }],
            });
            await db.SaveChangesAsync();
        });
        using var admin = await f.AdminAsync();
        var response = await admin.PutAsJsonAsync($"/api/event-tools/competitions/{competition}/passport-check/teams/{team}",
            new SetPassportCheckRequest("Fake Pony", true, LastFluVaccineDate: flu, LastTetanusDate: tetanus));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.False(await f.WithDbAsync(db => Task.FromResult(db.Set<PassportCheck>().Any(p => p.TeamId == team))));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("9999-12-31")]
    public void ExistingBoundaryDatesDoNotOverflowWhenEvaluatingStatus(string? explicitExpiry)
    {
        string? flu = "9999-12-31", fluExpiry = explicitExpiry;
        string? tetanus = "9999-12-31", tetanusExpiry = explicitExpiry;
        var status = PassportCheckService.EvaluateStatus(DateOnly.MaxValue, true,
            ref flu, ref fluExpiry, ref tetanus, ref tetanusExpiry);
        Assert.False(status.Certified);
        Assert.Equal("TooRecent", status.Status);
        Assert.Equal("9999-12-31", fluExpiry);
        Assert.Equal("9999-12-31", tetanusExpiry);
    }
}
