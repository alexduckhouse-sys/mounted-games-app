using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services.DecForms;
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
        // A club that isn't listed is no error: it is created on import.
        Assert.DoesNotContain("Unknown club.", preview.Rows[3].Errors);
        Assert.Null(preview.Rows[3].ClubId);
        Assert.Contains("Unknown section.", preview.Rows[3].Errors);

        // The suffix column is optional.
        var noSuffix = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{competitionId}/team-import/preview",
            new CsvTeamImportRequest($"club,section\n{club},U12"))).ReadAsync<CsvTeamImportPreviewDto>();
        Assert.Empty(noSuffix.Rows[0].Errors);
        Assert.Equal(club, noSuffix.Rows[0].TeamName);

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
    public async Task CloneCopiesTheSetupWithoutTeamsResultsEntriesOrPayments()
    {
        var source = await ArrangeCloneSourceAsync();
        var trainer = await _f.TrainerAsync();
        var start = new DateTime(2035, 7, 12, 9, 0, 0, DateTimeKind.Utc);

        var response = await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{source.CompetitionId}/clone",
            new CloneCompetitionRequest("Next event", start, start.AddDays(1)));
        var clone = await response.ReadAsync<CloneCompetitionResultDto>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal((1, 0, 2, 0, 0), (clone.Sections, clone.Teams, clone.Sessions, clone.Heats, clone.Races));
        await _f.WithDbAsync(async db =>
        {
            var copied = await db.Competitions.AsSplitQuery()
                .Include(x => x.Sections).ThenInclude(x => x.Signups)
                .Include(x => x.Sessions).ThenInclude(x => x.Heats)
                .SingleAsync(x => x.Id == clone.CompetitionId);
            Assert.Equal(start, copied.StartDate);
            // Set-up: hatbands, payment details, terms and the dec form setup come across.
            Assert.Equal("Private destination", copied.PaymentDestination);
            Assert.Equal("[\"Red\",\"Blue\"]", copied.LaneHatbands);
            Assert.Equal("Our terms", copied.TermsText);
            Assert.NotNull(copied.DecFormConfigJson);
            var section = Assert.Single(copied.Sections);
            Assert.Equal((TieBreakRule.LastRace, 4, 1500), (section.TieBreakRule, section.FinalistCount, section.PriceMinor));
            // Nothing that belongs to last year's entrants.
            Assert.Empty(section.Signups);
            Assert.Empty(await db.Teams.Where(t => t.CompetitionId == clone.CompetitionId).ToListAsync());
            Assert.Empty(await db.Results.Where(r => r.Race!.Heat!.Session!.CompetitionId == clone.CompetitionId).ToListAsync());
            Assert.Empty(await db.Set<EventTeamProfileLink>().Where(x => x.CompetitionId == clone.CompetitionId).ToListAsync());
            // Timetable plan: sessions keep their shape and move with the dates; heats stay behind.
            var sessions = copied.Sessions.OrderBy(x => x.OrderIndex).ToList();
            Assert.Empty(sessions[0].Heats); // an ordinary session's heats are drawn again for the new event
            var race = sessions[0];
            Assert.Equal(6, race.LanesPerHeat);
            Assert.Equal(start.AddHours(1), race.ScheduledStart);
            Assert.Equal(SessionStatus.Upcoming, race.Status);
            Assert.Equal("[\"Bending\",\"Mug\"]", race.PlannedRaces);
            Assert.Equal("{\"B\":[\"Flag\"]}", race.PlannedFinalRaces);
            Assert.Equal(copied.Sections.Single().Id, race.CompetitionSectionId);
            var lunch = sessions[1];
            Assert.Equal((SessionKind.Break, "Lunch for all"), (lunch.Kind, lunch.Notes));
            Assert.Null(lunch.CompetitionSectionId);
        });
    }

    [Fact]
    public async Task CloneTakesTheRaceListFromTheFirstHeatWhenNoneWasPlanned()
    {
        var source = await ArrangeCloneSourceAsync(plannedRaces: false);
        var trainer = await _f.TrainerAsync();
        var start = new DateTime(2035, 9, 12, 9, 0, 0, DateTimeKind.Utc);
        var clone = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{source.CompetitionId}/clone",
            new CloneCompetitionRequest("From heats", start, null))).ReadAsync<CloneCompetitionResultDto>();

        var planned = await _f.WithDbAsync(db => db.Sessions
            .Where(x => x.CompetitionId == clone.CompetitionId && x.Kind == SessionKind.Race).Select(x => x.PlannedRaces).SingleAsync());
        Assert.Equal("[\"Race 1\"]", planned);
    }

    [Fact]
    public async Task CloneRequiresAnOrganiserWhoCanManageTheSource()
    {
        var source = await ArrangeCloneSourceAsync();
        var start = new DateTime(2035, 7, 12, 9, 0, 0, DateTimeKind.Utc);
        var request = new CloneCompetitionRequest("Not yours", start, null);
        var url = $"/api/event-tools/competitions/{source.CompetitionId}/clone";
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(url, request)).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync(url, request)).StatusCode);
        var (other, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync(url, request)).StatusCode);
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
    public async Task PrintedDrawAndScoreSheets_TimeEveryHeat_SkipNonRaceItems_AndCarryLanesAndBibs()
    {
        var ownerId = await _f.TrainerIdAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: ownerId);
        var sectionId = await _f.SeedSectionAsync(competitionId, "Print section");
        var clubId = await _f.SeedClubAsync();
        var teamId = await _f.SeedTeamAsync(competitionId, sectionId, clubId, "Print team");
        await _f.WithDbAsync(async db =>
        {
            (await db.Teams.SingleAsync(t => t.Id == teamId)).BibDescription = "Green bibs";
            var start = new DateTime(2037, 6, 6, 9, 0, 0, DateTimeKind.Utc);
            // The auto-timetable sets only the session's start; heats have no time of their own.
            var race = new Session { CompetitionId = competitionId, CompetitionSectionId = sectionId, Name = "Racing", OrderIndex = 1,
                ScheduledStart = start, MinutesPerHeat = 10 };
            var briefing = new Session { CompetitionId = competitionId, Name = "Riders briefing", OrderIndex = 2, Kind = SessionKind.Briefing };
            db.AddRange(race, briefing);
            await db.SaveChangesAsync();
            for (var i = 1; i <= 2; i++)
            {
                var heat = new Heat { SessionId = race.Id, Label = $"Heat {i}", OrderIndex = i };
                db.Add(heat);
                await db.SaveChangesAsync();
                db.Add(new HeatEntry { HeatId = heat.Id, TeamId = teamId, LaneIndex = 3 });
                var r = new Race { HeatId = heat.Id, Name = "Bending", OrderIndex = 1, IsComplete = i == 1 };
                var r2 = new Race { HeatId = heat.Id, Name = "Mug", OrderIndex = 2 };
                db.AddRange(r, r2);
                await db.SaveChangesAsync();
                if (i == 1) db.Add(new Result { RaceId = r.Id, TeamId = teamId, Placing = 1, Points = 4 });
            }
            await db.SaveChangesAsync();
        });
        var anonymous = _f.CreateClient();

        var draw = await (await anonymous.GetAsync($"/api/event-tools/competitions/{competitionId}/print/draw")).ReadAsync<PrintableDrawDto>();
        var score = await (await anonymous.GetAsync($"/api/event-tools/competitions/{competitionId}/print/score-sheets")).ReadAsync<PrintableScoreSheetsDto>();

        var session = Assert.Single(draw.Sessions);
        Assert.Equal("Racing", session.SessionName);
        var nine = new DateTime(2037, 6, 6, 9, 0, 0, DateTimeKind.Utc);
        // Heats are timed from the session start: 10 minutes per whole heat, with two races each.
        Assert.Equal(new DateTime?[] { nine, nine.AddMinutes(10) }, session.Heats.Select(h => h.ScheduledStart));
        Assert.Equal(new DateTime?[] { nine, nine.AddMinutes(10) }, score.Heats.Select(h => h.ScheduledStart));
        var firstCell = score.Heats[0].Races[0].Teams.Single();
        Assert.Equal((3, "Green bibs", 4), (firstCell.Lane, firstCell.Bib, firstCell.Points));
        Assert.Null(score.Heats[1].Races[0].Teams.Single().Points);
    }

    [Fact]
    public async Task CloneKeepsTheFinalsSessionWithEmptyLetteredFinalHeats()
    {
        var source = await ArrangeCloneSourceAsync(standardFinal: true);
        var trainer = await _f.TrainerAsync();
        var start = new DateTime(2036, 8, 12, 9, 0, 0, DateTimeKind.Utc);
        var clone = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{source.CompetitionId}/clone",
            new CloneCompetitionRequest("Fresh standard finals", start, null))).ReadAsync<CloneCompetitionResultDto>();

        await _f.WithDbAsync(async db =>
        {
            var session = await db.Sessions.Include(x => x.Heats).ThenInclude(h => h.Races)
                .SingleAsync(x => x.CompetitionId == clone.CompetitionId && x.Name == "Finals · U12");
            // The heat is there to be populated from the new event's standings, with its race, and no teams.
            var heat = Assert.Single(session.Heats);
            Assert.Equal("A Final", heat.Label);
            Assert.Equal("Race 1", Assert.Single(heat.Races).Name);
            Assert.False(heat.Races.Single().IsComplete);
            Assert.Equal(start.AddHours(1), heat.ScheduledStart);
            Assert.Equal(0, await db.HeatEntries.CountAsync(x => x.Heat!.Session!.CompetitionId == clone.CompetitionId));
            Assert.Equal(0, await db.Results.CountAsync(x => x.Race!.Heat!.Session!.CompetitionId == clone.CompetitionId));
        });
    }

    [Fact]
    public async Task CloneLeavesThePayoutClubEmptyWhenTheCreatorHasNone()
    {
        var source = await ArrangeCloneSourceAsync();
        await _f.InDbAsync(async db =>
        {
            var c = await db.Competitions.SingleAsync(x => x.Id == source.CompetitionId);
            c.DecFormConfigJson = (DecFormConfig.Basic with { PayoutClubId = 4242 }).ToJson();
            await db.SaveChangesAsync();
            var ownerId = c.CreatedByUserId;
            (await db.Users.SingleAsync(u => u.Id == ownerId)).ClubId = null;
            await db.SaveChangesAsync();
        });
        var trainer = await _f.TrainerAsync();
        var clone = await (await trainer.PostAsJsonAsync($"/api/event-tools/competitions/{source.CompetitionId}/clone",
            new CloneCompetitionRequest("No club", new DateTime(2036, 9, 1, 9, 0, 0, DateTimeKind.Utc), null))).ReadAsync<CloneCompetitionResultDto>();
        var config = await _f.WithDbAsync(db => db.Competitions.Where(c => c.Id == clone.CompetitionId).Select(c => c.DecFormConfigJson).SingleAsync());
        Assert.Null(DecFormConfig.Parse(config)!.PayoutClubId);
    }

    private async Task<(int CompetitionId, int TeamId)> ArrangeCloneSourceAsync(bool derivedFinal = false, bool standardFinal = false, bool plannedRaces = true)
    {
        var ownerId = await _f.TrainerIdAsync();
        return await _f.WithDbAsync(async db =>
        {
            var start = new DateTime(2034, 6, 1, 9, 0, 0, DateTimeKind.Utc);
            var competition = new Competition
            {
                Name = $"Clone source {Guid.NewGuid():N}", StartDate = start, EndDate = start.AddDays(1),
                CreatedByUserId = ownerId, OrganiserName = "Private organiser", PaymentDestination = "Private destination",
                LaneHatbands = "[\"Red\",\"Blue\"]", TermsText = "Our terms",
                DecFormConfigJson = DecFormConfig.Basic.ToJson(),
            };
            var club = new Club { Name = $"Clone Club {Guid.NewGuid():N}" };
            db.AddRange(competition, club);
            await db.SaveChangesAsync();
            var section = new CompetitionSection { CompetitionId = competition.Id, Format = SectionFormat.Teams, AgeGroup = "Under 12", DisplayName = "U12",
                TieBreakRule = TieBreakRule.LastRace, FinalistCount = 4, PriceMinor = 1500 };
            db.Add(section);
            await db.SaveChangesAsync();
            db.Add(new SectionSignup { CompetitionSectionId = section.Id, FullName = "Paid Entrant", AmountMinor = 1500, Status = SignupPaymentStatus.Paid });
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
                PlannedRaces = plannedRaces && !standardFinal ? "[\"Bending\",\"Mug\"]" : null,
                PlannedFinalRaces = plannedRaces && !standardFinal ? "{\"B\":[\"Flag\"]}" : null,
            };
            db.Add(session);
            if (!standardFinal)
                db.Add(new Session { CompetitionId = competition.Id, Name = "Lunch", OrderIndex = 2, Kind = SessionKind.Break, IsBreak = true,
                    Notes = "Lunch for all [paused:1700000000000] [shift:+10]" });
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
