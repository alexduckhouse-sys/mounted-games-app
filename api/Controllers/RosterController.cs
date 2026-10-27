using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.DecForms;

namespace MountedGames.Api.Controllers;

public record SaveToRosterRequest(
    int? ClubId,
    string FullName,
    DateTime? DateOfBirth = null,
    string? HorseName = null,
    decimal? PonyHeightHands = null,
    string? PonyPassportNumber = null,
    string? PonyOwnerFullName = null,
    bool? UseInitialOnly = null,
    bool? NoFilming = null
);

public record UpdateSavedRiderRequest(
    string? FullName,
    string? HorseName = null,
    DateTime? DateOfBirth = null,
    decimal? PonyHeightHands = null,
    string? PonyPassportNumber = null,
    string? PonyOwnerFullName = null,
    bool? UseInitialOnly = null,
    bool? NoFilming = null
);

[ApiController]
[Authorize]
public class RosterController(AppDbContext db) : ControllerBase
{
    private async Task<bool> IsClubMemberOrTrainerOrAdminAsync(string userId, int clubId, CancellationToken ct)
    {
        if (User.IsInRole(Roles.Admin)) return true;

        var isMember = await db.Users.AsNoTracking()
            .AnyAsync(u => u.Id == userId && u.ClubId == clubId, ct);
        if (isMember) return true;

        return await db.SharesClubRosterAsync(User, clubId);
    }

    [HttpPost("api/roster")]
    [HttpPost("api/clubs/{clubId:int}/saved-riders")]
    public async Task<ActionResult<SavedRiderDto>> SaveToRoster(
        [FromRoute] int? clubId,
        [FromBody] SaveToRosterRequest req,
        CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var targetClubId = clubId ?? req.ClubId ?? await db.ClubIdOfAsync(User);
        if (targetClubId is null or <= 0)
            return BadRequest(new { message = "A target club is required to save a rider to the club roster." });

        if (!await IsClubMemberOrTrainerOrAdminAsync(userId, targetClubId.Value, ct))
            return Forbid();

        var fullName = (req.FullName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(fullName))
            return BadRequest(new { message = "Rider full name is required." });

        var horseName = string.IsNullOrWhiteSpace(req.HorseName) ? null : req.HorseName.Trim();
        var passport = string.IsNullOrWhiteSpace(req.PonyPassportNumber) ? null : req.PonyPassportNumber.Trim();
        var owner = string.IsNullOrWhiteSpace(req.PonyOwnerFullName) ? null : req.PonyOwnerFullName.Trim();

        var existing = await db.SavedRiders
            .Where(s => s.ClubId == targetClubId.Value)
            .ToListAsync(ct);

        var match = existing.FirstOrDefault(s =>
            string.Equals(s.FullName.Trim(), fullName, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(s.HorseName?.Trim() ?? string.Empty, horseName ?? string.Empty, StringComparison.OrdinalIgnoreCase));

        if (match is not null)
        {
            match.FullName = fullName;
            match.HorseName = horseName;
            if (req.DateOfBirth.HasValue) match.DateOfBirth = req.DateOfBirth;
            if (req.PonyHeightHands.HasValue) match.PonyHeightHands = req.PonyHeightHands;
            if (passport is not null) match.PonyPassportNumber = passport;
            if (owner is not null) match.PonyOwnerFullName = owner;
            if (req.UseInitialOnly.HasValue)
                match.UseInitialOnly = req.UseInitialOnly.Value || DecFormRules.HasSingleLetterSurnameInitial(fullName);
            if (req.NoFilming.HasValue)
                match.NoFilming = req.NoFilming.Value;
            await db.SaveChangesAsync(ct);
            return match.ToDto();
        }

        var saved = new SavedRider
        {
            ClubId = targetClubId.Value,
            CreatedByUserId = userId,
            FullName = fullName,
            DateOfBirth = req.DateOfBirth,
            HorseName = horseName,
            PonyHeightHands = req.PonyHeightHands,
            PonyPassportNumber = passport,
            PonyOwnerFullName = owner,
            UseInitialOnly = (req.UseInitialOnly ?? false) || DecFormRules.HasSingleLetterSurnameInitial(fullName),
            NoFilming = req.NoFilming ?? false,
        };
        db.SavedRiders.Add(saved);
        await db.SaveChangesAsync(ct);
        return saved.ToDto();
    }

    [HttpPut("api/roster/{id:int}")]
    [HttpPut("api/clubs/{clubId:int}/saved-riders/{id:int}")]
    public async Task<ActionResult<SavedRiderDto>> UpdateSavedRider(
        [FromRoute] int? clubId,
        [FromRoute] int id,
        [FromBody] UpdateSavedRiderRequest req,
        CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var saved = await db.SavedRiders.FirstOrDefaultAsync(
            s => s.Id == id && (!clubId.HasValue || s.ClubId == clubId.Value), ct);
        if (saved is null) return NotFound();

        if (!await IsClubMemberOrTrainerOrAdminAsync(userId, saved.ClubId, ct) && saved.CreatedByUserId != userId)
            return Forbid();

        var fullName = (req.FullName ?? saved.FullName).Trim();
        if (string.IsNullOrEmpty(fullName))
            return BadRequest(new { message = "Rider full name is required." });

        saved.FullName = fullName;
        saved.HorseName = string.IsNullOrWhiteSpace(req.HorseName) ? null : req.HorseName.Trim();
        if (req.DateOfBirth.HasValue) saved.DateOfBirth = req.DateOfBirth;
        if (req.PonyHeightHands.HasValue) saved.PonyHeightHands = req.PonyHeightHands;
        if (req.PonyPassportNumber is not null)
            saved.PonyPassportNumber = string.IsNullOrWhiteSpace(req.PonyPassportNumber) ? null : req.PonyPassportNumber.Trim();
        if (req.PonyOwnerFullName is not null)
            saved.PonyOwnerFullName = string.IsNullOrWhiteSpace(req.PonyOwnerFullName) ? null : req.PonyOwnerFullName.Trim();
        if (req.UseInitialOnly.HasValue)
            saved.UseInitialOnly = req.UseInitialOnly.Value || DecFormRules.HasSingleLetterSurnameInitial(fullName);
        if (req.NoFilming.HasValue)
            saved.NoFilming = req.NoFilming.Value;

        await db.SaveChangesAsync(ct);
        return saved.ToDto();
    }

    [HttpDelete("api/roster/{id:int}")]
    [HttpDelete("api/clubs/{clubId:int}/saved-riders/{id:int}")]
    public async Task<IActionResult> DeleteSavedRider(
        [FromRoute] int? clubId,
        [FromRoute] int id,
        CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var saved = await db.SavedRiders.FirstOrDefaultAsync(
            s => s.Id == id && (!clubId.HasValue || s.ClubId == clubId.Value), ct);
        if (saved is null) return NotFound();

        if (!await IsClubMemberOrTrainerOrAdminAsync(userId, saved.ClubId, ct) && saved.CreatedByUserId != userId)
            return Forbid();

        var linkedEntries = await db.RiderEntries
            .Where(r => r.SavedRiderId == saved.Id)
            .ToListAsync(ct);
        foreach (var entry in linkedEntries)
        {
            entry.SavedRiderId = null;
        }

        db.SavedRiders.Remove(saved);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
