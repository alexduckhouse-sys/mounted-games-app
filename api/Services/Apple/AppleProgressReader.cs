using System.Data;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
namespace MountedGames.Api.Services.Apple;
public sealed class AppleProgressReader(AppDbContext db, TimeProvider clock)
{
    public Task<TeamProgressSnapshotDto?> ReadAsync(int competitionId, int teamId, CancellationToken ct) => db.Database.CreateExecutionStrategy().ExecuteAsync<TeamProgressSnapshotDto?>(async () =>
    {
        await using var tx = await db.Database.BeginTransactionAsync(db.Database.IsNpgsql() ? IsolationLevel.RepeatableRead : IsolationLevel.Serializable, ct);
        var team = await db.Teams.AsNoTracking().Include(x => x.Section).SingleOrDefaultAsync(x => x.Id == teamId && x.CompetitionId == competitionId, ct);
        if (team == null) return null;
        var sessions = await db.Sessions.AsNoTracking().AsSplitQuery().Where(x => x.CompetitionId == competitionId)
            .Include(x => x.Heats).ThenInclude(x => x.Entries).Include(x => x.Heats).ThenInclude(x => x.Races).ToListAsync(ct);
        var progress = TeamProgress.Calculate(team, team.Section, sessions, true); var now = clock.GetUtcNow();
        await tx.CommitAsync(ct); return new(progress, now, now.AddMinutes(5));
    });
}
