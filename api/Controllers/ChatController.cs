using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{competitionId:int}/chat")]
public class ChatController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly UserManager<AppUser> _users;
    private readonly ILiveBroadcaster _live;

    public ChatController(AppDbContext db, UserManager<AppUser> users, ILiveBroadcaster live)
    {
        _db = db;
        _users = users;
        _live = live;
    }

    [HttpGet]
    public async Task<IEnumerable<ChatMessageDto>> Recent(int competitionId, [FromQuery] int take = 100)
    {
        take = Math.Clamp(take, 1, 500);
        var messages = await _db.ChatMessages
            .Where(m => m.CompetitionId == competitionId)
            .OrderByDescending(m => m.CreatedAt)
            .Take(take)
            .ToListAsync();
        messages.Reverse();
        return messages.Select(m => m.ToDto());
    }

    [HttpPost]
    public async Task<ActionResult<ChatMessageDto>> Post(int competitionId, PostChatMessageRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Body)) return BadRequest();
        if (!await _db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();

        AppUser? user = null;
        if (User.Identity?.IsAuthenticated == true)
            user = await _users.GetUserAsync(User);

        if (!User.IsInRole(Roles.Admin))
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
            if (!string.IsNullOrEmpty(ip) && await _db.IpBlocks.AnyAsync(b => b.IpAddress == ip))
                return StatusCode(403, new { message = "Posting from this network is blocked." });
        }

        var authorName = !string.IsNullOrWhiteSpace(req.AuthorName)
            ? req.AuthorName!.Trim()
            : user?.FullName
                ?? user?.Email
                ?? "Guest";
        if (authorName.Length > 60) authorName = authorName[..60];

        var msg = new ChatMessage
        {
            CompetitionId = competitionId,
            UserId = user?.Id,
            AuthorName = authorName,
            Body = req.Body.Trim(),
            Type = ChatMessageType.Chat,
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
        };
        _db.ChatMessages.Add(msg);
        await _db.SaveChangesAsync();
        var dto = msg.ToDto();
        await _live.ChatMessage(competitionId, dto);
        return dto;
    }

    [HttpDelete("{messageId:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int competitionId, int messageId)
    {
        var msg = await _db.ChatMessages.FirstOrDefaultAsync(m => m.Id == messageId && m.CompetitionId == competitionId);
        if (msg is null) return NotFound();
        _db.ChatMessages.Remove(msg);
        await _db.SaveChangesAsync();
        await _live.ChatMessageDeleted(competitionId, messageId);
        return NoContent();
    }

    [HttpPost("{messageId:int}/block-author")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<object>> BlockAuthor(int competitionId, int messageId, [FromBody] BlockAuthorRequest? req)
    {
        var msg = await _db.ChatMessages.FirstOrDefaultAsync(m => m.Id == messageId && m.CompetitionId == competitionId);
        if (msg is null) return NotFound();
        if (string.IsNullOrWhiteSpace(msg.IpAddress))
            return BadRequest(new { message = "No IP recorded for that message (posted before tracking was added)." });
        if (await _db.IpBlocks.AnyAsync(b => b.IpAddress == msg.IpAddress))
            return new { alreadyBlocked = true, ipAddress = msg.IpAddress };
        var admin = await _users.GetUserAsync(User);
        _db.IpBlocks.Add(new IpBlock
        {
            IpAddress = msg.IpAddress,
            Reason = req?.Reason ?? $"Blocked via chat message #{messageId} from {msg.AuthorName}",
            CreatedByUserId = admin?.Id,
        });
        await _db.SaveChangesAsync();
        return new { alreadyBlocked = false, ipAddress = msg.IpAddress };
    }

    [HttpPost("announcement")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<ChatMessageDto>> Announce(int competitionId, AnnouncementRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Body)) return BadRequest();
        if (!await _db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();
        var user = await _users.GetUserAsync(User);
        var msg = new ChatMessage
        {
            CompetitionId = competitionId,
            UserId = user?.Id,
            AuthorName = user?.FullName ?? "Organiser",
            Body = req.Body.Trim(),
            Type = ChatMessageType.Announcement,
            Tag = req.Tag
        };
        _db.ChatMessages.Add(msg);
        await _db.SaveChangesAsync();
        var dto = msg.ToDto();
        await _live.Announcement(competitionId, dto);
        await _live.ChatMessage(competitionId, dto);
        return dto;
    }
}
