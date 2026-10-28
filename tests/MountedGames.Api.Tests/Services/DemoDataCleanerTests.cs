using System.Net;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services;
using MountedGames.Api.Services.DecForms;
using MountedGames.Api.Services.EventTools;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Services;

/// <summary>
/// <c>--clear-demo-data</c>: every competition but one goes, with seasons, team profiles, the seeders' accounts and
/// unused clubs; the kept event, site admins and real accounts stay. Each test has its own database, because the
/// command deletes everything else in it. The kept event is made by the real importer with made-up riders.
/// </summary>
public class DemoDataCleanerTests
{
    private static readonly DateTime Today = DateTime.UtcNow.Date;

    private sealed record Arranged(
        int KeptId, string OwnerId, string OwnerEmail, string MemberId, string MemberEmail, string SecondAdminId,
        int PayoutClubId, int RosterClubId, int RosterRiderId, int OrphanClubId, string OrphanClubName, Guid MemberProfileId,
        int CoachRiderId);

    private const string Kept = "West Mids Pairs";

    private static async Task<(int Code, string Out, string Err)> RunAsync(ApiFactory f, params string[] args)
    {
        var output = new StringWriter();
        var error = new StringWriter();
        var code = await DemoDataCleaner.RunCommandAsync(f.Services, ["--clear-demo-data", .. args], output, error);
        return (code, output.ToString(), error.ToString());
    }

    /// <summary>Row counts of every table, read straight from SQLite so the check doesn't rely on the command's own counting.</summary>
    private static Task<Dictionary<string, long>> AllTableCountsAsync(ApiFactory f) => f.InDbAsync(async db =>
    {
        var names = await db.Database.SqlQueryRaw<string>(
            "SELECT name AS \"Value\" FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").ToListAsync();
        var counts = new Dictionary<string, long>();
        foreach (var name in names)
            counts[name] = await db.Database.SqlQueryRaw<long>($"SELECT COUNT(*) AS \"Value\" FROM \"{name}\"").SingleAsync();
        return counts;
    });

    private static CompetitionImportFile WestMidsPairs(string ownerEmail) => new(
        Kept, Today.AddDays(3).ToString("yyyy-MM-dd"),
        [
            new("Under 12", ["Bending", "Stepping Stones"],
            [
                new("09:00", [["Amy Ash", "Ben Birch"], ["Cara Cedar", "Dan Dove"], ["Eve Elm", "Finn Fir"]]),
                new("09:30", [["Gail Gorse", "Hal Hazel"], ["Ida Ivy"], ["Jay Juniper", "Kit Kale"]]),
            ], FinalRaces: ["Bending"], Finals: new("11:00")),
        ],
        OwnerEmail: ownerEmail, Location: "Somewhere in the West Midlands");

    /// <summary>
    /// The kept event (imported, one race scored, an entry, a competition admin, a supporter, a chat message, a pinned
    /// payout club), a real member and trainer, a second site admin, a real roster in its own club, an unused club, and
    /// the seeders' data: the local demo data (from ApiFactory), the eight review events and the history back catalogue.
    /// </summary>
    private static async Task<Arranged> ArrangeAsync(ApiFactory f, bool seedDemo = true)
    {
        var (_, member) = await f.SignupAsync("Member", $"Real Club {Guid.NewGuid():N}"[..20]);
        var (_, owner) = await f.ApprovedTrainerAsync();
        if (seedDemo)
            await f.InDbAsync(async db =>
            {
                await ReviewCompetitionSeeder.SeedAsync(db, Today, DateTime.UtcNow);
                await HistorySeeder.SeedAsync(db, Today);
            });
        var imported = await f.InDbAsync(db => CompetitionFileImport.ImportAsync(db, WestMidsPairs(owner.User.Email)));
        var keptId = imported.CompetitionId!.Value;
        return await f.InDbAsync(async db =>
        {
            var payoutClub = new Club { Name = $"Payout Club {Guid.NewGuid():N}"[..24] };
            var rosterClub = new Club { Name = $"Roster Club {Guid.NewGuid():N}"[..24] };
            var orphanClub = new Club { Name = $"Orphan Club {Guid.NewGuid():N}"[..24] };
            db.Clubs.AddRange(payoutClub, rosterClub, orphanClub);
            var rosterRider = new SavedRider { Club = rosterClub, CreatedByUserId = member.User.Id, FullName = "Lea Lime", HorseName = "Pip" };
            db.SavedRiders.Add(rosterRider);
            // A team profile a real person owns, not linked to any event: it stays.
            var memberProfile = new TeamProfile { OwnerUserId = member.User.Id, Club = rosterClub, DisplayName = "Real Team" };
            db.Set<TeamProfile>().Add(memberProfile);

            var secondAdmin = new AppUser { UserName = "second-admin@example.test", Email = "second-admin@example.test",
                NormalizedEmail = "SECOND-ADMIN@EXAMPLE.TEST", NormalizedUserName = "SECOND-ADMIN@EXAMPLE.TEST", FullName = "Second Admin" };
            db.Users.Add(secondAdmin);
            await db.SaveChangesAsync();
            var adminRole = await db.Roles.SingleAsync(r => r.Name == Roles.Admin);
            db.UserRoles.Add(new IdentityUserRole<string> { UserId = secondAdmin.Id, RoleId = adminRole.Id });

            var comp = await db.Competitions.Include(c => c.Sections).Include(c => c.Teams).SingleAsync(c => c.Id == keptId);
            comp.DecFormConfigJson = (DecFormConfig.Standard with { PayoutClubId = payoutClub.Id }).ToJson();
            // One race scored, as on the day.
            var race = await db.Races.Include(r => r.Heat).ThenInclude(h => h!.Entries)
                .Where(r => r.Heat!.Session!.CompetitionId == keptId).OrderBy(r => r.Id).FirstAsync();
            var place = 0;
            foreach (var entry in race.Heat!.Entries.OrderBy(e => e.LaneIndex))
                db.Results.Add(new Result { RaceId = race.Id, TeamId = entry.TeamId, Placing = ++place, Points = 4 - place });
            race.IsComplete = true;
            db.SectionSignups.Add(new SectionSignup
            {
                CompetitionSectionId = comp.Sections.First().Id, UserId = member.User.Id, FullName = "Real Entrant",
            });
            db.CompetitionCollaborators.Add(new CompetitionCollaborator { CompetitionId = keptId, UserId = member.User.Id, AddedByUserId = owner.User.Id });
            db.ChatMessages.Add(new ChatMessage { CompetitionId = keptId, UserId = member.User.Id, AuthorName = "Member", Body = "See you there" });
            // A seeder account the kept event uses: it must stay.
            var coach = await db.Users.SingleAsync(u => u.NormalizedEmail == "COACH@MG.LOCAL");
            db.TeamSupporters.Add(new TeamSupporter { TeamId = comp.Teams.First().Id, UserId = coach.Id });
            // ...and so do the riders that account saved.
            var coachRider = new SavedRider { Club = rosterClub, CreatedByUserId = coach.Id, FullName = "Mo Moss", HorseName = "Dot" };
            db.SavedRiders.Add(coachRider);
            await db.SaveChangesAsync();
            return new Arranged(keptId, owner.User.Id, owner.User.Email, member.User.Id, member.User.Email, secondAdmin.Id,
                payoutClub.Id, rosterClub.Id, rosterRider.Id, orphanClub.Id, orphanClub.Name, memberProfile.Id, coachRider.Id);
        });
    }

    private static Task<int[]> KeptCountsAsync(ApiFactory f, int id) => f.InDbAsync(async db =>
    {
        db.ChangeTracker.Clear();
        return new[]
        {
            await db.CompetitionSections.CountAsync(s => s.CompetitionId == id),
            await db.Sessions.CountAsync(s => s.CompetitionId == id),
            await db.Heats.CountAsync(h => h.Session!.CompetitionId == id),
            await db.Races.CountAsync(r => r.Heat!.Session!.CompetitionId == id),
            await db.Results.CountAsync(r => r.Race!.Heat!.Session!.CompetitionId == id),
            await db.Teams.CountAsync(t => t.CompetitionId == id),
            await db.DeclarationForms.CountAsync(d => d.Team!.CompetitionId == id),
            await db.RiderEntries.CountAsync(r => r.DeclarationForm!.Team!.CompetitionId == id),
            await db.SectionSignups.CountAsync(s => s.Section!.CompetitionId == id),
            await db.CompetitionCollaborators.CountAsync(c => c.CompetitionId == id),
            await db.TeamSupporters.CountAsync(s => s.Team!.CompetitionId == id),
            await db.ChatMessages.CountAsync(m => m.CompetitionId == id),
        };
    });

    [Fact]
    public async Task DryRunChangesNothing_ThenApplyKeepsOnlyTheRealEventAndRealAccounts()
    {
        await using var f = new ApiFactory();
        var a = await ArrangeAsync(f);
        var keptBefore = await KeptCountsAsync(f, a.KeptId);
        Assert.True(keptBefore[4] > 0);
        var tablesBefore = await AllTableCountsAsync(f);
        var competitionsBefore = tablesBefore["Competitions"];
        Assert.True(competitionsBefore > 15, $"expected the seeders' events, found {competitionsBefore}");

        // Dry run: nothing changes, and the report has counts, ids and event names but no people.
        var dry = await RunAsync(f, "--keep-competition", a.KeptId.ToString(), "--expect-name", Kept);
        Assert.True(dry.Code == 0, dry.Err);
        Assert.Equal(tablesBefore, await AllTableCountsAsync(f));
        Assert.StartsWith("Database: SQLite, file ", dry.Out);
        Assert.Contains("mg-test-", dry.Out.Split('\n')[0]);
        Assert.Contains("Dry run: nothing has been changed.", dry.Out);
        Assert.Contains($"Keeping competition {a.KeptId} \"West Mids Pairs\": 1 section, 2 sessions, 2 heats", dry.Out);
        Assert.Contains("1 owner account, 1 competition admin, 1 supporter, 1 chat message,", dry.Out);
        Assert.Contains("Team profiles: keeping 1 team profile owned by real accounts", dry.Out);
        // The clubs to go are named so the owner can check them; the kept ones are not listed.
        Assert.Contains($"\n  \"{a.OrphanClubName}\"", dry.Out);
        Assert.Contains("\n  \"Devon Daredevils\"", dry.Out);
        Assert.DoesNotContain($"\"{CompetitionFileImport.DefaultClub}\"", dry.Out);
        Assert.Contains($"Would delete {competitionsBefore - 1} other competitions", dry.Out);
        Assert.Contains("\"EGUK Winter Pairs Series — Round 1\"", dry.Out);
        Assert.Contains("\"EGUK National Championships\"", dry.Out);
        Assert.Matches($@"\n  Competitions +{competitionsBefore} +{competitionsBefore - 1} +1\r?\n", dry.Out);
        Assert.Matches(@"Accounts: would delete 5 made by the seeders; keeping \d+ \(2 site admins, \d+ real sign-ups, 1 seeder account the kept", dry.Out);
        Assert.Contains("Clubs: would delete ", dry.Out);
        foreach (var personal in new[] { "Amy Ash", "Lea Lime", "Real Entrant", "Jamie Carter", "Robin Page", "Olivia Hart", "Mo Moss",
                     a.OwnerEmail, a.MemberEmail, "trainer@mg.local", "coach@mg.local", "admin@mg.local", "second-admin" })
            Assert.DoesNotContain(personal, dry.Out, StringComparison.OrdinalIgnoreCase);

        // Apply.
        var applied = await RunAsync(f, "--keep-competition", a.KeptId.ToString(), "--expect-name", Kept, "--apply");
        Assert.True(applied.Code == 0, applied.Err);
        Assert.Contains("Applied: everything below was deleted in one transaction.", applied.Out);
        Assert.Contains($"Checked: competition {a.KeptId} still has all of that afterwards.", applied.Out);
        Assert.Equal(keptBefore, await KeptCountsAsync(f, a.KeptId));

        await f.InDbAsync(async db =>
        {
            db.ChangeTracker.Clear();
            Assert.Equal(a.KeptId, (await db.Competitions.SingleAsync()).Id);
            Assert.Equal(0, await db.Set<Season>().CountAsync());
            Assert.Equal(0, await db.Set<SeasonRound>().CountAsync());
            Assert.Equal(a.MemberProfileId, (await db.Set<TeamProfile>().SingleAsync()).Id);
            Assert.Equal(0, await db.Set<CatalogueItem>().CountAsync());
            Assert.Equal(0, await db.ShopPosts.CountAsync());
            Assert.Equal(0, await db.Set<EventCommerceSettings>().CountAsync());

            // Accounts: the seeders' go, except the demo coach the kept event uses; admins and real people stay.
            var users = await db.Users.Select(u => new { u.Id, u.NormalizedEmail }).ToListAsync();
            Assert.DoesNotContain(users, u => u.Id.StartsWith("history-seed-"));
            Assert.DoesNotContain(users, u => u.NormalizedEmail == "TRAINER@MG.LOCAL");
            Assert.Contains(users, u => u.NormalizedEmail == "COACH@MG.LOCAL");
            Assert.Contains(users, u => u.NormalizedEmail == "ADMIN@MG.LOCAL");
            foreach (var id in new[] { a.OwnerId, a.MemberId, a.SecondAdminId })
                Assert.Contains(users, u => u.Id == id);
            Assert.True(await db.UserRoles.AnyAsync(r => r.UserId == a.SecondAdminId));

            // Clubs: the kept event's, the pinned payout club, real accounts' and rosters' clubs and the preset list stay.
            var clubs = await db.Clubs.Select(c => new { c.Id, c.Name }).ToListAsync();
            Assert.Contains(clubs, c => c.Name == CompetitionFileImport.DefaultClub);
            foreach (var id in new[] { a.PayoutClubId, a.RosterClubId })
                Assert.Contains(clubs, c => c.Id == id);
            Assert.DoesNotContain(clubs, c => c.Id == a.OrphanClubId);
            Assert.DoesNotContain(clubs, c => c.Name.EndsWith(" Host Club"));
            Assert.DoesNotContain(clubs, c => c.Name == "Devon Daredevils");
            var memberClub = await db.Users.Where(u => u.Id == a.MemberId).Select(u => u.ClubId).SingleAsync();
            Assert.Contains(clubs, c => c.Id == memberClub);
            Assert.Equal(DbInitializer.PresetClubNames.Length, clubs.Count(c => DbInitializer.PresetClubNames.Contains(c.Name)));

            // Rosters: the real one and the kept coach's stay; the deleted seeder accounts' and the demo data's go.
            Assert.Equal(new[] { a.RosterRiderId, a.CoachRiderId }.Order(),
                (await db.SavedRiders.Select(r => r.Id).ToListAsync()).Order());
        });

        // The kept event still opens on the site.
        var page = await f.CreateClient().GetAsync($"/api/competitions/{a.KeptId}");
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);

        // Running it again finds nothing more to do.
        var again = await RunAsync(f, "--keep-competition", a.KeptId.ToString(), "--expect-name", Kept, "--apply");
        Assert.True(again.Code == 0, again.Err);
        Assert.Contains("No other competitions to delete.", again.Out);
        Assert.Contains("Accounts: deleted 0 made by the seeders", again.Out);
        Assert.Contains("Clubs: deleted 0 ", again.Out);
    }

    [Fact]
    public async Task RefusesWithoutAKnownNonDemoCompetitionOrAProperPostcode()
    {
        await using var f = new ApiFactory();
        var demoId = await f.InDbAsync(async db =>
        {
            var comp = new Competition { Name = $"Demo {Guid.NewGuid():N}", StartDate = Today };
            db.Competitions.Add(comp);
            db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { Competition = comp, IsDemo = true });
            await db.SaveChangesAsync();
            return comp.Id;
        });
        var before = await AllTableCountsAsync(f);
        var realId = await f.InDbAsync(db => db.Competitions.Where(c => c.Id != demoId).Select(c => c.Id).FirstAsync());

        foreach (var args in new string[][] { [], ["--apply"], ["--keep-competition"], ["--keep-competition", "--apply"],
                     ["--keep-competition", "abc"], ["--keep-competition", "0"], ["--keep-competition", "-4"] })
        {
            var run = await RunAsync(f, args);
            Assert.Equal(1, run.Code);
            Assert.Contains("Say which competition to keep: --keep-competition <id>", run.Err);
            Assert.Equal("", run.Out);
        }

        var realName = await f.InDbAsync(db => db.Competitions.Where(c => c.Id == realId).Select(c => c.Name).SingleAsync());
        foreach (var args in new string[][] { [], ["--expect-name"], ["--expect-name", ""], ["--expect-name", "--apply"] })
        {
            var run = await RunAsync(f, ["--keep-competition", realId.ToString(), "--apply", .. args]);
            Assert.Equal(1, run.Code);
            Assert.Contains("Say the kept competition's exact name too: --expect-name", run.Err);
        }
        // The name must match exactly: a different event, a different case or extra spaces stop the run.
        foreach (var name in new[] { Kept, realName.ToUpperInvariant(), realName + " " })
        {
            var run = await RunAsync(f, "--keep-competition", realId.ToString(), "--expect-name", name, "--apply");
            Assert.Equal(1, run.Code);
            Assert.Contains($"Competition {realId} is called \"{realName}\", not \"{name}\", so nothing was changed.", run.Err);
        }

        var unknown = await RunAsync(f, "--keep-competition", "987654", "--expect-name", Kept, "--apply");
        Assert.Equal((1, "There is no competition 987654, so nothing was changed."), (unknown.Code, unknown.Err.Trim()));

        var demoName = await f.InDbAsync(db => db.Competitions.Where(c => c.Id == demoId).Select(c => c.Name).SingleAsync());
        var demo = await RunAsync(f, "--keep-competition", demoId.ToString(), "--expect-name", demoName, "--apply");
        Assert.Equal(1, demo.Code);
        Assert.Contains("is marked as a demo event", demo.Err);

        foreach (var args in new string[][] { ["--venue-postcode"], ["--venue-postcode", "  "], ["--venue-postcode", "--apply"],
                     ["--venue-postcode", "ABCDEFGHIJKLM"] })
        {
            var run = await RunAsync(f, ["--keep-competition", realId.ToString(), "--expect-name", realName, "--apply", .. args]);
            Assert.Equal(1, run.Code);
            Assert.Contains("Give the venue postcode after --venue-postcode", run.Err);
        }

        Assert.Equal(before, await AllTableCountsAsync(f));
    }

    [Fact]
    public async Task VenuePostcodeIsCheckedInTheDryRunAndSetOnlyWithApply()
    {
        await using var f = new ApiFactory();
        var kept = await f.NewSectionAsync();
        var keptId = kept.CompetitionId;
        var name = kept.Competition!.Name;
        await f.InDbAsync(async db =>
        {
            // The event's what3words address must not stand in for a postcode the lookup can't find.
            await db.Competitions.Where(c => c.Id == keptId).ExecuteUpdateAsync(x => x.SetProperty(c => c.What3Words, "filled.count.soap"));
        });
        f.Http.RespondJson("api.postcodes.io/postcodes/CV8", """{"status":200,"result":{"latitude":52.34,"longitude":-1.47}}""");
        f.Http.RespondJson("api.what3words.com", """{"coordinates":{"lat":51.0,"lng":-2.0}}""");
        string[] keep = ["--keep-competition", keptId.ToString(), "--expect-name", name];

        // The dry run looks the postcode up (a read) and says where it is, but sets nothing.
        var dry = await RunAsync(f, [.. keep, "--venue-postcode", " cv8 2lz "]);
        Assert.True(dry.Code == 0, dry.Err);
        Assert.Contains($"Postcode: would set competition {keptId}'s postcode to CV8 2LZ (52.34, -1.47).", dry.Out);
        Assert.Contains(f.Http.Requests, r => r.Contains("postcodes.io"));
        Assert.Null(await f.InDbAsync(db => db.Competitions.Where(c => c.Id == keptId).Select(c => c.Postcode).SingleAsync()));

        // A postcode the lookup doesn't know is caught in the dry run, and with --apply stops the run before any delete.
        var others = await f.InDbAsync(db => db.Competitions.CountAsync(c => c.Id != keptId));
        Assert.True(others > 0);
        foreach (var apply in new[] { false, true })
        {
            var unknown = await RunAsync(f, [.. keep, "--venue-postcode", "ZZ9 9ZZ", .. (apply ? new[] { "--apply" } : [])]);
            Assert.Equal(1, unknown.Code);
            Assert.Contains("Couldn't find where ZZ9 9ZZ is, so nothing was changed.", unknown.Err);
        }
        Assert.DoesNotContain(f.Http.Requests, r => r.Contains("what3words"));
        Assert.Equal(others, await f.InDbAsync(db => db.Competitions.CountAsync(c => c.Id != keptId)));

        var applied = await RunAsync(f, [.. keep, "--venue-postcode", "cv8 2lz", "--apply"]);
        Assert.True(applied.Code == 0, applied.Err);
        Assert.Contains($"Postcode: set competition {keptId}'s postcode to CV8 2LZ (52.34, -1.47).", applied.Out);
        var venue = await f.InDbAsync(db => db.Competitions.Where(c => c.Id == keptId)
            .Select(c => new { c.Postcode, c.Latitude, c.Longitude }).SingleAsync());
        Assert.Equal(("CV8 2LZ", 52.34, -1.47), (venue.Postcode, venue.Latitude, venue.Longitude));
        Assert.Equal(0, await f.InDbAsync(db => db.Competitions.CountAsync(c => c.Id != keptId)));
    }

    [Fact]
    public async Task AnUnexpectedErrorIsReportedWithoutItsDetail()
    {
        // A database file that can't be opened: the provider's message (with the path) must not be printed.
        var missing = Path.Combine(Path.GetTempPath(), $"mg-missing-{Guid.NewGuid():N}", "nowhere.db");
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddHttpClient();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddDbContext<AppDbContext>(o => o.UseSqlite($"Data Source={missing};Mode=ReadOnly"));
        services.AddScoped<GeocodingService>();
        await using var provider = services.BuildServiceProvider();
        var output = new StringWriter();
        var error = new StringWriter();

        var code = await DemoDataCleaner.RunCommandAsync(provider,
            ["--clear-demo-data", "--keep-competition", "44", "--expect-name", Kept], output, error);

        Assert.Equal(1, code);
        Assert.StartsWith("The run stopped with an unexpected error (", error.ToString());
        Assert.DoesNotContain(missing, error.ToString());
        Assert.DoesNotContain("nowhere", error.ToString());
        Assert.Equal("", output.ToString());
    }

    [Fact]
    public async Task RollsBackWhenTheKeptEventWouldLoseAnything()
    {
        await using var f = new ApiFactory();
        var a = await ArrangeAsync(f, seedDemo: false);
        // A lane in another event's heat holding one of the kept teams: deleting that heat would take it with it.
        await f.InDbAsync(async db =>
        {
            var team = await db.Teams.FirstAsync(t => t.CompetitionId == a.KeptId);
            var heat = await db.Heats.FirstAsync(h => h.Session!.CompetitionId != a.KeptId);
            db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = team.Id, LaneIndex = 99 });
            await db.SaveChangesAsync();
        });
        var before = await AllTableCountsAsync(f);

        var run = await RunAsync(f, "--keep-competition", a.KeptId.ToString(), "--expect-name", Kept, "--apply");

        Assert.Equal(1, run.Code);
        Assert.Contains($"Competition {a.KeptId} would have gone from", run.Err);
        Assert.Contains("lanes for its teams", run.Err);
        Assert.Equal(before, await AllTableCountsAsync(f));
    }
}
