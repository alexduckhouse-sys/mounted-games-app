using System.Net;
using System.Net.Sockets;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/ip-blocks")]
[Authorize(Roles = Roles.MasterAdmin)]
public class IpBlocksController : ControllerBase
{
    private readonly AppDbContext _db;
    public IpBlocksController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IEnumerable<IpBlockDto>> List() =>
        // Networks added by blocking an account are managed with that account (unblock it to lift them), so they aren't listed.
        (await _db.IpBlocks.Where(i => i.BlockedAccountUserId == null).OrderByDescending(i => i.CreatedAt).ToListAsync())
            .Select(i => new IpBlockDto(i.Id, Mask(i.IpAddress), i.Reason, i.CreatedByUserId, i.CreatedAt));

    [HttpPost]
    public async Task<ActionResult<IpBlockDto>> Create(CreateIpBlockRequest req)
    {
        var ip = req.IpAddress?.Trim();
        if (string.IsNullOrWhiteSpace(ip)) return BadRequest("IP address is required.");
        if (ip.Length > 45 || !IPAddress.TryParse(ip, out var address) || (!ip.Contains('.') && !ip.Contains(':')))
            return BadRequest(new { message = "Enter a valid IPv4 or IPv6 address." });
        ip = address.ToString();
        if (req.Reason?.Trim().Length > 1000)
            return BadRequest(new { message = "Keep the reason to 1000 characters or fewer." });
        if (await _db.IpBlocks.AnyAsync(b => b.IpAddress == ip))
            return Conflict(new { message = "IP already blocked." });

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var block = new IpBlock { IpAddress = ip, Reason = req.Reason?.Trim(), CreatedByUserId = userId };
        _db.IpBlocks.Add(block);
        await _db.SaveChangesAsync();
        return new IpBlockDto(block.Id, Mask(block.IpAddress), block.Reason, block.CreatedByUserId, block.CreatedAt);
    }

    private static string Mask(string value)
    {
        if (!IPAddress.TryParse(value, out var address)) return "Hidden address";
        var bytes = address.GetAddressBytes();
        return address.AddressFamily == AddressFamily.InterNetwork
            ? $"{bytes[0]}.{bytes[1]}.{bytes[2]}.*"
            : $"{Convert.ToHexString(bytes.AsSpan(0, 2)).ToLowerInvariant()}:{Convert.ToHexString(bytes.AsSpan(2, 2)).ToLowerInvariant()}:*";
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var block = await _db.IpBlocks.FindAsync(id);
        if (block is null || block.BlockedAccountUserId is not null) return NotFound();
        _db.IpBlocks.Remove(block);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
