using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Security;

namespace MountedGames.Api.Controllers;

/// <summary>
/// The small, public facts behind a shared link's preview card. The website's routing middleware
/// (<c>web/middleware.ts</c>) calls these for link-preview crawlers, which can't run the app, and builds the
/// page with the Open Graph tags. Keep the fields few: they end up in chat apps and search results.
/// </summary>
[ApiController]
[AllowAnonymous]
[PublicRead]
[EnableRateLimiting("public-read")]
[Route("api/share")]
public class ShareController(AppDbContext db) : ControllerBase
{
    // Names and dates change rarely, and a preview that is a few minutes old is harmless.
    private const string CacheControl = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

    [HttpGet("competitions/{id:int}")]
    public async Task<ActionResult<ShareCompetitionDto>> Competition(int id, CancellationToken ct)
    {
        var card = await db.Competitions.AsNoTracking()
            .Where(c => c.Id == id)
            .Select(c => new ShareCompetitionDto(c.Name, c.StartDate, c.EndDate, c.Location, c.Teams.Count))
            .FirstOrDefaultAsync(ct);
        if (card is null) return NotFound();
        Response.Headers.CacheControl = CacheControl;
        return card;
    }

    [HttpGet("team-profiles/{id:guid}")]
    public async Task<ActionResult<ShareTeamProfileDto>> TeamProfile(Guid id, CancellationToken ct)
    {
        var card = await db.Set<TeamProfile>().AsNoTracking()
            .Where(p => p.Id == id)
            .Select(p => new ShareTeamProfileDto(p.DisplayName, p.Club!.Name, p.EventTeams.Count))
            .FirstOrDefaultAsync(ct);
        if (card is null) return NotFound();
        Response.Headers.CacheControl = CacheControl;
        return card;
    }
}
