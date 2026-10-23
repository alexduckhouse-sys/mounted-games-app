using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Seasons;

public class SeasonsEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public SeasonsEndpointsTests(ApiFactory f) => _f = f;

    private static CreateSeasonRequest SeasonBody(int? best = null, SectionFormat format = SectionFormat.Teams, string age = "Under 12")
        => new("Regional league", 2032, format, age, best,
            [new(1, 10), new(2, 8), new(3, 6), new(4, 4)]);

    [Fact]
    public async Task SeasonWrites_RequireOrganiserRole()
    {
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _f.CreateClient().PostAsJsonAsync("/api/seasons", SeasonBody())).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await member.PostAsJsonAsync("/api/seasons", SeasonBody())).StatusCode);
        var (pendingTrainer, _) = await _f.SignupAsync();
        Assert.Equal(HttpStatusCode.Forbidden,
            (await pendingTrainer.PostAsJsonAsync("/api/seasons", SeasonBody())).StatusCode);
    }

    [Fact]
    public async Task SeasonsForCompetition_ListsOnlySeasonsWithAnIncludedRoundThere()
    {
        var trainer = await _f.TrainerAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        var sectionId = await _f.SeedSectionAsync(competitionId, "U12 round");
        var elsewhere = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        var season = await (await trainer.PostAsJsonAsync("/api/seasons", SeasonBody())).ReadAsync<SeasonDto>();
        var anon = _f.CreateClient();

        Assert.Empty(await (await anon.GetAsync($"/api/seasons/for-competition/{competitionId}")).ReadAsync<List<SeasonLinkDto>>());
        var round = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds", new AddSeasonRoundRequest(sectionId))).ReadAsync<SeasonRoundDto>();
        var linked = await (await anon.GetAsync($"/api/seasons/for-competition/{competitionId}")).ReadAsync<List<SeasonLinkDto>>();
        Assert.Equal(season.Id, Assert.Single(linked).Id);
        Assert.Empty(await (await anon.GetAsync($"/api/seasons/for-competition/{elsewhere}")).ReadAsync<List<SeasonLinkDto>>());

        await trainer.PutAsJsonAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/included", new SetSeasonRoundIncludedRequest(false));
        Assert.Empty(await (await anon.GetAsync($"/api/seasons/for-competition/{competitionId}")).ReadAsync<List<SeasonLinkDto>>());
    }

    [Fact]
    public async Task SeasonValidation_RejectsInvalidRules()
    {
        var trainer = await _f.TrainerAsync();
        var malformed = new CreateSeasonRequest(" ", 1900, SectionFormat.Teams, "", 0,
            [new(1, 5), new(3, 6)]);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync("/api/seasons", malformed)).StatusCode);

        var increasing = SeasonBody() with { PlacePoints = [new(1, 5), new(2, 6)] };
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync("/api/seasons", increasing)).StatusCode);

        foreach (var invalid in new[]
        {
            SeasonBody() with { Year = 1900 },
            SeasonBody() with { Format = (SectionFormat)999 },
            SeasonBody() with { AgeGroup = " " },
            SeasonBody() with { BestResultsToCount = 1001 },
            SeasonBody() with { PlacePoints = [] },
            SeasonBody() with { PlacePoints = [new(1, 1_000_001)] },
        })
            Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync("/api/seasons", invalid)).StatusCode);
    }

    [Fact]
    public async Task SeasonCanBeListedReadUpdatedAndExcludedByItsOwner()
    {
        var trainer = await _f.TrainerAsync();
        var created = await (await trainer.PostAsJsonAsync("/api/seasons", SeasonBody())).ReadAsync<SeasonDto>();
        var publicSeason = Assert.Single(
            await (await _f.CreateClient().GetAsync("/api/seasons")).ReadAsync<List<SeasonDto>>(),
            x => x.Id == created.Id);
        Assert.False(publicSeason.CanManage);
        var ownerView = await (await trainer.GetAsync($"/api/seasons/{created.Id}")).ReadAsync<SeasonDto>();
        Assert.True(ownerView.CanManage);

        var update = new UpdateSeasonRequest("Updated league", 2034, SectionFormat.Teams, "Under 12", 2,
            [new(1, 12), new(2, 7)]);
        var updated = await (await trainer.PutAsJsonAsync($"/api/seasons/{created.Id}", update)).ReadAsync<SeasonDto>();
        Assert.Equal("Updated league", updated.Title);
        Assert.Equal(12, updated.PlacePoints[0].Points);
        var (other, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"/api/seasons/{created.Id}", update)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await trainer.GetAsync($"/api/seasons/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"/api/seasons/{Guid.NewGuid()}/standings")).StatusCode);

        var ownerId = await _f.TrainerIdAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        var sectionId = await _f.SeedSectionAsync(competitionId, "U12 round");
        var round = await (await trainer.PostAsJsonAsync($"/api/seasons/{created.Id}/rounds", new AddSeasonRoundRequest(sectionId)))
            .ReadAsync<SeasonRoundDto>();
        var excluded = await (await trainer.PutAsJsonAsync($"/api/seasons/{created.Id}/rounds/{round.Id}/included",
            new SetSeasonRoundIncludedRequest(false))).ReadAsync<SeasonRoundDto>();
        Assert.False(excluded.IsIncluded);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PutAsJsonAsync($"/api/seasons/{created.Id}/rounds/{round.Id}/included", new SetSeasonRoundIncludedRequest(true))).StatusCode);

        var incompatible = update with { Format = SectionFormat.Pairs };
        Assert.Equal(HttpStatusCode.Conflict, (await trainer.PutAsJsonAsync($"/api/seasons/{created.Id}", incompatible)).StatusCode);
    }

    [Fact]
    public async Task TeamProfiles_UseExplicitIdentity_AndAllowSameName()
    {
        var trainer = await _f.TrainerAsync();
        var clubId = await _f.SeedClubAsync("Explicit Identity Club");
        var body = new CreateTeamProfileRequest(clubId, "A", "Explicit Identity Club A");

        var first = await (await trainer.PostAsJsonAsync("/api/team-profiles", body)).ReadAsync<TeamProfileDto>();
        var secondResponse = await trainer.PostAsJsonAsync("/api/team-profiles", body);
        var second = await secondResponse.ReadAsync<TeamProfileDto>();

        Assert.Equal(HttpStatusCode.Created, secondResponse.StatusCode);
        Assert.NotEqual(first.Id, second.Id);
        var publicList = await (await _f.CreateClient().GetAsync("/api/team-profiles")).ReadAsync<List<TeamProfileDto>>();
        Assert.Contains(publicList, x => x.Id == first.Id);
        Assert.Contains(publicList, x => x.Id == second.Id);

        var updated = await (await trainer.PutAsJsonAsync($"/api/team-profiles/{first.Id}",
            new UpdateTeamProfileRequest(clubId, "C", "Explicit Identity Club C"))).ReadAsync<TeamProfileDto>();
        Assert.Equal("C", updated.Suffix);
        Assert.True(updated.CanManage);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await trainer.PutAsJsonAsync($"/api/team-profiles/{first.Id}", new UpdateTeamProfileRequest(0, "", ""))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _f.CreateClient().GetAsync($"/api/team-profiles/{Guid.NewGuid()}/history")).StatusCode);
    }

    [Fact]
    public async Task TrainerCannotLinkAnotherOwnersCompetitionOrProfile()
    {
        var ownerId = await _f.TrainerIdAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        var sectionId = await _f.SeedSectionAsync(competitionId);
        var clubId = await _f.SeedClubAsync();
        var teamId = await _f.SeedTeamAsync(competitionId, sectionId, clubId);
        var owner = await _f.TrainerAsync();
        var profile = await (await owner.PostAsJsonAsync("/api/team-profiles",
            new CreateTeamProfileRequest(clubId, "A", "Owner team"))).ReadAsync<TeamProfileDto>();
        var unrelated = await (await owner.PostAsJsonAsync("/api/team-profiles",
            new CreateTeamProfileRequest(clubId, "B", "Different team"))).ReadAsync<TeamProfileDto>();
        Assert.Equal(HttpStatusCode.Conflict,
            (await owner.PostAsJsonAsync($"/api/competitions/{competitionId}/team-profile-links",
                new LinkEventTeamRequest(unrelated.Id, teamId))).StatusCode);
        var (other, _) = await _f.ApprovedTrainerAsync();

        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PostAsJsonAsync($"/api/competitions/{competitionId}/team-profile-links",
                new LinkEventTeamRequest(profile.Id, teamId))).StatusCode);

        var otherCompetition = await _f.SeedCompetitionAsync(ownerUserId: (await _f.ApprovedTrainerAsync()).Auth.User.Id);
        var otherSection = await _f.SeedSectionAsync(otherCompetition);
        var otherTeam = await _f.SeedTeamAsync(otherCompetition, otherSection, clubId);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PostAsJsonAsync($"/api/competitions/{otherCompetition}/team-profile-links",
                new LinkEventTeamRequest(profile.Id, otherTeam))).StatusCode);

        var linked = await owner.PostAsJsonAsync($"/api/competitions/{competitionId}/team-profile-links",
            new LinkEventTeamRequest(profile.Id, teamId));
        Assert.Equal(HttpStatusCode.Created, linked.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await owner.PostAsJsonAsync($"/api/competitions/{competitionId}/team-profile-links",
                new LinkEventTeamRequest(profile.Id, teamId))).StatusCode);
    }

    [Fact]
    public async Task LinkedTeamProfileKeepsStableClubAndSuffixButAllowsDisplayNameCorrection()
    {
        var setup = await ArrangeCompletedRoundAsync(tied: false);
        var trainer = await _f.TrainerAsync();
        var history = await (await trainer.GetAsync($"/api/team-profiles/{setup.ProfileIds[0]}/history"))
            .ReadAsync<TeamProfileHistoryDto>();

        var changedIdentity = await trainer.PutAsJsonAsync($"/api/team-profiles/{setup.ProfileIds[0]}",
            new UpdateTeamProfileRequest(history.Profile.ClubId, "Changed", "Changed identity"));
        Assert.Equal(HttpStatusCode.Conflict, changedIdentity.StatusCode);

        var corrected = await (await trainer.PutAsJsonAsync($"/api/team-profiles/{setup.ProfileIds[0]}",
            new UpdateTeamProfileRequest(history.Profile.ClubId, history.Profile.Suffix, "Corrected display name")))
            .ReadAsync<TeamProfileDto>();
        Assert.Equal("Corrected display name", corrected.DisplayName);
        Assert.Equal(history.Profile.Suffix, corrected.Suffix);
    }

    [Fact]
    public async Task RoundRejectsMixedDivisionAndDuplicateSection()
    {
        var ownerId = await _f.TrainerIdAsync();
        var trainer = await _f.TrainerAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        var matching = await _f.SeedSectionAsync(competitionId, "Under 12");
        var mixed = await _f.WithDbAsync(async db =>
        {
            var section = new CompetitionSection
            {
                CompetitionId = competitionId, Format = SectionFormat.Pairs,
                AgeGroup = "Under 12", DisplayName = "Pairs",
            };
            db.CompetitionSections.Add(section);
            await db.SaveChangesAsync();
            return section.Id;
        });
        var season = await (await trainer.PostAsJsonAsync("/api/seasons", SeasonBody())).ReadAsync<SeasonDto>();

        Assert.Equal(HttpStatusCode.Conflict,
            (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds", new AddSeasonRoundRequest(mixed))).StatusCode);
        Assert.Equal(HttpStatusCode.Created,
            (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds", new AddSeasonRoundRequest(matching))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds", new AddSeasonRoundRequest(matching))).StatusCode);
    }

    [Fact]
    public async Task Publication_UsesSharedTies_IsVersioned_AndRejectsStalePreview()
    {
        var setup = await ArrangeCompletedRoundAsync(tied: true);
        var trainer = await _f.TrainerAsync();
        var season = await (await trainer.PostAsJsonAsync("/api/seasons", SeasonBody())).ReadAsync<SeasonDto>();
        var round = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds",
            new AddSeasonRoundRequest(setup.SectionId))).ReadAsync<SeasonRoundDto>();

        var previewResponse = await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview");
        var preview = await previewResponse.ReadAsync<SeasonPublicationPreviewDto>();
        Assert.Equal(HttpStatusCode.OK, previewResponse.StatusCode);
        Assert.Equal([1, 1], preview.Results.Select(x => x.EventRank));
        Assert.All(preview.Results, x => Assert.Equal(10, x.SeasonPoints));

        await _f.WithDbAsync(async db =>
        {
            var teamId = await db.Results.Where(x => x.RaceId == setup.RaceId).OrderBy(x => x.Id).Select(x => x.TeamId).FirstAsync();
            (await db.Teams.SingleAsync(x => x.Id == teamId)).IsHorsConcours = true;
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Conflict,
            (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications",
                new PublishSeasonRoundRequest(preview.SourceFingerprint, preview.NextVersion))).StatusCode);

        var fresh = await (await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview"))
            .ReadAsync<SeasonPublicationPreviewDto>();
        var first = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications",
            new PublishSeasonRoundRequest(fresh.SourceFingerprint, fresh.NextVersion))).ReadAsync<SeasonRoundPublicationDto>();
        Assert.Equal(1, first.Version);
        var publicVersion = await (await _f.CreateClient().GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications/1"))
            .ReadAsync<SeasonRoundPublicationDto>();
        Assert.Equal("Section total points across all completed races", publicVersion.RankingBasis);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _f.CreateClient().GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications/999")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications",
                new PublishSeasonRoundRequest(fresh.SourceFingerprint, fresh.NextVersion))).StatusCode);

        await _f.WithDbAsync(async db =>
        {
            var result = await db.Results.Where(x => x.RaceId == setup.RaceId).OrderByDescending(x => x.Id).FirstAsync();
            result.Points += 2;
            await db.SaveChangesAsync();
        });
        var staleSeason = await (await _f.CreateClient().GetAsync($"/api/seasons/{season.Id}")) .ReadAsync<SeasonDto>();
        Assert.False(Assert.Single(staleSeason.Rounds).PublicationIsCurrent);
        var secondPreview = await (await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview"))
            .ReadAsync<SeasonPublicationPreviewDto>();
        var second = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications",
            new PublishSeasonRoundRequest(secondPreview.SourceFingerprint, secondPreview.NextVersion))).ReadAsync<SeasonRoundPublicationDto>();
        Assert.Equal(2, second.Version);
        Assert.NotEqual(first.SourceFingerprint, second.SourceFingerprint);
        var currentSeason = await (await trainer.GetAsync($"/api/seasons/{season.Id}")).ReadAsync<SeasonDto>();
        Assert.True(Assert.Single(currentSeason.Rounds).PublicationIsCurrent);
    }

    [Fact]
    public async Task PublicationRejectsIncompleteRaceAndMissingExplicitLink()
    {
        var setup = await ArrangeCompletedRoundAsync(tied: false);
        var trainer = await _f.TrainerAsync();
        var season = await (await trainer.PostAsJsonAsync("/api/seasons", SeasonBody())).ReadAsync<SeasonDto>();
        var round = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds",
            new AddSeasonRoundRequest(setup.SectionId))).ReadAsync<SeasonRoundDto>();
        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.SingleAsync(x => x.Id == setup.RaceId);
            race.IsComplete = false;
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Conflict,
            (await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview")).StatusCode);

        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.SingleAsync(x => x.Id == setup.RaceId);
            race.IsComplete = true;
            var result = await db.Results.Where(x => x.RaceId == setup.RaceId).OrderByDescending(x => x.Id).FirstAsync();
            db.Results.Remove(result);
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Conflict,
            (await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview")).StatusCode);

        await _f.WithDbAsync(async db =>
        {
            var heatTeamIds = await db.HeatEntries.Where(x => x.Heat!.Races.Any(r => r.Id == setup.RaceId)).Select(x => x.TeamId).ToListAsync();
            var existingTeamIds = await db.Results.Where(x => x.RaceId == setup.RaceId).Select(x => x.TeamId).ToListAsync();
            var missingTeamId = heatTeamIds.Except(existingTeamIds).Single();
            db.Results.Add(new Result { RaceId = setup.RaceId, TeamId = missingTeamId, Placing = 2, Points = 4 });
            var link = await db.Set<EventTeamProfileLink>().FirstAsync(x => x.TeamProfileId == setup.ProfileIds[0]);
            db.Remove(link);
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Conflict,
            (await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview")).StatusCode);
    }

    [Fact]
    public async Task PublicationRejectsASectionWithoutRaces()
    {
        var ownerId = await _f.TrainerIdAsync();
        var trainer = await _f.TrainerAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        var sectionId = await _f.SeedSectionAsync(competitionId, "Empty round");
        await _f.WithDbAsync(async db =>
        {
            db.Sessions.Add(new Session { CompetitionId = competitionId, CompetitionSectionId = sectionId, Name = "Empty", OrderIndex = 1 });
            await db.SaveChangesAsync();
        });
        var season = await (await trainer.PostAsJsonAsync("/api/seasons", SeasonBody())).ReadAsync<SeasonDto>();
        var round = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds", new AddSeasonRoundRequest(sectionId)))
            .ReadAsync<SeasonRoundDto>();

        Assert.Equal(HttpStatusCode.Conflict,
            (await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview")).StatusCode);
    }

    [Fact]
    public async Task BestNStandingsAreDeterministicAndTiesShareRank()
    {
        var data = await _f.WithDbAsync(async db =>
        {
            var owner = await db.Users.SingleAsync(x => x.Email == TestClients.TrainerEmail);
            var club = new Club { Name = $"Standings {Guid.NewGuid():N}" };
            db.Clubs.Add(club);
            await db.SaveChangesAsync();
            var a = new TeamProfile { OwnerUserId = owner.Id, ClubId = club.Id, DisplayName = "Alpha", Suffix = "A" };
            var b = new TeamProfile { OwnerUserId = owner.Id, ClubId = club.Id, DisplayName = "Bravo", Suffix = "B" };
            var season = new Season
            {
                OwnerUserId = owner.Id, Title = "Best two", Year = 2033, Format = SectionFormat.Teams,
                AgeGroup = "Under 12", BestResultsToCount = 2,
            };
            db.Set<TeamProfile>().AddRange(a, b);
            db.Set<Season>().Add(season);
            await db.SaveChangesAsync();
            for (var i = 1; i <= 3; i++)
            {
                var competition = new Competition { Name = $"Round {i}", StartDate = new DateTime(2033, i, 1, 0, 0, 0, DateTimeKind.Utc), CreatedByUserId = owner.Id };
                db.Competitions.Add(competition);
                await db.SaveChangesAsync();
                var section = new CompetitionSection { CompetitionId = competition.Id, Format = SectionFormat.Teams, AgeGroup = "Under 12", DisplayName = "U12" };
                db.CompetitionSections.Add(section);
                await db.SaveChangesAsync();
                var round = new SeasonRound { SeasonId = season.Id, CompetitionId = competition.Id, CompetitionSectionId = section.Id, OrderIndex = i };
                db.Set<SeasonRound>().Add(round);
                await db.SaveChangesAsync();
                var pub = new SeasonRoundPublication { SeasonRoundId = round.Id, Version = 1, SourceFingerprint = new string((char)('A' + i), 64), PublishedByUserId = owner.Id };
                db.Set<SeasonRoundPublication>().Add(pub);
                await db.SaveChangesAsync();
                db.Set<SeasonRoundResult>().AddRange(
                    new SeasonRoundResult { SeasonRoundPublicationId = pub.Id, TeamProfileId = a.Id, EventTeamId = i * 10, TeamName = "Alpha", ClubName = club.Name, EventRank = 1, EventPoints = 10, SeasonPoints = i == 1 ? 1 : 5 },
                    new SeasonRoundResult { SeasonRoundPublicationId = pub.Id, TeamProfileId = b.Id, EventTeamId = i * 10 + 1, TeamName = "Bravo", ClubName = club.Name, EventRank = 1, EventPoints = 10, SeasonPoints = i == 3 ? 1 : 5 });
                await db.SaveChangesAsync();
            }
            return season.Id;
        });

        var standings = await (await _f.CreateClient().GetAsync($"/api/seasons/{data}/standings")).ReadAsync<SeasonStandingsDto>();
        Assert.Equal([1, 1], standings.Standings.Select(x => x.Rank));
        Assert.All(standings.Standings, x => Assert.Equal(10, x.TotalPoints));
        Assert.All(standings.Standings, x => Assert.Equal(2, x.Rounds.Count(r => r.Counted)));
    }

    [Fact]
    public async Task PublicHistoryOnlyReturnsPublicSnapshotFields()
    {
        var setup = await ArrangeCompletedRoundAsync(tied: false);
        var trainer = await _f.TrainerAsync();
        var season = await (await trainer.PostAsJsonAsync("/api/seasons", SeasonBody())).ReadAsync<SeasonDto>();
        var round = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds",
            new AddSeasonRoundRequest(setup.SectionId))).ReadAsync<SeasonRoundDto>();
        var preview = await (await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview")).ReadAsync<SeasonPublicationPreviewDto>();
        await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications", new PublishSeasonRoundRequest(preview.SourceFingerprint, preview.NextVersion));

        var response = await _f.CreateClient().GetAsync($"/api/team-profiles/{setup.ProfileIds[0]}/history");
        var json = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain("dateOfBirth", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("contactInfo", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("trainerUserId", json, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("publishedResults", json);
    }

    [Fact]
    public async Task PublicHistoryOmitsProfileWhenLatestPublicationExcludesIt()
    {
        var setup = await ArrangeCompletedRoundAsync(tied: false);
        var trainer = await _f.TrainerAsync();
        var season = await (await trainer.PostAsJsonAsync("/api/seasons", SeasonBody())).ReadAsync<SeasonDto>();
        var round = await (await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds",
            new AddSeasonRoundRequest(setup.SectionId))).ReadAsync<SeasonRoundDto>();
        var preview = await (await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview"))
            .ReadAsync<SeasonPublicationPreviewDto>();
        await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications",
            new PublishSeasonRoundRequest(preview.SourceFingerprint, preview.NextVersion));

        await _f.WithDbAsync(async db =>
        {
            var teamId = await db.Set<EventTeamProfileLink>()
                .Where(x => x.TeamProfileId == setup.ProfileIds[0])
                .Select(x => x.TeamId)
                .SingleAsync();
            (await db.Teams.SingleAsync(x => x.Id == teamId)).IsHorsConcours = true;
            await db.SaveChangesAsync();
        });
        var secondPreview = await (await trainer.GetAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publication-preview"))
            .ReadAsync<SeasonPublicationPreviewDto>();
        await trainer.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds/{round.Id}/publications",
            new PublishSeasonRoundRequest(secondPreview.SourceFingerprint, secondPreview.NextVersion));

        var history = await (await _f.CreateClient().GetAsync($"/api/team-profiles/{setup.ProfileIds[0]}/history"))
            .ReadAsync<TeamProfileHistoryDto>();
        Assert.Empty(history.PublishedResults);
    }

    private async Task<(int SectionId, int RaceId, Guid[] ProfileIds)> ArrangeCompletedRoundAsync(bool tied)
    {
        var ownerId = await _f.TrainerIdAsync();
        return await _f.WithDbAsync(async db =>
        {
            var competition = new Competition { Name = $"Season round {Guid.NewGuid():N}", StartDate = new DateTime(2032, 6, 1, 0, 0, 0, DateTimeKind.Utc), CreatedByUserId = ownerId };
            var club = new Club { Name = $"Season Club {Guid.NewGuid():N}" };
            db.AddRange(competition, club);
            await db.SaveChangesAsync();
            var section = new CompetitionSection { CompetitionId = competition.Id, Format = SectionFormat.Teams, AgeGroup = "Under 12", DisplayName = "Under 12" };
            db.Add(section);
            await db.SaveChangesAsync();
            var teams = new[]
            {
                new Team { CompetitionId = competition.Id, CompetitionSectionId = section.Id, ClubId = club.Id, Suffix = "A", DisplayName = "Season Club A" },
                new Team { CompetitionId = competition.Id, CompetitionSectionId = section.Id, ClubId = club.Id, Suffix = "B", DisplayName = "Season Club B" },
            };
            var profiles = new[]
            {
                new TeamProfile { OwnerUserId = ownerId, ClubId = club.Id, Suffix = "A", DisplayName = "Season Club A" },
                new TeamProfile { OwnerUserId = ownerId, ClubId = club.Id, Suffix = "B", DisplayName = "Season Club B" },
            };
            db.AddRange(teams);
            db.Set<TeamProfile>().AddRange(profiles);
            await db.SaveChangesAsync();
            db.Set<EventTeamProfileLink>().AddRange(
                new EventTeamProfileLink { TeamProfileId = profiles[0].Id, CompetitionId = competition.Id, TeamId = teams[0].Id, LinkedByUserId = ownerId },
                new EventTeamProfileLink { TeamProfileId = profiles[1].Id, CompetitionId = competition.Id, TeamId = teams[1].Id, LinkedByUserId = ownerId });
            var session = new Session { CompetitionId = competition.Id, CompetitionSectionId = section.Id, Name = "Round", OrderIndex = 1 };
            db.Add(session);
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = session.Id, Label = "Heat 1", OrderIndex = 1 };
            db.Add(heat);
            await db.SaveChangesAsync();
            db.AddRange(new HeatEntry { HeatId = heat.Id, TeamId = teams[0].Id, LaneIndex = 1 }, new HeatEntry { HeatId = heat.Id, TeamId = teams[1].Id, LaneIndex = 2 });
            var race = new Race { HeatId = heat.Id, Name = "Race", OrderIndex = 1, IsComplete = true };
            db.Add(race);
            await db.SaveChangesAsync();
            db.AddRange(
                new Result { RaceId = race.Id, TeamId = teams[0].Id, Placing = 1, Points = 5 },
                new Result { RaceId = race.Id, TeamId = teams[1].Id, Placing = tied ? 1 : 2, Points = tied ? 5 : 4 });
            await db.SaveChangesAsync();
            return (section.Id, race.Id, profiles.Select(x => x.Id).ToArray());
        });
    }
}
