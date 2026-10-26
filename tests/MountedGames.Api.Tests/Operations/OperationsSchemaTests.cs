using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class OperationsSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public OperationsSchemaTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task ExistingSqliteDatabaseGainsOperationsTablesWithoutLosingResults()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var competitionId = await db.Competitions.Select(x => x.Id).FirstAsync();
        var raceId = await db.Races.Select(x => x.Id).FirstAsync();
        var results = await db.Results.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Points }).ToListAsync();
        var competitionCount = await db.Competitions.CountAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE RaceScoreEvent; DROP TABLE RaceScoreState; DROP TABLE EquipmentAcknowledgement; DROP TABLE Rulebook;");

        await DbInitializer.SeedAsync(_factory.Services);
        var book = new Rulebook { Title = "Synthetic rules", Edition = "2030", Text = "Plain text rules." };
        db.Add(book);
        db.Add(new EquipmentAcknowledgement { CompetitionId = competitionId, ItemKey = "test-item" });
        db.Add(new RaceScoreState { RaceId = raceId, Revision = 1 });
        db.Add(new RaceScoreEvent { RaceId = raceId, Revision = 1, RequestId = "schema-check", Reason = "Synthetic record" });
        await db.SaveChangesAsync();
        await DbInitializer.SeedAsync(_factory.Services);
        db.ChangeTracker.Clear();

        Assert.True(book.Id > 0);
        Assert.Equal("Plain text rules.", (await db.Set<Rulebook>().SingleAsync()).Text);
        Assert.Single(await db.Set<EquipmentAcknowledgement>().ToListAsync());
        Assert.Single(await db.Set<RaceScoreState>().ToListAsync());
        Assert.Single(await db.Set<RaceScoreEvent>().ToListAsync());
        Assert.Equal(competitionCount, await db.Competitions.CountAsync());
        Assert.Equal(results, await db.Results.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Points }).ToListAsync());
    }

    [Fact]
    public async Task PerCompetitionRulebooksBecomeSharedKeepingTheNewestCopy()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("""
            DROP TABLE Rulebook;
            CREATE TABLE "Rulebook" ("Id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "CompetitionId" INTEGER NOT NULL, "Title" TEXT NOT NULL, "Edition" TEXT NOT NULL, "SourceUrl" TEXT, "Text" TEXT NOT NULL, "UpdatedAt" TEXT NOT NULL, "UpdatedByUserId" TEXT);
            CREATE UNIQUE INDEX "IX_Rulebook_CompetitionId_Title_Edition" ON "Rulebook" ("CompetitionId", "Title", "Edition");
            INSERT INTO "Rulebook" ("CompetitionId", "Title", "Edition", "Text", "UpdatedAt") VALUES
                (1, 'Handbook', '2030', 'older copy', '2030-01-01 10:00:00'),
                (2, 'Handbook', '2030', 'newer copy', '2030-02-01 10:00:00'),
                (2, 'Games guide', '1', 'only copy', '2030-01-05 10:00:00');
            """);

        await DbInitializer.SeedAsync(_factory.Services);
        db.ChangeTracker.Clear();

        var books = await db.Set<Rulebook>().AsNoTracking().OrderBy(x => x.Title).ToListAsync();
        Assert.Equal(new[] { "only copy", "newer copy" }, books.Select(x => x.Text));
        Assert.Equal(0, await db.Database.SqlQueryRaw<int>("""SELECT COUNT(*) AS "Value" FROM pragma_table_info('Rulebook') WHERE name = 'CompetitionId'""").SingleAsync());
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsWithdrawalTablesAndColumnWithoutLosingTeams()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var teams = await db.Teams.AsNoTracking().OrderBy(t => t.Id).Select(t => new { t.Id, t.DisplayName }).ToListAsync();
        var teamId = teams[0].Id;
        var competitionId = await db.Teams.Where(t => t.Id == teamId).Select(t => t.CompetitionId).SingleAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE TeamStatusEvent; DROP TABLE DrawChange; DROP TABLE RiderSwapEvent; ALTER TABLE Teams DROP COLUMN EntryStatus;");

        await DbInitializer.SeedAsync(_factory.Services);
        db.ChangeTracker.Clear();
        var team = await db.Teams.SingleAsync(t => t.Id == teamId);
        team.EntryStatus = Entities.TeamEntryStatus.NoShow;
        db.Add(new TeamStatusEvent { CompetitionId = competitionId, TeamId = teamId, Status = Entities.TeamEntryStatus.NoShow, Reason = "Synthetic" });
        db.Add(new DrawChange { CompetitionId = competitionId, SectionId = team.CompetitionSectionId, Kind = DrawChangeKind.Redraw, RequestId = "schema-check", Fingerprint = "f" });
        await db.SaveChangesAsync();
        await DbInitializer.SeedAsync(_factory.Services);
        db.ChangeTracker.Clear();

        Assert.Equal(Entities.TeamEntryStatus.NoShow, (await db.Teams.SingleAsync(t => t.Id == teamId)).EntryStatus);
        Assert.Single(await db.Set<TeamStatusEvent>().ToListAsync());
        Assert.Single(await db.Set<DrawChange>().ToListAsync());
        Assert.Empty(await db.Set<RiderSwapEvent>().ToListAsync());
        Assert.Equal(teams, await db.Teams.AsNoTracking().OrderBy(t => t.Id).Select(t => new { t.Id, t.DisplayName }).ToListAsync());
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsVolunteerTablesAndLorryColumnsWithoutLosingCompetitions()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var competitions = await db.Competitions.AsNoTracking().OrderBy(c => c.Id).Select(c => new { c.Id, c.Name }).ToListAsync();
        var competitionId = competitions[0].Id;
        var userId = await db.Users.Select(u => u.Id).FirstAsync();
        await db.Database.ExecuteSqlRawAsync("""
            DROP TABLE VolunteerClaim;
            DROP TABLE VolunteerShift;
            ALTER TABLE Competitions DROP COLUMN LorryWhat3Words;
            ALTER TABLE Competitions DROP COLUMN LorryLatitude;
            ALTER TABLE Competitions DROP COLUMN LorryLongitude;
            ALTER TABLE Competitions DROP COLUMN LorryDirectionsNote;
            """);

        await DbInitializer.SeedAsync(_factory.Services);
        db.ChangeTracker.Clear();
        var comp = await db.Competitions.SingleAsync(c => c.Id == competitionId);
        comp.LorryWhat3Words = "///lorry.gate.entry";
        comp.LorryLatitude = 51.5;
        comp.LorryLongitude = -1.2;
        comp.LorryDirectionsNote = "Enter via Gate B";
        var shift = new VolunteerShift { CompetitionId = competitionId, Role = "Arena Party", RequiredCount = 2 };
        db.VolunteerShifts.Add(shift);
        await db.SaveChangesAsync();
        db.VolunteerClaims.Add(new VolunteerClaim { ShiftId = shift.Id, UserId = userId, VolunteerName = "Sam Volunteer" });
        await db.SaveChangesAsync();
        await DbInitializer.SeedAsync(_factory.Services);
        db.ChangeTracker.Clear();

        var reloaded = await db.Competitions.SingleAsync(c => c.Id == competitionId);
        Assert.Equal("///lorry.gate.entry", reloaded.LorryWhat3Words);
        Assert.Equal(51.5, reloaded.LorryLatitude);
        Assert.Equal(-1.2, reloaded.LorryLongitude);
        Assert.Equal("Enter via Gate B", reloaded.LorryDirectionsNote);
        Assert.Single(await db.VolunteerShifts.ToListAsync());
        Assert.Single(await db.VolunteerClaims.ToListAsync());
        Assert.Equal(competitions, await db.Competitions.AsNoTracking().OrderBy(c => c.Id).Select(c => new { c.Id, c.Name }).ToListAsync());
    }
}
