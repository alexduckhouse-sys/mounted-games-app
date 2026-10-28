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
/// score card timing, the prize-giving and the event's look. Anyone can read them; the people who can broadcast can change them.
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
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<StreamOverlayDto>> Update(int competitionId, UpdateStreamOverlayRequest req)
    {
        if (!Enum.IsDefined(req.BannerStyle) || !Enum.IsDefined(req.StripMode) || !Enum.IsDefined(req.ScoreCardMode) || !Enum.IsDefined(req.SponsorMode))
            return BadRequest(new { message = "Unknown overlay option." });
        var arenas = (req.BannerArenas ?? []).Select(a => a?.Trim() ?? "").Where(a => a.Length > 0).Distinct().ToList();
        if (arenas.Count > MaxArenas || arenas.Any(a => a.Length > MaxArenaLength))
            return BadRequest(new { message = "Too many arenas, or an arena name is too long." });
        var look = req.Look is { } element ? element.GetRawText() : "{}";
        if (req.Look is { ValueKind: not JsonValueKind.Object } || System.Text.Encoding.UTF8.GetByteCount(look) > MaxLookBytes)
            return BadRequest(new { message = "Those overlay settings are too big to save." });

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
        overlay.SponsorMode = req.SponsorMode;
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

    private static readonly string[] ScoreCardActions = ["show", "skip", "edit"];
    private const int MaxNames = 32;
    private const int MaxNameLength = 60;

    /// <summary>
    /// Shows a race's score card now, skips it, or changes its display (hidden rows, display names, time on
    /// screen) for every viewer. Nothing is stored and results are untouched; viewers apply it to the card they hold.
    /// </summary>
    [HttpPost("score-card")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<ScoreCardControlDto>> ControlScoreCard(int competitionId, ScoreCardControlRequest req)
    {
        if (!ScoreCardActions.Contains(req.Action)) return BadRequest(new { message = "Action must be show, skip or edit." });
        var names = (req.Names ?? new Dictionary<int, string>())
            .Where(n => !string.IsNullOrWhiteSpace(n.Value))
            .ToDictionary(n => n.Key, n => n.Value.Trim());
        if (names.Count > MaxNames || names.Values.Any(n => n.Length > MaxNameLength))
            return BadRequest(new { message = "Too many names, or a name is too long." });
        var raceInCompetition = await db.Races.AnyAsync(r => r.Id == req.RaceId && r.HeatId == req.HeatId
            && r.Heat!.Session!.CompetitionId == competitionId);
        if (!raceInCompetition) return NotFound();

        var control = new ScoreCardControlDto(req.HeatId, req.RaceId, req.Action,
            (req.HiddenTeamIds ?? []).Distinct().Take(MaxNames).ToList(), names, req.Seconds);
        await live.ScoreCardControl(competitionId, control);
        return control;
    }

    private static readonly string[] PrizeGivingActions = ["show", "clear"];
    private const int MaxPlaces = 30;

    /// <summary>
    /// Steps a prize-giving on the stream: each call carries every place given so far, so a viewer who joins part-way
    /// catches up at the next place. Team and club names are read from the event; nothing is stored.
    /// </summary>
    [HttpPost("prize-giving")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<PrizeGivingDto>> ControlPrizeGiving(int competitionId, PrizeGivingControlRequest req)
    {
        if (!PrizeGivingActions.Contains(req.Action)) return BadRequest(new { message = "Action must be show or clear." });
        if (req.Action == "clear")
        {
            var cleared = new PrizeGivingDto("clear", null, null, [], false);
            await live.PrizeGiving(competitionId, cleared);
            return cleared;
        }

        var places = req.Places ?? [];
        if (req.SectionId is null || places.Count == 0 || places.Count > MaxPlaces || places.Select(p => p.TeamId).Distinct().Count() != places.Count)
            return BadRequest(new { message = "Choose an age group and up to 30 places, with each team once." });
        if (req.Champions && places[^1].Place != 1)
            return BadRequest(new { message = "The champions are the team in 1st place." });

        var section = await db.CompetitionSections
            .Where(s => s.Id == req.SectionId && s.CompetitionId == competitionId)
            .Select(s => new { s.Id, s.DisplayName, s.AgeGroup })
            .FirstOrDefaultAsync();
        if (section is null) return NotFound();
        var ids = places.Select(p => p.TeamId).ToList();
        var teams = await db.Teams
            .Where(t => ids.Contains(t.Id) && t.CompetitionSectionId == section.Id)
            .Select(t => new { t.Id, t.DisplayName, Club = t.Club != null ? t.Club.Name : null })
            .ToDictionaryAsync(t => t.Id);
        if (teams.Count != ids.Count) return NotFound();

        var given = new PrizeGivingDto("show", section.Id, string.IsNullOrWhiteSpace(section.DisplayName) ? section.AgeGroup : section.DisplayName,
            places.Select(p => new PrizeGivingPlaceDto(p.TeamId, p.Place, teams[p.TeamId].DisplayName, teams[p.TeamId].Club, p.Points)).ToList(),
            req.Champions);
        await live.PrizeGiving(competitionId, given);
        return given;
    }

    private static StreamOverlayDto ToDto(StreamOverlay o)
    {
        using var look = JsonDocument.Parse(string.IsNullOrWhiteSpace(o.LookJson) ? "{}" : o.LookJson);
        return new StreamOverlayDto(
            o.BannerText, o.BannerStyle, JsonSerializer.Deserialize<List<string>>(o.BannerArenas) ?? [],
            o.StripMode, o.ScoreCardMode, o.ScoreCardDelaySeconds, o.ScoreCardSeconds,
            look.RootElement.Clone(), o.Revision, o.Revision == 0 ? null : o.UpdatedAt, o.SponsorMode);
    }
}
