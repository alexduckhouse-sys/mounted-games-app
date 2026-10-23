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
        var book = new Rulebook { CompetitionId = competitionId, Title = "Synthetic rules", Edition = "2030", Text = "Plain text rules." };
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
}
