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
/// Withdrawals, no-shows, the re-draw of unscored heats that follows, and rider swaps. For the competition's
/// staff only: the reasons and rider names here are never public. The public timetable just shows the
/// heats that are left.
/// </summary>
[ApiController]
[Route("api/competitions/{competitionId:int}")]
[Authorize(Policy = CompetitionStaff.Policy)]
public class WithdrawalsController(AppDbContext db, ILiveBroadcaster live) : ControllerBase
{
    private string? ActorId => User.FindFirstValue(ClaimTypes.NameIdentifier);

    [HttpGet("entries")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IReadOnlyList<TeamEntryDto>>> Entries(int competitionId, CancellationToken ct)
    {
        try { return Ok(await new TeamEntryService(db).ListAsync(competitionId, ct)); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    [HttpPut("teams/{teamId:int}/entry-status")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SetTeamEntryStatusResult>> SetEntryStatus(
        int competitionId, int teamId, SetTeamEntryStatusRequest request, CancellationToken ct)
    {
        try
        {
            var result = await new TeamEntryService(db).SetStatusAsync(competitionId, teamId, request, ActorId, ct);
            await BroadcastAsync(competitionId, result.ChangedSessionIds);
            return result;
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (EntryValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (DrawValidationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpGet("sections/{sectionId:int}/redraw/preview")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<RedrawPreviewDto>> PreviewRedraw(int competitionId, int sectionId, CancellationToken ct)
    {
        try { return await new WithdrawalRedrawService(db).PreviewAsync(competitionId, sectionId, ct); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    [HttpPost("sections/{sectionId:int}/redraw/apply")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<RedrawPreviewDto>> ApplyRedraw(
        int competitionId, int sectionId, ApplyRedrawRequest request, CancellationToken ct)
    {
        try
        {
            var (preview, sessionIds) = await new WithdrawalRedrawService(db)
                .ApplyAsync(competitionId, sectionId, request, ActorId, ct);
            // A retry broadcasts again: a phone that missed the first message catches up.
            await BroadcastAsync(competitionId, sessionIds);
            return preview;
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (EntryValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (DrawChangedException ex) { return Conflict(new { message = ex.Message }); }
        catch (DrawValidationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPost("declaration-forms/{formId:int}/swap")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<RiderSwapDto>> SwapRider(
        int competitionId, int formId, SwapRiderRequest request, CancellationToken ct)
    {
        try { return await new RiderSwapService(db).SwapAsync(competitionId, formId, request, ActorId, ct); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (EntryValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (DeclarationLockedException ex) { return Conflict(new { message = ex.Message, locked = true }); }
        catch (DrawValidationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpGet("declaration-forms/{formId:int}/swaps")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IReadOnlyList<RiderSwapDto>>> Swaps(int competitionId, int formId, CancellationToken ct)
    {
        try { return Ok(await new RiderSwapService(db).HistoryAsync(competitionId, formId, ct)); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    /// <summary>Tells every phone watching this competition that these sessions changed.</summary>
    private async Task BroadcastAsync(int competitionId, IEnumerable<int> sessionIds)
    {
        var ids = sessionIds.Distinct().ToList();
        if (ids.Count == 0) return;
        var sessions = await db.Sessions.AsNoTracking()
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .Where(s => s.CompetitionId == competitionId && ids.Contains(s.Id))
            .ToListAsync();
        foreach (var session in sessions.OrderBy(s => s.OrderIndex))
            await live.SessionUpdated(competitionId, session.ToDto());
    }
}
