using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

/// <summary>Shift-day, finals boundary/creation/scaffold/populate and the auto-timetable generator.</summary>
public class CompetitionsScheduleTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CompetitionsScheduleTests(ApiFactory f) => _f = f;

    private async Task<(int Comp, int Section, int[] Teams)> CompWithTeamsAsync(int teamCount, string? sectionName = null)
    {
        var comp = await _f.SeedCompetitionAsync(start: new DateTime(2032, 3, 10, 14, 30, 0, DateTimeKind.Utc));
        var section = await _f.SeedSectionAsync(comp, sectionName);
        var club = await _f.SeedClubAsync();
        var teams = new List<int>();
        for (var i = 0; i < teamCount; i++) teams.Add(await _f.SeedTeamAsync(comp, section, club, $"T{i}"));
        return (comp, section, teams.ToArray());
    }

    // ---- shift-day ----

    [Fact]
    public async Task ShiftDay_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsync("/api/competitions/1/shift-day", null);
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task ShiftDay_Returns404_ForTrainerWhoDoesNotRunIt()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PostAsync("/api/competitions/1/shift-day", null);
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task ShiftDay_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsync("/api/competitions/999999/shift-day", null);
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task ShiftDay_MovesOnlyUnstartedSessionsAndEndDate()
    {
        var baseTime = new DateTime(2032, 6, 1, 10, 0, 0, DateTimeKind.Utc);
        var comp = await _f.SeedCompetitionAsync(end: baseTime.AddDays(1));
        var ids = await _f.WithDbAsync(async db =>
        {
            var upcoming = new Session { CompetitionId = comp, Name = "up", OrderIndex = 1, ScheduledStart = baseTime };
            var started = new Session { CompetitionId = comp, Name = "started", OrderIndex = 2, ScheduledStart = baseTime, StartedAt = baseTime };
            var finished = new Session { CompetitionId = comp, Name = "fin", OrderIndex = 3, ScheduledStart = baseTime, Status = SessionStatus.Finished };
            var unscheduled = new Session { CompetitionId = comp, Name = "nosched", OrderIndex = 4 };
            db.Sessions.AddRange(upcoming, started, finished, unscheduled);
            await db.SaveChangesAsync();
            return (upcoming.Id, started.Id, finished.Id, unscheduled.Id);
        });
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsync($"/api/competitions/{comp}/shift-day?days=2", null);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var detail = await r.ReadAsync<CompetitionDetail>();
        Assert.Equal(baseTime.AddDays(3), detail.EndDate);
        Assert.Equal(baseTime.AddDays(2), detail.Sessions.Single(s => s.Id == ids.Item1).ScheduledStart);
        Assert.Equal(baseTime, detail.Sessions.Single(s => s.Id == ids.Item2).ScheduledStart);
        Assert.Equal(baseTime, detail.Sessions.Single(s => s.Id == ids.Item3).ScheduledStart);
        Assert.Null(detail.Sessions.Single(s => s.Id == ids.Item4).ScheduledStart);
    }

    [Fact]
    public async Task ShiftDay_DefaultsToOneDay_AndToleratesMissingEndDate()
    {
        var baseTime = new DateTime(2032, 6, 1, 10, 0, 0, DateTimeKind.Utc);
        var comp = await _f.SeedCompetitionAsync();
        await _f.WithDbAsync(async db =>
        {
            db.Sessions.Add(new Session { CompetitionId = comp, Name = "up", OrderIndex = 1, ScheduledStart = baseTime });
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();

        var detail = await (await admin.PostAsync($"/api/competitions/{comp}/shift-day", null)).ReadAsync<CompetitionDetail>();

        Assert.Null(detail.EndDate);
        Assert.Equal(baseTime.AddDays(1), Assert.Single(detail.Sessions).ScheduledStart);
    }

    // ---- finals boundary ----

    [Fact]
    public async Task FinalsBoundary_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().GetAsync("/api/competitions/1/finals/boundary?topN=2");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task FinalsBoundary_Returns404_ForTrainerWhoDoesNotRunIt()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.GetAsync("/api/competitions/1/finals/boundary?topN=2");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task FinalsBoundary_Returns400_WhenTopNBelowOne()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.GetAsync("/api/competitions/1/finals/boundary?topN=0");
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task FinalsBoundary_ReportsEveryoneQualifies_WhenTopNCoversAllTeams()
    {
        var (comp, _, _) = await CompWithTeamsAsync(2);
        var admin = await _f.AdminAsync();

        var body = await (await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=2")).ReadAsync<JsonElement>();

        Assert.False(body.GetProperty("tied").GetBoolean());
        Assert.Contains("All teams qualify", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task FinalsBoundary_ReportsTiedTeamsAtTheCutoff()
    {
        var (comp, section, t) = await CompWithTeamsAsync(4);
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[]
        {
            (t[0], 1, false, 10), (t[1], 2, false, 5), (t[2], 3, false, 5), (t[3], 4, false, 1),
        });
        var admin = await _f.AdminAsync();

        var body = await (await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=2")).ReadAsync<JsonElement>();

        Assert.True(body.GetProperty("tied").GetBoolean());
        Assert.Equal(2, body.GetProperty("cutoff").GetInt32());
        Assert.Equal(5, body.GetProperty("totalAtCutoff").GetInt32());
        Assert.Equal(2, body.GetProperty("teams").GetArrayLength());
    }

    [Fact]
    public async Task FinalsBoundary_FlagsATieOnPoints_EvenWhenOneTeamHasMoreWins()
    {
        var (comp, section, t) = await CompWithTeamsAsync(3);
        // Teams 0 and 1 are level on 5 points; team 0 has the win. That is still a tie for the organiser to settle.
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[] { (t[0], 1, false, 5), (t[1], 2, false, 5), (t[2], 3, false, 1) });
        var admin = await _f.AdminAsync();

        var body = await (await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=1&sectionId={section}")).ReadAsync<JsonElement>();

        Assert.True(body.GetProperty("tied").GetBoolean());
        Assert.Equal(1, body.GetProperty("cutoff").GetInt32());
        Assert.Equal(2, body.GetProperty("teams").GetArrayLength());
    }

    [Fact]
    public async Task FinalsBoundary_ChecksEveryFinalsTier_NotJustTheLastPlace()
    {
        var (comp, section, t) = await CompWithTeamsAsync(4);
        // 20, 10, 10, 1: the A/B cut (after 1 lane) falls between 20 and 10 (clean), the B/C cut after 2 is
        // between the two on 10 and... topN 3 is clean (10 vs 1).
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[]
        {
            (t[0], 1, false, 20), (t[1], 2, false, 10), (t[2], 3, false, 10), (t[3], 4, false, 1),
        });
        var admin = await _f.AdminAsync();

        var clean = await (await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=3&sectionId={section}&lanesPerHeat=2")).ReadAsync<JsonElement>();
        var tiedAtTier = await (await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=3&sectionId={section}&lanesPerHeat=1")).ReadAsync<JsonElement>();

        // With two lanes the cuts are after 2 (10 v 10: tied) and after 3 (10 v 1: clean).
        Assert.True(clean.GetProperty("tied").GetBoolean());
        Assert.Equal(2, clean.GetProperty("cutoff").GetInt32());
        Assert.Single(clean.GetProperty("boundaries").EnumerateArray());
        // With one lane the cuts are after 1 (clean), 2 (tied) and 3 (clean).
        Assert.Equal(2, tiedAtTier.GetProperty("cutoff").GetInt32());
    }

    [Fact]
    public async Task FinalsBoundary_ReportsNoTie_WhenCutoffIsClean()
    {
        var (comp, section, t) = await CompWithTeamsAsync(3);
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[]
        {
            (t[0], 1, false, 10), (t[1], 2, false, 5), (t[2], 3, false, 1),
        });
        var admin = await _f.AdminAsync();

        var body = await (await admin.GetAsync($"/api/competitions/{comp}/finals/boundary?topN=2&sectionId={section}")).ReadAsync<JsonElement>();

        Assert.False(body.GetProperty("tied").GetBoolean());
        Assert.False(body.TryGetProperty("message", out _));
    }

    // ---- create finals ----

    [Fact]
    public async Task CreateFinals_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/competitions/1/finals", new { topN = 2, raceNames = new[] { "R" } });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task CreateFinals_Returns404_ForTrainerWhoDoesNotRunIt()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PostAsJsonAsync("/api/competitions/1/finals", new { topN = 2, raceNames = new[] { "R" } });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task CreateFinals_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions/999999/finals", new { topN = 2, raceNames = new[] { "R" } });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task CreateFinals_Returns400_WhenOnlyBlankRaceNames()
    {
        var (comp, _, _) = await CompWithTeamsAsync(2);
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals", new { topN = 2, raceNames = new[] { " ", "" } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task CreateFinals_Returns400_WhenTopNBelowOne()
    {
        var (comp, _, _) = await CompWithTeamsAsync(2);
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals", new { topN = 0, raceNames = new[] { "R" } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task CreateFinals_Returns400_WhenNoTeamsToSeed()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals", new { topN = 2, raceNames = new[] { "R" } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task CreateFinals_SeedsTopTeams_IntoOneHeat_WithDefaultName()
    {
        var (comp, _, t) = await CompWithTeamsAsync(4);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals",
            new { topN = 3, raceNames = new[] { " Bending ", "", "Relay" } });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal("Finals · Finals", s.Name);
        var heat = Assert.Single(s.Heats);
        Assert.Equal("A Final", heat.Label);
        Assert.Equal(3, heat.Entries.Count);
        Assert.Equal(new[] { "Bending", "Relay" }, heat.Races.Select(x => x.Name));
        Assert.Equal(new[] { 1, 2, 3 }, heat.Entries.Select(e => e.LaneIndex));
        Assert.Equal(3, s.LanesPerHeat);
        Assert.All(heat.Entries, e => Assert.Contains(e.TeamId, t));
    }

    [Fact]
    public async Task CreateFinals_UsesSectionNameAndSplitsIntoBalancedHeats()
    {
        var (comp, section, _) = await CompWithTeamsAsync(5, "Seniors");
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals", new
        {
            competitionSectionId = section, topN = 5, raceNames = new[] { "R" }, lanesPerHeat = 2,
        });

        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal("Finals · Seniors", s.Name);
        Assert.Equal(section, s.CompetitionSectionId);
        Assert.Equal(new[] { "C Final", "B Final", "A Final" }, s.Heats.Select(h => h.Label));
        Assert.Equal(5, s.Heats.Sum(h => h.Entries.Count));
        Assert.All(s.Heats, h => Assert.InRange(h.Entries.Count, 1, 2));
        Assert.Equal(2, s.LanesPerHeat);

        var topFirst = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals", new
        {
            competitionSectionId = section, topN = 5, raceNames = new[] { "R" }, lanesPerHeat = 2, lowestFinalFirst = false,
        })).ReadAsync<SessionDto>();
        Assert.Equal(new[] { "A Final", "B Final", "C Final" }, topFirst.Heats.Select(h => h.Label));
    }

    [Fact]
    public async Task CreateFinals_PlacesTeamsInRankOrder_AcrossAThenBThenCFinal()
    {
        var (comp, section, t) = await CompWithTeamsAsync(5, "Ranked");
        // Seeded in a scrambled order so only the points decide the ranking: t[2] > t[4] > t[0] > t[3] > t[1].
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[]
        {
            (t[0], 3, false, 6), (t[1], 5, false, 2), (t[2], 1, false, 10), (t[3], 4, false, 4), (t[4], 2, false, 8),
        });
        var admin = await _f.AdminAsync();

        // Repeat: the old shuffle only went wrong some of the time.
        for (var run = 0; run < 5; run++)
        {
            var s = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals", new
            {
                competitionSectionId = section, topN = 5, raceNames = new[] { "R" }, lanesPerHeat = 2,
            })).ReadAsync<SessionDto>();

            Assert.Equal(new[] { "C Final", "B Final", "A Final" }, s.Heats.Select(h => h.Label));
            Assert.Equal(new[] { t[1] }, s.Heats[0].Entries.Select(e => e.TeamId));
            Assert.Equal(new[] { t[0], t[3] }, s.Heats[1].Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
            Assert.Equal(new[] { t[2], t[4] }, s.Heats[2].Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
        }
    }

    [Fact]
    public async Task CreateFinals_ATopNSmallerThanTheSection_OnlyTakesTheBest()
    {
        var (comp, section, t) = await CompWithTeamsAsync(4, "TopOnly");
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[]
        {
            (t[0], 4, false, 1), (t[1], 3, false, 3), (t[2], 1, false, 9), (t[3], 2, false, 5),
        });
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals", new
        {
            competitionSectionId = section, topN = 2, raceNames = new[] { "R" }, lanesPerHeat = 6,
        })).ReadAsync<SessionDto>();

        var a = Assert.Single(s.Heats);
        Assert.Equal(new[] { t[2], t[3] }, a.Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId));
    }

    [Fact]
    public async Task CreateFinals_UsesCustomNameAndNonPositiveLanesFallBackToAllTeams()
    {
        var (comp, _, _) = await CompWithTeamsAsync(3);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals",
            new { topN = 3, raceNames = new[] { "R" }, lanesPerHeat = 0, name = "  Grand final  " });

        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal("Grand final", s.Name);
        Assert.Equal(3, s.LanesPerHeat);
        Assert.Single(s.Heats);
    }

    [Fact]
    public async Task CreateFinals_ExcludesHorsConcoursAndRanksByPoints()
    {
        var (comp, section, t) = await CompWithTeamsAsync(3);
        var club = await _f.SeedClubAsync();
        var hc = await _f.SeedTeamAsync(comp, section, club, "HC", horsConcours: true);
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[]
        {
            (t[0], 3, false, 1), (t[1], 1, false, 9), (t[2], 2, false, 5), (hc, 4, false, 50),
        });
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals", new { topN = 2, raceNames = new[] { "R" } });

        var heat = Assert.Single((await r.ReadAsync<SessionDto>()).Heats);
        Assert.Equal(new[] { t[1], t[2] }.OrderBy(x => x), heat.Entries.Select(e => e.TeamId).OrderBy(x => x));
    }

    [Fact]
    public async Task CreateFinals_AppendsAfterExistingSessions()
    {
        var (comp, section, t) = await CompWithTeamsAsync(2);
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[] { (t[0], 1, false, 1) }); // OrderIndex 1
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals", new { topN = 2, raceNames = new[] { "R" } });

        Assert.Equal(2, (await r.ReadAsync<SessionDto>()).OrderIndex);
    }

    [Fact]
    public async Task CreateFinals_Returns400_WhenSectionBelongsToAnotherCompetition()
    {
        var (comp, _, _) = await CompWithTeamsAsync(2);
        var (_, otherSection, _) = await CompWithTeamsAsync(2);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals",
            new { competitionSectionId = otherSection, topN = 2, raceNames = new[] { "R" } });

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    // ---- scaffold finals ----

    private static object Scaffold(int heats = 2, int lanes = 4, string[]? races = null, int? sectionId = null,
        string? name = null, int? minutes = null, DateTime? start = null, bool? lowestFinalFirst = null) => new
    {
        competitionSectionId = sectionId,
        raceNames = races ?? new[] { "Bending", "Relay" },
        lanesPerHeat = lanes,
        numHeats = heats,
        name,
        minutesPerHeat = minutes,
        scheduledStart = start,
        lowestFinalFirst,
    };

    [Fact]
    public async Task Scaffold_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/competitions/1/finals/scaffold", Scaffold());
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Scaffold_Returns400_WhenSectionNotInCompetition(bool otherCompetition)
    {
        var (comp, _, _) = await CompWithTeamsAsync(1);
        var section = otherCompetition ? (await CompWithTeamsAsync(1)).Section : 999999;
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals/scaffold", Scaffold(sectionId: section));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var s = await _f.WithDbAsync(db => db.Sessions.CountAsync(x => x.CompetitionId == comp));
        Assert.Equal(0, s);
    }

    [Fact]
    public async Task Scaffold_Returns404_ForTrainerWhoDoesNotRunIt()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PostAsJsonAsync("/api/competitions/1/finals/scaffold", Scaffold());
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Scaffold_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions/999999/finals/scaffold", Scaffold());
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Theory]
    [InlineData("noRaces")]
    [InlineData("noHeats")]
    [InlineData("noLanes")]
    public async Task Scaffold_Returns400_ForInvalidInput(string which)
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        var body = which switch
        {
            "noRaces" => Scaffold(races: new[] { " " }),
            "noHeats" => Scaffold(heats: 0),
            _ => Scaffold(lanes: 0),
        };

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals/scaffold", body);

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.False(string.IsNullOrEmpty((await r.ReadAsync<JsonElement>()).GetProperty("message").GetString()));
    }

    [Fact]
    public async Task Scaffold_CreatesEmptyHeatsWithRaces()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        var start = new DateTime(2032, 7, 7, 12, 0, 0, DateTimeKind.Utc);

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals/scaffold",
            Scaffold(heats: 3, lanes: 5, minutes: 12, start: start));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal("Finals · Finals", s.Name);
        Assert.Equal(5, s.LanesPerHeat);
        Assert.Equal(12, s.MinutesPerHeat);
        Assert.Equal(start, s.ScheduledStart);
        Assert.Equal(new[] { "C Final", "B Final", "A Final" }, s.Heats.Select(h => h.Label));
        Assert.All(s.Heats, h => { Assert.Empty(h.Entries); Assert.Equal(2, h.Races.Count); });

        var topFirst = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals/scaffold",
            Scaffold(heats: 3, lanes: 5, lowestFinalFirst: false))).ReadAsync<SessionDto>();
        Assert.Equal(new[] { "A Final", "B Final", "C Final" }, topFirst.Heats.Select(h => h.Label));
    }

    [Fact]
    public async Task Scaffold_UsesSectionNameOrCustomName()
    {
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp, "Juniors");
        var admin = await _f.AdminAsync();

        var named = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals/scaffold",
            Scaffold(sectionId: section))).ReadAsync<SessionDto>();
        var custom = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals/scaffold",
            Scaffold(name: " My finals "))).ReadAsync<SessionDto>();

        Assert.Equal("Finals · Juniors", named.Name);
        Assert.Equal("My finals", custom.Name);
        Assert.Equal(named.OrderIndex + 1, custom.OrderIndex);
    }

    // ---- populate finals ----

    private async Task<SessionDto> ScaffoldAsync(int comp, int heats, int lanes, int? sectionId = null)
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals/scaffold",
            Scaffold(heats: heats, lanes: lanes, sectionId: sectionId));
        return await r.ReadAsync<SessionDto>();
    }

    [Fact]
    public async Task Populate_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsync("/api/competitions/1/sessions/1/populate-finals", null);
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns404_ForTrainerWhoDoesNotRunIt()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PostAsync("/api/competitions/1/sessions/1/populate-finals", null);
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns404_WhenSessionMissingOrInOtherCompetition()
    {
        var (comp, _, _) = await CompWithTeamsAsync(2);
        var (other, _, _) = await CompWithTeamsAsync(2);
        var scaffolded = await ScaffoldAsync(other, 1, 2);
        var admin = await _f.AdminAsync();

        var missing = await admin.PostAsync($"/api/competitions/{comp}/sessions/999999/populate-finals", null);
        var wrongComp = await admin.PostAsync($"/api/competitions/{comp}/sessions/{scaffolded.Id}/populate-finals", null);

        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, wrongComp.StatusCode);
    }

    [Fact]
    public async Task Populate_Returns400_WhenSessionHasNoHeats()
    {
        var (comp, section, _) = await CompWithTeamsAsync(2);
        var session = await _f.WithDbAsync(async db =>
        {
            var s = new Session { CompetitionId = comp, CompetitionSectionId = section, Name = "empty", OrderIndex = 9 };
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
            return s.Id;
        });
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsync($"/api/competitions/{comp}/sessions/{session}/populate-finals", null);

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("no heats", (await r.ReadAsync<JsonElement>()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Populate_Returns400_WhenHeatsAlreadyHaveTeams()
    {
        var (comp, _, _) = await CompWithTeamsAsync(2);
        var admin = await _f.AdminAsync();
        var finals = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/finals",
            new { topN = 2, raceNames = new[] { "R" } })).ReadAsync<SessionDto>();

        var r = await admin.PostAsync($"/api/competitions/{comp}/sessions/{finals.Id}/populate-finals", null);

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("already have teams", (await r.ReadAsync<JsonElement>()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Populate_Returns400_WhenNoTeamsExist()
    {
        var comp = await _f.SeedCompetitionAsync();
        var scaffolded = await ScaffoldAsync(comp, 1, 2);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsync($"/api/competitions/{comp}/sessions/{scaffolded.Id}/populate-finals", null);

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Contains("No teams", (await r.ReadAsync<JsonElement>()).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Populate_FillsHeatsInRankOrder_FromSectionTeamsOnly()
    {
        var (comp, section, t) = await CompWithTeamsAsync(3);
        var otherSection = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        await _f.SeedTeamAsync(comp, otherSection, club, "Elsewhere");
        await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[]
        {
            (t[0], 3, false, 1), (t[1], 1, false, 9), (t[2], 2, false, 5),
        });
        var scaffolded = await ScaffoldAsync(comp, heats: 2, lanes: 2, sectionId: section);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsync($"/api/competitions/{comp}/sessions/{scaffolded.Id}/populate-finals", null);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var s = await r.ReadAsync<SessionDto>();
        Assert.Equal(new[] { "B Final", "A Final" }, s.Heats.Select(h => h.Label));
        Assert.Equal(new[] { t[0] }, s.Heats.Single(h => h.Label == "B Final").Entries.Select(e => e.TeamId));
        Assert.Equal(new[] { t[1], t[2] }, s.Heats.Single(h => h.Label == "A Final").Entries.Select(e => e.TeamId));
    }

    [Fact]
    public async Task Populate_DefaultsToSixLanes_WhenSessionHasNoLaneSetting()
    {
        var (comp, _, t) = await CompWithTeamsAsync(7);
        var session = await _f.WithDbAsync(async db =>
        {
            var s = new Session { CompetitionId = comp, Name = "manual", OrderIndex = 5 };
            s.Heats.Add(new Heat { Label = "A Final", OrderIndex = 1 });
            s.Heats.Add(new Heat { Label = "B Final", OrderIndex = 2 });
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
            return s.Id;
        });
        var admin = await _f.AdminAsync();

        var s = await (await admin.PostAsync($"/api/competitions/{comp}/sessions/{session}/populate-finals", null))
            .ReadAsync<SessionDto>();

        Assert.Equal(6, s.Heats[0].Entries.Count);
        Assert.Equal(1, s.Heats[1].Entries.Count);
        Assert.Equal(t.Length, s.Heats.Sum(h => h.Entries.Count));
    }

    // ---- auto timetable ----

    private static object Auto(int? races = null, int? sessions = null, int? lanes = null, int? minutes = null,
        int? gap = null, bool replace = false, int[]? sectionIds = null) => new
    {
        racesPerHeat = races,
        sessionsPerSection = sessions,
        lanesPerHeat = lanes,
        minutesPerHeat = minutes,
        minutesBetweenSessions = gap,
        replaceExisting = replace,
        sectionIds,
    };

    // ---- auto-timetable order by age ----

    [Theory]
    [InlineData("Open", 0)]
    [InlineData("Seniors", 0)]
    [InlineData("Under 18", 1)]
    [InlineData("U17", 1)]
    [InlineData("Under 15", 2)]
    [InlineData("Intermediate", 2)]
    [InlineData("Under 14", 3)]
    [InlineData("u-12", 4)]
    [InlineData("Juniors", 4)]
    [InlineData("Under 10", 5)]
    [InlineData("Novices", 5)]
    [InlineData("Lead Rein", 6)]
    [InlineData("Lead-rein Under 10", 6)]
    [InlineData("Mystery", SectionAgeOrder.Unclassified)]
    [InlineData("", SectionAgeOrder.Unclassified)]
    [InlineData(null, SectionAgeOrder.Unclassified)]
    public void SectionAgeOrder_PlacesAgeGroupsOldestFirst(string? text, int rank)
        => Assert.Equal(rank, SectionAgeOrder.Rank(text));

    [Fact]
    public void SectionAgeOrder_FallsBackToTheDisplayName_WhenTheAgeGroupIsNoHelp()
    {
        var section = new CompetitionSection { AgeGroup = "Mixed", DisplayName = "Teams Under 14" };
        Assert.Equal(3, SectionAgeOrder.Rank(section));
        Assert.Equal(4, SectionAgeOrder.Rank(new CompetitionSection { AgeGroup = "Under 12", DisplayName = "Teams Open" }));
    }

    [Fact]
    public async Task AutoTimetable_SchedulesOldestAgeGroupFirst_ThenUnclassifiedByName()
    {
        var comp = await _f.SeedCompetitionAsync(start: new DateTime(2032, 3, 10, 14, 30, 0, DateTimeKind.Utc));
        var club = await _f.SeedClubAsync();
        // Created youngest-first and in a jumbled order; names chosen so the alphabetical order differs too.
        var names = new[] { "Zebra Cup", "Lead Rein", "Under 10", "Junior", "Under 14", "Under 15", "Under 17", "Open", "Alpha Cup" };
        foreach (var name in names)
        {
            var section = await _f.WithDbAsync(async db =>
            {
                var s = new CompetitionSection { CompetitionId = comp, Format = SectionFormat.Teams, AgeGroup = name, DisplayName = name };
                db.CompetitionSections.Add(s);
                await db.SaveChangesAsync();
                return s.Id;
            });
            await _f.SeedTeamAsync(comp, section, club, $"Team {name}");
        }
        var admin = await _f.AdminAsync();

        var detail = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable", Auto())).ReadAsync<CompetitionDetail>();

        var ordered = detail.Sessions.OrderBy(s => s.OrderIndex).ToList();
        Assert.Equal(
            new[] { "Open", "Under 17", "Under 15", "Under 14", "Junior", "Under 10", "Lead Rein", "Alpha Cup", "Zebra Cup" },
            ordered.Select(s => s.Name));
        Assert.Equal(ordered.Select(s => s.ScheduledStart), ordered.Select(s => s.ScheduledStart).OrderBy(x => x));
    }

    [Fact]
    public async Task AutoTimetable_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/competitions/1/auto-timetable", Auto());
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task AutoTimetable_Returns404_ForTrainerWhoDoesNotRunIt()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PostAsJsonAsync("/api/competitions/1/auto-timetable", Auto());
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task AutoTimetable_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions/999999/auto-timetable", Auto());
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task AutoTimetable_Returns400_WhenCompetitionHasNoSections()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable", Auto());
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task AutoTimetable_Returns400_WhenSectionFilterMatchesNothing()
    {
        var (comp, _, _) = await CompWithTeamsAsync(2);
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable", Auto(sectionIds: new[] { 999999 }));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task AutoTimetable_AppliesDefaults_AndStartsAtNineOnCompetitionDay()
    {
        var (comp, _, t) = await CompWithTeamsAsync(7, "Only section");
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable", Auto());

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var d = await r.ReadAsync<CompetitionDetail>();
        var s = Assert.Single(d.Sessions);
        Assert.Equal("Only section", s.Name);
        Assert.Equal(new DateTime(2032, 3, 10, 9, 0, 0, DateTimeKind.Utc), s.ScheduledStart);
        Assert.Equal(6, s.LanesPerHeat);
        Assert.Equal(15, s.MinutesPerHeat);
        Assert.Equal(SessionKind.Race, s.Kind);
        Assert.Equal(2, s.Heats.Count);                       // 7 teams, max 6 per heat
        Assert.Equal(t.Length, s.Heats.Sum(h => h.Entries.Count));
        Assert.All(s.Heats, h => { Assert.Equal(5, h.Races.Count); Assert.Equal(75, h.DurationMinutes); });
        Assert.Equal(new[] { "Heat 1", "Heat 2" }, s.Heats.Select(h => h.Label));
    }

    [Fact]
    public async Task AutoTimetable_CreatesMultipleSessionsPerSection_SpacedByGap()
    {
        var (comp, _, _) = await CompWithTeamsAsync(4, "Multi");
        var admin = await _f.AdminAsync();

        var d = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable",
            Auto(races: 2, sessions: 2, lanes: 2, minutes: 10, gap: 5))).ReadAsync<CompetitionDetail>();

        Assert.Equal(new[] { "Multi · Session 1", "Multi · Session 2" }, d.Sessions.Select(s => s.Name));
        // 4 teams / 2 lanes = 2 heats * 2 races * 10 min = 40 min + 5 min gap
        Assert.Equal(d.Sessions[0].ScheduledStart!.Value.AddMinutes(45), d.Sessions[1].ScheduledStart);
        Assert.Equal(d.Sessions[0].OrderIndex + 1, d.Sessions[1].OrderIndex);
    }

    [Fact]
    public async Task AutoTimetable_SkipsSectionsWithoutTeams_AndHonoursSectionFilter()
    {
        var (comp, withTeams, _) = await CompWithTeamsAsync(2, "Has teams");
        await _f.SeedSectionAsync(comp, "No teams");
        var admin = await _f.AdminAsync();

        var d = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable",
            Auto(sectionIds: new[] { withTeams }))).ReadAsync<CompetitionDetail>();
        var all = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable", Auto(replace: true)))
            .ReadAsync<CompetitionDetail>();

        Assert.Equal("Has teams", Assert.Single(d.Sessions).Name);
        Assert.Equal("Has teams", Assert.Single(all.Sessions).Name); // "No teams" section produces nothing
    }

    [Fact]
    public async Task AutoTimetable_ReplaceExisting_RemovesRaceSessionsButKeepsBreaks()
    {
        var (comp, section, _) = await CompWithTeamsAsync(2, "Replace me");
        var admin = await _f.AdminAsync();
        await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable", Auto());
        await _f.WithDbAsync(async db =>
        {
            db.Sessions.Add(new Session { CompetitionId = comp, Name = "Lunch", Kind = SessionKind.Break, IsBreak = true, OrderIndex = 99 });
            await db.SaveChangesAsync();
        });

        var d = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable", Auto(replace: true)))
            .ReadAsync<CompetitionDetail>();

        Assert.Equal(2, d.Sessions.Count);
        Assert.Single(d.Sessions, s => s.Kind == SessionKind.Break && s.Name == "Lunch");
        Assert.Single(d.Sessions, s => s.Kind == SessionKind.Race && s.CompetitionSectionId == section);
    }

    [Fact]
    public async Task AutoTimetable_WithoutReplace_AppendsToExistingSessions()
    {
        var (comp, _, _) = await CompWithTeamsAsync(2, "Append");
        var admin = await _f.AdminAsync();

        await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable", Auto());
        var d = await (await admin.PostAsJsonAsync($"/api/competitions/{comp}/auto-timetable", Auto()))
            .ReadAsync<CompetitionDetail>();

        Assert.Equal(2, d.Sessions.Count);
        Assert.Equal(new[] { 1, 2 }, d.Sessions.Select(s => s.OrderIndex));
    }
}
