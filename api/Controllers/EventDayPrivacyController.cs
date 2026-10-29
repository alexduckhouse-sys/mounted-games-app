using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Apple;
using MountedGames.Api.Services.Vaccinations;

namespace MountedGames.Api.Controllers;

[ApiController, Authorize, Route("api/auth/me/event-day-data")]
public sealed class EventDayPrivacyController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        Response.Headers.CacheControl = "private, no-store";
        return Ok(new {
            ArrivalBookings = await AppleFeatures.ExportAccountAsync(db, id, ct),
            Vaccinations = await VaccinationPrivacy.ExportForUserAsync(db, id, ct),
            ProgrammeDecisions = await db.Set<WindRaceDecision>().AsNoTracking().Where(x => x.ActorUserId == id)
                .Select(x => new { x.CompetitionId, x.SessionId, x.ProfileId, x.Authority, x.Decision, x.CreatedAt }).ToListAsync(ct)
        });
    }
}
