using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services.Notifications;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Security;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{competitionId:int}/heat-calls")]
public class HeatCallsController(AppDbContext db, ReminderRunner reminders, ILiveBroadcaster live, ILogger<HeatCallsController> logger) : ControllerBase
{
    [HttpGet, AllowAnonymous, PublicRead, EnableRateLimiting("public-read")]
    public async Task<IReadOnlyList<HeatCallDto>> List(int competitionId, CancellationToken ct) =>
        await db.Set<HeatCall>().AsNoTracking().Where(x => x.Heat!.Session!.CompetitionId == competitionId
            && x.Heat.StartedAt == null && x.Heat.FinishedAt == null && !x.Heat.Races.Any(r => r.StartedAt != null || r.IsComplete))
            .Select(x => new HeatCallDto(x.HeatId, x.CalledAt)).ToListAsync(ct);

    [HttpPost("{heatId:int}"), Authorize(Policy = CompetitionStaff.Policy), CompetitionAccess("competitionId")]
    public async Task<ActionResult<HeatCallDto>> Call(int competitionId, int heatId, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        var result = await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var locked = await db.Heats.Where(h => h.Id == heatId && h.Session!.CompetitionId == competitionId)
                .ExecuteUpdateAsync(s => s.SetProperty(h => h.StartedAt, h => h.StartedAt), ct);
            if (locked == 0) return (Kind: "missing", Dto: (HeatCallDto?)null, Teams: Array.Empty<int>(), Label: "");
            var heat = await db.Heats.Include(h => h.Session).Include(h => h.Entries).Include(h => h.Races).SingleAsync(h => h.Id == heatId, ct);
            if (heat.StartedAt.HasValue || heat.FinishedAt.HasValue || heat.Races.Any(r => r.StartedAt.HasValue || r.IsComplete))
                return (Kind: "started", Dto: (HeatCallDto?)null, Teams: Array.Empty<int>(), Label: "");
            var previous = await db.Set<HeatCall>().FindAsync([heatId], ct);
            if (previous is not null) return (Kind: "replayed", Dto: (HeatCallDto?)new HeatCallDto(heatId, previous.CalledAt), Teams: Array.Empty<int>(), Label: "");
            var call = new HeatCall { HeatId = heatId, CalledAt = DateTime.UtcNow };
            db.Add(call);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return (Kind: "created", Dto: (HeatCallDto?)new HeatCallDto(heatId, call.CalledAt),
                Teams: heat.Entries.Select(e => e.TeamId).Distinct().ToArray(),
                Label: $"{heat.Label ?? $"Heat {heat.OrderIndex}"} · {heat.Session!.Name} · {heat.Session.ArenaName ?? "Main Arena"}");
        });
        if (result.Kind == "missing") return NotFound();
        if (result.Kind == "started") return Conflict(new { message = "This heat has already started." });
        // The heat-call row is the durable notification source. A later scheduler pass recovers
        // an interrupted delivery, and accepted destinations are never deliberately sent again.
        try
        {
            var session = await db.Sessions.AsNoTracking().Include(s => s.Section)
                .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
                .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(r => r.Team)
                .SingleAsync(s => s.Heats.Any(h => h.Id == heatId), ct);
            await live.SessionUpdated(competitionId, session.ToDto());
            await reminders.RunAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Heat call {HeatId} saved; live delivery will be retried", heatId);
        }
        return Ok(result.Dto);
    }
}
