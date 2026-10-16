using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.EventTools;

public class EventToolsEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public EventToolsEndpointsTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task ImportWritesRequireStoredCompetitionOwnership()
    {
        var ownerId = await _f.TrainerIdAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        var request = new CsvTeamImportRequest("club,suffix,section\nUnknown,A,Unknown");
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _f.CreateClient().PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview", request)).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await member.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview", request)).StatusCode);
        var (pendingTrainer, _) = await _f.SignupAsync();
        Assert.Equal(HttpStatusCode.Forbidden,
            (await pendingTrainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview", request)).StatusCode);
        var (otherTrainer, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound,
            (await otherTrainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview", request)).StatusCode);
    }

    [Fact]
    public async Task CsvPreviewAndApplySupportBomQuotedCommasAndNewlines()
    {
        var ownerId = await _f.TrainerIdAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        var sectionId = await _f.SeedSectionAsync(competitionId, "U12, Teams");
        var clubId = await _f.SeedClubAsync("North, West\nClub");
        var trainer = await _f.TrainerAsync();
        const string csv = "\uFEFFclub,suffix,section\r\n\"North, West\nClub\",\"A\",\"U12, Teams\"\r\n";

        var previewResponse = await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview", new CsvTeamImportRequest(csv));
        var preview = await previewResponse.ReadAsync<CsvTeamImportPreviewDto>();
        Assert.Equal(HttpStatusCode.OK, previewResponse.StatusCode);
        var row = Assert.Single(preview.Rows);
        Assert.Empty(row.Errors);
        Assert.Equal(clubId, row.ClubId);
        Assert.Equal(sectionId, row.CompetitionSectionId);

        var applyResponse = await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/apply",
            new ApplyCsvTeamImportRequest(csv, preview.Fingerprint, preview.PreviewVersion));
        var applied = await applyResponse.ReadAsync<CsvTeamImportResultDto>();
        Assert.Equal(HttpStatusCode.OK, applyResponse.StatusCode);
        Assert.Equal(1, applied.CreatedCount);
        var team = await _f.WithDbAsync(db => db.Teams.AsNoTracking().SingleAsync(x => x.Id == applied.TeamIds[0]));
        Assert.Equal("North, West\nClub A", team.DisplayName);
    }

    [Fact]
    public async Task CsvPreviewReportsUnknownDuplicateFormulaAndMalformedRows()
    {
        var ownerId = await _f.TrainerIdAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        await _f.SeedSectionAsync(competitionId, "U12");
        var club = $"CSV Club {Guid.NewGuid():N}";
        await _f.SeedClubAsync(club);
        var trainer = await _f.TrainerAsync();
        var csv = $"club,suffix,section\n{club},A,U12\n{club},A,U12\n=HYPERLINK(1),B,U12\nUnknown,C,Nope";

        var preview = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview",
            new CsvTeamImportRequest(csv))).ReadAsync<CsvTeamImportPreviewDto>();
        Assert.Equal(4, preview.TotalRows);
        Assert.Contains("Duplicate team in this CSV.", preview.Rows[1].Errors);
        Assert.Contains("Spreadsheet formulas are not allowed.", preview.Rows[2].Errors);
        Assert.Contains("Unknown club.", preview.Rows[3].Errors);
        Assert.Contains("Unknown section.", preview.Rows[3].Errors);

        var malformed = await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview",
            new CsvTeamImportRequest("club,suffix,section\n\"unfinished,A,U12"));
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
    }

    [Fact]
    public async Task CsvApplyRejectsStalePreviewAndExistingTeam()
    {
        var ownerId = await _f.TrainerIdAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        var sectionId = await _f.SeedSectionAsync(competitionId, "U12 import");
        var clubId = await _f.SeedClubAsync();
        var clubName = await _f.WithDbAsync(db => db.Clubs.Where(x => x.Id == clubId).Select(x => x.Name).SingleAsync());
        var trainer = await _f.TrainerAsync();
        var csv = $"club,suffix,section\n{clubName},A,U12 import";
        var preview = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview",
            new CsvTeamImportRequest(csv))).ReadAsync<CsvTeamImportPreviewDto>();

        await _f.SeedTeamAsync(competitionId, sectionId, clubId, display: "Different team");
        var stale = await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/apply",
            new ApplyCsvTeamImportRequest(csv, preview.Fingerprint, preview.PreviewVersion));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        var current = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview",
            new CsvTeamImportRequest(csv))).ReadAsync<CsvTeamImportPreviewDto>();
        Assert.Contains("Team already exists in this competition section.", Assert.Single(current.Rows).Errors);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/apply",
                new ApplyCsvTeamImportRequest(csv, current.Fingerprint, current.PreviewVersion))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/apply",
                new ApplyCsvTeamImportRequest(csv, current.Fingerprint, 99))).StatusCode);
    }

    [Fact]
    public async Task CsvLimitsAndMalformedHeadersReturnClearClientErrors()
    {
        var ownerId = await _f.TrainerIdAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        await _f.SeedSectionAsync(competitionId, "U12 limits");
        var trainer = await _f.TrainerAsync();
        var url = $"/api/event-tools/competitions/{competitionId}/team-import/preview";

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(url, new CsvTeamImportRequest(" "))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(url, new CsvTeamImportRequest("club,club,section\na,b,c"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(url, new CsvTeamImportRequest("club,suffix\na,b"))).StatusCode);
        var shortRow = await (await trainer.PostAsJsonAsync(url,
            new CsvTeamImportRequest("club,suffix,section\nonly-one"))).ReadAsync<CsvTeamImportPreviewDto>();
        Assert.Contains("required columns", Assert.Single(shortRow.Rows).Errors[0]);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(url, new CsvTeamImportRequest("club,suffix,section\n\"a\"oops,b,c"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(url, new CsvTeamImportRequest("club,suffix,section\na\"b,c,d"))).StatusCode);

        var tooMany = "club,suffix,section\n" + string.Join('\n', Enumerable.Range(1, 501).Select(x => $"Unknown,{x},Nope"));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await trainer.PostAsJsonAsync(url, new CsvTeamImportRequest(tooMany))).StatusCode);
        var tooLarge = "club,suffix,section\n" + new string('x', 256 * 1024);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await trainer.PostAsJsonAsync(url, new CsvTeamImportRequest(tooLarge))).StatusCode);
    }

    [Fact]
    public async Task CsvSuffixAcceptsTenCharactersAndRejectsEleven()
    {
        var ownerId = await _f.TrainerIdAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        await _f.SeedSectionAsync(competitionId, "U12 suffix");
        var clubId = await _f.SeedClubAsync();
        var clubName = await _f.WithDbAsync(db => db.Clubs.Where(x => x.Id == clubId).Select(x => x.Name).SingleAsync());
        var trainer = await _f.TrainerAsync();
        var csv = $"club,suffix,section\n{clubName},1234567890,U12 suffix\n{clubName},12345678901,U12 suffix";

        var preview = await (await trainer.PostAsJsonAsync(
            $"/api/event-tools/competitions/{competitionId}/team-import/preview", new CsvTeamImportRequest(csv)))
            .ReadAsync<CsvTeamImportPreviewDto>();
        Assert.Empty(preview.Rows[0].Errors);
        Assert.Contains("at most 10 characters", preview.Rows[1].Errors[0]);
    }

    [Fact]
    public async Task CloneCopiesOnlySetupAndShiftsDates()
    {
        var source = await ArrangeCloneSourceAsync();
        var trainer = await _f.TrainerAsync();
        var start = new DateTime(2035, 7, 12, 9, 0, 0, DateTimeKind.Utc);

        var response = await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{source.CompetitionId}/clone",
            new CloneCompetitionRequest("Next event", start, start.AddDays(1)));
        var clone = await response.ReadAsync<CloneCompetitionResultDto>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal((1, 1, 1, 1, 1), (clone.Sections, clone.Teams, clone.Sessions, clone.Heats, clone.Races));
        await _f.WithDbAsync(async db =>
        {
            var copied = await db.Competitions.AsSplitQuery()
                .Include(x => x.Sections).ThenInclude(x => x.Signups)
                .Include(x => x.Teams).ThenInclude(x => x.DeclarationForms)
                .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Races).ThenInclude(x => x.Results)
                .SingleAsync(x => x.Id == clone.CompetitionId);
            Assert.Equal(start, copied.StartDate);
            Assert.Null(copied.PaymentDestination);
            Assert.Null(copied.OrganiserName);
            Assert.Null(Assert.Single(copied.Teams).TrainerUserId);
            Assert.Null(Assert.Single(copied.Teams).SupporterJoinKey);
            Assert.Empty(copied.Sections.Single().Signups);
            Assert.Empty(copied.Teams.Single().DeclarationForms);
            var session = Assert.Single(copied.Sessions);
            Assert.Equal(6, session.LanesPerHeat);
            Assert.Equal(start.AddHours(1), session.ScheduledStart);
            Assert.Equal(SessionStatus.Upcoming, session.Status);
            var heat = Assert.Single(session.Heats);
            Assert.Equal(start.AddHours(1), heat.ScheduledStart);
            Assert.Empty(Assert.Single(heat.Races).Results);
            Assert.False(heat.Races.Single().IsComplete);
            Assert.Single(await db.Set<EventTeamProfileLink>().Where(x => x.CompetitionId == clone.CompetitionId).ToListAsync());
        });
    }

    [Fact]
    public async Task CloneRejectsMissingNameAndBackwardsDates()
    {
        var source = await ArrangeCloneSourceAsync();
        var trainer = await _f.TrainerAsync();
        var start = new DateTime(2035, 7, 12, 9, 0, 0, DateTimeKind.Utc);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{source.CompetitionId}/clone",
                new CloneCompetitionRequest(" ", start, null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{source.CompetitionId}/clone",
                new CloneCompetitionRequest("Bad dates", start, start.AddDays(-1)))).StatusCode);
    }

    [Fact]
    public async Task PrintableEndpointsReturnSafePublicData()
    {
        var source = await ArrangeCloneSourceAsync();
        var anonymous = _f.CreateClient();
        var draw = await (await anonymous.GetAsync($"/api/event-tools/competitions/{source.CompetitionId}/print/draw")).ReadAsync<PrintableDrawDto>();
        var score = await (await anonymous.GetAsync($"/api/event-tools/competitions/{source.CompetitionId}/print/score-sheets")).ReadAsync<PrintableScoreSheetsDto>();
        var resultsResponse = await anonymous.GetAsync($"/api/event-tools/competitions/{source.CompetitionId}/print/results");
        var results = await resultsResponse.ReadAsync<PrintableResultsDto>();

        Assert.Single(draw.Sessions);
        Assert.Single(score.Heats);
        Assert.Equal(1, Assert.Single(results.Sections).Results[0].Rank);
        var json = await resultsResponse.Content.ReadAsStringAsync();
        Assert.DoesNotContain("trainer", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("contact", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("declaration", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CloneLeavesResultDerivedRaceFinalLanesEmpty()
    {
        var source = await ArrangeCloneSourceAsync(derivedFinal: true);
        var trainer = await _f.TrainerAsync();
        var start = new DateTime(2036, 7, 12, 9, 0, 0, DateTimeKind.Utc);
        var clone = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{source.CompetitionId}/clone",
            new CloneCompetitionRequest("Fresh qualifiers", start, null))).ReadAsync<CloneCompetitionResultDto>();

        var entryCount = await _f.WithDbAsync(db => db.HeatEntries.CountAsync(x => x.Heat!.Session!.CompetitionId == clone.CompetitionId));
        Assert.Equal(0, entryCount);
    }

    [Fact]
    public async Task CloneLeavesStandardFinalLanesEmptyButKeepsTheirScaffold()
    {
        var source = await ArrangeCloneSourceAsync(standardFinal: true);
        var trainer = await _f.TrainerAsync();
        var start = new DateTime(2036, 8, 12, 9, 0, 0, DateTimeKind.Utc);
        var clone = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{source.CompetitionId}/clone",
            new CloneCompetitionRequest("Fresh standard finals", start, null))).ReadAsync<CloneCompetitionResultDto>();

        await _f.WithDbAsync(async db =>
        {
            var heat = await db.Heats.Include(x => x.Entries).Include(x => x.Races)
                .SingleAsync(x => x.Session!.CompetitionId == clone.CompetitionId);
            Assert.Equal("A Final", heat.Label);
            Assert.Empty(heat.Entries);
            Assert.Single(heat.Races);
        });
    }

    private async Task<(int CompetitionId, int TeamId)> ArrangeCloneSourceAsync(bool derivedFinal = false, bool standardFinal = false)
    {
        var ownerId = await _f.TrainerIdAsync();
        return await _f.WithDbAsync(async db =>
        {
            var start = new DateTime(2034, 6, 1, 9, 0, 0, DateTimeKind.Utc);
            var competition = new Competition
            {
                Name = $"Clone source {Guid.NewGuid():N}", StartDate = start, EndDate = start.AddDays(1),
                CreatedByUserId = ownerId, OrganiserName = "Private organiser", PaymentDestination = "Private destination",
            };
            var club = new Club { Name = $"Clone Club {Guid.NewGuid():N}" };
            db.AddRange(competition, club);
            await db.SaveChangesAsync();
            var section = new CompetitionSection { CompetitionId = competition.Id, Format = SectionFormat.Teams, AgeGroup = "Under 12", DisplayName = "U12" };
            db.Add(section);
            await db.SaveChangesAsync();
            var team = new Team
            {
                CompetitionId = competition.Id, CompetitionSectionId = section.Id, ClubId = club.Id,
                Suffix = "A", DisplayName = "Clone Club A", TrainerUserId = ownerId, SupporterJoinKey = "private-code",
            };
            var profile = new TeamProfile { OwnerUserId = ownerId, ClubId = club.Id, Suffix = "A", DisplayName = team.DisplayName };
            db.Add(team);
            db.Set<TeamProfile>().Add(profile);
            await db.SaveChangesAsync();
            db.Set<EventTeamProfileLink>().Add(new EventTeamProfileLink
            {
                CompetitionId = competition.Id, TeamId = team.Id, TeamProfileId = profile.Id, LinkedByUserId = ownerId,
            });
            var session = new Session
            {
                CompetitionId = competition.Id, CompetitionSectionId = section.Id,
                Name = standardFinal ? "Finals · U12" : "Session 1",
                ScheduledStart = start.AddHours(1), OrderIndex = 1, Status = SessionStatus.Finished,
                LanesPerHeat = 6, MinutesPerHeat = 12,
            };
            db.Add(session);
            await db.SaveChangesAsync();
            var heat = new Heat
            {
                SessionId = session.Id, Label = standardFinal ? "A Final" : "Heat 1", OrderIndex = 1,
                ScheduledStart = start.AddHours(1), StartedAt = start.AddHours(1),
                RaceRoundStage = derivedFinal ? RaceRoundStage.Final : RaceRoundStage.None,
            };
            db.Add(heat);
            await db.SaveChangesAsync();
            db.Add(new HeatEntry { HeatId = heat.Id, TeamId = team.Id, LaneIndex = 1 });
            var race = new Race { HeatId = heat.Id, Name = "Race 1", OrderIndex = 1, IsComplete = true };
            db.Add(race);
            await db.SaveChangesAsync();
            db.Add(new Result { RaceId = race.Id, TeamId = team.Id, Placing = 1, Points = 6, RecordedByUserId = ownerId });
            await db.SaveChangesAsync();
            return (competition.Id, team.Id);
        });
    }
}
