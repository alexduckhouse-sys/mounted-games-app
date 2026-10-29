using MountedGames.Api.Security;
using Microsoft.AspNetCore.RateLimiting;
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
[Route("api/rulebooks")]
public class RulebooksController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<ActionResult<IReadOnlyList<RulebookSummaryDto>>> List(CancellationToken cancellationToken) =>
        await db.Set<Rulebook>().AsNoTracking()
            .OrderBy(r => r.Title).ThenByDescending(r => r.UpdatedAt)
            .Select(r => new RulebookSummaryDto(r.Id, r.Title, r.Edition, r.SourceUrl, r.UpdatedAt))
            .ToListAsync(cancellationToken);

    [HttpGet("{id:int}")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<ActionResult<RulebookDto>> Get(int id, CancellationToken cancellationToken)
    {
        var row = await db.Set<Rulebook>().AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        return row is null ? NotFound() : ToDto(row);
    }

    [HttpPost]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<RulebookDto>> Create(
        UpsertRulebookRequest request, CancellationToken cancellationToken)
    {
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var title = request.Title.Trim();
        var edition = request.Edition.Trim();
        if (await db.Set<Rulebook>().AnyAsync(r => r.Title == title && r.Edition == edition, cancellationToken))
            return Conflict(new { message = "That rulebook title and edition already exists." });
        var row = new Rulebook
        {
            Title = title,
            Edition = edition,
            SourceUrl = Normalise(request.SourceUrl),
            Text = request.Text.Trim(),
            UpdatedAt = DateTime.UtcNow,
            UpdatedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier),
        };
        db.Add(row);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = row.Id }, ToDto(row));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<RulebookDto>> Update(
        int id, UpsertRulebookRequest request, CancellationToken cancellationToken)
    {
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var row = await db.Set<Rulebook>()
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (row is null) return NotFound();
        var title = request.Title.Trim();
        var edition = request.Edition.Trim();
        if (await db.Set<Rulebook>().AnyAsync(r => r.Id != id
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
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var row = await db.Set<Rulebook>()
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
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
                || uri.Scheme != Uri.UriSchemeHttps || string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo)))
            return "Use an https link without a username or password.";
        return null;
    }

    private static string? Normalise(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static RulebookDto ToDto(Rulebook row) =>
        new(row.Id, row.Title, row.Edition, row.SourceUrl, row.Text, row.UpdatedAt);
}
