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
public class SignupController : ControllerBase
{
    private readonly AppDbContext _db;
    public SignupController(AppDbContext db) => _db = db;

    /// <summary>
    /// Sign up to a comp section. The amount is captured from the section's
    /// price at signup time so it can't drift if the organiser later edits it.
    /// Payment integration is deferred — Status starts at Pending and an
    /// organiser flips it to Paid once funds land in their PaymentDestination.
    /// </summary>
    [HttpPost("api/competitions/{competitionId:int}/sections/{sectionId:int}/signups")]
    [AllowAnonymous]
    public async Task<ActionResult<SectionSignupDto>> Create(int competitionId, int sectionId, CreateSectionSignupRequest req)
    {
        var section = await _db.CompetitionSections
            .FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == competitionId);
        if (section is null) return NotFound();
        var name = req.FullName?.Trim();
        if (string.IsNullOrEmpty(name)) return BadRequest(new { message = "Full name required." });

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        if (!string.IsNullOrEmpty(ip) && await _db.IpBlocks.AnyAsync(b => b.IpAddress == ip))
            return StatusCode(403, new { message = "Signups from this network are blocked." });

        var signup = new SectionSignup
        {
            CompetitionSectionId = sectionId,
            UserId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
            FullName = name.Length > 200 ? name[..200] : name,
            PonyClubName = req.PonyClubName?.Trim(),
            ContactInfo = req.ContactInfo?.Trim(),
            AmountMinor = section.PriceMinor,
            Status = section.PriceMinor == 0 ? SignupPaymentStatus.Paid : SignupPaymentStatus.Pending,
            PaidAt = section.PriceMinor == 0 ? DateTime.UtcNow : null,
        };
        _db.SectionSignups.Add(signup);
        await _db.SaveChangesAsync();
        var loaded = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstAsync(s => s.Id == signup.Id);
        return loaded.ToDto();
    }

    /// <summary>List signups for a competition. Public — useful for organisers
    /// to share a "current entries" page; payment status visible only to
    /// admins/trainers (TODO).</summary>
    [HttpGet("api/competitions/{competitionId:int}/signups")]
    [AllowAnonymous]
    public async Task<IEnumerable<SectionSignupDto>> List(int competitionId)
    {
        var rows = await _db.SectionSignups
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == competitionId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
        return rows.Select(r => r.ToDto());
    }

    /// <summary>Organiser (trainer or admin) marks a signup paid / refunded / cancelled.</summary>
    [HttpPut("api/signups/{id:int}/status")]
    [Authorize(Roles = Roles.Admin + "," + Roles.Trainer)]
    public async Task<ActionResult<SectionSignupDto>> UpdateStatus(int id, UpdateSignupStatusRequest req)
    {
        var signup = await _db.SectionSignups
            .Include(s => s.Section)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (signup is null) return NotFound();
        signup.Status = req.Status;
        signup.PaidAt = req.Status == SignupPaymentStatus.Paid ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync();
        return signup.ToDto();
    }

    [HttpDelete("api/signups/{id:int}")]
    [Authorize(Roles = Roles.Admin + "," + Roles.Trainer)]
    public async Task<IActionResult> Delete(int id)
    {
        var signup = await _db.SectionSignups.FindAsync(id);
        if (signup is null) return NotFound();
        _db.SectionSignups.Remove(signup);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
