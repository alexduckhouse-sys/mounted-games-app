using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.EventTools;

/// <summary>The post-event results book, the special awards that go in it, and the staff-only entry list.</summary>
public class ResultsBookTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ResultsBookTests(ApiFactory f) => _f = f;

    private static string Base(int id) => $"/api/event-tools/competitions/{id}";

    /// <summary>
    /// A competition owned by a fresh trainer with one section, four teams and a qualifier heat plus an A Final:
    /// team 0 wins both, team 1 is eliminated in the final (with a private note), team 2 is DNS, team 3 is hors concours.
    /// </summary>
    private async Task<(Arena Arena, HttpClient Owner, int[] Races)> WorldAsync()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync(4);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id;
            (await db.Teams.FindAsync(arena.TeamIds[3]))!.IsHorsConcours = true;
            await db.SaveChangesAsync();
        });
        var (_, qualifying) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, "Heat 1", 1);
        var (_, final) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds.Take(3), "A Final", 2);
        var admin = await _f.AdminAsync();
        (await admin.PostAsJsonAsync($"/api/races/{qualifying[0]}/results", new SubmitRaceResultsRequest(new[]
        {
            new FinishingPlaceDto(arena.TeamIds[0], 1, false), new FinishingPlaceDto(arena.TeamIds[1], 2, false),
            new FinishingPlaceDto(arena.TeamIds[2], 3, false), new FinishingPlaceDto(arena.TeamIds[3], 4, false),
        }))).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"/api/races/{final[0]}/results", new SubmitRaceResultsRequest(new[]
        {
            new FinishingPlaceDto(arena.TeamIds[0], 1, false),
            new FinishingPlaceDto(arena.TeamIds[1], 0, true, ResultStatus.DidNotFinish, "Lost a shoe at the second cone"),
            new FinishingPlaceDto(arena.TeamIds[2], 0, true, ResultStatus.DidNotStart, "Pony lame"),
        }))).EnsureSuccessStatusCode();
        return (arena, owner, new[] { qualifying[0], final[0] });
    }

    // ---- who may call what ----

    [Fact]
    public async Task OrganiserBook_RequiresStaffOfThatCompetition()
    {
        var w = await WorldAsync();
        var url = $"{Base(w.Arena.CompetitionId)}/results-book/organiser";

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(url)).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.TrainerAsync()).GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await w.Owner.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.AdminAsync()).GetAsync($"{Base(999999)}/results-book/organiser")).StatusCode);
    }

    [Fact]
    public async Task PublicBook_NeedsNoSignIn_AndAnUnknownCompetitionIs404()
    {
        var w = await WorldAsync();
        Assert.Equal(HttpStatusCode.OK, (await _f.CreateClient().GetAsync($"{Base(w.Arena.CompetitionId)}/results-book")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"{Base(999999)}/results-book")).StatusCode);
    }

    [Fact]
    public async Task EntriesAndAwardsWrites_AreStaffOnly()
    {
        var w = await WorldAsync();
        var id = w.Arena.CompetitionId;
        var save = JsonContent.Create(new SaveSpecialAwardsRequest([new SaveSpecialAwardRow(null, "Best turned out", "Oak A", null)]));

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync($"{Base(id)}/print/entries")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PutAsync($"{Base(id)}/awards", save)).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"{Base(id)}/print/entries")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PutAsync($"{Base(id)}/awards", JsonContent.Create(new SaveSpecialAwardsRequest([])))).StatusCode);
        var other = await _f.TrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"{Base(id)}/print/entries")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsync($"{Base(id)}/awards", JsonContent.Create(new SaveSpecialAwardsRequest([])))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await w.Owner.GetAsync($"{Base(id)}/print/entries")).StatusCode);
    }

    // ---- what is in the book ----

    [Fact]
    public async Task Book_HasFinalStandingsFinalsAndLeavesOutHorsConcoursTeams()
    {
        var w = await WorldAsync();

        var book = await (await _f.CreateClient().GetAsync($"{Base(w.Arena.CompetitionId)}/results-book")).ReadAsync<ResultsBookDto>();

        Assert.False(book.IsProvisional);
        Assert.False(book.IncludesPrivate);
        var section = Assert.Single(book.Sections);
        Assert.Equal(new[] { w.Arena.TeamIds[0], w.Arena.TeamIds[1], w.Arena.TeamIds[2] }, section.Standings.Select(s => s.TeamId));
        Assert.Equal(new[] { 1, 2, 3 }, section.Standings.Select(s => s.Rank));
        Assert.All(section.Standings, s => Assert.Equal("A Final", s.FinalLabel));
        Assert.DoesNotContain(section.Standings, s => s.TeamId == w.Arena.TeamIds[3]);

        var final = Assert.Single(section.Finals);
        Assert.Equal("A Final", final.Label);
        Assert.Equal(new[] { "Race 1" }, final.RaceNames);
        Assert.Equal(new[] { "3", "DNF", "DNS" }, final.Rows.Select(r => r.RaceCells.Single()));
        Assert.Equal(new[] { 1, 2, 2 }, final.Rows.Select(r => r.Rank));
    }

    [Fact]
    public async Task PublicBook_NeverCarriesRefereeNotes_ButTheOrganiserCopyDoes()
    {
        var w = await WorldAsync();

        var publicJson = await _f.CreateClient().GetStringAsync($"{Base(w.Arena.CompetitionId)}/results-book");
        Assert.DoesNotContain("Lost a shoe", publicJson);
        Assert.DoesNotContain("Pony lame", publicJson);

        var organiser = await (await w.Owner.GetAsync($"{Base(w.Arena.CompetitionId)}/results-book/organiser")).ReadAsync<ResultsBookDto>();
        Assert.True(organiser.IncludesPrivate);
        Assert.Equal(new[] { "Lost a shoe at the second cone", "Pony lame" }, organiser.RefereeNotes.Select(n => n.Note).OrderBy(n => n));
        var dnf = organiser.RefereeNotes.Single(n => n.Note.StartsWith("Lost"));
        Assert.Equal("DNF", dnf.StatusLetter);
        Assert.Equal("A Final", dnf.HeatLabel);
    }

    [Fact]
    public async Task Book_IsProvisionalWhileARaceIsStillToScore()
    {
        var arena = await _f.CreateArenaAsync(2);
        await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);

        var book = await (await _f.CreateClient().GetAsync($"{Base(arena.CompetitionId)}/results-book")).ReadAsync<ResultsBookDto>();

        Assert.True(book.IsProvisional);
        Assert.Empty(book.Sections.Single().Finals);
    }

    [Fact]
    public async Task ARaceFinalOfAHeatHeatFinalRound_IsListedAsAFinal()
    {
        var arena = await _f.CreateArenaAsync(2, raceFinals: true);
        var (_, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, "Bending · Final", 1, stage: RaceRoundStage.Final, roundId: 1);
        (await (await _f.AdminAsync()).PostAsJsonAsync($"/api/races/{races[0]}/results", new SubmitRaceResultsRequest(new[]
        {
            new FinishingPlaceDto(arena.TeamIds[1], 1, false), new FinishingPlaceDto(arena.TeamIds[0], 2, false),
        }))).EnsureSuccessStatusCode();

        var book = await (await _f.CreateClient().GetAsync($"{Base(arena.CompetitionId)}/results-book")).ReadAsync<ResultsBookDto>();

        var final = Assert.Single(book.Sections.Single().Finals);
        Assert.Equal("Bending · Final", final.Label);
        Assert.Equal(new[] { arena.TeamIds[1], arena.TeamIds[0] }, final.Rows.Select(r => r.TeamId));
    }

    // ---- special awards ----

    [Fact]
    public async Task Awards_AreSavedInOrder_ReplacedOnTheNextSave_AndAppearInTheBook()
    {
        var w = await WorldAsync();
        var id = w.Arena.CompetitionId;

        var saved = await w.Owner.PutAsJsonAsync($"{Base(id)}/awards", new SaveSpecialAwardsRequest(
        [
            new SaveSpecialAwardRow(w.Arena.SectionId, "  Best turned out  ", " Team 1 ", "Gleaming tack"),
            new SaveSpecialAwardRow(null, "Spirit of the Games", "The whole of Club B", null),
        ]));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var list = await saved.ReadAsync<List<SpecialAwardDto>>();
        Assert.Equal(new[] { "Best turned out", "Spirit of the Games" }, list.Select(a => a.Title));
        Assert.Equal("Team 1", list[0].Recipient);

        var book = await (await _f.CreateClient().GetAsync($"{Base(id)}/results-book")).ReadAsync<ResultsBookDto>();
        Assert.Equal("Best turned out", Assert.Single(book.Sections.Single().Awards).Title);
        Assert.Equal("Spirit of the Games", Assert.Single(book.EventAwards).Title);
        Assert.Equal(2, (await (await _f.CreateClient().GetAsync($"{Base(id)}/awards")).ReadAsync<List<SpecialAwardDto>>()).Count);

        var replaced = await w.Owner.PutAsJsonAsync($"{Base(id)}/awards", new SaveSpecialAwardsRequest([]));
        Assert.Equal(HttpStatusCode.OK, replaced.StatusCode);
        Assert.Empty(await _f.WithDbAsync(d => d.SpecialAwards.Where(a => a.CompetitionId == id).ToListAsync()));
    }

    [Fact]
    public async Task Awards_RefuseAnAgeGroupFromAnotherCompetition_AndBlankTitles()
    {
        var w = await WorldAsync();
        var elsewhere = await _f.CreateArenaAsync(1);
        var id = w.Arena.CompetitionId;

        var wrongSection = await w.Owner.PutAsJsonAsync($"{Base(id)}/awards", new SaveSpecialAwardsRequest(
            [new SaveSpecialAwardRow(elsewhere.SectionId, "Best turned out", "Someone", null)]));
        Assert.Equal(HttpStatusCode.BadRequest, wrongSection.StatusCode);

        var blank = await w.Owner.PutAsJsonAsync($"{Base(id)}/awards", new SaveSpecialAwardsRequest(
            [new SaveSpecialAwardRow(null, "   ", "Someone", null)]));
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);

        var tooLong = await w.Owner.PutAsJsonAsync($"{Base(id)}/awards", new SaveSpecialAwardsRequest(
            [new SaveSpecialAwardRow(null, new string('t', 101), "Someone", null)]));
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"{Base(999999)}/awards")).StatusCode);
    }

    // ---- the entry list ----

    [Fact]
    public async Task Entries_ListTeamsWithRidersAndPonies_ForStaffOnly()
    {
        var w = await WorldAsync();
        await _f.WithDbAsync(async db =>
        {
            var form = new DeclarationForm { TeamId = w.Arena.TeamIds[0], SubmittedAt = DateTime.UtcNow };
            db.DeclarationForms.Add(form);
            await db.SaveChangesAsync();
            db.RiderEntries.AddRange(
                new RiderEntry { DeclarationFormId = form.Id, FullName = "Oliver Smith", HorseName = "Biscuit", IsCaptain = true, UseInitialOnly = true, OrderIndex = 0 },
                new RiderEntry { DeclarationFormId = form.Id, FullName = "Ava Jones", HorseName = " Biscuit ", IsReserve = true, OrderIndex = 1 });
            await db.SaveChangesAsync();
        });

        var entries = await (await w.Owner.GetAsync($"{Base(w.Arena.CompetitionId)}/print/entries")).ReadAsync<PrintableEntriesDto>();

        var team = entries.Sections.Single().Teams.Single(t => t.TeamId == w.Arena.TeamIds[0]);
        // Staff see the full name even for a rider who asked for an initial in public; the same pony name twice is not flagged.
        Assert.Equal(new[] { "Oliver Smith", "Ava Jones" }, team.Riders.Select(r => r.Name));
        Assert.Equal(new[] { "Biscuit", "Biscuit" }, team.Riders.Select(r => r.Pony));
        Assert.True(team.Riders[0].IsCaptain);
        Assert.True(team.Riders[1].IsReserve);
        Assert.Empty(entries.Sections.Single().Teams.Single(t => t.TeamId == w.Arena.TeamIds[1]).Riders);
        Assert.True(entries.Sections.Single().Teams.Single(t => t.TeamId == w.Arena.TeamIds[3]).IsHorsConcours);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.AdminAsync()).GetAsync($"{Base(999999)}/print/entries")).StatusCode);
    }

    // ---- public results summary & organiser archive ----

    [Fact]
    public async Task PublicResultsSummary_FormatsPodiumsAwardsAndProtectsInitialOnlyMinors()
    {
        var w = await WorldAsync();
        var id = w.Arena.CompetitionId;
        await _f.WithDbAsync(async db =>
        {
            var form = new DeclarationForm { TeamId = w.Arena.TeamIds[0], SubmittedAt = DateTime.UtcNow, TrainerName = "Coach Sarah", IsLocked = true, TermsAcceptedAt = DateTime.UtcNow };
            db.DeclarationForms.Add(form);
            await db.SaveChangesAsync();
            db.RiderEntries.AddRange(
                new RiderEntry { DeclarationFormId = form.Id, FullName = "Oliver Smith", HorseName = "Biscuit", IsCaptain = true, UseInitialOnly = true, OrderIndex = 0 },
                new RiderEntry { DeclarationFormId = form.Id, FullName = "Ava Jones", HorseName = "Comet", IsReserve = false, UseInitialOnly = false, OrderIndex = 1 });
            db.SpecialAwards.Add(new SpecialAward { CompetitionId = id, CompetitionSectionId = w.Arena.SectionId, Title = "Best Turned Out", Recipient = "Team 1", Note = "Gleaming", OrderIndex = 0 });
            db.SpecialAwards.Add(new SpecialAward { CompetitionId = id, CompetitionSectionId = null, Title = "Spirit of the Games", Recipient = "All Riders", Note = null, OrderIndex = 1 });
            await db.SaveChangesAsync();
        });

        var res = await _f.CreateClient().GetAsync($"{Base(id)}/results-summary");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var summary = await res.ReadAsync<PublicResultsSummaryDto>();
        Assert.Contains("🥇 1st:", summary.SummaryText);
        Assert.Contains("Oliver S. (Biscuit)", summary.SummaryText);
        Assert.DoesNotContain("Oliver Smith", summary.SummaryText);
        Assert.Contains("Ava Jones (Comet)", summary.SummaryText);
        Assert.Contains("🎖️ Best Turned Out: Team 1 (Gleaming)", summary.SummaryText);
        Assert.Contains("🎖️ Spirit of the Games: All Riders", summary.SummaryText);
        Assert.DoesNotContain("Lost a shoe", summary.SummaryText);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"{Base(999999)}/results-summary")).StatusCode);
    }

    [Fact]
    public async Task Archive_RequiresCompetitionStaff_AndIncludesAllSixSelfContainedFilesAndZipFormat()
    {
        var w = await WorldAsync();
        var id = w.Arena.CompetitionId;
        await _f.WithDbAsync(async db =>
        {
            var form = new DeclarationForm { TeamId = w.Arena.TeamIds[0], SubmittedAt = DateTime.UtcNow, TrainerName = "Coach Sarah", IsLocked = true, TermsAcceptedAt = DateTime.UtcNow };
            db.DeclarationForms.Add(form);
            await db.SaveChangesAsync();
            db.RiderEntries.Add(new RiderEntry { DeclarationFormId = form.Id, FullName = "Oliver Smith", HorseName = "Biscuit", PonyHeightHands = 13.2m, IsCaptain = true, UseInitialOnly = true, OrderIndex = 0 });
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync($"/api/competitions/{id}/archive")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.TrainerAsync()).GetAsync($"/api/competitions/{id}/archive")).StatusCode);

        var archiveRes = await w.Owner.GetAsync($"/api/competitions/{id}/archive");
        Assert.Equal(HttpStatusCode.OK, archiveRes.StatusCode);
        var archive = await archiveRes.ReadAsync<EventArchiveDto>();
        Assert.Equal(id, archive.CompetitionId);
        Assert.EndsWith("-archive.zip", archive.FileName);
        Assert.Contains("results-book.csv", archive.Files.Keys);
        Assert.Contains("standings.csv", archive.Files.Keys);
        Assert.Contains("timetable.csv", archive.Files.Keys);
        Assert.Contains("declarations.csv", archive.Files.Keys);
        Assert.Contains("entries-summary.csv", archive.Files.Keys);
        Assert.Contains("competition-snapshot.json", archive.Files.Keys);
        Assert.Contains("Oliver S.", archive.Files["declarations.csv"]);
        Assert.DoesNotContain("Oliver Smith", archive.Files["declarations.csv"]);

        var zipRes = await w.Owner.GetAsync($"{Base(id)}/archive?format=zip");
        Assert.Equal(HttpStatusCode.OK, zipRes.StatusCode);
        Assert.Equal("application/zip", zipRes.Content.Headers.ContentType?.MediaType);
        var zipBytes = await zipRes.Content.ReadAsByteArrayAsync();
        Assert.True(zipBytes.Length > 100);
        Assert.Equal((byte)'P', zipBytes[0]);
        Assert.Equal((byte)'K', zipBytes[1]);
    }

    [Fact]
    public async Task PublicSummaryAndArchive_IgnoreUnlockedDrafts_AndHonourTheSavedRidersInitialOnlyFlag()
    {
        var w = await WorldAsync();
        var id = w.Arena.CompetitionId;
        await _f.WithDbAsync(async db =>
        {
            var club = await db.Clubs.FirstAsync();
            var saved = new SavedRider { ClubId = club.Id, FullName = "Mabel Quigley", UseInitialOnly = true };
            db.SavedRiders.Add(saved);
            await db.SaveChangesAsync();
            // Team 1: a locked form whose rider has no flag of its own but whose roster entry asks for an initial.
            var locked = new DeclarationForm { TeamId = w.Arena.TeamIds[0], SubmittedAt = DateTime.UtcNow.AddHours(-1), IsLocked = true, TermsAcceptedAt = DateTime.UtcNow };
            // Another team has only an unsubmitted draft, which must never reach the public summary.
            var draft = new DeclarationForm { TeamId = w.Arena.TeamIds[1], SubmittedAt = DateTime.UtcNow, IsLocked = false };
            db.DeclarationForms.AddRange(locked, draft);
            await db.SaveChangesAsync();
            db.RiderEntries.AddRange(
                new RiderEntry { DeclarationFormId = locked.Id, SavedRiderId = saved.Id, FullName = "Mabel Quigley", HorseName = "Lockedpony", OrderIndex = 0 },
                new RiderEntry { DeclarationFormId = draft.Id, FullName = "Draftie Person", HorseName = "Draftpony", OrderIndex = 0 });
            await db.SaveChangesAsync();
        });

        var summary = (await (await _f.CreateClient().GetAsync($"{Base(id)}/results-summary")).ReadAsync<PublicResultsSummaryDto>()).SummaryText;
        Assert.Contains("Mabel Q. (Lockedpony)", summary);
        Assert.DoesNotContain("Mabel Quigley", summary);
        Assert.DoesNotContain("Draftie", summary);

        var archive = await (await w.Owner.GetAsync($"/api/competitions/{id}/archive")).ReadAsync<EventArchiveDto>();
        Assert.DoesNotContain("Mabel Quigley", archive.Files["declarations.csv"]);
        Assert.DoesNotContain("Mabel Quigley", archive.Files["competition-snapshot.json"]);
        Assert.Contains("Mabel Q.", archive.Files["declarations.csv"]);
    }
}
