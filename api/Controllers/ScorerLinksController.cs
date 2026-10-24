using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Scorer links: the organiser's side. An owner, a competition admin (team member) or an admin makes a link for one
/// competition, lists them and revokes them. The arena name is a label only. Anyone else gets 404. The token is returned once, on creation.
/// </summary>
[ApiController]
[Authorize(Policy = CompetitionStaff.Policy)]
public class ScorerLinksController(AppDbContext db, TimeProvider time) : ControllerBase
{
    private const int MaxActiveLinks = 100;
    private string UserId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    [HttpGet("api/competitions/{competitionId:int}/scorer-links")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<ScorerLinkListDto>> List(int competitionId, CancellationToken ct)
    {
        var competition = await db.Competitions.AsNoTracking().FirstAsync(c => c.Id == competitionId, ct);
        var arenas = await ArenasAsync(competitionId, ct);
        var links = await db.ScorerLinks.AsNoTracking().Where(l => l.CompetitionId == competitionId)
            .OrderByDescending(l => l.CreatedAt).ThenByDescending(l => l.Id).ToListAsync(ct);
        return new ScorerLinkListDto(arenas, DefaultExpiry(competition), links.Select(ToDto).ToList());
    }

    [HttpPost("api/competitions/{competitionId:int}/scorer-links")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<CreatedScorerLinkDto>> Create(int competitionId, CreateScorerLinkRequest req, CancellationToken ct)
    {
        var label = req.Label.Trim();
        var arena = req.ArenaName;
        if (label.Length == 0) return BadRequest(new { message = "Add the scorer's name." });

        var competition = await db.Competitions.AsNoTracking().FirstAsync(c => c.Id == competitionId, ct);
        if (!(await ArenasAsync(competitionId, ct)).Contains(arena))
            return BadRequest(new { message = "Choose an arena that has sessions in the timetable." });

        var now = time.GetUtcNow().UtcDateTime;
        var latest = DefaultExpiry(competition);
        if (latest <= now)
            return BadRequest(new { message = "This competition has finished, so it can't have new scorer links." });
        var expiresAt = req.ExpiresAt is { } chosen ? DateTime.SpecifyKind(chosen.ToUniversalTime(), DateTimeKind.Utc) : latest;
        if (expiresAt <= now) return BadRequest(new { message = "Choose an expiry time in the future." });
        if (expiresAt > latest)
            return BadRequest(new { message = "A link can't last beyond the day after the competition ends." });

        if (await db.ScorerLinks.CountAsync(l => l.CompetitionId == competitionId && l.RevokedAt == null && l.ExpiresAt > now, ct) >= MaxActiveLinks)
            return BadRequest(new { message = $"A competition can have up to {MaxActiveLinks} active scorer links. Revoke some first." });

        var token = ScorerLinkTokens.Generate();
        var link = new ScorerLink
        {
            CompetitionId = competitionId, Label = label, ArenaName = arena,
            TokenHash = ScorerLinkTokens.Hash(token), CreatedByUserId = UserId, CreatedAt = now, ExpiresAt = expiresAt,
        };
        db.ScorerLinks.Add(link);
        await db.SaveChangesAsync(ct);
        return new CreatedScorerLinkDto(ToDto(link), token, $"/score#t={token}");
    }

    [HttpPost("api/competitions/{competitionId:int}/scorer-links/{linkId:int}/revoke")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<ScorerLinkDto>> Revoke(int competitionId, int linkId, CancellationToken ct)
    {
        var link = await db.ScorerLinks.FirstOrDefaultAsync(l => l.Id == linkId && l.CompetitionId == competitionId, ct);
        if (link is null) return NotFound();
        if (link.RevokedAt is null)
        {
            link.RevokedAt = time.GetUtcNow().UtcDateTime;
            await db.SaveChangesAsync(ct);
        }
        return ToDto(link);
    }

    /// <summary>The end of the day after the competition's last day, so an event that runs late still works.</summary>
    internal static DateTime DefaultExpiry(Competition competition) =>
        DateTime.SpecifyKind((competition.EndDate ?? competition.StartDate).Date.AddDays(2), DateTimeKind.Utc);

    private async Task<List<string>> ArenasAsync(int competitionId, CancellationToken ct)
    {
        var arenas = await db.Sessions.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId && s.ArenaName != null && s.ArenaName != "")
            .Select(s => s.ArenaName!).Distinct().OrderBy(a => a).ToListAsync(ct);
        var hasUnnamed = arenas.Count == 0 || await db.Sessions.AsNoTracking()
            .AnyAsync(s => s.CompetitionId == competitionId && s.Kind == SessionKind.Race && !s.IsBreak && (s.ArenaName == null || s.ArenaName == ""), ct);
        if (hasUnnamed && !arenas.Contains("Main arena")) arenas.Insert(0, "Main arena");
        if (!arenas.Contains("All arenas")) arenas.Add("All arenas");
        return arenas;
    }

    private static ScorerLinkDto ToDto(ScorerLink l) =>
        new(l.Id, l.Label, l.ArenaName, l.CreatedAt, l.ExpiresAt, l.LastUsedAt, l.RevokedAt);
}
