using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Controllers;

public record CompetitionAccessDto(int CompetitionId, bool Owner);
public record TeamOwnerDto(string UserId, string Name);
public record TeamHelperDto(string UserId, string Name, string Email, DateTime AddedAt);
public record CompetitionTeamDto(TeamOwnerDto? Owner, IReadOnlyList<TeamHelperDto> Helpers);
public record AddHelperRequest([Required, EmailAddress, StringLength(256)] string Email);

/// <summary>
/// A competition's team: competition admins, who can do everything the owner can for that one event, including
/// adding and removing other competition admins. Nobody can remove the owner; deleting the competition stays with
/// site admins.
/// </summary>
[ApiController]
[Authorize]
public class CompetitionTeamController(AppDbContext db, UserManager<AppUser> users, TimeProvider time) : ControllerBase
{
    private const int MaxHelpers = 50;
    private string UserId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    /// <summary>The competitions the signed-in user owns or is a competition admin of, so the web knows where they can organise.</summary>
    [HttpGet("api/competitions/access")]
    public async Task<IEnumerable<CompetitionAccessDto>> MyAccess()
    {
        var owned = User.IsInRole(Roles.Trainer)
            ? await db.Competitions.AsNoTracking().Where(c => c.CreatedByUserId == UserId).Select(c => c.Id).ToListAsync()
            : [];
        var helping = await db.CompetitionCollaborators.AsNoTracking().Where(c => c.UserId == UserId)
            .Select(c => c.CompetitionId).ToListAsync();
        return owned.Select(id => new CompetitionAccessDto(id, true))
            .Concat(helping.Except(owned).Select(id => new CompetitionAccessDto(id, false)))
            .OrderBy(a => a.CompetitionId);
    }

    [HttpGet("api/competitions/{competitionId:int}/team")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<CompetitionTeamDto>> Get(int competitionId)
    {
        var ownerId = await db.Competitions.AsNoTracking().Where(c => c.Id == competitionId).Select(c => c.CreatedByUserId).FirstAsync();
        var owner = ownerId is null ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == ownerId).Select(u => new TeamOwnerDto(u.Id, u.FullName)).FirstOrDefaultAsync();
        var helpers = await db.CompetitionCollaborators.AsNoTracking().Where(c => c.CompetitionId == competitionId)
            .OrderBy(c => c.AddedAt)
            .Select(c => new TeamHelperDto(c.UserId, c.User!.FullName, c.User.Email ?? "", c.AddedAt))
            .ToListAsync();
        return new CompetitionTeamDto(owner, helpers);
    }

    [HttpPost("api/competitions/{competitionId:int}/team")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<TeamHelperDto>> Add(int competitionId, AddHelperRequest req)
    {
        var ownerId = await db.Competitions.AsNoTracking().Where(c => c.Id == competitionId).Select(c => c.CreatedByUserId).FirstAsync();
        var user = await users.FindByEmailAsync(req.Email.Trim());
        if (user is null) return NotFound(new { message = "No account uses that email. Ask them to sign up first." });
        if (user.Id == ownerId) return BadRequest(new { message = "The owner already runs this competition." });

        var helper = await db.CompetitionCollaborators.AsNoTracking().FirstOrDefaultAsync(c => c.CompetitionId == competitionId && c.UserId == user.Id);
        if (helper is null)
        {
            if (await db.CompetitionCollaborators.CountAsync(c => c.CompetitionId == competitionId) >= MaxHelpers)
                return BadRequest(new { message = $"A competition can have up to {MaxHelpers} competition admins." });
            helper = new CompetitionCollaborator
            {
                CompetitionId = competitionId, UserId = user.Id, Role = CollaboratorRole.CompetitionAdmin,
                AddedByUserId = UserId, AddedAt = time.GetUtcNow().UtcDateTime,
            };
            db.CompetitionCollaborators.Add(helper);
            await db.SaveChangesAsync();
        }
        return new TeamHelperDto(user.Id, user.FullName, user.Email ?? "", helper.AddedAt);
    }

    /// <summary>Any competition admin can remove another, or leave; the owner isn't on this list and can't be removed.</summary>
    [HttpDelete("api/competitions/{competitionId:int}/team/{userId}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IActionResult> Remove(int competitionId, string userId)
    {
        var helper = await db.CompetitionCollaborators.FirstOrDefaultAsync(c => c.CompetitionId == competitionId && c.UserId == userId);
        if (helper is null) return NotFound();
        db.CompetitionCollaborators.Remove(helper);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
