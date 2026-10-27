using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Operations;

namespace MountedGames.Api.Controllers;

/// <summary>
/// The protest and referee-decision log, for the competition's staff only (scorer links never reach it). The
/// reasons, names and decisions here are never public: the public only sees a race marked under review.
/// </summary>
[ApiController]
[Route("api/competitions/{competitionId:int}/protests")]
[Authorize(Policy = CompetitionStaff.Policy)]
public class ProtestsController(AppDbContext db, ILiveBroadcaster live) : ControllerBase
{
    private string? ActorId => User.FindFirstValue(ClaimTypes.NameIdentifier);

    [HttpGet]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IReadOnlyList<ProtestDto>>> List(int competitionId,
        [FromQuery] bool open = false, [FromQuery] int? heatId = null, [FromQuery] int? raceId = null,
        CancellationToken ct = default)
        => Ok(await new ProtestService(db).ListAsync(competitionId, open, heatId, raceId, ct));

    [HttpPost]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<ProtestDto>> Create(int competitionId, CreateProtestRequest request, CancellationToken ct)
        => Write(competitionId, () => new ProtestService(db).CreateAsync(competitionId, request, ActorId, ct));

    [HttpPost("{protestId:int}/decision")]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<ProtestDto>> Decide(int competitionId, int protestId, DecideProtestRequest request, CancellationToken ct)
        => Write(competitionId, () => new ProtestService(db).DecideAsync(competitionId, protestId, request, ActorId, ct));

    [HttpPost("{protestId:int}/withdraw")]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<ProtestDto>> Withdraw(int competitionId, int protestId, WithdrawProtestRequest request, CancellationToken ct)
        => Write(competitionId, () => new ProtestService(db).WithdrawAsync(competitionId, protestId, request, ActorId, ct));

    private async Task<ActionResult<ProtestDto>> Write(int competitionId, Func<Task<ProtestChange>> action)
    {
        ProtestChange change;
        try { change = await action(); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ProtestValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (ProtestConflictException ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (ScoringController.IsScoringConcurrency(ex))
        { return Conflict(new { message = "This changed on another device. Refresh and try again." }); }

        // Staff re-read the list; the payload carries nothing but the competition id.
        await live.ProtestsChanged(competitionId);
        if (change.FlagsChanged)
        {
            // Everyone else sees the heat's races marked (or no longer marked) under review, and nothing more.
            var heat = await db.Heats.AsNoTracking()
                .Include(h => h.Entries).ThenInclude(e => e.Team)
                .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
                .FirstAsync(h => h.Id == change.HeatId);
            await live.ResultsUpdated(competitionId, new { sessionId = change.SessionId, heat = heat.ToDto() });
        }
        return change.Protest;
    }
}
