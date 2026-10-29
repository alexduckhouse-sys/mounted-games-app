using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services.EventTools;
using MountedGames.Api.Services.TackCheck;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Tack check per age group and the passport check on arrival. Everything is for the competition's staff except
/// the Tack &amp; Turnout table, which shows team totals the public may see.
/// </summary>
[ApiController]
[Route("api/event-tools/competitions/{competitionId:int}")]
public sealed class TackCheckController(AppDbContext db, MountedGames.Api.Hubs.ILiveBroadcaster live) : ControllerBase
{
    [HttpGet("tack-check")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<TackCheckBoardDto>> Board(int competitionId, CancellationToken ct)
        => await new TackCheckService(db).BoardAsync(competitionId, ct);

    [HttpPut("tack-check/sections/{sectionId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<TackCheckSectionDto>> SaveSettings(
        int competitionId, int sectionId, SaveTackCheckSettingsRequest request, CancellationToken ct)
        => Run("Tack check not saved", async () =>
        {
            var result = await new TackCheckService(db).SaveSettingsAsync(competitionId, sectionId, request, ct);
            await BroadcastStandingsAsync(competitionId, sectionId);
            return result;
        });

    [HttpPut("tack-check/sections/{sectionId:int}/teams/{teamId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<TackCheckSectionDto>> SaveMarks(
        int competitionId, int sectionId, int teamId, SaveTackCheckMarksRequest request, CancellationToken ct)
        => Run("Marks not saved", async () =>
        {
            var result = await new TackCheckService(db)
                .SaveMarksAsync(competitionId, sectionId, teamId, request, User.FindFirstValue(ClaimTypes.NameIdentifier), ct);
            await BroadcastStandingsAsync(competitionId, sectionId, teamId);
            return result;
        });

    /// <summary>The Tack &amp; Turnout table: team points per sector in sections that score their tack check.</summary>
    [HttpGet("tack-check/leaderboard")]
    [AllowAnonymous]
    public async Task<ActionResult<TackLeaderboardDto>> Leaderboard(int competitionId, CancellationToken ct)
    {
        if (!await db.Competitions.AnyAsync(c => c.Id == competitionId, ct)) return NotFound();
        return await new TackCheckService(db).LeaderboardAsync(competitionId, ct);
    }

    /// <summary>The printable tack check forms. Staff only, because they list riders by name.</summary>
    [HttpGet("print/tack-check")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<PrintableTackCheckDto>> Printable(int competitionId, CancellationToken ct)
    {
        var result = await new TackCheckService(db).PrintableAsync(competitionId, ct);
        return result is null ? NotFound() : result;
    }

    [HttpGet("passport-check")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<PassportCheckBoardDto>> PassportBoard(int competitionId, CancellationToken ct)
    {
        var result = await new PassportCheckService(db).BoardAsync(competitionId, ct);
        return result is null ? NotFound() : result;
    }

    [HttpPut("passport-check/settings")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<PassportCheckBoardDto>> SavePassportSettings(
        int competitionId, SavePassportCheckSettingsRequest request, CancellationToken ct)
    {
        var service = new PassportCheckService(db);
        if (!await service.SetEnabledAsync(competitionId, request.Enabled, ct)) return NotFound();
        return (await service.BoardAsync(competitionId, ct))!;
    }

    [HttpPut("passport-check/teams/{teamId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<PassportCheckPonyDto>> SetPassportChecked(
        int competitionId, int teamId, SetPassportCheckRequest request, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var name = userId is null ? null : await db.Users.Where(u => u.Id == userId).Select(u => u.FullName).SingleOrDefaultAsync(ct);
        return await Run("Passport check not saved", () => new PassportCheckService(db)
            .SetCheckedAsync(competitionId, teamId, request, userId, name, ct));
    }

    [HttpGet("/api/event-tools/certified-horses/lookup")]
    [Authorize]
    public ActionResult<CertifiedHorseLookupDto> LookupCertifiedHorse()
        => Problem(statusCode: 410, title: "Passport lookup retired",
            detail: "Open the pony on its authorised declaration or the event passport board.");

    /// <summary>Tack check bonus points are part of the standings, so live screens refetch them.</summary>
    private Task BroadcastStandingsAsync(int competitionId, int sectionId, int? teamId = null)
        => live.ResultsUpdated(competitionId, new { sectionId, teamId, tackCheck = true });

    private async Task<ActionResult<T>> Run<T>(string title, Func<Task<T>> work)
    {
        try { return await work(); }
        catch (EventToolsException ex) { return Problem(statusCode: ex.StatusCode, title: title, detail: ex.Message); }
    }
}
