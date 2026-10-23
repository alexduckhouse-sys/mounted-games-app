using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services.Sponsors;

namespace MountedGames.Api.Controllers;

/// <summary>
/// A competition's sponsors. Anyone can read what is on show, fetch a logo and report that a sponsor was shown;
/// the competition's staff manage the list. Logos live in the database and are served from here, never from a third-party host.
/// </summary>
[ApiController]
[Route("api/competitions/{competitionId:int}/sponsors")]
public class SponsorsController(AppDbContext db, ILiveBroadcaster live, TimeProvider time) : ControllerBase
{
    private const int MaxSponsors = 30;

    private static string? LogoUrl(Sponsor s) =>
        s.LogoBytes is null ? null : $"/api/competitions/{s.CompetitionId}/sponsors/{s.Id}/logo?v={s.LogoVersion}";

    /// <summary>The sponsors on show now: enabled, inside their dates and with somewhere to appear.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<SponsorDto>>> List(int competitionId)
    {
        if (!await db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();
        var now = time.GetUtcNow().UtcDateTime;
        var rows = await db.Sponsors.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId && s.IsEnabled && s.ShowOn != SponsorPlacement.None
                && (s.StartsAt == null || s.StartsAt <= now) && (s.EndsAt == null || s.EndsAt > now))
            .OrderBy(s => s.Tier).ThenBy(s => s.SortOrder).ThenBy(s => s.Id)
            .Select(s => new { s.Id, s.CompetitionId, s.Name, s.LinkUrl, HasLogo = s.LogoBytes != null, s.LogoVersion, s.Tier, s.SortOrder, s.ShowOn })
            .ToListAsync();
        return rows.Select(s => new SponsorDto(s.Id, s.Name, s.LinkUrl,
            s.HasLogo ? $"/api/competitions/{s.CompetitionId}/sponsors/{s.Id}/logo?v={s.LogoVersion}" : null, s.Tier, s.SortOrder, s.ShowOn)).ToList();
    }

    [HttpGet("{sponsorId:int}/logo")]
    public async Task<IActionResult> Logo(int competitionId, int sponsorId)
    {
        var logo = await db.Sponsors.AsNoTracking().Where(s => s.Id == sponsorId && s.CompetitionId == competitionId)
            .Select(s => new { s.LogoBytes, s.LogoContentType }).FirstOrDefaultAsync();
        if (logo?.LogoBytes is null || logo.LogoContentType is null) return NotFound();
        // The address carries the logo's version, so a changed logo is a new address and this one may be kept for good.
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return File(logo.LogoBytes, logo.LogoContentType);
    }

    [HttpGet("manage")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IReadOnlyList<SponsorAdminDto>>> Manage(int competitionId)
    {
        var sponsors = await db.Sponsors.AsNoTracking().Where(s => s.CompetitionId == competitionId)
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Id).ToListAsync();
        var totals = await db.SponsorExposures.AsNoTracking().Where(e => e.Sponsor!.CompetitionId == competitionId)
            .GroupBy(e => e.SponsorId).Select(g => new { SponsorId = g.Key, Views = g.Sum(e => e.Views), Seconds = g.Sum(e => e.Seconds) })
            .ToDictionaryAsync(t => t.SponsorId);
        return sponsors.Select(s => ToAdminDto(s, totals.GetValueOrDefault(s.Id)?.Views ?? 0, totals.GetValueOrDefault(s.Id)?.Seconds ?? 0)).ToList();
    }

    [HttpPost]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SponsorAdminDto>> Create(int competitionId, SponsorRequest req)
    {
        var sponsors = await db.Sponsors.Where(s => s.CompetitionId == competitionId).Select(s => s.SortOrder).ToListAsync();
        if (sponsors.Count >= MaxSponsors) return BadRequest(new { message = $"A competition can have up to {MaxSponsors} sponsors." });
        var sponsor = new Sponsor { CompetitionId = competitionId, SortOrder = sponsors.Count == 0 ? 0 : sponsors.Max() + 1, CreatedAt = time.GetUtcNow().UtcDateTime };
        if (Apply(sponsor, req) is { } problem) return problem;
        db.Sponsors.Add(sponsor);
        await db.SaveChangesAsync();
        return ToAdminDto(sponsor, 0, 0);
    }

    [HttpPut("{sponsorId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SponsorAdminDto>> Update(int competitionId, int sponsorId, SponsorRequest req)
    {
        var sponsor = await db.Sponsors.FirstOrDefaultAsync(s => s.Id == sponsorId && s.CompetitionId == competitionId);
        if (sponsor is null) return NotFound();
        if (Apply(sponsor, req) is { } problem) return problem;
        await db.SaveChangesAsync();
        return await WithTotalsAsync(sponsor);
    }

    [HttpDelete("{sponsorId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IActionResult> Delete(int competitionId, int sponsorId)
    {
        var sponsor = await db.Sponsors.FirstOrDefaultAsync(s => s.Id == sponsorId && s.CompetitionId == competitionId);
        if (sponsor is null) return NotFound();
        db.Sponsors.Remove(sponsor);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPut("order")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IActionResult> Reorder(int competitionId, SponsorOrderRequest req)
    {
        var sponsors = await db.Sponsors.Where(s => s.CompetitionId == competitionId).ToListAsync();
        if (req.Ids.Count != sponsors.Count || req.Ids.Distinct().Count() != sponsors.Count || sponsors.Any(s => !req.Ids.Contains(s.Id)))
            return BadRequest(new { message = "Send every sponsor once." });
        var now = time.GetUtcNow().UtcDateTime;
        for (var i = 0; i < req.Ids.Count; i++)
        {
            var sponsor = sponsors.First(s => s.Id == req.Ids[i]);
            if (sponsor.SortOrder == i) continue;
            sponsor.SortOrder = i;
            sponsor.UpdatedAt = now;
        }
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Replaces the logo. The body is the image itself; its Content-Type must be png, jpeg or webp, and its first
    /// bytes must agree. The organiser's browser has already shrunk it, so anything over 200 KB is refused.
    /// </summary>
    [HttpPut("{sponsorId:int}/logo")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SponsorAdminDto>> SetLogo(int competitionId, int sponsorId)
    {
        var sponsor = await db.Sponsors.FirstOrDefaultAsync(s => s.Id == sponsorId && s.CompetitionId == competitionId);
        if (sponsor is null) return NotFound();
        var declared = Request.ContentType?.Split(';')[0].Trim().ToLowerInvariant();
        if (declared is null || !SponsorLogos.ContentTypes.Contains(declared))
            return StatusCode(StatusCodes.Status415UnsupportedMediaType, new { message = "The logo must be a PNG, JPEG or WebP image." });
        if (Request.ContentLength > SponsorLogos.MaxBytes)
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { message = "The logo must be 200 KB or smaller." });

        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await Request.Body.ReadAsync(chunk.AsMemory(), HttpContext.RequestAborted)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > SponsorLogos.MaxBytes)
                return StatusCode(StatusCodes.Status413PayloadTooLarge, new { message = "The logo must be 200 KB or smaller." });
        }
        var bytes = buffer.ToArray();
        var actual = SponsorLogos.Detect(bytes);
        if (actual is null || actual != declared)
            return BadRequest(new { message = "That file isn't a PNG, JPEG or WebP image." });

        sponsor.LogoBytes = bytes;
        sponsor.LogoContentType = actual;
        sponsor.LogoVersion++;
        sponsor.UpdatedAt = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync();
        return await WithTotalsAsync(sponsor);
    }

    [HttpDelete("{sponsorId:int}/logo")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SponsorAdminDto>> RemoveLogo(int competitionId, int sponsorId)
    {
        var sponsor = await db.Sponsors.FirstOrDefaultAsync(s => s.Id == sponsorId && s.CompetitionId == competitionId);
        if (sponsor is null) return NotFound();
        sponsor.LogoBytes = null;
        sponsor.LogoContentType = null;
        sponsor.LogoVersion++;
        sponsor.UpdatedAt = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync();
        return await WithTotalsAsync(sponsor);
    }

    /// <summary>Skips the sponsor card on screen for everyone watching. Nothing is stored.</summary>
    [HttpPost("skip")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SponsorControlDto>> Skip(int competitionId)
    {
        var control = new SponsorControlDto("skip");
        await live.SponsorControl(competitionId, control);
        return control;
    }

    /// <summary>
    /// Adds a batch of "shown" counts to today's totals. Open to everyone and limited per address; the counters
    /// hold no address, account or device. Sponsors that aren't this competition's are ignored.
    /// </summary>
    [HttpPost("exposures")]
    [EnableRateLimiting("sponsor-exposure")]
    public async Task<IActionResult> Exposures(int competitionId, SponsorExposureBatch batch)
    {
        if (batch.Items.Any(i => !SponsorPlacements.IsSingle(i.Placement)))
            return BadRequest(new { message = "Unknown placement." });
        var wanted = batch.Items.Where(i => i.Views > 0 || i.Seconds > 0)
            .GroupBy(i => (i.SponsorId, i.Placement))
            .Select(g => (g.Key.SponsorId, g.Key.Placement, Views: g.Sum(i => (long)i.Views), Seconds: g.Sum(i => (long)i.Seconds)))
            .ToList();
        if (wanted.Count == 0) return NoContent();
        var ids = wanted.Select(w => w.SponsorId).Distinct().ToList();
        var valid = (await db.Sponsors.Where(s => s.CompetitionId == competitionId && ids.Contains(s.Id)).Select(s => s.Id).ToListAsync()).ToHashSet();
        var day = time.GetUtcNow().UtcDateTime.Date;
        foreach (var (sponsorId, placement, views, seconds) in wanted.Where(w => valid.Contains(w.SponsorId)))
            await AddExposureAsync(sponsorId, day, placement, views, seconds);
        return NoContent();
    }

    private async Task AddExposureAsync(int sponsorId, DateTime day, SponsorPlacement placement, long views, long seconds)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var updated = await db.SponsorExposures.Where(e => e.SponsorId == sponsorId && e.Day == day && e.Placement == placement)
                .ExecuteUpdateAsync(set => set.SetProperty(e => e.Views, e => e.Views + views).SetProperty(e => e.Seconds, e => e.Seconds + seconds));
            if (updated > 0) return;
            var row = new SponsorExposure { SponsorId = sponsorId, Day = day, Placement = placement, Views = views, Seconds = seconds };
            db.SponsorExposures.Add(row);
            try
            {
                await db.SaveChangesAsync();
                return;
            }
            catch (DbUpdateException)
            {
                // Another viewer made today's row first; add to theirs on the next pass.
                db.Entry(row).State = EntityState.Detached;
            }
        }
    }

    private async Task<SponsorAdminDto> WithTotalsAsync(Sponsor sponsor)
    {
        var totals = await db.SponsorExposures.AsNoTracking().Where(e => e.SponsorId == sponsor.Id)
            .GroupBy(e => 1).Select(g => new { Views = g.Sum(e => e.Views), Seconds = g.Sum(e => e.Seconds) }).FirstOrDefaultAsync();
        return ToAdminDto(sponsor, totals?.Views ?? 0, totals?.Seconds ?? 0);
    }

    /// <summary>Copies a valid request onto the sponsor; a problem response when the request is not valid.</summary>
    private ActionResult? Apply(Sponsor sponsor, SponsorRequest req)
    {
        var name = req.Name.Trim();
        if (name.Length == 0) return BadRequest(new { message = "Give the sponsor a name." });
        if (!SponsorLogos.TryNormaliseLink(req.LinkUrl, out var link))
            return BadRequest(new { message = "The link must be a full https:// address." });
        if (!Enum.IsDefined(req.Tier) || (req.ShowOn & ~SponsorPlacements.All) != 0)
            return BadRequest(new { message = "Unknown tier or place." });
        var starts = Utc(req.StartsAt);
        var ends = Utc(req.EndsAt);
        if (starts is not null && ends is not null && ends <= starts)
            return BadRequest(new { message = "The end date must be after the start date." });

        sponsor.Name = name;
        sponsor.LinkUrl = link;
        sponsor.Tier = req.Tier;
        sponsor.ShowOn = req.ShowOn;
        sponsor.IsEnabled = req.IsEnabled;
        sponsor.StartsAt = starts;
        sponsor.EndsAt = ends;
        sponsor.UpdatedAt = time.GetUtcNow().UtcDateTime;
        return null;
    }

    private static DateTime? Utc(DateTime? value) => value is { } d
        ? d.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : d.ToUniversalTime()
        : null;

    private static SponsorAdminDto ToAdminDto(Sponsor s, long views, long seconds) => new(
        s.Id, s.Name, s.LinkUrl, LogoUrl(s), s.Tier, s.SortOrder, s.ShowOn, s.IsEnabled, s.StartsAt, s.EndsAt, views, seconds);
}
