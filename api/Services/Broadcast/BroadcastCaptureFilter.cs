using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Broadcast;

/// <summary>
/// Capture active outputs after a successful controller mutation has committed. Reads use a separate consistent
/// transaction, so an intervening correction becomes a later observation, never a falsely backdated one.
/// Polling repairs a missed capture; clients stay transparent if the required delayed baseline is unavailable.
/// </summary>
public sealed class BroadcastCaptureFilter(AppDbContext db, BroadcastService broadcast, TimeProvider time,
    ILogger<BroadcastCaptureFilter> logger, MountedGames.Api.Services.Apple.AppleDeliveryRunner apple) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var result = await next();
        if (HttpMethods.IsGet(context.HttpContext.Request.Method) || HttpMethods.IsHead(context.HttpContext.Request.Method)
            || result.Exception is not null || (result.Result as ObjectResult)?.StatusCode is >= 400
            || (result.Result as StatusCodeResult)?.StatusCode is >= 400 || db.Database.CurrentTransaction is not null) return;
        try
        {
            var ids = new HashSet<int>();
            foreach (var entity in db.ChangeTracker.Entries().Select(e => e.Entity))
            {
                var id = entity switch { Competition x => x.Id, CompetitionSection x => x.CompetitionId,
                    Session x => x.CompetitionId, Team x => x.CompetitionId, StreamOverlay x => x.CompetitionId,
                    Sponsor x => x.CompetitionId, BroadcastCue x => x.CompetitionId, _ => 0 };
                if (id > 0) ids.Add(id);
            }
            if (context.RouteData.Values.TryGetValue("competitionId", out var routeId) && int.TryParse(routeId?.ToString(), out var competitionId)) ids.Add(competitionId);
            var races = db.ChangeTracker.Entries<Race>().Select(e => e.Entity.Id)
                .Concat(db.ChangeTracker.Entries<Result>().Select(e => e.Entity.RaceId)).Distinct().ToList();
            if (races.Count > 0)
                foreach (var id in await db.Races.AsNoTracking().Where(r => races.Contains(r.Id)).Select(r => r.Heat!.Session!.CompetitionId).Distinct().ToListAsync()) ids.Add(id);
            if (ids.Count == 0) return;
            foreach (var id in ids) await apple.InvalidateCompetitionAsync(id);
            var cutoff = time.GetUtcNow().UtcDateTime.AddSeconds(-BroadcastService.MaxDelaySeconds - 45);
            var active = await db.Set<BroadcastSnapshot>().AsNoTracking().Where(s => ids.Contains(s.CompetitionId) && s.ObservedAt >= cutoff)
                .Select(s => new { s.CompetitionId, s.Arena, s.SectionKey }).Distinct().ToListAsync();
            foreach (var output in active)
                if (await broadcast.ValidArenaAsync(output.CompetitionId, output.Arena, output.SectionKey == 0 ? null : output.SectionKey, default))
                    await broadcast.ReadAsync(output.CompetitionId, output.Arena, output.SectionKey == 0 ? null : output.SectionKey, 0, default, force: true);
        }
        catch (Exception ex)
        {
            // The authorised mutation has already committed; do not invite users to submit it a second time.
            logger.LogWarning(ex, "Event display refresh was deferred; polling and durable delivery will reconcile it.");
        }
    }
}
