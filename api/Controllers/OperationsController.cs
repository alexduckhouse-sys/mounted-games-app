using MountedGames.Api.Security;
using Microsoft.AspNetCore.RateLimiting;
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

[ApiController]
[Route("api/competitions/{competitionId:int}")]
[Authorize(Policy = CompetitionStaff.Policy)]
public class OperationsController(
    AppDbContext db, EquipmentCalculator equipmentCalculator, ILiveBroadcaster live) : ControllerBase
{
    [HttpGet("draw-undo")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<DrawUndoStatusDto>> GetDrawUndo(
        int competitionId, CancellationToken cancellationToken)
    {
        var exists = await db.Competitions.AsNoTracking()
            .AnyAsync(c => c.Id == competitionId, cancellationToken);
        if (!exists) return NotFound();
        return await DrawUndoService.GetStatusAsync(db, competitionId, cancellationToken);
    }

    [HttpPost("draw-undo")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<DrawUndoResultDto>> UndoDraw(
        int competitionId, CancellationToken cancellationToken)
    {
        try
        {
            var (result, changedSessionIds) = await DrawUndoService.UndoAsync(db, competitionId, cancellationToken);
            if (changedSessionIds.Count > 0)
            {
                var updatedSessions = await db.Sessions
                    .Include(s => s.Section)
                    .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
                    .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
                    .Where(s => s.CompetitionId == competitionId && changedSessionIds.Contains(s.Id))
                    .ToListAsync(cancellationToken);
                foreach (var session in updatedSessions)
                    await live.SessionUpdated(competitionId, session.ToDto());
            }
            return result;
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }
    [HttpPost("sections/{sectionId:int}/draw/preview")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<DrawPreviewDto>> PreviewDraw(
        int competitionId, int sectionId, DrawRequest request, CancellationToken cancellationToken)
    {
        try
        {
            return await new CompetitionDrawService(db)
                .PreviewAsync(competitionId, sectionId, request.Seed, cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (DrawValidationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPost("sections/{sectionId:int}/draw/apply")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<DrawPreviewDto>> ApplyDraw(
        int competitionId, int sectionId, ApplyDrawRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Fingerprint))
            return BadRequest(new { message = "A preview fingerprint is required." });
        try
        {
            return await new CompetitionDrawService(db)
                .ApplyAsync(competitionId, sectionId, request, cancellationToken, User.FindFirstValue(ClaimTypes.NameIdentifier));
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (DrawChangedException ex) { return Conflict(new { message = ex.Message }); }
        catch (DrawValidationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpGet("operations/readiness")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<CompetitionReadinessDto>> Readiness(
        int competitionId, CancellationToken cancellationToken)
    {
        try
        {
            return await new CompetitionReadinessService(db, equipmentCalculator)
                .GetAsync(competitionId, cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    [HttpPut("operations/equipment-acknowledgements")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<CompetitionReadinessDto>> UpdateEquipmentAcknowledgements(
        int competitionId, UpdateEquipmentAcknowledgementsRequest request, CancellationToken cancellationToken)
    {
        if (request.AcknowledgedKeys is null)
            return BadRequest(new { message = "Acknowledged keys are required." });
        if (string.IsNullOrWhiteSpace(request.ExpectedFingerprint))
            return BadRequest(new { message = "The checklist fingerprint is required." });
        try
        {
            return await new CompetitionReadinessService(db, equipmentCalculator).UpdateEquipmentAsync(
                competitionId, request.AcknowledgedKeys, request.ExpectedFingerprint,
                User.FindFirstValue(ClaimTypes.NameIdentifier), cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (DrawChangedException ex) { return Conflict(new { message = ex.Message }); }
        catch (DrawValidationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpGet("arena-crew-sheet")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<ActionResult<ArenaCrewPropSheetDto>> GetArenaCrewSheet(
        int competitionId,
        [FromQuery] int? sessionId = null,
        [FromQuery] int? heatId = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            return await new ArenaCrewSheetService(db)
                .GetAsync(competitionId, sessionId, heatId, cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
    }
}
