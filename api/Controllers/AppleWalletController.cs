using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Security;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Apple;
using MountedGames.Api.Services.Apple;
namespace MountedGames.Api.Controllers;

[ServiceFilter(typeof(AppleConflictFilter))]
[ApiController, AllowAnonymous, Route("api/apple/wallet/v1"), EnableRateLimiting("public-read")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AppleWalletController(AppDbContext db, AppleOptions options, AppleSecrets secrets,
    ArrivalBookingService bookings, ApplePassIssuer issuer, TimeProvider clock) : ControllerBase
{
    private async Task<WalletPass?> Authorise(string type, string serial, CancellationToken ct)
    {
        if (!options.WalletReady || type != options.PassTypeId || serial.Length != 32) return null;
        var pass = await db.Set<WalletPass>().SingleOrDefaultAsync(x => x.Serial == serial, ct);
        var auth = Request.Headers.Authorization.ToString();
        return pass != null && auth.StartsWith("ApplePass ", StringComparison.Ordinal) && AppleSecrets.Matches(auth[10..], pass.AuthenticationTokenHash) ? pass : null;
    }
    [HttpPost("devices/{device}/registrations/{type}/{serial}")]
    public async Task<IActionResult> Register(string device, string type, string serial, WalletRegisterRequest request, CancellationToken ct)
    {
        if (device.Length is < 16 or > 256) return BadRequest();
        return await bookings.ExecuteAsync<IActionResult>(async () => {

        var pass = await Authorise(type, serial, ct); if (pass == null) return Unauthorized();
        var hash = AppleSecrets.Hash(device);
        var registration = await db.Set<WalletDeviceRegistration>().SingleOrDefaultAsync(x => x.WalletPassId == pass.Id && x.DeviceHash == hash, ct);
        var added = registration == null;
        if (added) {
            if (await db.Set<WalletDeviceRegistration>().CountAsync(x => x.WalletPassId == pass.Id, ct) >= 20
                || await db.Set<WalletDeviceRegistration>().CountAsync(x => x.DeviceHash == hash, ct) >= 200) return Conflict();
            registration = new() { WalletPassId = pass.Id, DeviceHash = hash }; db.Add(registration);
        }
        // A previous send must not delete or acknowledge a registration whose device token just rotated.
        registration!.LeaseToken = null; registration.LeaseUntil = null;
        registration!.ProtectedPushToken = secrets.Protect(request.PushToken.ToLowerInvariant(), "wallet-push");
        registration.PendingCursor = pass.ChangeCursor; registration.NextAttemptAt = clock.GetUtcNow().UtcDateTime; registration.Attempts = 0;
        await db.SaveChangesAsync(ct);  return StatusCode(added ? 201 : 200);

        }, ct);
    }
    [HttpDelete("devices/{device}/registrations/{type}/{serial}")]
    public async Task<IActionResult> Unregister(string device, string type, string serial, CancellationToken ct)
    {
        var pass = await Authorise(type, serial, ct); if (pass == null) return Unauthorized();
        var hash = AppleSecrets.Hash(device); await db.Set<WalletDeviceRegistration>().Where(x => x.WalletPassId == pass.Id && x.DeviceHash == hash).ExecuteDeleteAsync(ct); return Ok();
    }
    [PublicRead]
    [HttpGet("devices/{device}/registrations/{type}")]
    public async Task<IActionResult> Changed(string device, string type, [FromQuery] string? passesUpdatedSince, CancellationToken ct)
    {
        if (!options.WalletReady || type != options.PassTypeId || device.Length is < 16 or > 256) return NoContent();
        long since = 0; if (passesUpdatedSince != null && (!long.TryParse(passesUpdatedSince, out since) || since < 0)) return BadRequest();
        return await bookings.ExecuteAsync<IActionResult>(async () => {
 var hash = AppleSecrets.Hash(device);
        var passes = await (from pass in db.Set<WalletPass>() join registration in db.Set<WalletDeviceRegistration>() on pass.Id equals registration.WalletPassId
            where registration.DeviceHash == hash select pass).ToListAsync(ct);
        foreach (var pass in passes)
        {
            var booking = await db.Set<ArrivalBooking>().Include(x => x.Sources).ThenInclude(x => x.Allocations).SingleOrDefaultAsync(x => x.Id == pass.ArrivalBookingId, ct);
            if (booking != null) await bookings.RefreshPassAsync(booking, false, ct);
        }
        var watermark = await db.Set<AppleChangeClock>().Select(x => x.Value).SingleAsync(ct);
        var serials = passes.Where(x => passesUpdatedSince == null || x.ChangeCursor > since).Select(x => x.Serial).ToArray();
         return serials.Length == 0 ? NoContent() : Ok(new { serialNumbers = serials, lastUpdated = watermark.ToString(System.Globalization.CultureInfo.InvariantCulture) });

        }, ct);
    }
    [PublicRead]
    [HttpGet("passes/{type}/{serial}")]
    public async Task<IActionResult> Latest(string type, string serial, CancellationToken ct)
    {
        return await bookings.ExecuteAsync<IActionResult>(async () => {
 var pass = await Authorise(type, serial, ct); if (pass == null) return Unauthorized();
        var booking = await db.Set<ArrivalBooking>().Include(x => x.Sources).ThenInclude(x => x.Allocations).SingleAsync(x => x.Id == pass.ArrivalBookingId, ct);
        await bookings.RefreshPassAsync(booking, false, ct);
        var modified = new DateTimeOffset(DateTime.SpecifyKind(pass.ChangedAt, DateTimeKind.Utc));
        Response.Headers.LastModified = modified.ToString("R"); Response.Headers.ETag = $"\"{pass.ChangeCursor}\"";
        if (Request.Headers.IfNoneMatch == Response.Headers.ETag) {  return StatusCode(304); }
        if (Request.Headers.IfNoneMatch.Count == 0 && DateTimeOffset.TryParse(Request.Headers.IfModifiedSince, out var since)
            && modified.ToUnixTimeSeconds() <= since.ToUnixTimeSeconds()) {  return StatusCode(304); }
        try { var bytes = issuer.Issue(pass, await bookings.ProjectAsync(booking, ct));  return File(bytes, "application/vnd.apple.pkpass"); }
        catch (Exception ex) when (ex is InvalidOperationException or System.Security.Cryptography.CryptographicException or FormatException) { return StatusCode(503); }

        }, ct);
    }
    // Apple's diagnostics can contain tokens or personal data. Deliberately discard rather than logging.
    [HttpPost("log"), RequestSizeLimit(8192)] public IActionResult Log() => Ok();
}
