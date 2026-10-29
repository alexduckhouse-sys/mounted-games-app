using Microsoft.AspNetCore.RateLimiting;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Security;

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
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public ActionResult<VapidPublicKeyResponse> VapidKey() => new VapidPublicKeyResponse(_vapid.PublicKey);

    /// <summary>Upsert a push subscription for the signed-in user.</summary>
    [HttpPost("subscribe")]
    [Authorize]
    public async Task<IActionResult> Subscribe(PushSubscribeRequest req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        if (!PushEndpointPolicy.IsAllowed(req.Endpoint)) return BadRequest();

        var existing = await _db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint);
        if (existing != null)
        {
            // Another account holds this browser endpoint. Hand it over only if the request proves it holds the
            // browser's own subscription (the keys are generated in the browser and never shared), which covers a
            // browser whose logout never managed to unsubscribe. Anyone who merely knows the endpoint gets a 409.
            if (existing.UserId != userId)
            {
                if (!KeysMatch(existing, req)) return Conflict();
                existing.UserId = userId;
            }
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

    private static bool KeysMatch(PushSubscription stored, PushSubscribeRequest req)
    {
        static bool Same(string? a, string? b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
        }
        // Evaluate both so timing doesn't reveal which key was wrong.
        var p256dh = Same(stored.P256dh, req.P256dh);
        var auth = Same(stored.Auth, req.Auth);
        return p256dh & auth;
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
