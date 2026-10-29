using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Security;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Stats;

namespace MountedGames.Api.Controllers;

/// <summary>
/// The statistics hub (<c>/stats</c> on the web). Anyone, signed in or not, may search, browse and see a full profile:
/// headline numbers, per-game breakdown, entries, partnerships, clubs and seasons. The only thing that varies by caller
/// is names: site admins see riders' full names, everyone else sees what each rider chose to show (initials only for
/// those who asked). The service decides that from the caller.
/// Every call is limited per user or address by the <c>stats</c> policy (<c>RateLimits:StatsPerMinute</c>).
/// </summary>
[ApiController]
[AllowAnonymous]
[PublicRead]
[EnableRateLimiting(RequestLimits.StatsPolicy)]
[Route("api/stats")]
public sealed class StatsController(AppDbContext db, StandingsService standings) : ControllerBase
{
    private readonly StatsService _stats = new(db, standings);

    private StatsViewer Viewer => new(User.IsInRole(Roles.Admin));

    [HttpGet("search")]
    public async Task<ActionResult<StatsSearchDto>> Search([FromQuery] string? q, CancellationToken ct)
        => await _stats.SearchAsync(q, Viewer, ct) is { } result ? result : BadQuery();

    /// <summary>A page of every rider, pony, team or club (<c>kind</c> 0 to 3), optionally narrowed by <c>q</c>.</summary>
    [HttpGet("browse")]
    public async Task<ActionResult<StatsBrowseDto>> Browse([FromQuery] StatsSubjectKind? kind, [FromQuery] string? q, [FromQuery] int page = 1, CancellationToken ct = default)
    {
        if (kind is null || !Enum.IsDefined(kind.Value))
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid kind", detail: "Kind must be 0 (rider), 1 (pony), 2 (team) or 3 (club).");
        return await _stats.BrowseAsync(kind.Value, q, page, Viewer, ct) is { } result ? result : BadQuery();
    }

    [HttpGet("riders")]
    public Task<ActionResult<StatsProfileDto>> Rider([FromQuery] string? name, CancellationToken ct)
        => Profile(name, () => _stats.RiderAsync(name, Viewer, ct));

    [HttpGet("ponies")]
    public Task<ActionResult<StatsProfileDto>> Pony([FromQuery] string? name, CancellationToken ct)
        => Profile(name, () => _stats.PonyAsync(name, Viewer, ct));

    [HttpGet("teams")]
    public Task<ActionResult<StatsProfileDto>> Team([FromQuery] string? name, CancellationToken ct)
        => Profile(name, () => _stats.TeamAsync(name, Viewer, ct));

    [HttpGet("clubs")]
    public Task<ActionResult<StatsProfileDto>> Club([FromQuery] string? name, CancellationToken ct)
        => Profile(name, () => _stats.ClubAsync(name, Viewer, ct));

    /// <summary>Game statistics for a season team profile, over the event teams linked to it.</summary>
    [HttpGet("team-profiles/{id:guid}")]
    public async Task<ActionResult<StatsProfileDto>> TeamProfile(Guid id, CancellationToken ct)
        => await _stats.TeamProfileAsync(id, Viewer, ct) is { } result ? result : NotFound();

    /// <summary>Earlier finishes of the teams in one age group, for the stream's Favourites card.</summary>
    [HttpGet("competitions/{competitionId:int}/favourites-history")]
    public async Task<ActionResult<List<FavouriteHistoryDto>>> FavouriteHistory(int competitionId, [FromQuery] int sectionId, CancellationToken ct)
        => await db.CompetitionSections.AsNoTracking().AnyAsync(s => s.Id == sectionId && s.CompetitionId == competitionId, ct)
            ? await _stats.FavouriteHistoryAsync(competitionId, sectionId, ct)
            : NotFound();

    private async Task<ActionResult<StatsProfileDto>> Profile(string? name, Func<Task<StatsProfileDto?>> load)
    {
        if (!StatsNames.IsValidQuery(StatsNames.Normalise(name))) return BadQuery();
        return await load() is { } result ? result : NotFound();
    }

    private ObjectResult BadQuery() => Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid search",
        detail: $"Type between {StatsNames.MinQueryLength} and {StatsNames.MaxQueryLength} characters.");
}
