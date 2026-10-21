using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;

namespace MountedGames.Api.Controllers;

/// <summary>
/// The overlays viewers see on a competition's live video: a producer's banner, the now-racing strip,
/// score card timing and the event's look. Anyone can read them; the people who can broadcast can change them.
/// </summary>
[ApiController]
[Route("api/competitions/{competitionId:int}/overlays")]
public class StreamOverlaysController(AppDbContext db, ILiveBroadcaster live, TimeProvider time) : ControllerBase
{
    private const int MaxLookBytes = 4000;
    private const int MaxArenas = 12;
    private const int MaxArenaLength = 80;

    [HttpGet]
    public async Task<ActionResult<StreamOverlayDto>> Get(int competitionId)
    {
        if (!await db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();
        var overlay = await db.StreamOverlays.AsNoTracking().FirstOrDefaultAsync(o => o.CompetitionId == competitionId);
        return ToDto(overlay ?? new StreamOverlay { CompetitionId = competitionId });
    }

    [HttpPut]
    [Authorize(Roles = Roles.Organiser)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<StreamOverlayDto>> Update(int competitionId, UpdateStreamOverlayRequest req)
    {
        if (!Enum.IsDefined(req.BannerStyle) || !Enum.IsDefined(req.StripMode) || !Enum.IsDefined(req.ScoreCardMode))
            return BadRequest(new { message = "Unknown overlay option." });
        var arenas = (req.BannerArenas ?? []).Select(a => a?.Trim() ?? "").Where(a => a.Length > 0).Distinct().ToList();
        if (arenas.Count > MaxArenas || arenas.Any(a => a.Length > MaxArenaLength))
            return BadRequest(new { message = "Too many arenas, or an arena name is too long." });
        var look = req.Look is { } element ? element.GetRawText() : "{}";
        if (req.Look is { ValueKind: not JsonValueKind.Object } || System.Text.Encoding.UTF8.GetByteCount(look) > MaxLookBytes)
            return BadRequest(new { message = "The look must be a JSON object of at most 4000 bytes." });

        var overlay = await db.StreamOverlays.FirstOrDefaultAsync(o => o.CompetitionId == competitionId);
        if (overlay is null)
        {
            overlay = new StreamOverlay { CompetitionId = competitionId };
            db.StreamOverlays.Add(overlay);
        }
        if (req.ExpectedRevision is { } expected && expected != overlay.Revision)
            return Conflict(ToDto(overlay));

        overlay.BannerText = string.IsNullOrWhiteSpace(req.BannerText) ? null : req.BannerText.Trim();
        overlay.BannerStyle = req.BannerStyle;
        overlay.BannerArenas = JsonSerializer.Serialize(arenas);
        overlay.StripMode = req.StripMode;
        overlay.ScoreCardMode = req.ScoreCardMode;
        overlay.ScoreCardDelaySeconds = req.ScoreCardDelaySeconds;
        overlay.ScoreCardSeconds = req.ScoreCardSeconds;
        overlay.LookJson = look;
        overlay.Revision++;
        overlay.UpdatedAt = time.GetUtcNow().UtcDateTime;
        overlay.UpdatedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (overlay.Revision == 1)
        {
            // Another producer created the row at the same moment; theirs stands.
            return Conflict(new { message = "Someone else just changed the overlays. Reload and try again." });
        }

        var dto = ToDto(overlay);
        await live.OverlayUpdated(competitionId, dto);
        return dto;
    }

    private static StreamOverlayDto ToDto(StreamOverlay o)
    {
        using var look = JsonDocument.Parse(string.IsNullOrWhiteSpace(o.LookJson) ? "{}" : o.LookJson);
        return new StreamOverlayDto(
            o.BannerText, o.BannerStyle, JsonSerializer.Deserialize<List<string>>(o.BannerArenas) ?? [],
            o.StripMode, o.ScoreCardMode, o.ScoreCardDelaySeconds, o.ScoreCardSeconds,
            look.RootElement.Clone(), o.Revision, o.Revision == 0 ? null : o.UpdatedAt);
    }
}
