using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Authorize(Roles = Roles.Trainer + "," + Roles.Admin)]
[Route("api/trainer/notes")]
public class TrainerNotesController : ControllerBase
{
    private readonly AppDbContext _db;
    public TrainerNotesController(AppDbContext db) => _db = db;

    private string UserId =>
        User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
        ?? throw new InvalidOperationException();

    [HttpGet]
    public async Task<IEnumerable<TrainerNoteDto>> List()
    {
        var uid = UserId;
        return (await _db.TrainerNotes
            .Where(n => n.UserId == uid)
            .OrderByDescending(n => n.UpdatedAt ?? n.CreatedAt)
            .ToListAsync())
        .Select(n => n.ToDto());
    }

    [HttpPost]
    public async Task<ActionResult<TrainerNoteDto>> Create(SaveTrainerNoteRequest req)
    {
        var n = new TrainerNote { UserId = UserId, Title = req.Title, Body = req.Body };
        _db.TrainerNotes.Add(n);
        await _db.SaveChangesAsync();
        return n.ToDto();
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<TrainerNoteDto>> Update(int id, SaveTrainerNoteRequest req)
    {
        var n = await _db.TrainerNotes.FirstOrDefaultAsync(n => n.Id == id && n.UserId == UserId);
        if (n is null) return NotFound();
        n.Title = req.Title;
        n.Body = req.Body;
        n.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return n.ToDto();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var n = await _db.TrainerNotes.FirstOrDefaultAsync(n => n.Id == id && n.UserId == UserId);
        if (n is null) return NotFound();
        _db.TrainerNotes.Remove(n);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
