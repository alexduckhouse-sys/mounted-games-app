using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Security;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Stats;

namespace MountedGames.Api.Controllers;

/// <summary>
/// The statistics hub (<c>/stats</c> on the web). Anyone may search and see a profile's headline numbers; the
/// per-game breakdown, the list of entries and the rider and pony partnerships are for signed-in viewers only.
/// The service decides that from the caller, so the detail never leaves the API for an anonymous request.
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

    private StatsViewer Viewer => new(User.Identity?.IsAuthenticated == true, User.IsInRole(Roles.Admin));

    [HttpGet("search")]
    public async Task<ActionResult<StatsSearchDto>> Search([FromQuery] string? q, CancellationToken ct)
        => await _stats.SearchAsync(q, Viewer, ct) is { } result ? result : BadQuery();

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

    private async Task<ActionResult<StatsProfileDto>> Profile(string? name, Func<Task<StatsProfileDto?>> load)
    {
        if (!StatsNames.IsValidQuery(StatsNames.Normalise(name))) return BadQuery();
        return await load() is { } result ? result : NotFound();
    }

    private ObjectResult BadQuery() => Problem(statusCode: StatusCodes.Status400BadRequest, title: "Invalid search",
        detail: $"Type between {StatsNames.MinQueryLength} and {StatsNames.MaxQueryLength} characters.");
}
