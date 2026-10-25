using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Data;
using MountedGames.Api.Hubs;
using Microsoft.AspNetCore.Mvc;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.DecForms;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

public class RefereeCardsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f = factory;
    private static string CardUrl(Arena arena) => $"/api/competitions/{arena.CompetitionId}/teams/{arena.TeamIds[0]}/card";

    [Theory]
    [InlineData("yellow", "yellow")]
    [InlineData("none", null)]
    [InlineData(null, null)]
    public async Task CurrentCardOverridesHistoricalRed_WithoutRewritingScoredResults(string? card, string? expected)
    {
        var arena = await _f.CreateArenaAsync(1);
        var (_, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        using (var scope = _f.Services.CreateScope())
        {
            var scoring = scope.ServiceProvider.GetRequiredService<ScoringService>();
            foreach (var race in races)
                await scoring.ApplyRaceResultsAsync(race, [new FinishingPlace(arena.TeamIds[0], 1, false, null, "[card:red] Private test explanation")], null);
        }
        var before = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => races.Contains(r.RaceId)).OrderBy(r => r.Id).Select(r => new { r.Id, r.RefereeNote, r.Points }).ToListAsync());
        var admin = await _f.AdminAsync();
        var response = await admin.PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest(card, races[0]));
        response.EnsureSuccessStatusCode();
        var dto = await response.ReadAsync<TeamDto>();
        Assert.Equal(expected, dto.RefereeCard);
        Assert.DoesNotContain("card:", dto.BibDescription ?? "");
        Assert.DoesNotContain("Private test", await response.Content.ReadAsStringAsync());
        var publicTeams = await _f.CreateClient().GetFromJsonAsync<List<TeamDto>>($"/api/competitions/{arena.CompetitionId}/teams");
        Assert.Equal(expected, Assert.Single(publicTeams!).RefereeCard);
        var after = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => races.Contains(r.RaceId)).OrderBy(r => r.Id).Select(r => new { r.Id, r.RefereeNote, r.Points }).ToListAsync());
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task CardEndpointRequiresScopedCompetitionAuthority()
    {
        var arena = await _f.CreateArenaAsync(1);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest("red"))).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest("red"))).StatusCode);
        var (trainer, auth) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await trainer.PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest("red"))).StatusCode);
        await _f.WithDbAsync(async db => { (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id; await db.SaveChangesAsync(); });
        (await trainer.PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest(" RED "))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest("blue"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await trainer.PutAsJsonAsync($"/api/competitions/{arena.CompetitionId}/teams/2147483647/card", new SetTeamCardRequest("red"))).StatusCode);
    }

    [Fact]
    public async Task RaceContextMustBelongToCompetitionAndIncludeTeam()
    {
        var arena = await _f.CreateArenaAsync(2);
        var other = await _f.CreateArenaAsync(1);
        var (_, foreign) = await _f.AddHeatAsync(other.SessionId, other.TeamIds);
        var (_, uninvolved) = await _f.AddHeatAsync(arena.SessionId, [arena.TeamIds[1]]);
        var (_, valid) = await _f.AddHeatAsync(arena.SessionId, [arena.TeamIds[0]]);
        var admin = await _f.AdminAsync();
        foreach (var race in new[] { foreign[0], uninvolved[0], int.MaxValue })
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest("red", race))).StatusCode);
        Assert.Null(await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == arena.TeamIds[0]).Select(t => t.BibDescription).SingleAsync()));
        (await admin.PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest("yellow", valid[0]))).EnsureSuccessStatusCode();
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("[card:red] Blue bib", "red")]
    [InlineData("[card:none] Blue bib", null)]
    public async Task ClubManagerBibEditsCannotAssignDowngradeOrRestoreCards(string? existing, string? expected)
    {
        var (manager, auth) = await _f.ApprovedManagerAsync($"Fake card club {Guid.NewGuid():N}");
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        var team = await _f.SeedTeamAsync(comp, section, auth.User.ClubId!.Value);
        await _f.WithDbAsync(async db => { (await db.Teams.FindAsync(team))!.BibDescription = existing; await db.SaveChangesAsync(); });
        var url = $"/api/teams/{team}/trainer";
        var response = await manager.PutAsJsonAsync(url, new UpdateTeamRequest(BibDescription: "[card:yellow] [card:red] New bib", Flag: "gb-wls"));
        response.EnsureSuccessStatusCode();
        var dto = await response.ReadAsync<TeamDto>();
        Assert.Equal(expected, dto.RefereeCard);
        Assert.Equal("gb-wls", dto.Flag);
        Assert.Equal("[flag:gb-wls] New bib", dto.BibDescription);
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.PutAsJsonAsync(url, new UpdateTeamRequest(Flag: "x][card:red"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}/card", new SetTeamCardRequest("red"))).StatusCode);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task DeclarationConfigPreservesCardSettingAndTrustedPayoutAcrossSaveAndReset(bool enabled)
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var comp = await _f.SeedCompetitionAsync(ownerUserId: auth.User.Id);
        var otherClub = await _f.SeedClubAsync($"Fake unrelated {Guid.NewGuid():N}");
        await _f.WithDbAsync(async db => { (await db.Competitions.FindAsync(comp))!.DecFormConfigJson = (DecFormConfig.Basic with { UseRefereeCards = enabled }).ToJson(); await db.SaveChangesAsync(); });
        var url = $"/api/competitions/{comp}/dec-form-config";
        var saved = await owner.PutAsJsonAsync(url, DecFormConfig.Basic with { UseRefereeCards = !enabled, PayoutClubId = otherClub });
        saved.EnsureSuccessStatusCode();
        var config = (await saved.ReadAsync<DecFormConfigDto>()).Config;
        Assert.Equal(enabled, config.UseRefereeCards);
        Assert.Equal(auth.User.ClubId, config.PayoutClubId);
        var reset = await owner.DeleteAsync(url);
        reset.EnsureSuccessStatusCode();
        var dto = await reset.ReadAsync<DecFormConfigDto>();
        Assert.True(dto.IsStandard);
        Assert.Equal(enabled, dto.Config.UseRefereeCards);
        Assert.Equal(auth.User.ClubId, dto.Config.PayoutClubId);
    }

    [Fact]
    public async Task ResetWithoutPayoutClubStillPreservesCardMetadata()
    {
        var arena = await _f.CreateArenaAsync(1);
        await _f.WithDbAsync(async db => { (await db.Competitions.FindAsync(arena.CompetitionId))!.DecFormConfigJson = (DecFormConfig.Basic with { UseRefereeCards = true }).ToJson(); await db.SaveChangesAsync(); });
        var response = await (await _f.AdminAsync()).DeleteAsync($"/api/competitions/{arena.CompetitionId}/dec-form-config");
        response.EnsureSuccessStatusCode();
        var dto = await response.ReadAsync<DecFormConfigDto>();
        Assert.True(dto.Config.UseRefereeCards);
        Assert.True(dto.IsStandard);
        Assert.Null(dto.Config.PayoutClubId);
    }

    [Theory]
    [InlineData("[card:red] Blue", "red")]
    [InlineData("[card:none] Blue", null)]
    public async Task DeclarationBibCannotChangeCardsOrUseCardTagsAsRequiredBib(string existing, string? expected)
    {
        var (trainer, auth) = await _f.ApprovedTrainerAsync();
        var comp = await _f.SeedCompetitionAsync(ownerUserId: auth.User.Id);
        var section = await _f.SeedSectionAsync(comp);
        var team = await _f.SeedTeamAsync(comp, section, auth.User.ClubId!.Value, trainerUserId: auth.User.Id);
        await _f.WithDbAsync(async db =>
        {
            (await db.Teams.FindAsync(team))!.BibDescription = existing;
            (await db.Competitions.FindAsync(comp))!.DecFormConfigJson = (DecFormConfig.Basic with { Bib = FieldRequirement.Required }).ToJson();
            await db.SaveChangesAsync();
        });
        SubmitDeclarationFormRequest Form(string bib) => new(team, null,
            [new RiderEntryInput(null, "Test Rider", null, "Test Pony", null, false, false, 0)], false,
            "07123 456789", BibDescription: bib, AcceptTerms: true);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync("/api/declaration-forms", Form("[card:red]"))).StatusCode);
        (await trainer.PostAsJsonAsync("/api/declaration-forms", Form("[flag:gb-wls] [card:yellow] Green"))).EnsureSuccessStatusCode();
        var stored = await _f.WithDbAsync(db => db.Teams.AsNoTracking().SingleAsync(t => t.Id == team));
        Assert.Equal(expected, ResultStatuses.TeamCardOf(stored));
        Assert.Equal("[flag:gb-wls] Green", ResultStatuses.PublicBibDescription(stored.BibDescription));
    }

    [Theory]
    [InlineData(false, "[card:[card:red]red]", false)]
    [InlineData(false, "[card:[flag:x]red]", false)]
    [InlineData(false, "[card:[card:red]none]", true)]
    [InlineData(false, "[card:[flag:x]none]", true)]
    [InlineData(true, "[card:[card:red]red]", false)]
    [InlineData(true, "[card:[flag:x]red]", false)]
    [InlineData(true, "[card:[card:red]none]", true)]
    [InlineData(true, "[card:[flag:x]none]", true)]
    [InlineData(true, "[card:[card:[card:red]red]red]", false)]
    [InlineData(true, "[card:[card:[card:red]red]none]", true)]
    public async Task NestedBibTagsCannotForgeCardsOrSuppressHistory(bool declaration, string payload, bool historicalRed)
    {
        var (manager, auth) = await _f.ApprovedManagerAsync($"Fake nested club {Guid.NewGuid():N}");
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        var team = await _f.SeedTeamAsync(comp, section, auth.User.ClubId!.Value);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(comp))!.DecFormConfigJson = (DecFormConfig.Basic with { Bib = FieldRequirement.Required }).ToJson();
            await db.SaveChangesAsync();
        });
        if (historicalRed)
        {
            var session = await _f.SeedScoredRaceAsync(comp, section, [(team, 1, false, 1)]);
            await _f.WithDbAsync(async db =>
            {
                var result = await db.Results.SingleAsync(r => r.TeamId == team && r.Race!.Heat!.SessionId == session);
                result.RefereeNote = "[card:red] Private history";
                await db.SaveChangesAsync();
            });
        }
        var response = declaration
            ? await manager.PostAsJsonAsync("/api/declaration-forms", new SubmitDeclarationFormRequest(team, null,
                [new RiderEntryInput(null, "Test Rider", null, "Test Pony", null, false, false, 0)], false,
                "07123 456789", BibDescription: payload + " Green", AcceptTerms: true))
            : await manager.PutAsJsonAsync($"/api/teams/{team}/trainer", new UpdateTeamRequest(BibDescription: payload + " Green"));
        response.EnsureSuccessStatusCode();
        var stored = await _f.WithDbAsync(db => db.Teams.AsNoTracking().Include(t => t.Results).SingleAsync(t => t.Id == team));
        Assert.Equal(historicalRed ? "red" : null, ResultStatuses.TeamCardOf(stored));
        Assert.DoesNotContain("[card:", stored.BibDescription!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Green", stored.BibDescription!);
        if (historicalRed) Assert.Equal("[card:red] Private history", Assert.Single(stored.Results).RefereeNote);
    }

    [Fact]
    public async Task StaleBibSaveCannotEraseACard_AndControllerReturnsConflict()
    {
        var arena = await _f.CreateArenaAsync(1);
        using var staleScope = _f.Services.CreateScope();
        var staleDb = staleScope.ServiceProvider.GetRequiredService<AppDbContext>();
        var staleTeam = (await staleDb.Teams.FindAsync(arena.TeamIds[0]))!;
        (await (await _f.AdminAsync()).PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest("red"))).EnsureSuccessStatusCode();
        var controller = new TeamsController(staleDb);
        var response = await controller.Update(arena.CompetitionId, staleTeam.Id, new UpdateTeamInput(BibDescription: "Green"));
        Assert.IsType<ConflictObjectResult>(response.Result);
        var stored = await _f.WithDbAsync(db => db.Teams.AsNoTracking().SingleAsync(t => t.Id == staleTeam.Id));
        Assert.Equal("red", ResultStatuses.TeamCardOf(stored));
        Assert.DoesNotContain("Green", stored.BibDescription!);
    }

    [Fact]
    public async Task StaleCardSaveCannotOverwriteAnotherDecision()
    {
        var arena = await _f.CreateArenaAsync(1);
        using var staleScope = _f.Services.CreateScope();
        var staleDb = staleScope.ServiceProvider.GetRequiredService<AppDbContext>();
        await staleDb.Teams.FindAsync(arena.TeamIds[0]);
        (await (await _f.AdminAsync()).PutAsJsonAsync(CardUrl(arena), new SetTeamCardRequest("red"))).EnsureSuccessStatusCode();
        var controller = new CompetitionsController(staleDb,
            staleScope.ServiceProvider.GetRequiredService<ILiveBroadcaster>(),
            staleScope.ServiceProvider.GetRequiredService<GeocodingService>());
        var response = await controller.SetTeamCard(arena.CompetitionId, arena.TeamIds[0], new SetTeamCardRequest("yellow"));
        Assert.IsType<ConflictObjectResult>(response.Result);
        var stored = await _f.WithDbAsync(db => db.Teams.AsNoTracking().SingleAsync(t => t.Id == arena.TeamIds[0]));
        Assert.Equal("red", ResultStatuses.TeamCardOf(stored));
    }

    [Fact]
    public void HistoricalCardsAndPublicMetadataNeverExposePrivateNoteText()
    {
        Assert.Null(ResultStatuses.TeamCardOf(null));
        Assert.Null(ResultStatuses.LatestCardOf(null));
        Assert.Equal("red", ResultStatuses.TeamCardOf(new Team { Results = [new Result { RefereeNote = "[card:yellow] Private A" }, new Result { RefereeNote = "[CARD:RED] Private B" }] }));
        Assert.Equal("yellow", ResultStatuses.TeamCardOf(new Team { Results = [new Result { RefereeNote = "[card:yellow] Private A" }] }));
        Assert.Null(ResultStatuses.RefereeCardOf("Private note only"));
        Assert.Equal("[flag:gb-eng] Blue", ResultStatuses.PublicBibDescription("[card:none] [flag:gb-eng] Blue"));
        Assert.Null(ResultStatuses.MergeBibTags(null, "[card:red]"));
        Assert.Throws<ScoreValidationException>(() => ResultStatuses.CleanNote(new string('x', 501)));
        Assert.Equal(500, ResultStatuses.CleanNote(new string('x', 500))!.Length);
    }
}
