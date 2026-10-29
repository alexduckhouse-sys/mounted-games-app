using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Apple;
using MountedGames.Api.Services.Apple;
namespace MountedGames.Api.Controllers;

[ServiceFilter(typeof(AppleConflictFilter))]
[ApiController, AllowAnonymous, Route("api/apple"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AppleLiveActivitiesController(AppDbContext db, AppleOptions options, AppleSecrets secrets,
    ArrivalBookingService transactionLock, AppleDeliveryRunner runner, TimeProvider clock) : ControllerBase
{
    [HttpGet("availability")] public IActionResult Availability() => Ok(new { liveActivities = options.LiveReady, wallet = options.WalletReady });
    [HttpPost("installations"), EnableRateLimiting("auth")]
    public async Task<ActionResult<NativeInstallationDto>> Create(CancellationToken ct)
    {
        if (!options.LiveReady) return StatusCode(503);
        var token = AppleSecrets.NewToken(); var row = new NativeInstallation { Id = Guid.NewGuid(), CapabilityHash = AppleSecrets.Hash(token), CreatedAt = clock.GetUtcNow().UtcDateTime, LastSeenAt = clock.GetUtcNow().UtcDateTime };
        db.Add(row); await db.SaveChangesAsync(ct); return new NativeInstallationDto(row.Id, token);
    }
    private async Task<NativeInstallation?> Installation(Guid id, CancellationToken ct)
    {
        if (!options.LiveReady) return null;
        var row = await db.Set<NativeInstallation>().SingleOrDefaultAsync(x => x.Id == id, ct);
        var auth = Request.Headers.Authorization.ToString();
        return row != null && auth.StartsWith("AppleInstallation ", StringComparison.Ordinal) && AppleSecrets.Matches(auth[18..], row.CapabilityHash) ? row : null;
    }
    [HttpPut("installations/{installationId:guid}/activities")]
    public async Task<IActionResult> Upsert(Guid installationId, AppleActivityRequest request, CancellationToken ct)
    {
        return await transactionLock.ExecuteAsync<IActionResult>(async () => {
 var installation = await Installation(installationId, ct); if (installation == null) return Unauthorized();
        var now = clock.GetUtcNow();
        if (request.Sandbox != options.Sandbox || request.StartedAt > now.AddMinutes(1) || request.StartedAt < now.AddHours(-8)) return BadRequest();
        if (!await db.Teams.AnyAsync(x => x.Id == request.TeamId && x.CompetitionId == request.CompetitionId, ct)) return NotFound();
        var row = await db.Set<LiveActivityRegistration>().SingleOrDefaultAsync(x => x.InstallationId == installationId && x.ActivityId == request.ActivityId, ct);
        if (row == null)
        {
            if (await db.Set<LiveActivityRegistration>().CountAsync(x => x.InstallationId == installationId && !x.Ended && x.ExpiresAt > now.UtcDateTime, ct) >= 1) return Conflict(new { message = "Stop the current Lock Screen card before choosing another team." });
            row = new LiveActivityRegistration { Id = Guid.NewGuid(), InstallationId = installationId, ActivityId = request.ActivityId, CompetitionId = request.CompetitionId, TeamId = request.TeamId, ExpiresAt = request.StartedAt.AddHours(8).UtcDateTime, Sandbox = request.Sandbox }; db.Add(row);
        }
        else if (row.TeamId != request.TeamId || row.CompetitionId != request.CompetitionId || row.EndRequested || row.Ended) return Conflict();
        row.ProtectedPushToken = secrets.Protect(request.PushToken.ToLowerInvariant(), "activity-push"); row.Version++; row.NextAttemptAt = now.UtcDateTime; row.Attempts = 0;
        installation.LastSeenAt = now.UtcDateTime; await db.SaveChangesAsync(ct);
        return Ok();

        }, ct);
    }
    [HttpDelete("installations/{installationId:guid}/activities/{activityId}")]
    public async Task<IActionResult> End(Guid installationId, string activityId, CancellationToken ct)
    {
        if (await Installation(installationId, ct) == null) return Unauthorized();
        await db.Set<LiveActivityRegistration>().Where(x => x.InstallationId == installationId && x.ActivityId == activityId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.Ended, true).SetProperty(x => x.Version, x => x.Version + 1).SetProperty(x => x.ProtectedPushToken, ""), ct);
        return NoContent();
    }
    [HttpPost("delivery/wake")]
    public async Task<IActionResult> Wake(CancellationToken ct)
    {
        var auth = Request.Headers.Authorization.ToString();
        if (options.WakeKey?.Length < 32 || options.WakeKey == null || !auth.StartsWith("Bearer ", StringComparison.Ordinal)
            || !AppleSecrets.Matches(auth[7..], AppleSecrets.Hash(options.WakeKey))) return Unauthorized();
        return Ok(new { accepted = await runner.RunAsync(ct) });
    }
}
