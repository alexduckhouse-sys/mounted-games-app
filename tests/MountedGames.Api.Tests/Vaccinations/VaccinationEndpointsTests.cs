using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Vaccinations;
using MountedGames.Api.Tests.Infrastructure;
namespace MountedGames.Api.Tests.Vaccinations;

public class VaccinationEndpointsTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static string Base(int competition) => $"/api/event-tools/competitions/{competition}/passport-check/vaccinations";
    private static SaveVaccinationEvidenceRequest Evidence(int revision = 0) => new(revision, [new(2025, 6, 1), new(2025, 7, 1), new(2025, 12, 1)], true, new(2026, 10, 20), false, "Fake history note");
    private async Task<(int Comp, int Team, int Rider, HttpClient Owner, HttpClient Entrant)> World()
    {
        var (owner, auth) = await f.ApprovedTrainerAsync();
        var (entrant, entryAuth) = await f.SignupAsync("Member");
        var comp = await f.SeedCompetitionAsync(start: new(2026, 10, 20));
        var section = await f.SeedSectionAsync(comp); var club = await f.SeedClubAsync(); var team = await f.SeedTeamAsync(comp, section, club, "Fake team");
        var rider = await f.WithDbAsync(async db =>
        {
            var c = await db.Competitions.FindAsync(comp); c!.EnablePassportCheck = true; c.CreatedByUserId = auth.User.Id;
            var form = new DeclarationForm { TeamId = team, SubmittedByUserId = entryAuth.User.Id, Riders = [new() { FullName = "Fake Rider", HorseName = "Fake Pony" }] };
            db.Add(form); await db.SaveChangesAsync(); return form.Riders.Single().Id;
        });
        var response = await owner.PutAsJsonAsync($"{Base(comp)}/settings", new SaveVaccinationSettingsRequest(0, VaccinationPolicies.PonyClub2026, "arrival", [])); response.EnsureSuccessStatusCode();
        return (comp, team, rider, owner, entrant);
    }
    [Fact]
    public async Task AuthorisationAndPrivateResponsesDoNotPermitGlobalHistorySearch()
    {
        var w = await World(); var url = Base(w.Comp);
        using var anon = f.CreateClient(); using var other = await f.TrainerAsync(); var (member, _) = await f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.GetAsync($"{url}/riders/{w.Rider}/mine")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.PutAsJsonAsync($"{url}/riders/{w.Rider}/mine", Evidence())).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PutAsJsonAsync($"{url}/riders/{w.Rider}/mine", Evidence())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.Entrant.PutAsJsonAsync($"{url}/riders/{w.Rider}/evidence", Evidence())).StatusCode);
        var own = await w.Entrant.GetAsync($"{url}/riders/{w.Rider}/mine"); own.EnsureSuccessStatusCode();
        Assert.Contains("no-store", own.Headers.CacheControl!.ToString());
        Assert.Equal(HttpStatusCode.Gone, (await member.GetAsync("/api/event-tools/certified-horses/lookup?ponyName=Fake")).StatusCode);
        var supplied = await w.Entrant.PutAsJsonAsync($"{url}/riders/{w.Rider}/mine", Evidence()); supplied.EnsureSuccessStatusCode();
        var publicBody = await (await anon.GetAsync($"/api/declaration-forms?competitionId={w.Comp}")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("Fake history note", publicBody); Assert.DoesNotContain("2025-12-01", publicBody);
    }
    [Fact]
    public async Task EvidenceInspectionAndEntrantCorrectionKeepProvenanceAndRejectStaleRevision()
    {
        var w = await World(); var url = $"{Base(w.Comp)}/riders/{w.Rider}";
        var supplied = await (await w.Entrant.PutAsJsonAsync($"{url}/mine", Evidence())).ReadAsync<VaccinationPonyDto>();
        Assert.Null(supplied.Verified); Assert.Null(supplied.Inspection); Assert.Equal("entrant", supplied.Provisional!.Source);
        var verified = await (await w.Owner.PutAsJsonAsync($"{url}/evidence", Evidence(supplied.Revision))).ReadAsync<VaccinationPonyDto>();
        Assert.NotNull(verified.Provisional); Assert.Equal("staff", verified.Verified!.Source);
        var request = new InspectVaccinationRequest(verified.Revision, 1, verified.Verified.Id, new(2026, 10, 20), "admitted", "Passport inspected in this test", true);
        var inspected = await (await w.Owner.PostAsJsonAsync($"{url}/inspection", request)).ReadAsync<VaccinationPonyDto>();
        Assert.True(inspected.Inspection!.Current); Assert.Equal(verified.Verified.Revision, inspected.Inspection.EvidenceRevision);
        var correction = await (await w.Entrant.PutAsJsonAsync($"{url}/mine", Evidence(inspected.Revision) with { CompleteHistory = false })).ReadAsync<VaccinationPonyDto>();
        Assert.False(correction.Inspection!.Current); Assert.NotNull(correction.Verified); Assert.False(correction.Provisional!.CompleteHistory);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.PostAsJsonAsync($"{url}/inspection", request)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Entrant.PutAsJsonAsync($"{url}/mine", Evidence(inspected.Revision))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.PostAsJsonAsync($"{url}/inspection", request with { ExpectedRevision = correction.Revision })).StatusCode);
        var refused = await w.Owner.PostAsJsonAsync($"{url}/inspection", request with { ExpectedRevision = correction.Revision, EvidenceId = correction.Provisional.Id, PassportInspected = false });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        var decision = await (await w.Owner.PostAsJsonAsync($"{url}/inspection", request with { ExpectedRevision = correction.Revision, EvidenceId = correction.Provisional.Id, Decision = "review" })).ReadAsync<VaccinationPonyDto>();
        Assert.Equal(2, decision.InspectionHistory.Count); Assert.True(decision.Inspection!.Current); Assert.Equal("MissingHistory", decision.Provisional!.Evaluation.Status);
    }
    [Fact]
    public async Task SameNamePoniesRequireExplicitIdentityLinkAndChangedDeclarationDoesNotInheritInspection()
    {
        var w = await World(); var url = Base(w.Comp);
        var first = await (await w.Entrant.PutAsJsonAsync($"{url}/riders/{w.Rider}/mine", Evidence())).ReadAsync<VaccinationPonyDto>();
        var secondId = await f.WithDbAsync(async db =>
        {
            var r = new RiderEntry { DeclarationFormId = first.DeclarationFormId, FullName = "Other Fake Rider", HorseName = "Fake Pony" }; db.Add(r); await db.SaveChangesAsync(); return r.Id;
        });
        var board = await (await w.Owner.GetAsync(url)).ReadAsync<VaccinationBoardDto>(); Assert.Equal(2, board.Ponies.Count); Assert.Null(board.Ponies.Single(p => p.RiderEntryId == secondId).HorseId);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Owner.PutAsJsonAsync($"{url}/riders/{secondId}/horse", new LinkVaccinationHorseRequest(0, first.HorseId!.Value, false))).StatusCode);
        var linked = await (await w.Owner.PutAsJsonAsync($"{url}/riders/{secondId}/horse", new LinkVaccinationHorseRequest(0, first.HorseId!.Value, true))).ReadAsync<VaccinationPonyDto>();
        Assert.Equal(first.HorseId, linked.HorseId); Assert.Null(linked.Provisional); Assert.Null(linked.Inspection);
        await f.WithDbAsync(async db => { var row = await db.RiderEntries.FindAsync(w.Rider); row!.HorseName = "Changed Fake Pony"; await db.SaveChangesAsync(); });
        Assert.Equal(HttpStatusCode.Conflict, (await w.Entrant.PutAsJsonAsync($"{url}/riders/{w.Rider}/mine", Evidence(first.Revision))).StatusCode);
        var newRiderId = await f.WithDbAsync(async db => { var form = new DeclarationForm { TeamId = w.Team, SubmittedAt = DateTime.UtcNow.AddMinutes(2), Riders = [new() { FullName = "Fake Rider", HorseName = "Fake Pony" }] }; db.Add(form); await db.SaveChangesAsync(); return form.Riders.Single().Id; });
        Assert.Equal(HttpStatusCode.NotFound, (await w.Entrant.GetAsync($"{url}/riders/{w.Rider}/mine")).StatusCode);
        var fresh = await (await w.Owner.GetAsync(url)).ReadAsync<VaccinationBoardDto>(); var pony = Assert.Single(fresh.Ponies); Assert.Equal(newRiderId, pony.RiderEntryId); Assert.Null(pony.HorseId);
    }
    [Fact]
    public async Task EventAndPolicyChangesInvalidateDecisionsAndVenueRulesStaySeparate()
    {
        var w = await World(); var url = Base(w.Comp);
        var pony = await (await w.Owner.PutAsJsonAsync($"{url}/riders/{w.Rider}/evidence", Evidence())).ReadAsync<VaccinationPonyDto>();
        var inspection = new InspectVaccinationRequest(pony.Revision, 1, pony.Verified!.Id, new(2026, 10, 20), "admitted", "Fake official reason", true);
        (await w.Owner.PostAsJsonAsync($"{url}/riders/{w.Rider}/inspection", inspection)).EnsureSuccessStatusCode();
        var venue = new VenueVaccinationRule("Fake venue", "edition 1", "https://example.com/venue", new(2026, 1, 1), new(2026, 12, 31), 6, 0, 7, true, false);
        (await w.Owner.PutAsJsonAsync($"{url}/settings", new SaveVaccinationSettingsRequest(1, VaccinationPolicies.PonyClub2026, "arrival", [venue]))).EnsureSuccessStatusCode();
        var changed = await (await w.Owner.GetAsync(url)).ReadAsync<VaccinationBoardDto>(); Assert.False(changed.Ponies[0].Inspection!.Current); Assert.Contains(changed.Ponies[0].Verified!.Evaluation.Mandatory, x => x.Code == "venue-booster");
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.PutAsJsonAsync($"{url}/settings", new SaveVaccinationSettingsRequest(1, "manual-v1", "arrival", []))).StatusCode);
        await f.WithDbAsync(async db => { (await db.Competitions.FindAsync(w.Comp))!.StartDate = new(2026, 10, 21); await db.SaveChangesAsync(); });
        Assert.Equal(HttpStatusCode.Conflict, (await w.Owner.PostAsJsonAsync($"{url}/riders/{w.Rider}/inspection", inspection with { ExpectedRevision = changed.Ponies[0].Revision, ExpectedSettingsRevision = 2 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PutAsJsonAsync($"{url}/settings", new SaveVaccinationSettingsRequest(2, "unverified-invented", "arrival", []))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PutAsJsonAsync($"{url}/riders/{w.Rider}/evidence", Evidence(changed.Ponies[0].Revision) with { Dates = [new(9999, 1, 1)] })).StatusCode);
    }
    [Fact]
    public async Task ConcurrentWritersCannotOverwriteTheOtherHistory()
    {
        var w = await World(); var url = $"{Base(w.Comp)}/riders/{w.Rider}";
        var initial = await (await w.Entrant.PutAsJsonAsync($"{url}/mine", Evidence())).ReadAsync<VaccinationPonyDto>();
        var responses = await Task.WhenAll(
            w.Entrant.PutAsJsonAsync($"{url}/mine", Evidence(initial.Revision) with { Notes = "Fake correction A" }),
            w.Owner.PutAsJsonAsync($"{url}/evidence", Evidence(initial.Revision) with { Notes = "Fake correction B" }));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        var history = await f.WithDbAsync(db => db.Set<VaccinationEvidence>().Where(e => e.CompetitionId == w.Comp).ToListAsync());
        Assert.Equal(2, history.Count); Assert.Equal(2, history.Max(e => e.Revision));
    }
    [Fact]
    public async Task EventDateUsesLocalCalendarDayAndAChangedDateMakesDecisionStale()
    {
        var w = await World();
        await f.WithDbAsync(async db => { (await db.Competitions.FindAsync(w.Comp))!.StartDate = new(2026, 6, 19, 23, 30, 0, DateTimeKind.Utc); await db.SaveChangesAsync(); });
        var board = await (await w.Owner.GetAsync(Base(w.Comp))).ReadAsync<VaccinationBoardDto>();
        Assert.Equal(new DateOnly(2026, 6, 20), board.Settings.EventStartOn);
    }

}
