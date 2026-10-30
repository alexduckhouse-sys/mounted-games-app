using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.DecForms;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.EventTools;

public class StartingPointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public StartingPointsTests(ApiFactory f) => _f = f;

    private static readonly DateTime Start = new(2037, 5, 2, 9, 0, 0, DateTimeKind.Utc);

    /// <summary>A competition owned by a fresh approved trainer, with one section, a race session, a break, a team and a result.</summary>
    private async Task<(HttpClient Client, string UserId, int CompetitionId)> ArrangeAsync()
    {
        var (client, auth) = await _f.ApprovedTrainerAsync();
        var userId = auth.User.Id;
        var competitionId = await _f.WithDbAsync(async db =>
        {
            var competition = new Competition
            {
                Name = $"Source {Guid.NewGuid():N}", StartDate = Start, EndDate = Start.AddDays(1), CreatedByUserId = userId,
                PaymentDestination = "Club bank", LaneHatbands = "[\"Red\",\"Blue\"]", DecFormConfigJson = DecFormConfig.Basic.ToJson(),
            };
            var club = new Club { Name = $"SP Club {Guid.NewGuid():N}" };
            db.AddRange(competition, club);
            await db.SaveChangesAsync();
            var section = new CompetitionSection { CompetitionId = competition.Id, Format = SectionFormat.Teams, AgeGroup = "U12", DisplayName = "U12", PriceMinor = 900 };
            db.Add(section);
            await db.SaveChangesAsync();
            var team = new Team { CompetitionId = competition.Id, CompetitionSectionId = section.Id, ClubId = club.Id, Suffix = "A", DisplayName = "Private team" };
            db.Add(team);
            db.Add(new Session { CompetitionId = competition.Id, CompetitionSectionId = section.Id, Name = "Heats", OrderIndex = 1,
                ScheduledStart = Start.AddHours(2), PlannedRaces = "[\"Bending\"]", LanesPerHeat = 4 });
            db.Add(new Session { CompetitionId = competition.Id, Name = "Lunch", OrderIndex = 2, Kind = SessionKind.Break, IsBreak = true });
            await db.SaveChangesAsync();
            return competition.Id;
        });
        return (client, userId, competitionId);
    }

    private static async Task<StartingPointDto> SaveAsync(HttpClient client, int competitionId, string name = "My set-up")
    {
        var response = await client.PostAsJsonAsync($"/api/competitions/{competitionId}/starting-points", new SaveStartingPointRequest(name));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<StartingPointDto>();
    }

    [Fact]
    public async Task SaveListRenameAndDelete_WorkForTheOwner()
    {
        var (owner, _, competitionId) = await ArrangeAsync();

        var saved = await SaveAsync(owner, competitionId, "  Summer show  ");
        Assert.Equal(("Summer show", 1, 2, true), (saved.Name, saved.Sections, saved.Sessions, saved.IsMine));
        Assert.Null(saved.OwnerName);

        var list = await (await owner.GetAsync("/api/starting-points")).ReadAsync<List<StartingPointDto>>();
        Assert.Equal(saved.Id, Assert.Single(list).Id);

        var renamed = await owner.PutAsJsonAsync($"/api/starting-points/{saved.Id}", new RenameStartingPointRequest("Summer show 2"));
        Assert.Equal("Summer show 2", (await renamed.ReadAsync<StartingPointDto>()).Name);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/starting-points/{saved.Id}")).StatusCode);
        Assert.Empty(await (await owner.GetAsync("/api/starting-points")).ReadAsync<List<StartingPointDto>>());
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync($"/api/starting-points/{saved.Id}")).StatusCode);
    }

    [Fact]
    public async Task SavedSetup_HoldsNoTeamsResultsOrPersonalData()
    {
        var (owner, _, competitionId) = await ArrangeAsync();
        var saved = await SaveAsync(owner, competitionId);

        var json = await _f.WithDbAsync(db => db.StartingPoints.Where(p => p.Id == saved.Id).Select(p => p.SetupJson).SingleAsync());
        Assert.DoesNotContain("Private team", json);
        Assert.Contains("Club bank", json);
        Assert.Contains("Bending", json);
    }

    [Fact]
    public async Task Save_RejectsBadNamesAndOtherPeoplesCompetitions_AndNeedsSignIn()
    {
        var (owner, _, competitionId) = await ArrangeAsync();
        var url = $"/api/competitions/{competitionId}/starting-points";
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(url, new SaveStartingPointRequest("   "))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync(url, new SaveStartingPointRequest(new string('x', StartingPoint.MaxNameLength + 1)))).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(url, new SaveStartingPointRequest("A"))).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync(url, new SaveStartingPointRequest("A"))).StatusCode);
        var (other, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync(url, new SaveStartingPointRequest("A"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync("/api/starting-points")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/starting-points")).StatusCode);
    }

    [Fact]
    public async Task Save_StopsAtTheLimit()
    {
        var (owner, userId, competitionId) = await ArrangeAsync();
        await _f.InDbAsync(async db =>
        {
            for (var i = 0; i < StartingPoint.MaxPerOwner; i++)
                db.StartingPoints.Add(new StartingPoint { Name = $"P{i}", OwnerUserId = userId, SetupJson = "{}" });
            await db.SaveChangesAsync();
        });
        var response = await owner.PostAsJsonAsync($"/api/competitions/{competitionId}/starting-points", new SaveStartingPointRequest("One too many"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task OtherOrganisersGetNotFound_ButAdminsSeeAndManageEverything()
    {
        var (owner, _, competitionId) = await ArrangeAsync();
        var saved = await SaveAsync(owner, competitionId, "Private to owner");
        var (other, _) = await _f.ApprovedTrainerAsync();

        Assert.DoesNotContain(await (await other.GetAsync("/api/starting-points")).ReadAsync<List<StartingPointDto>>(), p => p.Id == saved.Id);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PutAsJsonAsync($"/api/starting-points/{saved.Id}", new RenameStartingPointRequest("Mine now"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/api/starting-points/{saved.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PostAsJsonAsync($"/api/starting-points/{saved.Id}/competition", new CreateFromStartingPointRequest("Nope", Start, null))).StatusCode);

        var admin = await _f.AdminAsync();
        var adminList = await admin.GetAsync("/api/starting-points");
        Assert.Equal(HttpStatusCode.OK, adminList.StatusCode);
        var seen = (await adminList.ReadAsync<List<StartingPointDto>>()).Single(p => p.Id == saved.Id);
        Assert.False(seen.IsMine);
        Assert.False(string.IsNullOrEmpty(seen.OwnerName));
        Assert.Equal(HttpStatusCode.OK,
            (await admin.PutAsJsonAsync($"/api/starting-points/{saved.Id}", new RenameStartingPointRequest("Renamed by admin"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/starting-points/{saved.Id}")).StatusCode);
    }

    [Fact]
    public async Task Rename_RejectsAnEmptyName()
    {
        var (owner, _, competitionId) = await ArrangeAsync();
        var saved = await SaveAsync(owner, competitionId);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PutAsJsonAsync($"/api/starting-points/{saved.Id}", new RenameStartingPointRequest(" "))).StatusCode);
    }

    [Fact]
    public async Task CreateCompetition_BuildsANewEventOwnedByTheCallerWithShiftedTimes()
    {
        var (owner, userId, competitionId) = await ArrangeAsync();
        var saved = await SaveAsync(owner, competitionId);
        var newStart = Start.AddYears(1);

        var response = await owner.PostAsJsonAsync($"/api/starting-points/{saved.Id}/competition",
            new CreateFromStartingPointRequest("  Next year  ", newStart, newStart.AddDays(1)));
        var created = await response.ReadAsync<CloneCompetitionResultDto>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(("Next year", 1, 2, 0), (created.Name, created.Sections, created.Sessions, created.Teams));
        await _f.WithDbAsync(async db =>
        {
            var competition = await db.Competitions.Include(c => c.Sessions).Include(c => c.Sections).SingleAsync(c => c.Id == created.CompetitionId);
            Assert.Equal(userId, competition.CreatedByUserId);
            Assert.Equal((newStart, "Club bank"), (competition.StartDate, competition.PaymentDestination));
            Assert.Equal(900, competition.Sections.Single().PriceMinor);
            var race = competition.Sessions.Single(s => s.Kind == SessionKind.Race);
            Assert.Equal(newStart.AddHours(2), race.ScheduledStart);
            Assert.Equal("[\"Bending\"]", race.PlannedRaces);
            Assert.Empty(await db.Teams.Where(t => t.CompetitionId == created.CompetitionId).ToListAsync());
        });
    }

    [Fact]
    public async Task CreateCompetition_PinsTheCallersClubForPayouts_AndRejectsBadInput()
    {
        var (owner, userId, competitionId) = await ArrangeAsync();
        var clubId = await _f.SeedClubAsync();
        await _f.InDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == userId)).ClubId = clubId;
            await db.SaveChangesAsync();
        });
        var saved = await SaveAsync(owner, competitionId);
        var url = $"/api/starting-points/{saved.Id}/competition";

        var created = await (await owner.PostAsJsonAsync(url, new CreateFromStartingPointRequest("With club", Start, null))).ReadAsync<CloneCompetitionResultDto>();
        var config = await _f.WithDbAsync(db => db.Competitions.Where(c => c.Id == created.CompetitionId).Select(c => c.DecFormConfigJson).SingleAsync());
        Assert.Equal(clubId, DecFormConfig.Parse(config)!.PayoutClubId);

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync(url, new CreateFromStartingPointRequest(" ", Start, null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync(url, new CreateFromStartingPointRequest("Backwards", Start, Start.AddDays(-1)))).StatusCode);
    }

    [Fact]
    public async Task CreateCompetition_ReportsAStartingPointThatCannotBeRead()
    {
        var (owner, userId, _) = await ArrangeAsync();
        var id = await _f.WithDbAsync(async db =>
        {
            var point = new StartingPoint { Name = "Broken", OwnerUserId = userId, SetupJson = "not json" };
            db.Add(point);
            await db.SaveChangesAsync();
            return point.Id;
        });
        var listed = await (await owner.GetAsync("/api/starting-points")).ReadAsync<List<StartingPointDto>>();
        Assert.Equal((0, 0), (listed.Single(p => p.Id == id).Sections, listed.Single(p => p.Id == id).Sessions));
        Assert.Equal(HttpStatusCode.Conflict,
            (await owner.PostAsJsonAsync($"/api/starting-points/{id}/competition", new CreateFromStartingPointRequest("X", Start, null))).StatusCode);
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsStartingPoints()
    {
        var (owner, userId, competitionId) = await ArrangeAsync();
        await SaveAsync(owner, competitionId, "Before upgrade");
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.StartingPoints.CountAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE StartingPoints");

        await DbInitializer.SeedAsync(_f.Services);
        db.StartingPoints.Add(new StartingPoint { Name = "After upgrade", OwnerUserId = userId, SetupJson = "{}" });
        await db.SaveChangesAsync();

        Assert.Equal("After upgrade", await db.StartingPoints.Select(p => p.Name).SingleAsync());
        Assert.True(rows >= 1);
    }

    [Fact]
    public async Task DeletingAnAccountRemovesItsStartingPoints()
    {
        var (owner, userId, competitionId) = await ArrangeAsync();
        var saved = await SaveAsync(owner, competitionId);
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Identity.UserManager<AppUser>>();

        await new AccountDeletionService(db, users).DeleteAsync((await users.FindByIdAsync(userId))!);

        Assert.False(await db.StartingPoints.AnyAsync(p => p.Id == saved.Id));
    }

    [Theory]
    [InlineData("2026-07-17T23:00:00Z")] // UK midnight BST for 2026-07-18
    [InlineData("2026-07-18T00:00:00Z")] // UTC midnight date-only anchor for 2026-07-18
    public void OffsetMinutes_PreservesMorningWallClockAcrossBstAndUtcMidnightAnchors(string startIso)
    {
        var startDate = DateTime.Parse(startIso, null, System.Globalization.DateTimeStyles.AdjustToUniversal);
        var scheduledMorning = new DateTime(2026, 7, 18, 8, 0, 0, DateTimeKind.Utc); // 09:00 BST

        var offset = MountedGames.Api.Services.EventTools.CompetitionSetup.OffsetMinutesFromStart(scheduledMorning, startDate);
        Assert.Equal(9 * 60, offset);

        // Applying to a winter GMT date (both 00:00Z and 00:00 GMT) yields 09:00 UTC.
        var winterStart = new DateTime(2026, 12, 5, 0, 0, 0, DateTimeKind.Utc);
        Assert.Equal(
            new DateTime(2026, 12, 5, 9, 0, 0, DateTimeKind.Utc),
            MountedGames.Api.Services.EventTools.CompetitionSetup.ApplyOffsetMinutes(winterStart, offset));

        // Applying to a summer BST date (whether anchored at 23:00Z or 00:00Z) yields 08:00 UTC (09:00 BST).
        var summerUtcMidnight = new DateTime(2027, 7, 17, 0, 0, 0, DateTimeKind.Utc);
        var summerBstMidnight = new DateTime(2027, 7, 16, 23, 0, 0, DateTimeKind.Utc);
        Assert.Equal(
            new DateTime(2027, 7, 17, 8, 0, 0, DateTimeKind.Utc),
            MountedGames.Api.Services.EventTools.CompetitionSetup.ApplyOffsetMinutes(summerUtcMidnight, offset));
        Assert.Equal(
            new DateTime(2027, 7, 17, 8, 0, 0, DateTimeKind.Utc),
            MountedGames.Api.Services.EventTools.CompetitionSetup.ApplyOffsetMinutes(summerBstMidnight, offset));

        // When both ScheduledStart and StartDate are 00:00:00Z on a BST date, offset is 0, not +60m.
        var utcMidnight = new DateTime(2026, 7, 18, 0, 0, 0, DateTimeKind.Utc);
        Assert.Equal(0, MountedGames.Api.Services.EventTools.CompetitionSetup.OffsetMinutesFromStart(utcMidnight, utcMidnight));
    }
}
