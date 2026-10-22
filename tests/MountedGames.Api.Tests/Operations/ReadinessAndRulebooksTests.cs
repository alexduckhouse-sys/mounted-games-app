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
    public async Task Rulebook_IsPubliclyReadable_ButOnlyOwnerOrAdminCanEdit()
    {
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        var owner = await _f.TrainerAsync();
        var createdResponse = await owner.PostAsJsonAsync(RulebooksUrl(competitionId),
            new UpsertRulebookRequest("Event handbook", "Autumn 2030", "https://example.invalid/rules", "Plain text rules."));
        var created = await createdResponse.ReadAsync<RulebookDto>();

        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        var publicResponse = await _f.CreateClient().GetAsync($"{RulebooksUrl(competitionId)}/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, publicResponse.StatusCode);
        Assert.Equal("Plain text rules.", (await publicResponse.ReadAsync<RulebookDto>()).Text);
        var update = new UpsertRulebookRequest("Changed", "1", null, "No");
        var (pendingTrainer, _) = await _f.SignupAsync("Trainer");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await pendingTrainer.PutAsJsonAsync($"{RulebooksUrl(competitionId)}/{created.Id}", update)).StatusCode);
        var (other, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PutAsJsonAsync($"{RulebooksUrl(competitionId)}/{created.Id}", update)).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await (await _f.AdminAsync()).PutAsJsonAsync($"{RulebooksUrl(competitionId)}/{created.Id}",
                new UpsertRulebookRequest("Event handbook", "Winter 2030", null, "Updated text."))).StatusCode);
    }

    [Theory]
    [InlineData("", "1", null, "Text")]
    [InlineData("Rules", "", null, "Text")]
    [InlineData("Rules", "1", "file:///tmp/rules", "Text")]
    [InlineData("Rules", "1", null, "")]
    public async Task Rulebook_RejectsInvalidFields(string title, string edition, string? source, string text)
    {
        var competitionId = await _f.SeedCompetitionAsync();
        var response = await (await _f.AdminAsync()).PostAsJsonAsync(RulebooksUrl(competitionId),
            new UpsertRulebookRequest(title, edition, source, text));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rulebook_RejectsSourceUrlOverStorageLimit()
    {
        var competitionId = await _f.SeedCompetitionAsync();
        var source = $"https://example.invalid/{new string('a', 2000)}";

        var response = await (await _f.AdminAsync()).PostAsJsonAsync(RulebooksUrl(competitionId),
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
    private static string RulebooksUrl(int competitionId) => $"/api/competitions/{competitionId}/rulebooks";
    private sealed record ReadinessData(Arena Arena, int SignupId, int SecondSessionId, int HeatId);
}
