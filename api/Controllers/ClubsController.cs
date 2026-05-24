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
[Route("api/clubs")]
public class ClubsController : ControllerBase
{
    private readonly AppDbContext _db;
    public ClubsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IEnumerable<ClubDto>> List() =>
        (await _db.Clubs.OrderBy(c => c.Name).ToListAsync()).Select(c => c.ToDto());

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ClubDto>> Get(int id)
    {
        var club = await _db.Clubs.FindAsync(id);
        return club is null ? NotFound() : club.ToDto();
    }

    [HttpGet("{id:int}/saved-riders")]
    public async Task<IEnumerable<SavedRiderDto>> SavedRiders(int id) =>
        (await _db.SavedRiders.Where(r => r.ClubId == id).OrderBy(r => r.FullName).ToListAsync())
            .Select(r => r.ToDto());

    [HttpPost]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<ClubDto>> Create(CreateClubRequest req)
    {
        var name = (req.Name ?? string.Empty).Trim();
        if (name.Length == 0) return BadRequest(new { message = "Name is required." });
        // Allow re-using an existing club (idempotent — handy for "add a custom team" from the wizard).
        var existing = await _db.Clubs.FirstOrDefaultAsync(c => c.Name == name);
        if (existing is not null) return existing.ToDto();
        var club = new Club
        {
            Name = name,
            Region = string.IsNullOrWhiteSpace(req.Region) ? "Custom" : req.Region.Trim(),
            BibColour = string.IsNullOrWhiteSpace(req.BibColour) ? null : req.BibColour.Trim(),
        };
        _db.Clubs.Add(club);
        await _db.SaveChangesAsync();
        return club.ToDto();
    }
}
