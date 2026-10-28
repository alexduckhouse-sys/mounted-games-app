using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.EventTools;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.EventTools;

public class CompetitionFileImportTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CompetitionFileImportTests(ApiFactory f) => _f = f;

    private static readonly string[] HeatRaces = { "Bending", "Stepping Stones", "Old Sock" };
    private static readonly string[] FinalRaces = { "Bending", "2 Flag" };

    private static CompetitionImportSection Juniors(params CompetitionImportHeat[] heats) => new(
        "Under 15", HeatRaces, heats.Length > 0 ? heats :
        [
            new("08:30", [["Amy Ash", "Ben Birch"], ["Cara Cedar", "Dan Dove"], ["Eve Elm", "Finn Fir"], null]),
            new("08:50", [["Gail Gorse", "Hal Hazel"], ["Ida Ivy"], null, ["Jay Juniper", "Kit Kale"]]),
        ],
        FinalRaces: FinalRaces, Finals: new("10:10"));

    /// <summary>Made-up riders: the real event file lives outside the repo.</summary>
    private static CompetitionImportFile Sample(string? name = null, string date = "2030-06-01") => new(
        name ?? $"Import {Guid.NewGuid():N}", date,
        [
            Juniors(),
            new("Novice", ["Bending", "Sweetie Race"],
                [new("13:00", [["Lea Lime", "Max Maple"], ["Nia Nettle", "Oli Oak"]])],
                CarryPointsIntoFinal: true, MinutesPerHeat: 15, Finals: new("09:30", MinutesPerFinal: 20)),
        ],
        LaneHatbands: ["Red", "Purple #6A3D9A", "White", "Black"],
        Location: "Showground", Description: "  Pairs day.  ", EndTime: "16:00", Icon: "gb-eng");

    private static async Task<AppDbContext> Database()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=:memory:").Options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        return db;
    }

    [Fact]
    public async Task Import_BuildsSectionsTimetableLanesRacesAndRiders()
    {
        await using var db = await Database();
        var owner = new AppUser { UserName = "owner@example.test", Email = "owner@example.test", NormalizedEmail = "OWNER@EXAMPLE.TEST" };
        db.Users.Add(owner);
        var trainerRole = new IdentityRole(Roles.Trainer) { NormalizedName = Roles.Trainer.ToUpperInvariant() };
        db.Roles.Add(trainerRole);
        db.UserRoles.Add(new IdentityUserRole<string> { UserId = owner.Id, RoleId = trainerRole.Id });
        db.Clubs.Add(new Club { Name = "unaffiliated" });
        await db.SaveChangesAsync();

        var result = await CompetitionFileImport.ImportAsync(db, Sample("Pairs Day") with { OwnerEmail = " owner@example.test " });

        Assert.Equal(new CompetitionImportResult(result.CompetitionId, 2, 4, 3, 8, 15, 8, false), result);
        db.ChangeTracker.Clear();
        var comp = await db.Competitions
            .Include(c => c.Sections)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races)
            .SingleAsync(c => c.Id == result.CompetitionId);
        Assert.Equal(owner.Id, comp.CreatedByUserId);
        Assert.True(comp.SignupsLocked);
        Assert.Equal("gb-eng", comp.Icon);
        Assert.Equal("Pairs day.", comp.Description);
        Assert.Equal("[\"Red\",\"Purple #6A3D9A\",\"White\",\"Black\"]", comp.LaneHatbands);
        // 1 June is British Summer Time: 08:30 on the sheet is 07:30 UTC.
        Assert.Equal(new DateTime(2030, 6, 1, 7, 30, 0), comp.StartDate);
        Assert.Equal(new DateTime(2030, 6, 1, 15, 0, 0), comp.EndDate);

        var juniors = comp.Sections.Single(s => s.AgeGroup == "Under 15");
        Assert.Equal(("Under 15 Pairs", SectionFormat.Pairs, true, false), (juniors.DisplayName, juniors.Format, juniors.HasFinal, juniors.CarryPointsIntoFinal));
        Assert.True(comp.Sections.Single(s => s.AgeGroup == "Novice").CarryPointsIntoFinal);

        // Sessions run in start order: the Novice finals at 09:30 sit between the junior heats and their finals.
        Assert.Equal(
            ["Under 15 Pairs heats", "Finals · Novice Pairs", "Finals · Under 15 Pairs", "Novice Pairs heats"],
            comp.Sessions.OrderBy(s => s.OrderIndex).Select(s => s.Name));
        var heats = comp.Sessions.Single(s => s.Name == "Under 15 Pairs heats");
        Assert.Equal((4, 20, "[\"Bending\",\"Stepping Stones\",\"Old Sock\"]"), (heats.LanesPerHeat!.Value, heats.MinutesPerHeat!.Value, heats.PlannedRaces));
        var heat2 = heats.Heats.Single(h => h.Label == "Heat 2");
        Assert.Equal(new DateTime(2030, 6, 1, 7, 50, 0), heat2.ScheduledStart);
        // Lane 3 stays empty, as on the sheet; a pair with one rider waits for a partner.
        Assert.Equal(
            [(1, "Gail Gorse & Hal Hazel"), (2, "Ida Ivy & partner TBC"), (4, "Jay Juniper & Kit Kale")],
            heat2.Entries.OrderBy(e => e.LaneIndex).Select(e => (e.LaneIndex, e.Team!.DisplayName)));
        Assert.Equal(HeatRaces, heat2.Races.OrderBy(r => r.OrderIndex).Select(r => r.Name));
        Assert.All(heat2.Races, r => Assert.False(r.IsComplete));

        var finals = comp.Sessions.Single(s => s.Name == "Finals · Under 15 Pairs");
        Assert.Empty(finals.Heats);
        Assert.Equal((30, "[\"Bending\",\"2 Flag\"]"), (finals.MinutesPerHeat!.Value, finals.PlannedRaces));
        Assert.Equal("[\"Bending\",\"Sweetie Race\"]", comp.Sessions.Single(s => s.Name == "Finals · Novice Pairs").PlannedRaces);

        var teams = await db.Teams.Include(t => t.Club).Include(t => t.DeclarationForms).ThenInclude(d => d.Riders)
            .Where(t => t.CompetitionId == comp.Id).ToListAsync();
        Assert.All(teams, t => Assert.Equal("unaffiliated", t.Club!.Name));
        Assert.Single(await db.Clubs.Where(c => c.Name.ToLower() == "unaffiliated").ToListAsync());
        var single = teams.Single(t => t.DisplayName == "Ida Ivy & partner TBC").DeclarationForms.Single();
        Assert.False(single.IsLocked);
        Assert.Equal(["Ida Ivy"], single.Riders.Select(r => r.FullName));
        var pair = teams.Single(t => t.DisplayName == "Amy Ash & Ben Birch").DeclarationForms.Single().Riders.OrderBy(r => r.OrderIndex).ToList();
        Assert.Equal([("Amy Ash", true), ("Ben Birch", false)], pair.Select(r => (r.FullName, r.IsCaptain)));
        Assert.Empty(await db.Results.Where(r => r.Race!.Heat!.Session!.CompetitionId == comp.Id).ToListAsync());
    }

    [Fact]
    public async Task Import_SameRidersInTwoHeatsAreOneTeam_AndIndividualsWork()
    {
        await using var db = await Database();
        var file = Sample() with
        {
            LaneHatbands = null, EndTime = null, Icon = null,
            Sections =
            [
                Juniors(new("08:30", [["Amy Ash", "Ben Birch"], ["Cara Cedar", "Dan Dove"]]),
                        new("09:00", [["ben birch", "amy ash"], ["Eve Elm", "Finn Fir"]])),
                new("Senior", ["Bending"], [new("11:00", [["Sol Spruce"], ["Tia Teak"], ["Uma Ulex"]])], Format: "Individual", HasFinal: false, CarryPointsIntoFinal: true),
            ],
        };

        var result = await CompetitionFileImport.ImportAsync(db, file);

        Assert.Equal(6, result.Teams);
        Assert.Equal(9, result.Riders);
        db.ChangeTracker.Clear();
        var comp = await db.Competitions.Include(c => c.Sections).Include(c => c.Sessions).SingleAsync(c => c.Id == result.CompetitionId);
        Assert.Null(comp.LaneHatbands);
        Assert.Equal("flag", comp.Icon);
        var seniors = comp.Sections.Single(s => s.AgeGroup == "Senior");
        Assert.Equal(("Senior Individuals", false, false), (seniors.DisplayName, seniors.HasFinal, seniors.CarryPointsIntoFinal));
        Assert.Equal(["Tia Teak"], await db.Teams.Where(t => t.CompetitionSectionId == seniors.Id && t.DisplayName == "Tia Teak").Select(t => t.DisplayName).ToListAsync());
        // Without an end time, the event ends with the last session's slot: the 11:00 BST heat (10:00 UTC) and its 20 minutes.
        Assert.Equal(new DateTime(2030, 6, 1, 10, 20, 0), comp.EndDate);
        Assert.Equal(3, comp.Sessions.Count);
    }

    [Fact]
    public async Task DryRun_SavesNothing()
    {
        await using var db = await Database();
        var result = await CompetitionFileImport.ImportAsync(db, Sample(), dryRun: true);

        Assert.True(result.DryRun);
        Assert.Null(result.CompetitionId);
        Assert.Equal(8, result.Teams);
        Assert.Empty(await db.Competitions.ToListAsync());
        Assert.Empty(await db.Clubs.ToListAsync());
    }

    [Fact]
    public async Task Import_RefusesAnEventThatExists_AndAnUnknownOwner()
    {
        await using var db = await Database();
        await CompetitionFileImport.ImportAsync(db, Sample("Twice"));

        var again = await Assert.ThrowsAsync<CompetitionImportException>(() => CompetitionFileImport.ImportAsync(db, Sample("Twice")));
        Assert.Contains("already exists", again.Message);
        // A different day is a different event.
        await CompetitionFileImport.ImportAsync(db, Sample("Twice", "2030-06-08"));

        var owner = await Assert.ThrowsAsync<CompetitionImportException>(() =>
            CompetitionFileImport.ImportAsync(db, Sample() with { OwnerEmail = "nobody@example.test" }));
        Assert.Contains("No account uses nobody@example.test", owner.Message);
        db.Users.Add(new AppUser { UserName = "member@example.test", Email = "member@example.test", NormalizedEmail = "MEMBER@EXAMPLE.TEST" });
        await db.SaveChangesAsync();
        var member = await Assert.ThrowsAsync<CompetitionImportException>(() =>
            CompetitionFileImport.ImportAsync(db, Sample() with { OwnerEmail = "member@example.test" }));
        Assert.Contains("is not an admin or approved trainer", member.Message);
        Assert.Equal(2, await db.Competitions.CountAsync());
    }

    public static TheoryData<string, string> BadFiles() => new()
    {
        { "name", "name is missing" },
        { "date", "date must be written yyyy-MM-dd" },
        { "zone", "Unknown time zone" },
        { "no-sections", "has no sections" },
        { "blank-hatband", "lane hatband is blank" },
        { "age", "ageGroup is missing" },
        { "format", "format must be Pairs or Individual" },
        { "no-races", "heats have no races" },
        { "too-many-races", "more than 40 races" },
        { "no-heats", "has no heats" },
        { "minutes", "minutesPerHeat must be at least 1" },
        { "time", "time must be written HH:mm" },
        { "lanes", "more lanes than there are hatbands" },
        { "three-riders", "has 3 riders" },
        { "twice", "is in two lanes" },
        { "empty-heat", "has nobody in it" },
        { "finals-off", "has finals but hasFinal is false" },
        { "final-minutes", "minutesPerFinal must be at least 1" },
        { "final-races", "finals have no races" },
        { "end", "endTime is before the last session ends" },
        { "final-lanes", "lanesPerFinal must be at least 1" },
        { "final-lanes-hatbands", "lanesPerFinal is more than there are hatbands" },
        { "final-early", "A Final starts before the finals session" },
        { "final-order", "B Final starts before the final before it" },
        { "final-count", "more than 26 finals" },
        { "final-time", "C Final: time must be written HH:mm" },
        { "final-end", "endTime is before the last session ends" },
    };

    [Theory]
    [MemberData(nameof(BadFiles))]
    public async Task Import_RefusesBadFiles(string fault, string message)
    {
        await using var db = await Database();
        var good = Sample();
        var s = Juniors();
        CompetitionImportSection With(CompetitionImportHeat heat) => s with { Heats = [heat] };
        var file = fault switch
        {
            "name" => good with { Name = " " },
            "date" => good with { Date = "01/06/2030" },
            "zone" => good with { TimeZone = "Mars/Olympus" },
            "no-sections" => good with { Sections = [] },
            "blank-hatband" => good with { LaneHatbands = ["Red", " "] },
            "age" => good with { Sections = [s with { AgeGroup = "" }] },
            "format" => good with { Sections = [s with { Format = "Teams" }] },
            "no-races" => good with { Sections = [s with { HeatRaces = [" "] }] },
            "too-many-races" => good with { Sections = [s with { HeatRaces = Enumerable.Repeat("Bending", 41).ToList() }] },
            "no-heats" => good with { Sections = [s with { Heats = [] }] },
            "minutes" => good with { Sections = [s with { MinutesPerHeat = 0 }] },
            "time" => good with { Sections = [With(new("8.30am", [["Amy Ash"]]))] },
            "lanes" => good with { Sections = [With(new("08:30", [["A"], ["B"], ["C"], ["D"], ["E"]]))] },
            "three-riders" => good with { Sections = [With(new("08:30", [["A", "B", "C"]]))] },
            "twice" => good with { Sections = [With(new("08:30", [["A", "B"], ["B", "A"]]))] },
            "empty-heat" => good with { Sections = [With(new("08:30", [null, [" "]]))] },
            "finals-off" => good with { Sections = [s with { HasFinal = false }] },
            "final-minutes" => good with { Sections = [s with { Finals = new("10:10", 0) }] },
            "final-races" => good with { Sections = [s with { FinalRaces = [] }] },
            "end" => good with { EndTime = "09:00" },
            "final-lanes" => good with { Sections = [s with { Finals = new("10:10", LanesPerFinal: 0, Heats: ["10:10"]) }] },
            "final-lanes-hatbands" => good with { Sections = [s with { Finals = new("10:10", LanesPerFinal: 5) }] },
            "final-early" => good with { Sections = [s with { Finals = new("10:10", Heats: ["10:00"]) }] },
            "final-order" => good with { Sections = [s with { Finals = new("10:10", Heats: ["10:40", "10:10"]) }] },
            "final-count" => good with { Sections = [s with { Finals = new("10:10", Heats: Enumerable.Repeat("10:10", 27).ToList()) }] },
            "final-time" => good with { Sections = [s with { Finals = new("10:10", Heats: ["10:10", "10:40", "11am"]) }] },
            "final-end" => good with { Sections = [s with { Finals = new("15:00", Heats: ["15:00", "15:30", "16:00"]) }] },
            _ => throw new ArgumentOutOfRangeException(nameof(fault)),
        };

        var ex = await Assert.ThrowsAsync<CompetitionImportException>(() => CompetitionFileImport.ImportAsync(db, file));

        Assert.Contains(message, ex.Message);
        Assert.Empty(await db.Competitions.ToListAsync());
    }

    [Fact]
    public void Parse_ReadsCommentedJson_AndRefusesBadJson()
    {
        var file = CompetitionFileImport.Parse("""
            {
              // The organiser's notes are allowed.
              "name": "Pairs Day", "date": "2030-06-01",
              "sections": [{ "ageGroup": "Under 12", "heatRaces": ["Bending"], "heats": [{ "start": "09:00", "lanes": [["A", "B"], null] }], }],
            }
            """);
        Assert.Equal("Pairs Day", file.Name);
        Assert.Null(file.Sections[0].Heats[0].Lanes[1]);

        Assert.Contains("not valid event JSON", Assert.Throws<CompetitionImportException>(() => CompetitionFileImport.Parse("{ nope")).Message);
        Assert.Equal("The file is empty.", Assert.Throws<CompetitionImportException>(() => CompetitionFileImport.Parse("null")).Message);
    }

    [Fact]
    public async Task ImportedEvent_IsRunByItsOwner_WhoDrawsFinalsIntoThePlannedSession()
    {
        var name = $"Owned import {Guid.NewGuid():N}";
        var result = await _f.WithDbAsync(db => CompetitionFileImport.ImportAsync(db, Sample(name) with { OwnerEmail = TestClients.TrainerEmail }));
        var id = result.CompetitionId!.Value;
        var trainer = await _f.TrainerAsync();

        var sessions = await (await trainer.GetAsync($"/api/competitions/{id}/sessions")).ReadAsync<List<SessionDto>>();
        var heats = sessions.Single(s => s.Name == "Under 15 Pairs heats");
        var ordered = heats.Heats.OrderBy(h => h.OrderIndex).ToList();
        Assert.Equal(["Heat 1", "Heat 2"], ordered.Select(h => h.Label));
        Assert.Equal([1, 2, 4], ordered[1].Entries.Select(e => e.LaneIndex).Order());
        var planned = sessions.Single(s => s.Name == "Finals · Under 15 Pairs");
        Assert.Equal(FinalRaces, planned.PlannedRaces);

        // Every heat race scored: lane order is finishing order, points from the largest heat (3).
        await _f.WithDbAsync(async db =>
        {
            var races = await db.Races.Include(r => r.Heat!).ThenInclude(h => h.Entries).Where(r => r.Heat!.SessionId == heats.Id).ToListAsync();
            foreach (var race in races)
            {
                race.IsComplete = true;
                var place = 0;
                foreach (var entry in race.Heat!.Entries.OrderBy(e => e.LaneIndex))
                    db.Results.Add(new Result { RaceId = race.Id, TeamId = entry.TeamId, Placing = ++place, Points = 4 - place });
            }
            await db.SaveChangesAsync();
        });

        var response = await trainer.PostAsJsonAsync($"/api/competitions/{id}/finals", new CreateFinalsRequest(
            heats.CompetitionSectionId, 6, FinalRaces, 3, null, LowestFinalFirst: false, ExistingSessionId: planned.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var drawn = await response.ReadAsync<SessionDto>();
        Assert.Equal(planned.Id, drawn.Id);
        Assert.Equal(["A Final", "B Final"], drawn.Heats.OrderBy(h => h.OrderIndex).Select(h => h.Label));
        Assert.All(drawn.Heats, h => Assert.Equal(FinalRaces, h.Races.Select(r => r.Name)));
    }

    /// <summary>The juniors with their A and B finals on the timetable, empty, three pairs each.</summary>
    private static CompetitionImportSection JuniorsWithFinals() => Juniors() with
    {
        Finals = new("10:10", MinutesPerFinal: 25, LanesPerFinal: 3, Heats: ["10:10", "10:30"]),
    };

    [Fact]
    public async Task Import_AddsEmptyLetteredFinals_WithTheirTimesAndRaces()
    {
        await using var db = await Database();
        var file = Sample() with { Sections = [JuniorsWithFinals()] };

        var result = await CompetitionFileImport.ImportAsync(db, file);

        // Two heats and two finals; 3 heat races each and 2 final races each.
        Assert.Equal((4, 10), (result.Heats, result.Races));
        var finals = await db.Sessions.Include(s => s.Heats).ThenInclude(h => h.Races).Include(s => s.Heats).ThenInclude(h => h.Entries)
            .SingleAsync(s => s.CompetitionId == result.CompetitionId && s.Name == "Finals · Under 15 Pairs");
        Assert.Equal((3, 25, new DateTime(2030, 6, 1, 9, 10, 0)), (finals.LanesPerHeat!.Value, finals.MinutesPerHeat!.Value, finals.ScheduledStart!.Value));
        // A runs first, as on the sheet; A is cut to the 20 minutes before B starts.
        Assert.Equal(
            [("A Final", 1, new DateTime(2030, 6, 1, 9, 10, 0), 20), ("B Final", 2, new DateTime(2030, 6, 1, 9, 30, 0), 25)],
            finals.Heats.OrderBy(h => h.OrderIndex).Select(h => (h.Label!, h.OrderIndex, h.ScheduledStart!.Value, h.DurationMinutes!.Value)));
        Assert.All(finals.Heats, h =>
        {
            Assert.Empty(h.Entries);
            Assert.Equal(FinalRaces, h.Races.OrderBy(r => r.OrderIndex).Select(r => r.Name));
        });
    }

    [Fact]
    public async Task AddFinals_FillsThePlannedSessionsOfAnEventImportedEarlier_Once()
    {
        await using var db = await Database();
        var name = $"Finals later {Guid.NewGuid():N}";
        var first = await CompetitionFileImport.ImportAsync(db, Sample(name));
        var later = Sample(name) with
        {
            Sections =
            [
                JuniorsWithFinals() with { FinalRaces = null },
                // The Novice final waits for the draw: nothing listed, nothing added.
                Sample().Sections[1],
            ],
        };

        var check = await CompetitionFileImport.AddFinalsAsync(db, later, dryRun: true);
        Assert.Equal((first.CompetitionId, 1, 2, 4, true), (check.CompetitionId, check.Sessions, check.Heats, check.Races, check.DryRun));
        Assert.Empty(await db.Heats.Where(h => h.Label == "A Final").ToListAsync());

        var added = await CompetitionFileImport.AddFinalsAsync(db, later);

        Assert.False(added.DryRun);
        db.ChangeTracker.Clear();
        var sessions = await db.Sessions.Include(s => s.Heats).ThenInclude(h => h.Races)
            .Where(s => s.CompetitionId == first.CompetitionId).ToListAsync();
        var juniors = sessions.Single(s => s.Name == "Finals · Under 15 Pairs");
        Assert.Equal(["A Final", "B Final"], juniors.Heats.OrderBy(h => h.OrderIndex).Select(h => h.Label));
        // The races planned at import are kept when the later file doesn't list them.
        Assert.All(juniors.Heats, h => Assert.Equal(FinalRaces, h.Races.OrderBy(r => r.OrderIndex).Select(r => r.Name)));
        Assert.Equal(3, juniors.LanesPerHeat);
        Assert.Empty(sessions.Single(s => s.Name == "Finals · Novice Pairs").Heats);

        var again = await Assert.ThrowsAsync<CompetitionImportException>(() => CompetitionFileImport.AddFinalsAsync(db, later));
        Assert.Equal("Under 15 already has finals heats. Nothing was changed.", again.Message);
    }

    [Theory]
    [InlineData("no-event", "There's no")]
    [InlineData("two-events", "more than one")]
    [InlineData("no-age-group", "has no Under 18 age group")]
    [InlineData("no-session", "has no empty finals session")]
    [InlineData("nothing", "lists no finals heats to add")]
    [InlineData("too-late", "The last final ends after the event does")]
    [InlineData("minutes", "minutesPerFinal must be at least 1")]
    public async Task AddFinals_RefusesWithoutChangingAnything(string fault, string message)
    {
        await using var db = await Database();
        var name = $"Refused {Guid.NewGuid():N}";
        var withFinals = Sample(name) with { Sections = [JuniorsWithFinals()] };
        if (fault != "no-event") await CompetitionFileImport.ImportAsync(db, Sample(name));
        if (fault == "two-events")
        {
            db.Competitions.Add(new Competition { Name = name, StartDate = new DateTime(2030, 6, 1, 9, 0, 0, DateTimeKind.Utc), EndDate = new DateTime(2030, 6, 1, 17, 0, 0, DateTimeKind.Utc) });
            await db.SaveChangesAsync();
        }
        if (fault == "no-session")
        {
            var planned = await db.Sessions.SingleAsync(s => s.Name == "Finals · Under 15 Pairs");
            db.Sessions.Remove(planned);
            await db.SaveChangesAsync();
        }
        var file = fault switch
        {
            "no-age-group" => withFinals with { Sections = [JuniorsWithFinals() with { AgeGroup = "Under 18" }] },
            "nothing" => Sample(name),
            "too-late" => withFinals with { Sections = [JuniorsWithFinals() with { Finals = new("15:30", Heats: ["15:30", "15:50"]) }] },
            "minutes" => withFinals with { Sections = [JuniorsWithFinals() with { Finals = new("10:10", MinutesPerFinal: 0, Heats: ["10:10"]) }] },
            _ => withFinals,
        };

        var ex = await Assert.ThrowsAsync<CompetitionImportException>(() => CompetitionFileImport.AddFinalsAsync(db, file));

        Assert.Contains(message, ex.Message);
        Assert.Empty(await db.Heats.Where(h => h.Label!.EndsWith("Final")).ToListAsync());
    }

    [Fact]
    public async Task ImportedEmptyFinals_AreFilledFromTheStandingsOnTheDay()
    {
        var name = $"Filled finals {Guid.NewGuid():N}";
        var result = await _f.WithDbAsync(db => CompetitionFileImport.ImportAsync(db,
            Sample(name) with { OwnerEmail = TestClients.TrainerEmail, Sections = [JuniorsWithFinals()] }));
        var id = result.CompetitionId!.Value;
        var trainer = await _f.TrainerAsync();
        var sessions = await (await trainer.GetAsync($"/api/competitions/{id}/sessions")).ReadAsync<List<SessionDto>>();
        var heats = sessions.Single(s => s.Name == "Under 15 Pairs heats");
        var finals = sessions.Single(s => s.Name == "Finals · Under 15 Pairs");
        Assert.All(finals.Heats, h => Assert.Empty(h.Entries));

        // Lane 1 wins each heat race, lane 2 is second and so on.
        await _f.WithDbAsync(async db =>
        {
            var races = await db.Races.Include(r => r.Heat!).ThenInclude(h => h.Entries).Where(r => r.Heat!.SessionId == heats.Id).ToListAsync();
            foreach (var race in races)
            {
                race.IsComplete = true;
                var place = 0;
                foreach (var entry in race.Heat!.Entries.OrderBy(e => e.LaneIndex))
                    db.Results.Add(new Result { RaceId = race.Id, TeamId = entry.TeamId, Placing = ++place, Points = 4 - place });
            }
            await db.SaveChangesAsync();
        });

        var response = await trainer.PostAsync($"/api/competitions/{id}/sessions/{finals.Id}/populate-finals", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var filled = (await response.ReadAsync<SessionDto>()).Heats.OrderBy(h => h.OrderIndex).ToList();
        Assert.Equal([("A Final", 3), ("B Final", 3)], filled.Select(h => (h.Label!, h.Entries.Count)));
        // Both heat winners and a second place make the A Final.
        var laneOne = heats.Heats.SelectMany(h => h.Entries.Where(e => e.LaneIndex == 1)).Select(e => e.TeamId);
        Assert.Subset(filled[0].Entries.Select(e => e.TeamId).ToHashSet(), laneOne.ToHashSet());
    }
}
