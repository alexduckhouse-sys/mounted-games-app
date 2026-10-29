using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Security;
using MountedGames.Api.Services.Broadcast;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{competitionId:int}/broadcast-snapshot")]
public sealed class BroadcastController(AppDbContext db, BroadcastService broadcast, TimeProvider time) : ControllerBase
{
    [HttpGet, AllowAnonymous, PublicRead, EnableRateLimiting("public-read")]
    public async Task<ActionResult<BroadcastSnapshotDto>> Get(int competitionId, [FromQuery] string arena,
        [FromQuery] int delay = 0, [FromQuery] int? section = null, CancellationToken ct = default)
    {
        Response.Headers.CacheControl = "no-store";
        if (delay is < 0 or > BroadcastService.MaxDelaySeconds) return BadRequest(new { message = "Video delay must be between 0 and 120 seconds." });
        if (!await broadcast.ValidArenaAsync(competitionId, arena, section, ct)) return NotFound();
        return await broadcast.ReadAsync(competitionId, arena, section, delay, ct);
    }

    [HttpPut("visibility"), Authorize(Policy = CompetitionStaff.Policy), CompetitionAccess("competitionId")]
    public async Task<IActionResult> Visibility(int competitionId, BroadcastVisibilityRequest req, CancellationToken ct)
    {
        if (!await broadcast.ValidArenaAsync(competitionId, req.Arena, null, ct)) return NotFound();
        var row = await db.Set<BroadcastOutput>().SingleOrDefaultAsync(x => x.CompetitionId == competitionId && x.Arena == req.Arena, ct);
        if (req.ExpectedRevision is { } expected && expected != (row?.Revision ?? 0)) return Conflict(new { message = "The graphics have changed. Refresh and try again." });
        if (row is null) { row = new() { CompetitionId = competitionId, Arena = req.Arena }; db.Add(row); }
        row.Hidden = req.Hidden;
        row.DiscardBefore = time.GetUtcNow().UtcDateTime;
        row.Revision++;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return Conflict(new { message = "The graphics have changed. Refresh and try again." }); }
        return Ok(new { row.Hidden, row.Revision });
    }
}
