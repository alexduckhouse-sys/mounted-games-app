using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class ReadinessAndRulebooksTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ReadinessAndRulebooksTests(ApiFactory f) => _f = f;

    [Theory]
    [InlineData("http://example.invalid/rules")]
    [InlineData("https://fake:fake@example.invalid/rules")]
    [InlineData("javascript:alert(1)")]
    public async Task RulebooksRejectUnsafeLinks(string url)
    {
        var admin = await _f.AdminAsync();
        var response = await admin.PostAsJsonAsync("/api/rulebooks", new { title = "Fake rules", edition = "Test", text = "Fake rules text", sourceUrl = url });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Readiness_ReportsAllBlockingCategories_WithoutPrivateContacts()
    {
        var data = await CreateReadinessDataAsync();
        var admin = await _f.AdminAsync();

        var response = await admin.GetAsync(ReadinessUrl(data.Arena.CompetitionId));
        var report = await response.ReadAsync<CompetitionReadinessDto>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(report.IsReady);
        Assert.Single(report.MissingDeclarations);
        Assert.Single(report.UnpaidSignups);
        Assert.Single(report.IncompleteTeams);
        Assert.Single(report.SessionOverlaps);
        Assert.Single(report.EquipmentChecklist);
        Assert.False(report.EquipmentChecklist[0].Acknowledged);
        var json = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("private@example.invalid", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("FullName", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task EquipmentAcknowledgement_AndResolvedChecks_MakeCompetitionReady()
    {
        var data = await CreateReadinessDataAsync();
        await _f.WithDbAsync(async db =>
        {
            var section = await db.CompetitionSections.FindAsync(data.Arena.SectionId);
            section!.Format = SectionFormat.Individual;
            var form = new DeclarationForm { TeamId = data.Arena.TeamIds[0] };
            form.Riders.Add(new RiderEntry { FullName = "Test Rider", OrderIndex = 1 });
            db.DeclarationForms.Add(form);
            var signup = await db.SectionSignups.SingleAsync(s => s.Id == data.SignupId);
            signup.Status = SignupPaymentStatus.Paid;
            var second = await db.Sessions.FindAsync(data.SecondSessionId);
            second!.ArenaName = "Arena 2";
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        var before = await (await admin.GetAsync(ReadinessUrl(data.Arena.CompetitionId))).ReadAsync<CompetitionReadinessDto>();

        var after = await (await admin.PutAsJsonAsync(
            $"/api/competitions/{data.Arena.CompetitionId}/operations/equipment-acknowledgements",
            new UpdateEquipmentAcknowledgementsRequest(
                before.EquipmentChecklist.Select(x => x.Key).ToList(), before.EquipmentFingerprint)))
            .ReadAsync<CompetitionReadinessDto>();

        Assert.True(after.IsReady);
        Assert.All(after.EquipmentChecklist, item => Assert.True(item.Acknowledged));
    }

    [Fact]
    public async Task EquipmentAcknowledgement_RejectsStaleFullSet_WithoutLosingNewerSave()
    {
        var data = await CreateReadinessDataAsync();
        var admin = await _f.AdminAsync();
        var firstRead = await (await admin.GetAsync(ReadinessUrl(data.Arena.CompetitionId)))
            .ReadAsync<CompetitionReadinessDto>();
        var url = $"/api/competitions/{data.Arena.CompetitionId}/operations/equipment-acknowledgements";
        var keys = firstRead.EquipmentChecklist.Select(item => item.Key).ToList();

        var firstSave = await admin.PutAsJsonAsync(url,
            new UpdateEquipmentAcknowledgementsRequest(keys, firstRead.EquipmentFingerprint));
        var staleSave = await admin.PutAsJsonAsync(url,
            new UpdateEquipmentAcknowledgementsRequest([], firstRead.EquipmentFingerprint));

        Assert.Equal(HttpStatusCode.OK, firstSave.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, staleSave.StatusCode);
        var current = await (await admin.GetAsync(ReadinessUrl(data.Arena.CompetitionId)))
            .ReadAsync<CompetitionReadinessDto>();
        Assert.All(current.EquipmentChecklist, item => Assert.True(item.Acknowledged));
    }

    [Fact]
    public async Task Readiness_TreatsOverlappingUnnamedArenasAsSameDefaultArena()
    {
        var arena = await _f.CreateArenaAsync();
        await _f.WithDbAsync(async db =>
        {
            var first = await db.Sessions.FindAsync(arena.SessionId);
            first!.ArenaName = null;
            first.Location = null;
            first.ScheduledStart = new DateTime(2030, 7, 1, 9, 0, 0, DateTimeKind.Utc);
            first.DurationMinutes = 60;
            db.Sessions.Add(new Session
            {
                CompetitionId = arena.CompetitionId,
                CompetitionSectionId = arena.SectionId,
                Name = "Second session",
                OrderIndex = 2,
                Kind = SessionKind.Race,
                ScheduledStart = first.ScheduledStart.Value.AddMinutes(30),
                DurationMinutes = 30,
            });
            await db.SaveChangesAsync();
        });

        var report = await (await (await _f.AdminAsync()).GetAsync(ReadinessUrl(arena.CompetitionId)))
            .ReadAsync<CompetitionReadinessDto>();

        Assert.Equal("Arena not set", Assert.Single(report.SessionOverlaps).Arena);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Readiness_BlocksRaceWithMissingOrMalformedEquipmentDiagram(bool addMalformedTemplate)
    {
        var arena = await _f.CreateArenaAsync(1);
        var (_, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var raceName = $"Unresolved equipment {Guid.NewGuid():N}";
        await _f.WithDbAsync(async db =>
        {
            (await db.Races.FindAsync(races[0]))!.Name = raceName;
            if (addMalformedTemplate)
                db.RaceTemplates.Add(new RaceTemplate { Name = raceName, DiagramJson = "{not-json" });
            await db.SaveChangesAsync();
        });

        var report = await (await (await _f.AdminAsync()).GetAsync(ReadinessUrl(arena.CompetitionId)))
            .ReadAsync<CompetitionReadinessDto>();

        Assert.False(report.IsReady);
        var issue = Assert.Single(report.EquipmentIssues);
        Assert.Equal(raceName, issue.RaceName);
        Assert.Contains(addMalformedTemplate ? "valid equipment diagram" : "matching race template", issue.Message);
    }

    [Fact]
    public async Task Readiness_IsRestrictedToCompetitionOwnerOrAdmin()
    {
        var arena = await _f.CreateArenaAsync(1);
        var ownerId = await _f.TrainerIdAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = ownerId;
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _f.CreateClient().GetAsync(ReadinessUrl(arena.CompetitionId))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await (await _f.TrainerAsync()).GetAsync(ReadinessUrl(arena.CompetitionId))).StatusCode);
        var (pendingTrainer, _) = await _f.SignupAsync("Trainer");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await pendingTrainer.GetAsync(ReadinessUrl(arena.CompetitionId))).StatusCode);
        var (other, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.GetAsync(ReadinessUrl(arena.CompetitionId))).StatusCode);
    }

    [Fact]
    public async Task Rulebook_IsPubliclyReadable_ButOnlyAdminsCanEdit()
    {
        var admin = await _f.AdminAsync();
        var title = $"Event handbook {Guid.NewGuid():N}";
        var createdResponse = await admin.PostAsJsonAsync(RulebooksUrl,
            new UpsertRulebookRequest(title, "Autumn 2030", "https://example.invalid/rules", "Plain text rules."));
        var created = await createdResponse.ReadAsync<RulebookDto>();

        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        var publicResponse = await _f.CreateClient().GetAsync($"{RulebooksUrl}/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, publicResponse.StatusCode);
        Assert.Equal("Plain text rules.", (await publicResponse.ReadAsync<RulebookDto>()).Text);

        // The list leaves the text out; it is fetched one rulebook at a time.
        var list = await (await _f.CreateClient().GetAsync(RulebooksUrl)).ReadAsync<List<RulebookSummaryDto>>();
        Assert.Contains(list, r => r.Id == created.Id && r.Title == title);
        Assert.DoesNotContain("Plain text rules.", await (await _f.CreateClient().GetAsync(RulebooksUrl)).Content.ReadAsStringAsync());

        var update = new UpsertRulebookRequest("Changed", "1", null, "No");
        var (pendingTrainer, _) = await _f.SignupAsync("Trainer");
        Assert.Equal(HttpStatusCode.Forbidden, (await pendingTrainer.PutAsJsonAsync($"{RulebooksUrl}/{created.Id}", update)).StatusCode);
        var owner = await _f.TrainerAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PutAsJsonAsync($"{RulebooksUrl}/{created.Id}", update)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsJsonAsync(RulebooksUrl, update)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.DeleteAsync($"{RulebooksUrl}/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(RulebooksUrl, update)).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await admin.PutAsJsonAsync($"{RulebooksUrl}/{created.Id}", new UpsertRulebookRequest(title, "Winter 2030", null, "Updated text."))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync(RulebooksUrl, new UpsertRulebookRequest(title, "Winter 2030", null, "Again"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"{RulebooksUrl}/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"{RulebooksUrl}/{created.Id}")).StatusCode);
    }

    [Theory]
    [InlineData("", "1", null, "Text")]
    [InlineData("Rules", "", null, "Text")]
    [InlineData("Rules", "1", "file:///tmp/rules", "Text")]
    [InlineData("Rules", "1", null, "")]
    public async Task Rulebook_RejectsInvalidFields(string title, string edition, string? source, string text)
    {
        var response = await (await _f.AdminAsync()).PostAsJsonAsync(RulebooksUrl,
            new UpsertRulebookRequest(title, edition, source, text));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rulebook_RejectsSourceUrlOverStorageLimit()
    {
        var source = $"https://example.invalid/{new string('a', 2000)}";

        var response = await (await _f.AdminAsync()).PostAsJsonAsync(RulebooksUrl,
            new UpsertRulebookRequest("Rules", "1", source, "Text"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Readiness_WarnsWhenSameRiderIsInTwoArenasAtOnce_MatchingNamesLoosely()
    {
        var c = await CreateRiderClashAsync("Jane  Smith", " jane smith ", "Arena 1", "Arena 2", 30);

        var overlap = Assert.Single(await GetOverlapsAsync(c.CompetitionId));

        Assert.Equal(c.FirstSessionId, overlap.FirstSessionId);
        Assert.Equal(c.SecondSessionId, overlap.SecondSessionId);
        Assert.Equal("Jane Smith: Clash A (Under 12 Teams)", overlap.FirstSessionName);
        Assert.Equal("Clash B (Under 12 Teams)", overlap.SecondSessionName);
        Assert.Equal("Arena 1 and Arena 2", overlap.Arena);
        Assert.Equal(c.Start.AddMinutes(30), overlap.StartsAt);
        Assert.Equal(c.Start.AddMinutes(60), overlap.EndsAt);
        Assert.False((await GetReadinessAsync(c.CompetitionId)).IsReady);
    }

    [Theory]
    [InlineData("Arena 1", "arena 1", 30)]
    [InlineData("Arena 1", "Arena 2", 60)]
    [InlineData("Arena 1", "Arena 2", 90)]
    [InlineData("Arena 1", null, 30)]
    public async Task Readiness_DoesNotWarnForSameArenaNonOverlappingOrUnsetArenaRiders(
        string arenaA, string? arenaB, int offsetMinutes)
    {
        var c = await CreateRiderClashAsync("Jane Smith", "Jane Smith", arenaA, arenaB, offsetMinutes);

        var overlaps = await GetOverlapsAsync(c.CompetitionId);

        // The same arena is still reported as an ordinary session overlap, but never as a rider clash.
        Assert.DoesNotContain(overlaps, o => o.FirstSessionName.StartsWith("Jane Smith:"));
    }

    [Fact]
    public async Task Readiness_IgnoresSharedPonyNames()
    {
        var c = await CreateRiderClashAsync("Jane Smith", "Bob Jones", "Arena 1", "Arena 2", 30,
            ponyA: "Biscuit", ponyB: "Biscuit");

        Assert.Empty(await GetOverlapsAsync(c.CompetitionId));
    }

    [Fact]
    public async Task Readiness_RiderClashUsesHeatTimes_NotTheWholeSession()
    {
        var c = await CreateRiderClashAsync("Jane Smith", "Jane Smith", "Arena 1", "Arena 2", 30);
        await _f.WithDbAsync(async db =>
        {
            // The sessions overlap, but Jane's heats are 10 minutes each and an hour apart.
            foreach (var id in new[] { c.FirstSessionId, c.SecondSessionId })
                (await db.Sessions.FindAsync(id))!.MinutesPerHeat = 10;
            var secondHeat = await db.Heats.SingleAsync(h => h.SessionId == c.SecondSessionId);
            secondHeat.ScheduledStart = c.Start.AddMinutes(60);
            await db.SaveChangesAsync();
        });

        var overlaps = await GetOverlapsAsync(c.CompetitionId);

        Assert.DoesNotContain(overlaps, o => o.FirstSessionName.StartsWith("Jane Smith:"));
    }

    private async Task<List<SessionOverlapDto>> GetOverlapsAsync(int competitionId) =>
        (await GetReadinessAsync(competitionId)).SessionOverlaps.ToList();

    private async Task<CompetitionReadinessDto> GetReadinessAsync(int competitionId) =>
        await (await (await _f.AdminAsync()).GetAsync(ReadinessUrl(competitionId)))
            .ReadAsync<CompetitionReadinessDto>();

    /// <summary>
    /// Two teams in one competition, each declaring one rider, racing in two 60-minute sessions;
    /// the second starts <paramref name="offsetMinutes"/> after the first.
    /// </summary>
    private async Task<RiderClash> CreateRiderClashAsync(
        string riderA, string riderB, string? arenaA, string? arenaB, int offsetMinutes,
        string? ponyA = null, string? ponyB = null)
    {
        var arena = await _f.CreateArenaAsync(2);
        var start = new DateTime(2030, 8, 1, 9, 0, 0, DateTimeKind.Utc);
        await _f.AddHeatAsync(arena.SessionId, [arena.TeamIds[0]]);
        return await _f.WithDbAsync(async db =>
        {
            var first = await db.Sessions.FindAsync(arena.SessionId);
            first!.Name = "Clash A";
            first.ArenaName = arenaA;
            first.ScheduledStart = start;
            first.DurationMinutes = 60;
            var second = new Session
            {
                CompetitionId = arena.CompetitionId, CompetitionSectionId = arena.SectionId,
                Name = "Clash B", ArenaName = arenaB, OrderIndex = 2, Kind = SessionKind.Race,
                ScheduledStart = start.AddMinutes(offsetMinutes), DurationMinutes = 60,
            };
            db.Sessions.Add(second);
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = second.Id, Label = "Heat 1", OrderIndex = 1 };
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
            db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = arena.TeamIds[1], LaneIndex = 1 });
            foreach (var (teamId, name, pony) in new[]
                     { (arena.TeamIds[0], riderA, ponyA), (arena.TeamIds[1], riderB, ponyB) })
            {
                var form = new DeclarationForm { TeamId = teamId };
                form.Riders.Add(new RiderEntry { FullName = name, HorseName = pony, OrderIndex = 1 });
                db.DeclarationForms.Add(form);
            }
            await db.SaveChangesAsync();
            return new RiderClash(arena.CompetitionId, first.Id, second.Id, start);
        });
    }

    private sealed record RiderClash(int CompetitionId, int FirstSessionId, int SecondSessionId, DateTime Start);

    [Fact]
    public async Task Readiness_CountsFlaggedRidersPerTeam_FromTheLatestFormOnly_WithoutNamingThem()
    {
        var arena = await _f.CreateArenaAsync(2);
        await _f.WithDbAsync(async db =>
        {
            var oldForm = new DeclarationForm { TeamId = arena.TeamIds[0], SubmittedAt = DateTime.UtcNow.AddDays(-2) };
            oldForm.Riders.Add(new RiderEntry { FullName = "Old Flagged", OrderIndex = 1, FlagsJson = "[\"Pony too small\"]" });
            var newForm = new DeclarationForm { TeamId = arena.TeamIds[0], SubmittedAt = DateTime.UtcNow };
            newForm.Riders.Add(new RiderEntry { FullName = "Secret Rider One", OrderIndex = 1, FlagsJson = "[\"Over weight limit\"]" });
            newForm.Riders.Add(new RiderEntry { FullName = "Secret Rider Two", OrderIndex = 2, FlagsJson = "[\"Pony too small\"]" });
            newForm.Riders.Add(new RiderEntry { FullName = "Fine Rider", OrderIndex = 3, FlagsJson = "[]" });
            var clean = new DeclarationForm { TeamId = arena.TeamIds[1] };
            clean.Riders.Add(new RiderEntry { FullName = "Clean Rider", OrderIndex = 1 });
            db.DeclarationForms.AddRange(oldForm, newForm, clean);
            await db.SaveChangesAsync();
        });

        var response = await (await _f.AdminAsync()).GetAsync(ReadinessUrl(arena.CompetitionId));
        var report = await response.ReadAsync<CompetitionReadinessDto>();

        var flagged = Assert.Single(report.FlaggedDecForms);
        Assert.Equal((arena.TeamIds[0], 2), (flagged.TeamId, flagged.FlaggedRiders));
        var json = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Secret Rider", json);
        Assert.DoesNotContain("Over weight limit", json);
    }

    [Fact]
    public async Task Readiness_ListsRaceSessionsAndAgeGroupsWithNoRaceListChosen()
    {
        var competitionId = await _f.SeedCompetitionAsync(start: new DateTime(2038, 1, 1, 9, 0, 0, DateTimeKind.Utc));
        var chosen = await _f.SeedSectionAsync(competitionId, "Chosen");
        var viaHeats = await _f.SeedSectionAsync(competitionId, "Via heats");
        var empty = await _f.SeedSectionAsync(competitionId, "Empty");
        var none = await _f.SeedSectionAsync(competitionId, "No session");
        await _f.WithDbAsync(async db =>
        {
            db.Sessions.Add(new Session { CompetitionId = competitionId, CompetitionSectionId = chosen, Name = "Planned", OrderIndex = 1, PlannedRaces = "[\"Bending\"]" });
            var withHeat = new Session { CompetitionId = competitionId, CompetitionSectionId = viaHeats, Name = "Has races", OrderIndex = 2 };
            db.Add(withHeat);
            db.Sessions.Add(new Session { CompetitionId = competitionId, CompetitionSectionId = empty, Name = "Nothing chosen", OrderIndex = 3 });
            db.Sessions.Add(new Session { CompetitionId = competitionId, CompetitionSectionId = empty, Name = "Tea", OrderIndex = 4, Kind = SessionKind.Break });
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = withHeat.Id, Label = "Heat 1", OrderIndex = 1 };
            db.Add(heat);
            await db.SaveChangesAsync();
            db.Races.Add(new Race { HeatId = heat.Id, Name = "Mug", OrderIndex = 1 });
            await db.SaveChangesAsync();
        });

        var report = await (await (await _f.AdminAsync()).GetAsync(ReadinessUrl(competitionId))).ReadAsync<CompetitionReadinessDto>();

        Assert.Equal(2, report.RaceListsToChoose.Count);
        var unchosen = report.RaceListsToChoose.Single(x => x.SessionId is not null);
        Assert.Equal(("Nothing chosen", empty), (unchosen.SessionName, unchosen.SectionId));
        var missingSession = report.RaceListsToChoose.Single(x => x.SessionId is null);
        Assert.Equal(none, missingSession.SectionId);
    }

    private async Task<ReadinessData> CreateReadinessDataAsync()
    {
        var arena = await _f.CreateArenaAsync(1);
        var (heatId, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        return await _f.WithDbAsync(async db =>
        {
            var templateName = $"Test equipment {Guid.NewGuid():N}";
            db.RaceTemplates.Add(new RaceTemplate
            {
                Name = templateName, IsBuiltIn = false,
                DiagramJson = "[{\"t\":\"pole\",\"x\":10}]",
            });
            var race = await db.Races.FindAsync(races[0]);
            race!.Name = templateName;
            var first = await db.Sessions.FindAsync(arena.SessionId);
            first!.ArenaName = "Main arena";
            first.ScheduledStart = new DateTime(2030, 6, 1, 9, 0, 0, DateTimeKind.Utc);
            first.DurationMinutes = 60;
            var second = new Session
            {
                CompetitionId = arena.CompetitionId,
                CompetitionSectionId = arena.SectionId,
                Name = "Overlapping session", ArenaName = "main ARENA",
                ScheduledStart = first.ScheduledStart.Value.AddMinutes(30), DurationMinutes = 45,
                OrderIndex = 2, Kind = SessionKind.Race,
            };
            db.Sessions.Add(second);
            var signup = new SectionSignup
            {
                CompetitionSectionId = arena.SectionId,
                FullName = "Private Test Person", ContactInfo = "private@example.invalid",
                AmountMinor = 2500, Status = SignupPaymentStatus.Pending,
            };
            db.SectionSignups.Add(signup);
            await db.SaveChangesAsync();
            return new ReadinessData(arena, signup.Id, second.Id, heatId);
        });
    }

    private static string ReadinessUrl(int competitionId) => $"/api/competitions/{competitionId}/operations/readiness";
    private const string RulebooksUrl = "/api/rulebooks";
    private sealed record ReadinessData(Arena Arena, int SignupId, int SecondSessionId, int HeatId);
}
