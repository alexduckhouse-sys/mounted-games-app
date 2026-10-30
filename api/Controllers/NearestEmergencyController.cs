using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services.Geo;

namespace MountedGames.Api.Controllers;

/// <summary>
/// The nearest hospital with an emergency department, for the emergency box on the organiser's printed poster.
/// Organisers and competition admins only (anyone else gets 404). The browser asks us, never the map service.
/// </summary>
[ApiController]
[Authorize(Policy = CompetitionStaff.Policy)]
public class NearestEmergencyController(AppDbContext db, NearestEmergencyService nearest) : ControllerBase
{
    /// <summary>Always 200: when the lookup can't be done the answer says <c>available: false</c> and the poster prints without it.</summary>
    [HttpGet("api/competitions/{id:int}/nearest-emergency")]
    [CompetitionAccess("id")]
    [EnableRateLimiting("geocode")]
    public async Task<ActionResult<NearestEmergencyDto>> Get(int id, CancellationToken ct)
    {
        var venue = await db.Competitions.AsNoTracking().Where(c => c.Id == id)
            .Select(c => new { c.Latitude, c.Longitude, c.Postcode }).FirstAsync(ct);
        return await nearest.FindAsync(venue.Latitude, venue.Longitude, venue.Postcode, ct);
    }
}
