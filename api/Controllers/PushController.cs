using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/push")]
public class PushController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly VapidKeyService _vapid;
    private readonly PushNotifier _push;

    public PushController(AppDbContext db, VapidKeyService vapid, PushNotifier push)
    {
        _db = db;
        _vapid = vapid;
        _push = push;
    }

    /// <summary>Public — browser fetches this to know which VAPID key to use when subscribing.</summary>
    [HttpGet("vapid-public-key")]
    [AllowAnonymous]
    public ActionResult<VapidPublicKeyResponse> VapidKey() => new VapidPublicKeyResponse(_vapid.PublicKey);

    /// <summary>Upsert a push subscription for the signed-in user.</summary>
    [HttpPost("subscribe")]
    [Authorize]
    public async Task<IActionResult> Subscribe(PushSubscribeRequest req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        if (string.IsNullOrWhiteSpace(req.Endpoint)) return BadRequest();

        var existing = await _db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint);
        if (existing != null)
        {
            existing.UserId = userId;
            existing.P256dh = req.P256dh;
            existing.Auth = req.Auth;
            existing.LastSeenAt = DateTime.UtcNow;
        }
        else
        {
            _db.PushSubscriptions.Add(new PushSubscription
            {
                UserId = userId,
                Endpoint = req.Endpoint,
                P256dh = req.P256dh,
                Auth = req.Auth,
            });
        }
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Remove one push subscription by endpoint (sent by the SW before it
    /// unsubscribes) — or, with no body, remove all subscriptions for the
    /// signed-in user (used when they toggle notifications off).
    /// </summary>
    [HttpDelete("subscribe")]
    [Authorize]
    public async Task<IActionResult> Unsubscribe([FromQuery] string? endpoint = null)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        if (!string.IsNullOrEmpty(endpoint))
        {
            var s = await _db.PushSubscriptions
                .FirstOrDefaultAsync(x => x.Endpoint == endpoint && x.UserId == userId);
            if (s is null) return NoContent();
            _db.PushSubscriptions.Remove(s);
        }
        else
        {
            var all = await _db.PushSubscriptions.Where(s => s.UserId == userId).ToListAsync();
            _db.PushSubscriptions.RemoveRange(all);
        }
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Sends a test push to the signed-in user (for debugging the wiring).</summary>
    [HttpPost("test")]
    [Authorize]
    public async Task<IActionResult> Test([FromBody] SendTestPushRequest? req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        await _push.SendToUsersAsync(
            new[] { userId },
            new PushPayload(
                Title: req?.Title?.Trim() ?? "Mounted Games — test push",
                Body: req?.Body?.Trim() ?? "If you can see this, background pushes are wired up.",
                Tag: "test",
                Url: "/teams"));
        return NoContent();
    }
}
