using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Services;

public class CompetitionReadRevisionSchemaTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private Task<(long Local, long Shared)> Version(int id, bool detail = false)
        => factory.InDbAsync(db => CompetitionSnapshotCache.VersionAsync(db, id, detail, default));

    [Fact]
    public async Task BulkMovesInvalidateOldAndNewCompetitions_AndRollbackDoesNotPublishRevision()
    {
        var a = await factory.CreateArenaAsync(1);
        var b = await factory.CreateArenaAsync(1);
        var (_, races) = await factory.AddHeatAsync(a.SessionId, a.TeamIds, "Synthetic heat", 1, 1);
        var resultId = await factory.InDbAsync(async db =>
        {
            var result = new Result { RaceId = races[0], TeamId = a.TeamIds[0], Points = 1 };
            db.Add(result); await db.SaveChangesAsync(); return result.Id;
        });
        var beforeA = await Version(a.CompetitionId);
        var beforeB = await Version(b.CompetitionId);
        await factory.InDbAsync(async db =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Results.Where(r => r.Id == resultId).ExecuteUpdateAsync(s => s.SetProperty(r => r.TeamId, b.TeamIds[0]));
            Assert.True((await CompetitionSnapshotCache.VersionAsync(db, b.CompetitionId, false, default)).Local > beforeB.Local);
            await tx.RollbackAsync();
        });
        Assert.Equal(beforeA, await Version(a.CompetitionId));
        Assert.Equal(beforeB, await Version(b.CompetitionId));
        await factory.InDbAsync(db => db.Results.Where(r => r.Id == resultId).ExecuteUpdateAsync(s => s.SetProperty(r => r.TeamId, b.TeamIds[0])));
        Assert.True((await Version(a.CompetitionId)).Local > beforeA.Local);
        Assert.True((await Version(b.CompetitionId)).Local > beforeB.Local);
        beforeA = await Version(a.CompetitionId);
        beforeB = await Version(b.CompetitionId);
        await factory.InDbAsync(db => db.Results.Where(r => r.Id == resultId).ExecuteDeleteAsync());
        Assert.True((await Version(a.CompetitionId)).Local > beforeA.Local);
        Assert.True((await Version(b.CompetitionId)).Local > beforeB.Local);
    }

    [Fact]
    public async Task StandingsDependenciesAreScoped_AndDetailOnlyWritesDoNotFlushStandings()
    {
        var a = await factory.CreateArenaAsync(1);
        var untouched = await factory.SeedCompetitionAsync();
        var (heat, races) = await factory.AddHeatAsync(a.SessionId, a.TeamIds, "Synthetic heat", 1, 1);
        var user = await factory.TrainerIdAsync();
        var ids = await factory.InDbAsync(async db =>
        {
            var signup = new SectionSignup { CompetitionSectionId = a.SectionId, FullName = "Synthetic entrant" };
            var tack = new TackCheckSection { CompetitionId = a.CompetitionId, CompetitionSectionId = a.SectionId, IsEnabled = true, Mode = TackCheckMode.BonusPoints,
                Sectors = [new TackCheckSector { Name = "Synthetic sector" }] };
            var order = new EventOrder { CompetitionId = a.CompetitionId, BuyerUserId = user, IdempotencyKey = Guid.NewGuid().ToString(),
                Lines = [new EventOrderLine { TitleSnapshot = "Stable", Quantity = 1, SellerUserId = user }] };
            db.AddRange(signup, tack, order, new CompetitionEntrySettings { CompetitionId = a.CompetitionId, MaxStables = 20 },
                new EventCommerceSettings { CompetitionId = a.CompetitionId },
                new FinalsTieOrder { CompetitionId = a.CompetitionId, TeamId = a.TeamIds[0], Position = 1 });
            await db.SaveChangesAsync();
            var sector = tack.Sectors.Single();
            db.AddRange(new SignupExtras { SignupId = signup.Id }, new SignupMatchmaking { SignupId = signup.Id },
                new TackCheckMark { TeamId = a.TeamIds[0], TackCheckSectorId = sector.Id, Points = 2 });
            await db.SaveChangesAsync();
            return (Signup: signup.Id, Tack: tack.Id, Sector: sector.Id, Order: order.Id, Line: order.Lines.Single().Id);
        });
        async Task Change(Func<AppDbContext, Task> write, bool standings = true, bool detail = true)
        {
            var s = await Version(a.CompetitionId); var d = await Version(a.CompetitionId, true); var other = await Version(untouched, true);
            await factory.InDbAsync(write);
            Assert.Equal(standings, (await Version(a.CompetitionId)).Local > s.Local);
            Assert.Equal(detail, (await Version(a.CompetitionId, true)).Local > d.Local);
            Assert.Equal(other.Local, (await Version(untouched, true)).Local);
        }
        await Change(db => db.CompetitionSections.Where(s => s.Id == a.SectionId).ExecuteUpdateAsync(s => s.SetProperty(x => x.CarryPointsIntoFinal, false)));
        await Change(db => db.Teams.Where(t => t.Id == a.TeamIds[0]).ExecuteUpdateAsync(s => s.SetProperty(t => t.BibDescription, "[card:yellow]")));
        await Change(db => db.Sessions.Where(s => s.Id == a.SessionId).ExecuteUpdateAsync(s => s.SetProperty(x => x.OrderIndex, 3)));
        await Change(db => db.Heats.Where(h => h.Id == heat).ExecuteUpdateAsync(s => s.SetProperty(h => h.Label, "A Final")));
        await Change(db => db.HeatEntries.Where(e => e.HeatId == heat).ExecuteUpdateAsync(s => s.SetProperty(e => e.LaneIndex, 2)));
        await Change(db => db.Races.Where(r => r.Id == races[0]).ExecuteUpdateAsync(s => s.SetProperty(r => r.IsComplete, true)));
        await Change(db => db.Set<FinalsTieOrder>().Where(t => t.CompetitionId == a.CompetitionId).ExecuteDeleteAsync(), detail: false);
        await Change(db => db.Set<TackCheckSection>().Where(t => t.Id == ids.Tack).ExecuteUpdateAsync(s => s.SetProperty(t => t.IsEnabled, false)), detail: false);
        await Change(db => db.Set<TackCheckSector>().Where(t => t.Id == ids.Sector).ExecuteUpdateAsync(s => s.SetProperty(t => t.Name, "Other sector")), detail: false);
        await Change(db => db.Set<TackCheckMark>().Where(t => t.TeamId == a.TeamIds[0]).ExecuteDeleteAsync(), detail: false);
        await Change(db => db.SectionSignups.Where(s => s.Id == ids.Signup).ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, SignupPaymentStatus.Cancelled)), standings: false);
        await Change(db => db.Set<SignupExtras>().Where(s => s.SignupId == ids.Signup).ExecuteUpdateAsync(s => s.SetProperty(x => x.TeamsCount, 3)), standings: false);
        await Change(db => db.Set<SignupMatchmaking>().Where(s => s.SignupId == ids.Signup).ExecuteUpdateAsync(s => s.SetProperty(x => x.WaitingForGuestSpot, true)), standings: false);
        await Change(db => db.Set<CompetitionEntrySettings>().Where(s => s.CompetitionId == a.CompetitionId).ExecuteUpdateAsync(s => s.SetProperty(x => x.MaxStables, 30)), standings: false);
        await Change(db => db.Set<EventCommerceSettings>().Where(s => s.CompetitionId == a.CompetitionId).ExecuteUpdateAsync(s => s.SetProperty(x => x.IsDemo, true)), standings: false);
        await Change(db => db.Set<EventOrder>().Where(s => s.Id == ids.Order).ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, CommerceOrderStatus.Cancelled)), standings: false);
        await Change(db => db.Set<EventOrderLine>().Where(s => s.Id == ids.Line).ExecuteUpdateAsync(s => s.SetProperty(x => x.Quantity, 2)), standings: false);
    }

    [Fact]
    public async Task HeartbeatsAndSessionRevocationDoNotInvalidate_PublicUserAndClubEditsDo()
    {
        var a = await factory.CreateArenaAsync(1);
        var user = await factory.TrainerIdAsync();
        var before = await Version(a.CompetitionId, true);
        var standing = await Version(a.CompetitionId);
        await factory.InDbAsync(async db =>
        {
            var stream = new LiveStream { CompetitionId = a.CompetitionId, StartedByUserId = user };
            db.Add(stream); await db.SaveChangesAsync();
            stream.LastHeartbeatAt = DateTime.UtcNow; await db.SaveChangesAsync();
            await db.Users.Where(u => u.Id == user).ExecuteUpdateAsync(s => s.SetProperty(u => u.SessionVersion, u => u.SessionVersion + 1));
        });
        Assert.Equal(before, await Version(a.CompetitionId, true));
        await factory.InDbAsync(db => db.Users.Where(u => u.Id == user).ExecuteUpdateAsync(s => s.SetProperty(u => u.FullName, "Synthetic new display")));
        Assert.True((await Version(a.CompetitionId, true)).Shared > before.Shared);
        Assert.Equal(standing, await Version(a.CompetitionId));
        var club = await factory.InDbAsync(db => db.Teams.Where(t => t.Id == a.TeamIds[0]).Select(t => t.ClubId).SingleAsync());
        await factory.InDbAsync(db => db.Clubs.Where(c => c.Id == club).ExecuteUpdateAsync(s => s.SetProperty(c => c.Name, "Synthetic renamed club")));
        Assert.True((await Version(a.CompetitionId)).Local > standing.Local);
    }

    [Fact]
    public async Task ExistingSqliteDatabaseUpgradesIdempotentlyWithoutChangingResults()
    {
        await factory.InDbAsync(async db =>
        {
            var results = await db.Results.AsNoTracking().Select(r => new { r.Id, r.TeamId, r.Points }).OrderBy(r => r.Id).ToListAsync();
            var names = await db.Database.SqlQueryRaw<string>("SELECT name AS Value FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'mg_read_revision_%'").ToListAsync();
            foreach (var name in names) await db.Database.ExecuteSqlRawAsync("DROP TRIGGER \"" + name.Replace("\"", "\"\"") + "\"");
            await db.Database.ExecuteSqlRawAsync("DROP TABLE CompetitionReadRevisions");
            await DbInitializer.SeedAsync(factory.Services);
            await CompetitionReadRevisionSchemaV1.EnsureSqliteAsync(db);
            Assert.Equal(results, await db.Results.AsNoTracking().Select(r => new { r.Id, r.TeamId, r.Points }).OrderBy(r => r.Id).ToListAsync());
            var c = new Competition { Name = "Synthetic upgraded", StartDate = DateTime.UtcNow };
            db.Add(c); await db.SaveChangesAsync();
            Assert.True((await CompetitionSnapshotCache.VersionAsync(db, c.Id, false, default)).Local > 0);
        });
    }
}
