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
[Authorize(Roles = Roles.Admin)]
public class IpBlocksController : ControllerBase
{
    private readonly AppDbContext _db;
    public IpBlocksController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IEnumerable<IpBlockDto>> List() =>
        (await _db.IpBlocks.OrderByDescending(i => i.CreatedAt).ToListAsync())
            .Select(i => new IpBlockDto(i.Id, i.IpAddress, i.Reason, i.CreatedByUserId, i.CreatedAt));

    [HttpPost]
    public async Task<ActionResult<IpBlockDto>> Create(CreateIpBlockRequest req)
    {
        var ip = req.IpAddress?.Trim();
        if (string.IsNullOrWhiteSpace(ip)) return BadRequest("IP address is required.");
        if (await _db.IpBlocks.AnyAsync(b => b.IpAddress == ip))
            return Conflict(new { message = "IP already blocked." });

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var block = new IpBlock { IpAddress = ip, Reason = req.Reason?.Trim(), CreatedByUserId = userId };
        _db.IpBlocks.Add(block);
        await _db.SaveChangesAsync();
        return new IpBlockDto(block.Id, block.IpAddress, block.Reason, block.CreatedByUserId, block.CreatedAt);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var block = await _db.IpBlocks.FindAsync(id);
        if (block is null) return NotFound();
        _db.IpBlocks.Remove(block);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("mine")]
    [AllowAnonymous]
    public ActionResult<object> Mine()
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "";
        return new { ip };
    }
}
