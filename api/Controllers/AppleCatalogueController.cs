using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Apple;
namespace MountedGames.Api.Controllers;

[ApiController, Authorize, Route("api/apple/catalogue/{itemId:int}/fulfilment")]
[ServiceFilter(typeof(AppleConflictFilter))]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AppleCatalogueController(AppDbContext db) : ControllerBase
{
    private Task<CatalogueItem?> Find(int id, CancellationToken ct)
    {
        var owner = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var admin = User.IsInRole(Roles.Admin);
        return db.Set<CatalogueItem>().SingleOrDefaultAsync(x => x.Id == id && (x.SellerUserId == owner || admin), ct);
    }
    [HttpGet]
    public async Task<IActionResult> Get(int itemId, CancellationToken ct)
    {
        var item = await Find(itemId, ct); return item == null ? NotFound() : Ok(new FulfilmentRequest(item.FulfilmentKind, item.FulfilmentFromDate, item.FulfilmentUntilDate, item.Version));
    }
    [HttpPut]
    public async Task<IActionResult> Put(int itemId, FulfilmentRequest request, CancellationToken ct)
    {
        if (!AppleFulfilment.Valid(request)) return BadRequest(new { message = "Choose the booking type, first night and departure date." });
        var item = await Find(itemId, ct); if (item == null) return NotFound();
        if (item.Version != request.ExpectedVersion) return Conflict(new { message = "This item changed. Refresh it and try again." });
        item.FulfilmentKind = request.Kind;
        item.FulfilmentFromDate = AppleFulfilment.HasNights(request) ? request.FromDate : null;
        item.FulfilmentUntilDate = AppleFulfilment.HasNights(request) ? request.UntilDate : null;
        item.Version++;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { message = "This item changed. Refresh it and try again." }); }
        return Ok(new FulfilmentRequest(item.FulfilmentKind, item.FulfilmentFromDate, item.FulfilmentUntilDate, item.Version));
    }
}
