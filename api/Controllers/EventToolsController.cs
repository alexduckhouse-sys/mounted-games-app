using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
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
            var result = await new CompetitionCloneService(db).CloneAsync(competitionId, request, userId, ct);
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
    public async Task<ActionResult<PrintableResultsDto>> PrintableResults(
        int competitionId, [FromQuery] int? sessionId = null, CancellationToken ct = default)
    {
        var result = await new PrintableEventService(db).ResultsAsync(competitionId, ct, sessionId);
        return result is null ? NotFound() : result;
    }

    /// <summary>The results book as the public sees it: standings, finals and awards, nothing private.</summary>
    [HttpGet("results-book")]
    [AllowAnonymous]
    public async Task<ActionResult<ResultsBookDto>> ResultsBook(int competitionId, [FromServices] ResultsBookService book, CancellationToken ct)
    {
        var result = await book.BuildAsync(competitionId, includePrivate: false, ct);
        return result is null ? NotFound() : result;
    }

    /// <summary>The organiser's copy of the results book: the public one plus the referee's private notes.</summary>
    [HttpGet("results-book/organiser")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    public async Task<ActionResult<ResultsBookDto>> OrganiserResultsBook(int competitionId, [FromServices] ResultsBookService book, CancellationToken ct)
    {
        if (!await CanManageCompetitionAsync(competitionId, ct)) return NotFound();
        var result = await book.BuildAsync(competitionId, includePrivate: true, ct);
        return result is null ? NotFound() : result;
    }

    /// <summary>Public-safe formatted results summary text ready to copy/paste for social media or press releases.</summary>
    [HttpGet("results-summary")]
    [AllowAnonymous]
    public async Task<ActionResult<PublicResultsSummaryDto>> ResultsSummary(int competitionId, [FromServices] ResultsBookService book, CancellationToken ct)
    {
        var result = await book.BuildPublicSummaryAsync(competitionId, ct);
        return result is null ? NotFound() : result;
    }

    /// <summary>Complete self-contained organiser archive bundle (CSV + JSON snapshot, or ZIP download).</summary>
    [HttpGet("archive")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    public async Task<IActionResult> Archive(
        int competitionId,
        [FromServices] EventArchiveService archiveService,
        [FromQuery] string? format = null,
        CancellationToken ct = default)
    {
        if (!await CanManageCompetitionAsync(competitionId, ct)) return NotFound();
        var archive = await archiveService.BuildArchiveAsync(competitionId, ct);
        if (archive is null) return NotFound();
        if (string.Equals(format, "zip", StringComparison.OrdinalIgnoreCase))
        {
            return File(EventArchiveService.BuildZipBytes(archive), "application/zip", archive.FileName);
        }
        return Ok(archive);
    }

    /// <summary>The entry list with riders and ponies. Staff only, because it shows full rider names.</summary>
    [HttpGet("print/entries")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    public async Task<ActionResult<PrintableEntriesDto>> PrintableEntries(int competitionId, CancellationToken ct)
    {
        if (!await CanManageCompetitionAsync(competitionId, ct)) return NotFound();
        var result = await new PrintableEventService(db).EntriesAsync(competitionId, ct);
        return result is null ? NotFound() : result;
    }

    [HttpGet("awards")]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<SpecialAwardDto>>> Awards(int competitionId, CancellationToken ct)
    {
        if (!await db.Competitions.AnyAsync(c => c.Id == competitionId, ct)) return NotFound();
        return await db.SpecialAwards.AsNoTracking().Where(a => a.CompetitionId == competitionId)
            .OrderBy(a => a.OrderIndex).ThenBy(a => a.Id)
            .Select(a => new SpecialAwardDto(a.Id, a.CompetitionSectionId, a.Title, a.Recipient, a.Note)).ToListAsync(ct);
    }

    /// <summary>Replaces the competition's special awards with this list, in this order.</summary>
    [HttpPut("awards")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    public async Task<ActionResult<IReadOnlyList<SpecialAwardDto>>> SaveAwards(int competitionId, SaveSpecialAwardsRequest request, CancellationToken ct)
    {
        if (!await CanManageCompetitionAsync(competitionId, ct)) return NotFound();
        var sectionIds = await db.CompetitionSections.Where(s => s.CompetitionId == competitionId).Select(s => s.Id).ToListAsync(ct);
        if (request.Awards.Any(a => a.CompetitionSectionId is { } id && !sectionIds.Contains(id)))
            return BadRequest(new { message = "An award names an age group that is not in this competition." });
        if (request.Awards.Any(a => string.IsNullOrWhiteSpace(a.Title) || string.IsNullOrWhiteSpace(a.Recipient)))
            return BadRequest(new { message = "Every award needs a title and a recipient." });

        db.SpecialAwards.RemoveRange(await db.SpecialAwards.Where(a => a.CompetitionId == competitionId).ToListAsync(ct));
        var rows = request.Awards.Select((a, i) => new SpecialAward
        {
            CompetitionId = competitionId, CompetitionSectionId = a.CompetitionSectionId,
            Title = a.Title.Trim(), Recipient = a.Recipient.Trim(),
            Note = string.IsNullOrWhiteSpace(a.Note) ? null : a.Note.Trim(), OrderIndex = i,
        }).ToList();
        db.SpecialAwards.AddRange(rows);
        await db.SaveChangesAsync(ct);
        return rows.Select(a => new SpecialAwardDto(a.Id, a.CompetitionSectionId, a.Title, a.Recipient, a.Note)).ToList();
    }

    private Task<bool> CanManageCompetitionAsync(int competitionId, CancellationToken ct) =>
        db.CanManageAsync(User, competitionId, ct);
}
