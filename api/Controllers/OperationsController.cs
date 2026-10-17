using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Operations;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{competitionId:int}")]
[Authorize(Roles = Roles.Organiser)]
public class OperationsController(
    AppDbContext db, EquipmentCalculator equipmentCalculator) : ControllerBase
{
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
                .ApplyAsync(competitionId, sectionId, request, cancellationToken);
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
}
