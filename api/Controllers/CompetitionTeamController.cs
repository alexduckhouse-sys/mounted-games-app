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

public record CompetitionAccessDto(int CompetitionId, bool Owner, CollaboratorRole? Role);
public record TeamOwnerDto(string UserId, string Name);
public record TeamHelperDto(string UserId, string Name, string? Email, CollaboratorRole Role, DateTime AddedAt);
public record CompetitionTeamDto(bool CanManageTeam, TeamOwnerDto? Owner, IReadOnlyList<TeamHelperDto> Helpers);
public record AddHelperRequest([Required, EmailAddress, StringLength(256)] string Email, CollaboratorRole Role);
public record ChangeHelperRoleRequest(CollaboratorRole Role);

/// <summary>
/// A competition's team: helpers the owner (or an admin) adds so they can run that one event, such as
/// co-organisers, ring scorers or stream producers. Only the owner and admins change the team; a helper can leave.
/// </summary>
[ApiController]
[Authorize]
public class CompetitionTeamController(AppDbContext db, UserManager<AppUser> users, TimeProvider time) : ControllerBase
{
    private const int MaxHelpers = 50;
    private string UserId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    private bool IsAdmin => User.IsInRole(Roles.Admin);

    /// <summary>The competitions the signed-in user owns or helps on, so the web knows where they can organise.</summary>
    [HttpGet("api/competitions/access")]
    public async Task<IEnumerable<CompetitionAccessDto>> MyAccess()
    {
        var owned = User.IsInRole(Roles.Trainer)
            ? await db.Competitions.AsNoTracking().Where(c => c.CreatedByUserId == UserId).Select(c => c.Id).ToListAsync()
            : [];
        var helping = await db.CompetitionCollaborators.AsNoTracking().Where(c => c.UserId == UserId)
            .Select(c => new { c.CompetitionId, c.Role }).ToListAsync();
        return owned.Select(id => new CompetitionAccessDto(id, true, null))
            .Concat(helping.Where(h => !owned.Contains(h.CompetitionId)).Select(h => new CompetitionAccessDto(h.CompetitionId, false, h.Role)))
            .OrderBy(a => a.CompetitionId);
    }

    [HttpGet("api/competitions/{competitionId:int}/team")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<CompetitionTeamDto>> Get(int competitionId)
    {
        var competition = await db.Competitions.AsNoTracking().FirstAsync(c => c.Id == competitionId);
        var manage = IsAdmin || competition.CreatedByUserId == UserId;
        var owner = competition.CreatedByUserId is null ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == competition.CreatedByUserId).Select(u => new TeamOwnerDto(u.Id, u.FullName)).FirstOrDefaultAsync();
        var helpers = await db.CompetitionCollaborators.AsNoTracking().Where(c => c.CompetitionId == competitionId)
            .OrderBy(c => c.AddedAt)
            .Select(c => new TeamHelperDto(c.UserId, c.User!.FullName, manage ? c.User.Email : null, c.Role, c.AddedAt))
            .ToListAsync();
        return new CompetitionTeamDto(manage, owner, helpers);
    }

    [HttpPost("api/competitions/{competitionId:int}/team")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<TeamHelperDto>> Add(int competitionId, AddHelperRequest req)
    {
        if (!Enum.IsDefined(req.Role)) return BadRequest(new { message = "Choose a role for this helper." });
        var competition = await db.Competitions.AsNoTracking().FirstAsync(c => c.Id == competitionId);
        if (!IsAdmin && competition.CreatedByUserId != UserId) return Forbid();
        var user = await users.FindByEmailAsync(req.Email.Trim());
        if (user is null) return NotFound(new { message = "No account uses that email. Ask them to sign up first." });
        if (user.Id == UserId || user.Id == competition.CreatedByUserId)
            return BadRequest(new { message = "The owner is already in charge of this competition." });
        if (await db.CompetitionCollaborators.CountAsync(c => c.CompetitionId == competitionId) >= MaxHelpers)
            return BadRequest(new { message = $"A competition can have up to {MaxHelpers} helpers." });

        var helper = await db.CompetitionCollaborators.FirstOrDefaultAsync(c => c.CompetitionId == competitionId && c.UserId == user.Id);
        if (helper is null)
        {
            helper = new CompetitionCollaborator { CompetitionId = competitionId, UserId = user.Id, AddedByUserId = UserId, AddedAt = time.GetUtcNow().UtcDateTime };
            db.CompetitionCollaborators.Add(helper);
        }
        helper.Role = req.Role;
        await db.SaveChangesAsync();
        return new TeamHelperDto(user.Id, user.FullName, user.Email, helper.Role, helper.AddedAt);
    }

    [HttpPut("api/competitions/{competitionId:int}/team/{userId}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<TeamHelperDto>> ChangeRole(int competitionId, string userId, ChangeHelperRoleRequest req)
    {
        if (!Enum.IsDefined(req.Role)) return BadRequest(new { message = "Choose a role for this helper." });
        if (!await IsOwnerOrAdminAsync(competitionId)) return Forbid();
        var helper = await db.CompetitionCollaborators.Include(c => c.User)
            .FirstOrDefaultAsync(c => c.CompetitionId == competitionId && c.UserId == userId);
        if (helper is null) return NotFound();
        helper.Role = req.Role;
        await db.SaveChangesAsync();
        return new TeamHelperDto(helper.UserId, helper.User!.FullName, helper.User.Email, helper.Role, helper.AddedAt);
    }

    [HttpDelete("api/competitions/{competitionId:int}/team/{userId}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IActionResult> Remove(int competitionId, string userId)
    {
        if (userId != UserId && !await IsOwnerOrAdminAsync(competitionId)) return Forbid();
        var helper = await db.CompetitionCollaborators.FirstOrDefaultAsync(c => c.CompetitionId == competitionId && c.UserId == userId);
        if (helper is null) return NotFound();
        db.CompetitionCollaborators.Remove(helper);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<bool> IsOwnerOrAdminAsync(int competitionId) =>
        IsAdmin || await db.Competitions.AnyAsync(c => c.Id == competitionId && c.CreatedByUserId == UserId);
}
