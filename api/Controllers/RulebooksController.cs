using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{competitionId:int}/rulebooks")]
public class RulebooksController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<RulebookDto>>> List(
        int competitionId, CancellationToken cancellationToken)
    {
        if (!await db.Competitions.AnyAsync(c => c.Id == competitionId, cancellationToken)) return NotFound();
        var rows = await db.Set<Rulebook>().AsNoTracking()
            .Where(r => r.CompetitionId == competitionId)
            .OrderBy(r => r.Title).ThenByDescending(r => r.UpdatedAt)
            .ToListAsync(cancellationToken);
        return rows.Select(ToDto).ToList();
    }

    [HttpGet("{id:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<RulebookDto>> Get(
        int competitionId, int id, CancellationToken cancellationToken)
    {
        var row = await db.Set<Rulebook>().AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id && r.CompetitionId == competitionId, cancellationToken);
        return row is null ? NotFound() : ToDto(row);
    }

    [HttpPost]
    [Authorize(Roles = Roles.Organiser)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<RulebookDto>> Create(
        int competitionId, UpsertRulebookRequest request, CancellationToken cancellationToken)
    {
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var title = request.Title.Trim();
        var edition = request.Edition.Trim();
        if (await db.Set<Rulebook>().AnyAsync(r => r.CompetitionId == competitionId
                && r.Title == title && r.Edition == edition, cancellationToken))
            return Conflict(new { message = "That rulebook title and edition already exists." });
        var row = new Rulebook
        {
            CompetitionId = competitionId,
            Title = title,
            Edition = edition,
            SourceUrl = Normalise(request.SourceUrl),
            Text = request.Text.Trim(),
            UpdatedAt = DateTime.UtcNow,
            UpdatedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier),
        };
        db.Add(row);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(Get), new { competitionId, id = row.Id }, ToDto(row));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Organiser)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<RulebookDto>> Update(
        int competitionId, int id, UpsertRulebookRequest request, CancellationToken cancellationToken)
    {
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var row = await db.Set<Rulebook>()
            .FirstOrDefaultAsync(r => r.Id == id && r.CompetitionId == competitionId, cancellationToken);
        if (row is null) return NotFound();
        var title = request.Title.Trim();
        var edition = request.Edition.Trim();
        if (await db.Set<Rulebook>().AnyAsync(r => r.CompetitionId == competitionId && r.Id != id
                && r.Title == title && r.Edition == edition, cancellationToken))
            return Conflict(new { message = "That rulebook title and edition already exists." });
        row.Title = title;
        row.Edition = edition;
        row.SourceUrl = Normalise(request.SourceUrl);
        row.Text = request.Text.Trim();
        row.UpdatedAt = DateTime.UtcNow;
        row.UpdatedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        await db.SaveChangesAsync(cancellationToken);
        return ToDto(row);
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Organiser)]
    [CompetitionAccess("competitionId")]
    public async Task<IActionResult> Delete(int competitionId, int id, CancellationToken cancellationToken)
    {
        var row = await db.Set<Rulebook>()
            .FirstOrDefaultAsync(r => r.Id == id && r.CompetitionId == competitionId, cancellationToken);
        if (row is null) return NotFound();
        db.Remove(row);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private static string? Validate(UpsertRulebookRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title)) return "Title is required.";
        if (request.Title.Trim().Length > 200) return "Title must be 200 characters or fewer.";
        if (string.IsNullOrWhiteSpace(request.Edition)) return "Edition is required.";
        if (request.Edition.Trim().Length > 100) return "Edition must be 100 characters or fewer.";
        if (string.IsNullOrWhiteSpace(request.Text)) return "Rulebook text is required.";
        if (request.Text.Length > 250_000) return "Rulebook text is too long.";
        var source = Normalise(request.SourceUrl);
        if (source?.Length > 2000) return "Source URL must be 2000 characters or fewer.";
        if (source is not null && (!Uri.TryCreate(source, UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)))
            return "Source URL must be an absolute http or https URL.";
        return null;
    }

    private static string? Normalise(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static RulebookDto ToDto(Rulebook row) =>
        new(row.Id, row.CompetitionId, row.Title, row.Edition, row.SourceUrl, row.Text, row.UpdatedAt);
}
