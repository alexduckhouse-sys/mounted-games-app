using System.Net;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Json;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Seasons;

public class CollaboratorSeasonAccessTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task MemberCollaboratorCanLinkTheirEventAndPublishTheirSeasonWithoutAccessToOtherEvents()
    {
        var (staff, auth) = await f.SignupAsync("Member");
        var competition = await f.SeedCompetitionAsync(ownerUserId: await f.TrainerIdAsync());
        var other = await f.SeedCompetitionAsync();
        await f.InDbAsync(async db =>
        {
            db.CompetitionCollaborators.Add(new CompetitionCollaborator { CompetitionId = competition, UserId = auth.User.Id, AddedByUserId = auth.User.Id });
            await db.SaveChangesAsync();
        });
        var section = await f.SeedSectionAsync(competition);
        var foreignSection = await f.SeedSectionAsync(other);
        var club = await f.SeedClubAsync();
        var team = await f.SeedTeamAsync(competition, section, club);
        var session = await f.SeedScoredRaceAsync(competition, section, [(team, 1, false, 1)]);
        await f.InDbAsync(async db =>
        {
            var heat = await db.Heats.SingleAsync(h => h.SessionId == session);
            db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = team, LaneIndex = 1 });
            await db.SaveChangesAsync();
        });
        var options = await (await staff.GetAsync("/api/seasons/available-competitions")).ReadAsync<List<SeasonCompetitionOptionDto>>();
        Assert.Contains(options, c => c.Id == competition);
        Assert.DoesNotContain(options, c => c.Id == other);
        var request = new CreateSeasonRequest("Fake league", 2032, SectionFormat.Teams, "Under 12", null, [new(1, 10)], CompetitionIds: [competition]);
        var created = await staff.PostAsJsonAsync("/api/seasons", request);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var season = await created.ReadAsync<SeasonDto>();
        Assert.True(season.CanManage);
        var round = Assert.Single(season.Rounds);
        Assert.Equal(HttpStatusCode.NotFound, (await staff.PostAsJsonAsync("/api/seasons", request with { CompetitionIds = [other] })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await staff.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds", new AddSeasonRoundRequest(foreignSection))).StatusCode);
        var profileResponse = await staff.PostAsJsonAsync("/api/team-profiles", new CreateTeamProfileRequest(club, "A", "Fake profile"));
        Assert.Equal(HttpStatusCode.Created, profileResponse.StatusCode);
        var profile = await profileResponse.ReadAsync<TeamProfileDto>();
        Assert.True(profile.CanManage);
        var link = new LinkEventTeamRequest(profile.Id, team);
        Assert.Equal(HttpStatusCode.NotFound, (await staff.PostAsJsonAsync($"/api/competitions/{other}/team-profile-links", link)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await staff.PostAsJsonAsync($"/api/competitions/{competition}/team-profile-links", link)).StatusCode);
        var previewResponse = await staff.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview");
        Assert.Equal(HttpStatusCode.OK, previewResponse.StatusCode);
        var preview = await previewResponse.ReadAsync<SeasonPublicationPreviewDto>();
        Assert.Equal(HttpStatusCode.Created, (await staff.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications",
            new PublishSeasonRoundRequest(preview.SourceFingerprint, preview.NextVersion))).StatusCode);
    }
}
