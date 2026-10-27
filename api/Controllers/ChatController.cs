using MountedGames.Api.Services.Accounts;
using System.Security.Claims;
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
    private readonly ScoringService _scoring;

    public ChatController(AppDbContext db, UserManager<AppUser> users, ILiveBroadcaster live, ScoringService scoring)
    {
        _db = db;
        _users = users;
        _live = live;
        _scoring = scoring;
    }

    [HttpGet]
    public async Task<IEnumerable<ChatMessageDto>> Recent(int competitionId, [FromQuery] int take = 100)
    {
        take = Math.Clamp(take, 1, 500);
        var userId = _users.GetUserId(User);
        var query = _db.ChatMessages.Where(m => m.CompetitionId == competitionId)
            .VisibleTo(userId, User.IsInRole(Roles.Admin))
            .WithoutBlockedAuthors(_db, userId);
        var messages = await query
            .OrderByDescending(m => m.CreatedAt)
            .Take(take)
            .ToListAsync();
        messages.Reverse();
        return messages.Select(m => m.ToDto());
    }

    /// <summary>
    /// Any signed-in user can message the organisers privately; those messages are seen only by
    /// admins and the sender. An admin's message goes to the public feed, unless it replies to a
    /// user's thread (<c>ReplyToUserId</c>), in which case only admins and that user see it.
    /// </summary>
    [HttpPost]
    [Authorize]
    public async Task<ActionResult<ChatMessageDto>> Post(int competitionId, PostChatMessageRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Body)) return BadRequest();
        if (!await _db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();

        var user = await _users.GetUserAsync(User);
        if (user is null || user.LockoutEnd == DateTimeOffset.MaxValue
            || user.LockedAt != null || user.BlockedAt != null) return Unauthorized();
        var isAdmin = User.IsInRole(Roles.Admin);
        var replyTo = string.IsNullOrWhiteSpace(req.ReplyToUserId) ? null : req.ReplyToUserId.Trim();
        if (replyTo is not null)
        {
            if (!isAdmin) return Forbid();
            // Only into a thread that exists: an admin can't push private messages at arbitrary accounts.
            var hasThread = await _db.ChatMessages.AnyAsync(m =>
                m.CompetitionId == competitionId && m.AdminOnly && m.UserId == replyTo);
            if (!hasThread) return BadRequest(new { message = "That person hasn't messaged the organisers." });
            if (await ChatModeration.IsDirectMessageBlockedAsync(_db, user.Id, replyTo, HttpContext.RequestAborted))
                return StatusCode(403, new { message = "You can't send a private reply to this person." });
        }

        if (!isAdmin)
        {
            if (await _db.IsIpBlockedAsync(HttpContext))
                return StatusCode(403, new { message = "Posting from this network is blocked." });
        }

        var claimName = string.Equals(user.Email, "admin@mg.local", StringComparison.OrdinalIgnoreCase)
            ? User.FindFirstValue("fullName")
            : null;
        var authorName = !string.IsNullOrWhiteSpace(claimName) ? claimName
            : !string.IsNullOrWhiteSpace(user.FullName) ? user.FullName
            : user.Email ?? "Organiser";
        if (authorName.Length > 60) authorName = authorName[..60];

        var msg = new ChatMessage
        {
            CompetitionId = competitionId,
            UserId = user.Id,
            AuthorName = authorName,
            Body = ProfanityFilter.Clean(req.Body.Trim()),
            Type = ChatMessageType.Chat,
            AdminOnly = !isAdmin || replyTo is not null,
            RecipientUserId = replyTo,
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
        };
        _db.ChatMessages.Add(msg);
        await _db.SaveChangesAsync();
        var dto = msg.ToDto();
        if (msg.AdminOnly)
            await _live.AdminOnlyChatMessage(competitionId, user.Id, dto, replyTo);
        else
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
        if (IpRetention.IsHashed(msg.IpAddress))
            return BadRequest(new { message = "That address is no longer stored; addresses are removed from messages after 30 days." });
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
    public async Task<ActionResult<ChatMessageDto>> Announce(int competitionId, AnnouncementRequest req,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(req.Body) || req.Body.Length > 2000 || req.Tag?.Length > 100)
            return BadRequest();
        if (!await _db.Competitions.AnyAsync(c => c.Id == competitionId, cancellationToken)) return NotFound();
        var tag = req.Tag?.Trim();
        var body = ProfanityFilter.Clean(req.Body.Trim());
        var user = await _users.GetUserAsync(User);
        if (user is null || user.LockoutEnd == DateTimeOffset.MaxValue
            || user.LockedAt != null || user.BlockedAt != null) return Unauthorized();
        var claimName = string.Equals(user.Email, "admin@mg.local", StringComparison.OrdinalIgnoreCase)
            ? User.FindFirstValue("fullName") : null;
        var authorName = !string.IsNullOrWhiteSpace(claimName) ? claimName : (user?.FullName ?? "Organiser");
        ChatMessage msg;
        List<ChatMessage> previous = [];
        try
        {
            if (tag?.StartsWith("missing-team:", StringComparison.OrdinalIgnoreCase) == true)
            {
                if (!int.TryParse(tag["missing-team:".Length..], out var heatId) || heatId < 1) return BadRequest();
                msg = await _scoring.CreateMissingTeamCallAsync(heatId, competitionId, null, body,
                    user?.Id, authorName, cancellationToken);
            }
            else
            {
                if (string.Equals(tag, "pinned", StringComparison.OrdinalIgnoreCase)) tag = "pinned";
                msg = await _scoring.WithChatLockAsync(competitionId, async () =>
                {
                    previous = tag == "pinned" ? await ClearPinnedTagsAsync(competitionId, cancellationToken) : [];
                    var announcement = new ChatMessage
                    {
                        CompetitionId = competitionId, UserId = user?.Id,
                        AuthorName = authorName.Length > 60 ? authorName[..60] : authorName,
                        Body = body, Type = ChatMessageType.Announcement, Tag = tag,
                    };
                    _db.ChatMessages.Add(announcement);
                    await _db.SaveChangesAsync(cancellationToken);
                    return announcement;
                }, cancellationToken);
            }
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreConflictException ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (ScoringController.IsScoringConcurrency(ex))
        { return Conflict(new { message = "The announcement changed on another device. Please try again." }); }
        foreach (var old in previous) await BroadcastAnnouncementAsync(old);
        await BroadcastAnnouncementAsync(msg);
        return msg.ToDto();
    }

    [HttpPost("{messageId:int}/pin")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<ChatMessageDto>> PinAnnouncement(int competitionId, int messageId,
        CancellationToken cancellationToken = default)
    {
        List<ChatMessage> previous = [];
        ChatMessage msg;
        bool? shouldPin = null;
        try
        {
            msg = await _scoring.WithChatLockAsync(competitionId, async () =>
            {
                var message = await _db.ChatMessages
                    .FirstOrDefaultAsync(m => m.Id == messageId && m.CompetitionId == competitionId, cancellationToken)
                    ?? throw new KeyNotFoundException();
                if (message.AdminOnly || message.RecipientUserId != null)
                    throw new ScoreValidationException("Private messages cannot be pinned publicly.");
                if (message.Tag?.StartsWith("missing-team", StringComparison.OrdinalIgnoreCase) == true)
                    throw new ScoreValidationException("Ring calls clear when their heat starts and cannot be pinned.");
                // Keep the intended state when the provider retries after an ambiguous commit.
                shouldPin ??= !string.Equals(message.Tag, "pinned", StringComparison.OrdinalIgnoreCase);
                previous.AddRange(await ClearPinnedTagsAsync(competitionId, cancellationToken));
                previous.RemoveAll(m => m.Id == messageId);
                message.Type = ChatMessageType.Announcement;
                message.Tag = shouldPin.Value ? "pinned" : null;
                await _db.SaveChangesAsync(cancellationToken);
                return message;
            }, cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (Exception ex) when (ScoringController.IsScoringConcurrency(ex))
        { return Conflict(new { message = "The pinned announcement changed on another device. Please try again." }); }
        foreach (var old in previous.DistinctBy(m => m.Id)) await BroadcastAnnouncementAsync(old);
        await BroadcastAnnouncementAsync(msg);
        return msg.ToDto();
    }

    private async Task<List<ChatMessage>> ClearPinnedTagsAsync(int competitionId, CancellationToken cancellationToken)
    {
        var messages = await _db.ChatMessages.Where(m => m.CompetitionId == competitionId
                && m.Tag != null && m.Tag.ToLower() == "pinned" && !m.AdminOnly && m.RecipientUserId == null)
            .ToListAsync(cancellationToken);
        foreach (var message in messages) message.Tag = null;
        return messages;
    }

    private async Task BroadcastAnnouncementAsync(ChatMessage message)
    {
        var dto = message.ToDto();
        await _live.Announcement(message.CompetitionId, dto);
        await _live.ChatMessage(message.CompetitionId, dto);
    }
}
