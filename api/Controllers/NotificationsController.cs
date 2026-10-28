using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Services.Notifications;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/internal/notifications")]
public sealed class NotificationsController(ReminderRunner runner, IConfiguration configuration, AppDbContext db) : ControllerBase
{
    /// <summary>GET supports cron runners; POST supports a manual test trigger. Neither is enabled without a strong server secret.</summary>
    [HttpGet("run")]
    [HttpPost("run")]
    [AllowAnonymous]
    public async Task<IActionResult> Run(CancellationToken ct)
    {
        var expected = configuration["Notifications:RunnerSecret"];
        if (string.IsNullOrEmpty(expected) || Encoding.UTF8.GetByteCount(expected) < 32) return NotFound();
        var supplied = Request.Headers.Authorization.ToString();
        if (!supplied.StartsWith("Bearer ", StringComparison.Ordinal)
            || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(supplied[7..])),
                SHA256.HashData(Encoding.UTF8.GetBytes(expected)))) return Unauthorized();
        Response.Headers.CacheControl = "no-store";
        return Ok(await runner.RunAsync(ct));
    }

    [HttpGet("status")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var counts = await db.NotificationDeliveries.GroupBy(d => d.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct);
        var lastActivityAt = await db.NotificationDeliveries.MaxAsync(d => (DateTime?)d.UpdatedAt, ct);
        var recoveredLeases = await db.NotificationDeliveries.SumAsync(d => d.RecoveredLeases, ct);
        return Ok(new { lastActivityAt, recoveredLeases, counts });
    }
}
