using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services.EventTools;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/event-tools/competitions/{competitionId:int}")]
public sealed class EventToolsController(AppDbContext db) : ControllerBase
{
    [HttpPost("team-import/preview")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [RequestSizeLimit(CsvTeamImportService.MaxBytes + 4096)]
    public async Task<ActionResult<CsvTeamImportPreviewDto>> PreviewTeamImport(
        int competitionId, CsvTeamImportRequest request, CancellationToken ct)
    {
        if (!await CanManageCompetitionAsync(competitionId, ct)) return NotFound();
        try { return await new CsvTeamImportService(db).PreviewAsync(competitionId, request.Csv, ct); }
        catch (EventToolsException ex) { return Problem(statusCode: ex.StatusCode, title: "Import preview unavailable", detail: ex.Message); }
    }

    [HttpPost("team-import/apply")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [RequestSizeLimit(CsvTeamImportService.MaxBytes + 4096)]
    public async Task<ActionResult<CsvTeamImportResultDto>> ApplyTeamImport(
        int competitionId, ApplyCsvTeamImportRequest request, CancellationToken ct)
    {
        if (!await CanManageCompetitionAsync(competitionId, ct)) return NotFound();
        try { return await new CsvTeamImportService(db).ApplyAsync(competitionId, request.Csv, request.Fingerprint, request.PreviewVersion, ct); }
        catch (EventToolsException ex) { return Problem(statusCode: ex.StatusCode, title: "Import cannot be applied", detail: ex.Message); }
    }

    [HttpPost("clone")]
    [Authorize(Roles = Roles.Organiser)]
    public async Task<ActionResult<CloneCompetitionResultDto>> Clone(
        int competitionId, CloneCompetitionRequest request, CancellationToken ct)
    {
        if (!await CanManageCompetitionAsync(competitionId, ct)) return NotFound();
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();
        try
        {
            var result = await new CompetitionCloneService(db).CloneAsync(competitionId, request, userId, User.IsInRole(Roles.Admin), ct);
            return Created($"/api/competitions/{result.CompetitionId}", result);
        }
        catch (EventToolsException ex)
        {
            return Problem(statusCode: ex.StatusCode, title: "Competition cannot be duplicated", detail: ex.Message);
        }
    }

    [HttpGet("print/draw")]
    [AllowAnonymous]
    public async Task<ActionResult<PrintableDrawDto>> PrintableDraw(int competitionId, CancellationToken ct)
    {
        var result = await new PrintableEventService(db).DrawAsync(competitionId, ct);
        return result is null ? NotFound() : result;
    }

    [HttpGet("print/score-sheets")]
    [AllowAnonymous]
    public async Task<ActionResult<PrintableScoreSheetsDto>> PrintableScoreSheets(int competitionId, CancellationToken ct)
    {
        var result = await new PrintableEventService(db).ScoreSheetsAsync(competitionId, ct);
        return result is null ? NotFound() : result;
    }

    [HttpGet("print/results")]
    [AllowAnonymous]
    public async Task<ActionResult<PrintableResultsDto>> PrintableResults(int competitionId, CancellationToken ct)
    {
        var result = await new PrintableEventService(db).ResultsAsync(competitionId, ct);
        return result is null ? NotFound() : result;
    }

    private Task<bool> CanManageCompetitionAsync(int competitionId, CancellationToken ct) =>
        db.CanManageAsync(User, competitionId, ct);
}
