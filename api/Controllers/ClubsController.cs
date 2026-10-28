using System.ComponentModel.DataAnnotations;
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
    [Authorize]
    public async Task<IEnumerable<SavedRiderDto>> SavedRiders(int id)
    {
        var uid = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        // A club's team managers and trainers share its roster; anyone else sees only the riders they saved.
        var seesWholeClub = User.IsInRole(Roles.Admin) || await _db.SharesClubRosterAsync(User, id);
        return (await _db.SavedRiders
            .Where(r => r.ClubId == id && (seesWholeClub || (uid != null && r.CreatedByUserId == uid)))
            .OrderBy(r => r.FullName).ThenBy(r => r.HorseName).ToListAsync()).Select(r => r.ToDto());
    }

    [HttpGet("my-saved-riders")]
    [Authorize]
    public async Task<IEnumerable<SavedRiderDto>> MySavedRiders()
    {
        var uid = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(uid)) return Array.Empty<SavedRiderDto>();
        var clubId = await _db.ClubIdOfAsync(User);
        var sharesClub = clubId.HasValue && (User.IsInRole(Roles.Admin) || await _db.SharesClubRosterAsync(User, clubId.Value));
        return (await _db.SavedRiders
            .Where(r => r.CreatedByUserId == uid || (sharesClub && r.ClubId == clubId))
            .OrderBy(r => r.FullName).ThenBy(r => r.HorseName)
            .ToListAsync()).Select(r => r.ToDto());
    }

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

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<ClubDto>> Update(int id, UpdateClubRequest req)
    {
        var club = await _db.Clubs.FindAsync(id);
        if (club is null) return NotFound();
        if (req.Name is not null)
        {
            var name = req.Name.Trim();
            if (name.Length == 0) return BadRequest(new { message = "Name is required." });
            if (await _db.Clubs.AnyAsync(c => c.Id != id && c.Name == name))
                return Conflict(new { message = "A club with that name already exists." });
            club.Name = name;
        }
        if (req.Region is not null)
            club.Region = string.IsNullOrWhiteSpace(req.Region) ? "Custom" : req.Region.Trim();
        if (req.BibColour is not null)
            club.BibColour = string.IsNullOrWhiteSpace(req.BibColour) ? null : req.BibColour.Trim();
        await _db.SaveChangesAsync();
        return club.ToDto();
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id)
    {
        var club = await _db.Clubs.FindAsync(id);
        if (club is null) return NotFound();
        var inUse = await _db.Teams.AnyAsync(t => t.ClubId == id)
            || await _db.Users.AnyAsync(u => u.ClubId == id)
            || await _db.SavedRiders.AnyAsync(r => r.ClubId == id)
            || await _db.Set<MountedGames.Api.Entities.Seasons.TeamProfile>().AnyAsync(p => p.ClubId == id)
            || await _db.ClubPayoutAccounts.AnyAsync(p => p.ClubId == id);
        if (inUse)
            return Conflict(new { message = "This club has teams or members, so it can’t be deleted." });
        _db.Clubs.Remove(club);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}

public record UpdateClubRequest(
    [MaxLength(150)] string? Name = null,
    [MaxLength(150)] string? Region = null,
    [MaxLength(80)] string? BibColour = null);
