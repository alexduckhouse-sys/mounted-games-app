using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Saved overlay looks. Trainers and competition admins see and change their own; admins see and change everyone's, so a club's
/// look can be shared by whoever runs the stream.
/// </summary>
// Unused in web UI yet — reserved for iOS / upcoming wiring
[ApiController]
[Route("api/overlay-looks")]
[Authorize(Policy = CompetitionStaff.Policy)]
public class OverlayLooksController(AppDbContext db, TimeProvider time) : ControllerBase
{
    private const int MaxLookBytes = 4000;
    private const int MaxLooksPerOwner = 50;

    private string UserId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    private bool IsAdmin => User.IsInRole(Roles.Admin);

    [HttpGet]
    public async Task<IEnumerable<OverlayLookDto>> List()
    {
        var looks = await db.OverlayLooks.AsNoTracking()
            .Where(l => IsAdmin || l.OwnerUserId == UserId)
            .OrderBy(l => l.Name).ToListAsync();
        return looks.Select(ToDto);
    }

    [HttpPost]
    public async Task<ActionResult<OverlayLookDto>> Create(SaveOverlayLookRequest req)
    {
        if (Invalid(req) is { } problem) return problem;
        if (await db.OverlayLooks.CountAsync(l => l.OwnerUserId == UserId) >= MaxLooksPerOwner)
            return BadRequest(new { message = $"You can keep up to {MaxLooksPerOwner} looks. Delete one first." });
        var now = time.GetUtcNow().UtcDateTime;
        var look = new OverlayLook { OwnerUserId = UserId, Name = req.Name.Trim(), LookJson = req.Look.GetRawText(), CreatedAt = now, UpdatedAt = now };
        db.OverlayLooks.Add(look);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(List), ToDto(look));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<OverlayLookDto>> Update(int id, SaveOverlayLookRequest req)
    {
        if (Invalid(req) is { } problem) return problem;
        var look = await Find(id);
        if (look is null) return NotFound();
        look.Name = req.Name.Trim();
        look.LookJson = req.Look.GetRawText();
        look.UpdatedAt = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync();
        return ToDto(look);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var look = await Find(id);
        if (look is null) return NotFound();
        db.OverlayLooks.Remove(look);
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Someone else's look reads as missing, so its existence isn't revealed.</summary>
    private Task<OverlayLook?> Find(int id) =>
        db.OverlayLooks.FirstOrDefaultAsync(l => l.Id == id && (IsAdmin || l.OwnerUserId == UserId));

    private BadRequestObjectResult? Invalid(SaveOverlayLookRequest req) =>
        req.Look.ValueKind != JsonValueKind.Object || System.Text.Encoding.UTF8.GetByteCount(req.Look.GetRawText()) > MaxLookBytes || string.IsNullOrWhiteSpace(req.Name)
            ? BadRequest(new { message = "A look needs a name and must be a JSON object of at most 4000 bytes." })
            : null;

    private OverlayLookDto ToDto(OverlayLook l)
    {
        using var look = JsonDocument.Parse(l.LookJson);
        return new OverlayLookDto(l.Id, l.Name, look.RootElement.Clone(), l.OwnerUserId == UserId, l.UpdatedAt);
    }
}
