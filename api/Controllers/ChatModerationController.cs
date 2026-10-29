using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Authorize]
public class ChatModerationController(AppDbContext db, TimeProvider time) : ControllerBase, IAsyncActionFilter
{
    private string UserId => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;
    private CancellationToken Cancellation => HttpContext.RequestAborted;

    [NonAction]
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (string.IsNullOrWhiteSpace(UserId)) { context.Result = Unauthorized(); return; }
        // Authentication caches activity across requests. Read the minimal state again here so an
        // emptied account cannot recreate report text while another instance's cache catches up.
        var account = await db.Users.AsNoTracking().Where(u => u.Id == UserId)
            .Select(u => new { u.LockoutEnd, u.LockedAt, u.BlockedAt }).SingleOrDefaultAsync(Cancellation);
        if (account == null || account.LockoutEnd == DateTimeOffset.MaxValue
            || account.LockedAt != null || account.BlockedAt != null)
        {
            context.Result = Unauthorized();
            return;
        }
        await next();
    }
    private async Task<IQueryable<ChatMessage>> VisibleMessagesAsync(int competitionId) => db.ChatMessages
        .Where(m => m.CompetitionId == competitionId)
        .VisibleTo(UserId, await db.CanManageAsync(User, competitionId, Cancellation));

    [HttpPost("api/competitions/{competitionId:int}/chat/{messageId:int}/report")]
    public async Task<IActionResult> Report(int competitionId, int messageId, ReportChatMessageRequest request)
    {
        var reason = request.Reason?.Trim();
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 1000)
            return BadRequest(new { message = "Tell us what happened in 1 to 1,000 characters." });
        if (!await (await VisibleMessagesAsync(competitionId)).AnyAsync(m => m.Id == messageId, Cancellation)) return NotFound();
        if (await db.ChatReports.AnyAsync(r => r.MessageId == messageId && r.ReporterUserId == UserId, Cancellation))
            return NoContent();
        var report = new ChatReport
        {
            MessageId = messageId,
            ReporterUserId = UserId,
            Reason = reason,
            CreatedAt = time.GetUtcNow().UtcDateTime
        };
        db.ChatReports.Add(report);
        try { await db.SaveChangesAsync(Cancellation); }
        catch (DbUpdateException)
        {
            db.Entry(report).State = EntityState.Detached;
            // A second device can submit the same report concurrently.
            if (await db.ChatReports.AnyAsync(r => r.MessageId == messageId && r.ReporterUserId == UserId, Cancellation))
                return NoContent();
            if (!await (await VisibleMessagesAsync(competitionId)).AnyAsync(m => m.Id == messageId, Cancellation)) return NotFound();
            throw;
        }
        return NoContent();
    }

    [HttpPost("api/competitions/{competitionId:int}/chat/{messageId:int}/block-user")]
    public async Task<IActionResult> BlockUser(int competitionId, int messageId)
    {
        var message = await (await VisibleMessagesAsync(competitionId)).AsNoTracking().SingleOrDefaultAsync(m => m.Id == messageId, Cancellation);
        if (message == null) return NotFound();
        if (message.UserId == null || message.UserId == UserId)
            return BadRequest(new { message = "You can't block yourself or a deleted account." });
        var blockedId = message.UserId;
        if (await db.ChatUserBlocks.AnyAsync(b => b.UserId == UserId && b.BlockedUserId == blockedId, Cancellation))
            return NoContent();
        var block = new ChatUserBlock
        {
            UserId = UserId,
            BlockedUserId = blockedId,
            CreatedAt = time.GetUtcNow().UtcDateTime
        };
        db.ChatUserBlocks.Add(block);
        try { await db.SaveChangesAsync(Cancellation); }
        catch (DbUpdateException)
        {
            db.Entry(block).State = EntityState.Detached;
            if (await db.ChatUserBlocks.AnyAsync(b => b.UserId == UserId && b.BlockedUserId == blockedId, Cancellation))
                return NoContent();
            if (!await db.Users.AnyAsync(u => u.Id == blockedId, Cancellation))
                return BadRequest(new { message = "That account has been deleted." });
            throw;
        }
        return NoContent();
    }

    [HttpGet("api/chat/blocked-users")]
    public Task<List<BlockedChatUserDto>> BlockedUsers() => db.ChatUserBlocks.AsNoTracking()
        .Where(b => b.UserId == UserId).OrderBy(b => b.BlockedUserId)
        .Select(b => new BlockedChatUserDto(b.BlockedUserId)).ToListAsync(Cancellation);

    [HttpDelete("api/chat/blocked-users/{userId}")]
    public async Task<IActionResult> Unblock(string userId)
    {
        await db.ChatUserBlocks.Where(b => b.UserId == UserId && b.BlockedUserId == userId).ExecuteDeleteAsync(Cancellation);
        return NoContent();
    }

    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    [HttpGet("api/competitions/{competitionId:int}/chat/reports")]
    public Task<List<ChatReportDto>> Reports(int competitionId, [FromQuery] int take = 50, [FromQuery] int? beforeId = null)
        => db.ChatReports.AsNoTracking().Where(r => r.Message.CompetitionId == competitionId
            && (beforeId == null || r.Id < beforeId))
            .OrderByDescending(r => r.Id).Take(Math.Clamp(take, 1, 100))
            .Select(r => new ChatReportDto(r.Id, r.MessageId, r.ReporterUserId, r.Reason, r.CreatedAt, r.ResolvedAt))
            .ToListAsync(Cancellation);

    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    [HttpGet("api/competitions/{competitionId:int}/chat/reports/{reportId:int}/message")]
    public async Task<ActionResult<ChatMessageDto>> ReportedMessage(int competitionId, int reportId)
    {
        // Explicit moderation access does not depend on the moderator's personal block list.
        var message = await db.ChatReports.AsNoTracking()
            .Where(r => r.Id == reportId && r.Message.CompetitionId == competitionId)
            .Select(r => r.Message).SingleOrDefaultAsync(Cancellation);
        return message == null ? NotFound() : message.ToDto();
    }

    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    [HttpPost("api/competitions/{competitionId:int}/chat/reports/{reportId:int}/resolve")]
    public async Task<IActionResult> Resolve(int competitionId, int reportId)
    {
        var reports = db.ChatReports.Where(r => r.Id == reportId && r.Message.CompetitionId == competitionId);
        if (!await reports.AnyAsync(Cancellation)) return NotFound();
        await reports.Where(r => r.ResolvedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.ResolvedAt, time.GetUtcNow().UtcDateTime), Cancellation);
        return NoContent();
    }
}
