using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Hubs;
using MountedGames.Api.Security;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Email;
using MountedGames.Api.Services.Geo;
using MountedGames.Api.Services.Payouts;
using MountedGames.Api.Services.Streaming;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions")]
public class CompetitionsController : ControllerBase
{
    [HttpPut("{id:int}/stream-url")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<IActionResult> SetStreamUrl(int id, StreamUrlRequest request, CancellationToken ct)
    {
        var competition = await _db.Competitions.SingleAsync(c => c.Id == id, ct);
        competition.StreamUrl = request.StreamUrl;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    private readonly AppDbContext _db;
    private readonly ILiveBroadcaster _live;
    private readonly GeocodingService _geocode;
    private readonly PushNotifier? _push;
    public CompetitionsController(AppDbContext db, ILiveBroadcaster live, GeocodingService geocode, PushNotifier? push = null)
    {
        _db = db;
        _live = live;
        _geocode = geocode;
        _push = push;
    }

    [HttpGet("/api/geocode")]
    [AllowAnonymous]
    [EnableRateLimiting("geocode")]
    public async Task<ActionResult<GeocodeResult>> Geocode(
        [FromQuery] string? postcode = null,
        [FromQuery] string? w3w = null,
        CancellationToken ct = default)
    {
        var (lat, lon, source) = await _geocode.ResolveAsync(postcode, w3w, ct);
        return new GeocodeResult(lat, lon, source);
    }

    private IQueryable<Session> SessionsWithDetail() => _db.Sessions
        .Include(s => s.Section)
        .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team).ThenInclude(t => t!.Results)
        .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team);

    private static (double? lat, double? lon) ExtractCoordsFromAppleMapsUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return (null, null);
        try
        {
            var uri = new Uri(url);
            var q = System.Web.HttpUtility.ParseQueryString(uri.Query);
            foreach (var key in new[] { "ll", "sll", "q", "coordinate", "center" })
            {
                var raw = q[key];
                if (string.IsNullOrWhiteSpace(raw)) continue;
                var parts = raw.Split(',', StringSplitOptions.TrimEntries);
                if (parts.Length >= 2
                    && double.TryParse(parts[0], System.Globalization.CultureInfo.InvariantCulture, out var la)
                    && double.TryParse(parts[1], System.Globalization.CultureInfo.InvariantCulture, out var lo))
                {
                    return (la, lo);
                }
            }
            var atMatch = System.Text.RegularExpressions.Regex.Match(uri.AbsolutePath,
                @"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)");
            if (atMatch.Success
                && double.TryParse(atMatch.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture, out var aLat)
                && double.TryParse(atMatch.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture, out var aLon))
            {
                return (aLat, aLon);
            }
        }
        catch
        {
            // fall through
        }
        return (null, null);
    }

    [HttpGet("picker")]
    [AllowAnonymous]
    public async Task<ActionResult<CompetitionPickerPage>> Picker(
        [FromQuery] bool past = false, [FromQuery] int page = 1, [FromQuery] int pageSize = 24,
        CancellationToken ct = default, [FromQuery] int? year = null,
        [FromQuery] string? location = null, [FromQuery] string? search = null)
        => await PickerPage(past, page, pageSize, year, location, search, null, ct);

    /// <summary>
    /// The upcoming list ordered for this viewer: nearest first when we can tell roughly where they are, without ever asking. The
    /// place comes from a signed-in person's entry, team and supporter history, else from the rough position of their connection
    /// that the website's proxy vouched for on this request. It is used for this call only and never stored or logged. The answer
    /// differs per viewer, so (like <c>picker/mine</c>) it is outside the public-cache allowlists and sent <c>no-store</c>; the
    /// plain <c>picker</c> stays the same for everyone and is what the app falls back to offline.
    /// </summary>
    [HttpGet("picker/near-you")]
    [AllowAnonymous]
    [EnableRateLimiting(RequestLimits.NearYouPolicy)]
    public async Task<ActionResult<CompetitionNearYouPage>> NearYou(
        [FromServices] LocationInference locations, [FromQuery] int page = 1, [FromQuery] int pageSize = 24,
        [FromQuery] string? sort = null, CancellationToken ct = default)
    {
        if (page is < 1 or > 10000 || pageSize is < 1 or > 50)
            return Problem(statusCode: 400, title: "Invalid page", detail: "Use a page from 1 to 10000 and a page size from 1 to 50.");
        Response.Headers.CacheControl = "private, no-store";
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var origin = userId is null ? null
            : await locations.FromHistoryAsync(userId, ct);
        origin ??= VisitorGeo.Get(HttpContext);
        return await CompetitionPickerQuery.LoadNearYouAsync(_db, page, pageSize, DateTime.UtcNow.Date, origin,
            nearest: !string.Equals(sort, CompetitionPickerQuery.SortSoonest, StringComparison.OrdinalIgnoreCase), ct);
    }

    // Separate path deliberately excluded from both server and service-worker public-cache allowlists.
    [HttpGet("picker/mine")]
    [Authorize]
    public async Task<ActionResult<CompetitionPickerPage>> MyPicker(
        [FromQuery] bool past = true, [FromQuery] int page = 1, [FromQuery] int pageSize = 24,
        CancellationToken ct = default, [FromQuery] int? year = null,
        [FromQuery] string? location = null, [FromQuery] string? search = null)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        Response.Headers.CacheControl = "private, no-store";
        return await PickerPage(past, page, pageSize, year, location, search, userId, ct);
    }

    private async Task<ActionResult<CompetitionPickerPage>> PickerPage(bool past, int page, int pageSize,
        int? year, string? location, string? search, string? userId, CancellationToken ct)
    {
        if (page is < 1 or > 10000 || pageSize is < 1 or > 50)
            return Problem(statusCode: 400, title: "Invalid page", detail: "Use a page from 1 to 10000 and a page size from 1 to 50.");
        if (year is < 1 or > 9999 || location?.Length > 200 || search?.Length > 200)
            return Problem(statusCode: 400, title: "Invalid filter", detail: "Use a valid year and at most 200 characters for a location or search.");
        return await CompetitionPickerQuery.LoadAsync(_db, past, page, pageSize, DateTime.UtcNow.Date, ct, year, location, search, userId);
    }

    [HttpGet]
    public async Task<IEnumerable<CompetitionSummary>> List([FromQuery] bool includeArchived = false)
    {
        var q = _db.Competitions
            .AsNoTracking()
            .Include(c => c.Sections)
            .Include(c => c.Teams)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats)
            .AsQueryable();
        if (!includeArchived) q = q.Where(c => !c.IsArchived);
        return (await q.OrderByDescending(c => c.StartDate).ToListAsync()).Select(c => c.ToSummary());
    }

    /// <summary>True for a competition marked as a demo event (the same mark the fake payment endpoints check).</summary>
    private Task<bool> IsDemoCompetitionAsync(int competitionId) =>
        _db.Set<EventCommerceSettings>().AsNoTracking().AnyAsync(x => x.CompetitionId == competitionId && x.IsDemo);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<CompetitionDetail>> Get(int id)
    {
        var c = await _db.Competitions
            .AsNoTracking()
            .AsSplitQuery()
            .Include(c => c.Sections)
            .Include(c => c.Teams).ThenInclude(t => t.Club)
            .Include(c => c.Teams).ThenInclude(t => t.Section)
            .Include(c => c.Teams).ThenInclude(t => t.Trainer)
            .Include(c => c.Teams).ThenInclude(t => t.Results)
            .Include(c => c.Sessions).ThenInclude(s => s.Section)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team).ThenInclude(t => t!.Results)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (c is null) return NotFound();
        var signupCounts = await ActiveSignupCountsAsync(id);
        var capacity = await VenueCapacity.GetCapacityAsync(_db, id);

        return c.ToDto(
            c.Sections.OrderBy(s => s.DisplayName).Select(s => s.ToDto(signupCounts.GetValueOrDefault(s.Id))).ToList(),
            c.Teams.OrderBy(t => t.DisplayName).Select(t => t.ToDto()).ToList(),
            c.Sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList(),
            isDemo: await IsDemoCompetitionAsync(c.Id),
            payoutsTo: await _db.PayoutsToAsync(c.CreatedByUserId, c.DecFormConfigJson),
            includePaymentDetails: User.Identity?.IsAuthenticated == true,
            maxStables: capacity.MaxStables,
            maxHookups: capacity.MaxHookups,
            stablesRemaining: capacity.StablesRemaining,
            hookupsRemaining: capacity.HookupsRemaining);
    }

    /// <summary>
    /// A small first answer for phones on a weak signal. It has the same shape as <see cref="Get"/>, but holds
    /// only the sessions that matter now in each arena (on now, the last finished, the next two) and the teams
    /// racing in them. The web shows it straight away and swaps in the full timetable when that arrives.
    /// </summary>
    [HttpGet("{id:int}/first-view")]
    public async Task<ActionResult<CompetitionDetail>> FirstView(int id)
    {
        var c = await _db.Competitions.AsNoTracking().Include(x => x.Sections).FirstOrDefaultAsync(x => x.Id == id);
        if (c is null) return NotFound();

        var outline = await _db.Sessions.AsNoTracking()
            .Where(s => s.CompetitionId == id)
            .Select(s => new SessionOutline(s.Id, s.ArenaName, s.Status, s.OrderIndex))
            .ToListAsync();
        var sessionIds = FirstViewSessionIds(outline);
        var sessions = await _db.Sessions.AsNoTracking().AsSplitQuery()
            .Where(s => sessionIds.Contains(s.Id))
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team).ThenInclude(t => t!.Results)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .ToListAsync();
        var teamIds = sessions.SelectMany(s => s.Heats).SelectMany(h => h.Entries).Select(e => e.TeamId).Distinct().ToList();
        var teams = await _db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == id && teamIds.Contains(t.Id))
            .Include(t => t.Club).Include(t => t.Section).Include(t => t.Trainer).Include(t => t.Results)
            .ToListAsync();
        var signupCounts = await ActiveSignupCountsAsync(id);
        var capacity = await VenueCapacity.GetCapacityAsync(_db, id);

        return c.ToDto(
            c.Sections.OrderBy(s => s.DisplayName).Select(s => s.ToDto(signupCounts.GetValueOrDefault(s.Id))).ToList(),
            teams.OrderBy(t => t.DisplayName).Select(t => t.ToDto()).ToList(),
            sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList(),
            isDemo: await IsDemoCompetitionAsync(c.Id),
            payoutsTo: await _db.PayoutsToAsync(c.CreatedByUserId, c.DecFormConfigJson),
            includePaymentDetails: User.Identity?.IsAuthenticated == true,
            maxStables: capacity.MaxStables,
            maxHookups: capacity.MaxHookups,
            stablesRemaining: capacity.StablesRemaining,
            hookupsRemaining: capacity.HookupsRemaining);
    }

    internal sealed record SessionOutline(int Id, string? ArenaName, SessionStatus Status, int OrderIndex);

    /// <summary>Per arena: every session on now, the last one finished and the next two.</summary>
    internal static HashSet<int> FirstViewSessionIds(IEnumerable<SessionOutline> sessions)
    {
        var ids = new HashSet<int>();
        foreach (var arena in sessions.GroupBy(s => s.ArenaName ?? string.Empty))
        {
            var ordered = arena.OrderBy(s => s.OrderIndex).ToList();
            ids.UnionWith(ordered.Where(s => s.Status == SessionStatus.InArena).Select(s => s.Id));
            if (ordered.LastOrDefault(s => s.Status == SessionStatus.Finished) is { } last) ids.Add(last.Id);
            ids.UnionWith(ordered.Where(s => s.Status == SessionStatus.Upcoming).Take(2).Select(s => s.Id));
        }
        return ids;
    }

    /// <summary>
    /// Toggle whether public signups are accepted for this competition.
    /// Used by the format-after-signups flow to "close entries" before forming teams.
    /// </summary>
    [HttpPost("{id:int}/signups-locked")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<object>> SetSignupsLocked(int id, SetSignupsLockedRequest req)
    {
        var c = await _db.Competitions.FirstOrDefaultAsync(c => c.Id == id);
        if (c is null) return NotFound();
        c.SignupsLocked = req.Locked;
        await _db.SaveChangesAsync();
        return new { signupsLocked = c.SignupsLocked };
    }

    private const string ContactEmailProblem = "That contact email doesn't look right. Check it, or leave it blank.";
    private const string PaymentLinkProblem = "That payment link doesn't look right. Use a full https:// link, or leave it blank.";

    [HttpPost]
    [Authorize(Roles = Roles.Organiser)]
    public async Task<ActionResult<CompetitionSummary>> Create(CreateCompetitionRequest req)
    {
        string? contactEmail = null;
        if (!string.IsNullOrWhiteSpace(req.ContactEmail) && !EmailAddresses.TryNormalise(req.ContactEmail, out contactEmail))
            return BadRequest(new { message = ContactEmailProblem });
        if (!CompetitionFields.TryNormalisePaymentLinkUrl(req.PaymentLinkUrl, out var paymentLinkUrl))
            return BadRequest(new { message = PaymentLinkProblem });
        var appleUrl = string.IsNullOrWhiteSpace(req.AppleMapsUrl) ? null : req.AppleMapsUrl.Trim();
        var lat = req.Latitude;
        var lon = req.Longitude;
        if (lat is null || lon is null)
        {
            var (aLat, aLon) = ExtractCoordsFromAppleMapsUrl(appleUrl);
            lat ??= aLat;
            lon ??= aLon;
        }
        if (lat is null || lon is null)
        {
            var (gLat, gLon, _) = await _geocode.ResolveAsync(req.Postcode, req.What3Words);
            lat ??= gLat;
            lon ??= gLon;
        }
        var creatorClubId = await _db.ClubIdOfAsync(User);
        var lorryW3w = CompetitionFields.Trimmed(req.LorryWhat3Words?.Trim().TrimStart('/'));
        var lorryLat = req.LorryLatitude;
        var lorryLon = req.LorryLongitude;
        if ((lorryLat is null || lorryLon is null) && lorryW3w is not null)
        {
            var (lLat, lLon, _) = await _geocode.ResolveAsync(null, lorryW3w);
            lorryLat ??= lLat;
            lorryLon ??= lLon;
        }
        var c = new Competition
        {
            Name = req.Name,
            Icon = req.Icon ?? "flag",
            Location = req.Location,
            Description = req.Description,
            Latitude = lat,
            Longitude = lon,
            What3Words = string.IsNullOrWhiteSpace(req.What3Words) ? null : req.What3Words.Trim(),
            AppleMapsUrl = appleUrl,
            Postcode = CompetitionFields.Postcode(req.Postcode),
            CompetitionNumber = CompetitionFields.Trimmed(req.CompetitionNumber),
            ContactEmail = contactEmail,
            LorryWhat3Words = lorryW3w,
            LorryLatitude = lorryLat,
            LorryLongitude = lorryLon,
            LorryDirectionsNote = CompetitionFields.Trimmed(req.LorryDirectionsNote),
            StreamUrl = string.IsNullOrWhiteSpace(req.StreamUrl) ? null : req.StreamUrl.Trim(),
            OrganiserName = string.IsNullOrWhiteSpace(req.OrganiserName) ? null : req.OrganiserName.Trim(),
            PaymentDestination = string.IsNullOrWhiteSpace(req.PaymentDestination) ? null : req.PaymentDestination.Trim(),
            PaymentLinkUrl = paymentLinkUrl,
            TermsText = string.IsNullOrWhiteSpace(req.TermsText) ? null : req.TermsText.Trim(),
            // New competitions start with the basic dec form and pin the creator's club for payouts; older ones with no setup keep the standard form.
            DecFormConfigJson = (MountedGames.Api.Services.DecForms.DecFormConfig.Basic with
            {
                PayoutClubId = creatorClubId,
                UseRefereeCards = req.UseRefereeCards,
            }).ToJson(),
            LaneHatbands = PlannedRaceList.Write(req.LaneHatbands),
            StartDate = req.StartDate,
            EndDate = req.EndDate,
            CreatedByUserId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
        };
        _db.Competitions.Add(c);
        await _db.SaveChangesAsync();
        if (req.MaxStables is > 0 || req.MaxHookups is > 0)
        {
            _db.Add(new CompetitionEntrySettings
            {
                CompetitionId = c.Id,
                MaxStables = req.MaxStables is > 0 ? req.MaxStables : null,
                MaxHookups = req.MaxHookups is > 0 ? req.MaxHookups : null,
            });
            await _db.SaveChangesAsync();
        }
        return CreatedAtAction(nameof(Get), new { id = c.Id }, c.ToSummary());
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<CompetitionSummary>> Update(int id, UpdateCompetitionRequest req)
    {
        string? contactEmail = null;
        if (!string.IsNullOrWhiteSpace(req.ContactEmail) && !EmailAddresses.TryNormalise(req.ContactEmail, out contactEmail))
            return BadRequest(new { message = ContactEmailProblem });
        if (!CompetitionFields.TryNormalisePaymentLinkUrl(req.PaymentLinkUrl, out var paymentLinkUrl))
            return BadRequest(new { message = PaymentLinkProblem });
        var c = await _db.Competitions
            .Include(c => c.Sections).Include(c => c.Teams).Include(c => c.Sessions)
            .FirstOrDefaultAsync(c => c.Id == id);
        if (c is null) return NotFound();
        c.Name = req.Name;
        if (req.Icon is not null) c.Icon = req.Icon;
        c.Location = req.Location;
        c.Description = req.Description;
        var appleUrl = string.IsNullOrWhiteSpace(req.AppleMapsUrl) ? null : req.AppleMapsUrl.Trim();
        var newLat = req.Latitude;
        var newLon = req.Longitude;
        if (newLat is null || newLon is null)
        {
            var (aLat, aLon) = ExtractCoordsFromAppleMapsUrl(appleUrl);
            newLat ??= aLat;
            newLon ??= aLon;
        }
        if (newLat is null || newLon is null)
        {
            var (gLat, gLon, _) = await _geocode.ResolveAsync(req.Postcode, req.What3Words);
            newLat ??= gLat;
            newLon ??= gLon;
        }
        c.Latitude = newLat;
        c.Longitude = newLon;
        c.StreamUrl = string.IsNullOrWhiteSpace(req.StreamUrl) ? null : req.StreamUrl.Trim();
        c.What3Words = string.IsNullOrWhiteSpace(req.What3Words) ? null : req.What3Words.Trim();
        c.AppleMapsUrl = appleUrl;
        // Null leaves these fields as they are (older clients don't send them); a blank value clears them.
        if (req.Postcode is not null) c.Postcode = CompetitionFields.Postcode(req.Postcode);
        if (req.CompetitionNumber is not null) c.CompetitionNumber = CompetitionFields.Trimmed(req.CompetitionNumber);
        if (req.ContactEmail is not null) c.ContactEmail = contactEmail;
        if (req.LorryWhat3Words is not null)
        {
            c.LorryWhat3Words = CompetitionFields.Trimmed(req.LorryWhat3Words.Trim().TrimStart('/'));
            if (c.LorryWhat3Words is null && req.LorryLatitude is null && req.LorryLongitude is null)
            {
                c.LorryLatitude = null;
                c.LorryLongitude = null;
            }
        }
        if (req.LorryDirectionsNote is not null) c.LorryDirectionsNote = CompetitionFields.Trimmed(req.LorryDirectionsNote);
        if (req.LorryLatitude.HasValue) c.LorryLatitude = req.LorryLatitude;
        if (req.LorryLongitude.HasValue) c.LorryLongitude = req.LorryLongitude;
        if ((c.LorryLatitude is null || c.LorryLongitude is null) && c.LorryWhat3Words is not null && req.LorryWhat3Words is not null)
        {
            var (lLat, lLon, _) = await _geocode.ResolveAsync(null, c.LorryWhat3Words);
            c.LorryLatitude ??= lLat;
            c.LorryLongitude ??= lLon;
        }
        if (req.PaymentLinkUrl is not null) c.PaymentLinkUrl = paymentLinkUrl;
        c.OrganiserName = string.IsNullOrWhiteSpace(req.OrganiserName) ? null : req.OrganiserName.Trim();
        c.PaymentDestination = string.IsNullOrWhiteSpace(req.PaymentDestination) ? null : req.PaymentDestination.Trim();
        c.TermsText = string.IsNullOrWhiteSpace(req.TermsText) ? null : req.TermsText.Trim();
        if (req.LaneHatbands is not null) c.LaneHatbands = PlannedRaceList.Write(req.LaneHatbands);
        if (req.UseRefereeCards.HasValue)
        {
            c.DecFormConfigJson = (MountedGames.Api.Services.DecForms.DecFormConfig.For(c) with
            {
                UseRefereeCards = req.UseRefereeCards.Value,
            }).ToJson();
        }
        c.StartDate = req.StartDate;
        c.EndDate = req.EndDate;
        c.IsActive = req.IsActive;
        c.IsArchived = req.IsArchived;
        if (req.MaxStables.HasValue || req.MaxHookups.HasValue)
        {
            var settings = await _db.Set<CompetitionEntrySettings>().FindAsync(c.Id);
            if (settings is null)
            {
                settings = new CompetitionEntrySettings { CompetitionId = c.Id };
                _db.Add(settings);
            }
            if (req.MaxStables.HasValue)
                settings.MaxStables = req.MaxStables.Value > 0 ? req.MaxStables.Value : null;
            if (req.MaxHookups.HasValue)
                settings.MaxHookups = req.MaxHookups.Value > 0 ? req.MaxHookups.Value : null;
        }
        await _db.SaveChangesAsync();
        return c.ToSummary();
    }

    [HttpPut("{id:int}/teams/{teamId:int}/card")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<TeamDto>> SetTeamCard(int id, int teamId, SetTeamCardRequest req)
    {
        var raw = req.Card?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(raw) && raw is not ("none" or "yellow" or "red"))
            return BadRequest(new { message = "Card must be 'yellow', 'red', or null." });
        var card = raw is "yellow" or "red" ? raw : null;

        var team = await _db.Teams
            .Include(t => t.Club)
            .Include(t => t.Section)
            .Include(t => t.Trainer)
            .Include(t => t.Results)
            .FirstOrDefaultAsync(t => t.Id == teamId && t.CompetitionId == id);
        if (team is null) return NotFound();

        if (req.RaceId is { } raceId && !await _db.Races.AnyAsync(r => r.Id == raceId
            && r.Heat!.Session!.CompetitionId == id
            && (r.Heat.Entries.Any(e => e.TeamId == teamId) || r.Results.Any(result => result.TeamId == teamId))))
            return BadRequest(new { message = "The race must belong to this competition and include this team." });

        // Team cards represent the current decision; scored race notes remain immutable here.
        team.BibDescription = ResultStatuses.ApplyCardTag(team.BibDescription, card ?? "none");

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(new { message = "The team changed while you were editing. Reload and try again." });
        }
        await _live.ResultsUpdated(id, new { teamId = team.Id, refereeCard = card });
        return team.ToDto();
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id, [FromServices] CompetitionStreamLocks streamLocks,
        [FromServices] StreamLifecycle streamLifecycle)
    {
        using var streamLease = await streamLocks.AcquireAsync(id, HttpContext.RequestAborted);
        var c = await _db.Competitions
            .Include(x => x.Sections)
            .Include(x => x.Teams)
            .Include(x => x.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(x => x.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .Include(x => x.ChatMessages)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (c is null) return NotFound();

        // Money and season records are never deleted with an event, so say what is in the way rather than crash on the foreign key.
        var hasOrders = await _db.Set<EventOrder>().AnyAsync(o => o.CompetitionId == id);
        var hasRounds = await _db.Set<MountedGames.Api.Entities.Seasons.SeasonRound>().AnyAsync(r => r.CompetitionId == id);
        if (hasOrders || hasRounds)
        {
            var blockers = new List<string>();
            if (hasOrders) blockers.Add("shop orders");
            if (hasRounds) blockers.Add("a season round");
            return Conflict(new
            {
                message = $"This competition can't be deleted because it still has {string.Join(" and ", blockers)}.{(hasRounds ? " Remove its rounds from the season first." : "")}"
            });
        }

        // Walk the graph bottom-up so foreign-key constraints don't trip.
        foreach (var session in c.Sessions)
        foreach (var heat in session.Heats)
        {
            foreach (var race in heat.Races) _db.Results.RemoveRange(race.Results);
            _db.Races.RemoveRange(heat.Races);
            _db.HeatEntries.RemoveRange(heat.Entries);
        }
        foreach (var session in c.Sessions) _db.Heats.RemoveRange(session.Heats);
        var shiftIds = await _db.VolunteerShifts.Where(s => s.CompetitionId == id).Select(s => s.Id).ToListAsync();
        if (shiftIds.Count > 0)
        {
            await _db.VolunteerClaims.Where(cl => shiftIds.Contains(cl.ShiftId)).ExecuteDeleteAsync();
            await _db.VolunteerShifts.Where(s => s.CompetitionId == id).ExecuteDeleteAsync();
        }
        _db.Sessions.RemoveRange(c.Sessions);

        var teamIds = c.Teams.Select(t => t.Id).ToList();
        var decForms = await _db.DeclarationForms
            .Include(d => d.Riders)
            .Where(d => teamIds.Contains(d.TeamId))
            .ToListAsync();
        foreach (var d in decForms) _db.RiderEntries.RemoveRange(d.Riders);
        _db.DeclarationForms.RemoveRange(decForms);

        _db.Teams.RemoveRange(c.Teams);
        _db.ChatMessages.RemoveRange(c.ChatMessages);
        _db.CompetitionSections.RemoveRange(c.Sections);
        var closures = (await _db.LiveStreams.Where(s => s.CompetitionId == id).ToListAsync())
            .Select(streamLifecycle.MarkEnded).OfType<StreamLifecycle.Closure>().ToArray();
        _db.Competitions.Remove(c);

        await _db.SaveChangesAsync();
        foreach (var closure in closures) await streamLifecycle.CompleteEndAsync(closure);
        return NoContent();
    }

    [HttpPost("{id:int}/sections")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<CompetitionSectionDto>> AddSection(int id, CreateSectionRequest req)
    {
        if (!await _db.Competitions.AnyAsync(c => c.Id == id)) return NotFound();
        // One naming rule (age group, then the format in the plural). A name sent by a client is only a fallback.
        var display = string.IsNullOrWhiteSpace(req.AgeGroup)
            ? (string.IsNullOrWhiteSpace(req.DisplayName) ? SectionNaming.FormatPlural(req.Format) : req.DisplayName!)
            : SectionNaming.DisplayName(req.Format, req.AgeGroup);
        // Carry defaults to on in the request, so it can't be refused here: heat, heat, final stores and ignores it.
        if (req.UsesRaceFinals && (!req.HasFinal || req.DoublePointsInFinal))
            return BadRequest(new { message = FinalOptionsRaceFinalsMessage });
        var section = new CompetitionSection
        {
            CompetitionId = id,
            Format = req.Format,
            AgeGroup = req.AgeGroup,
            DisplayName = display,
            RunoffRaceName = string.IsNullOrWhiteSpace(req.RunoffRaceName) ? null : req.RunoffRaceName.Trim(),
            UsesRaceFinals = req.UsesRaceFinals,
            PriceMinor = Math.Max(0, req.PriceMinor),
            MaxParticipants = req.MaxParticipants.HasValue && req.MaxParticipants.Value > 0
                ? req.MaxParticipants
                : null,
            FinalistCount = req.FinalistCount,
            TieBreakRule = req.TieBreakRule,
            HasFinal = req.HasFinal,
            CarryPointsIntoFinal = req.CarryPointsIntoFinal,
            DoublePointsInFinal = req.DoublePointsInFinal,
        };
        _db.CompetitionSections.Add(section);
        await _db.SaveChangesAsync();
        return section.ToDto();
    }

    /// <summary>Entries that count towards a section's cap (paid and pending), by section id.</summary>
    private async Task<Dictionary<int, int>> ActiveSignupCountsAsync(int competitionId)
    {
        var now = DateTime.UtcNow;
        var rows = await _db.SectionSignups.AsNoTracking()
            .Where(s => s.Section!.CompetitionId == competitionId
                && (s.Status == SignupPaymentStatus.Paid || s.Status == SignupPaymentStatus.Pending)
                && !_db.Set<SignupMatchmaking>().Any(m => m.SignupId == s.Id && m.WaitingForGuestSpot)
                && !_db.Set<SignupExtras>().Any(x => x.SignupId == s.Id && (x.IsWithdrawn || (x.IsWaitlist && (x.WaitlistOfferExpiresAt == null || x.WaitlistOfferExpiresAt <= now)))))
            .Select(s => new { s.CompetitionSectionId,
                Count = _db.Set<SignupExtras>().Where(x => x.SignupId == s.Id).Select(x => (int?)x.TeamsCount).FirstOrDefault() ?? 1 })
            .ToListAsync();
        return rows.GroupBy(s => s.CompetitionSectionId).ToDictionary(g => g.Key, g => g.Sum(s => s.Count));
    }

    [HttpPut("{id:int}/sections/{sectionId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<CompetitionSectionDto>> UpdateSection(int id, int sectionId, UpdateSectionRequest req)
    {
        var section = await _db.CompetitionSections.FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == id);
        if (section is null) return NotFound();
        var finalOptionsError = await FinalOptionsErrorAsync(section, req);
        if (finalOptionsError is not null) return finalOptionsError;
        section.RunoffRaceName = string.IsNullOrWhiteSpace(req.RunoffRaceName) ? null : req.RunoffRaceName.Trim();
        // Saving brings an older name in line with the naming rule.
        section.DisplayName = SectionNaming.Of(section) is { Length: > 0 } named ? named : section.DisplayName;
        if (req.UsesRaceFinals.HasValue) section.UsesRaceFinals = req.UsesRaceFinals.Value;
        if (req.TieBreakRule.HasValue) section.TieBreakRule = req.TieBreakRule.Value;
        if (req.HasFinal.HasValue) section.HasFinal = req.HasFinal.Value;
        if (req.CarryPointsIntoFinal.HasValue) section.CarryPointsIntoFinal = req.CarryPointsIntoFinal.Value;
        if (req.DoublePointsInFinal.HasValue) section.DoublePointsInFinal = req.DoublePointsInFinal.Value;
        if (req.PriceMinor.HasValue) section.PriceMinor = Math.Max(0, req.PriceMinor.Value);
        if (req.MaxParticipants.HasValue)
            section.MaxParticipants = req.MaxParticipants.Value > 0 ? req.MaxParticipants.Value : null;
        // Unlike the optional fields above, an omitted FinalistCount clears it: the editor
        // always sends the full section, and null is how an organiser unsets it.
        section.FinalistCount = req.FinalistCount;
        await _db.SaveChangesAsync();
        return section.ToDto((await ActiveSignupCountsAsync(id)).GetValueOrDefault(section.Id));
    }

    private const string FinalOptionsRaceFinalsMessage =
        "Heat, heat, final has no separate final, so it can't have a final of its own, carry points or double them.";

    /// <summary>
    /// Why a section's final switches can't change as asked, or null. The switches belong to the standard format. A final
    /// that exists stays (turning it off would orphan its heats), and the double-points setting is fixed once a final race
    /// has been scored, because saved points are not recalculated.
    /// </summary>
    private async Task<ActionResult?> FinalOptionsErrorAsync(CompetitionSection section, UpdateSectionRequest req)
    {
        var raceFinals = req.UsesRaceFinals ?? section.UsesRaceFinals;
        if (raceFinals && (req.HasFinal == false || req.CarryPointsIntoFinal == true || req.DoublePointsInFinal == true))
            return BadRequest(new { message = FinalOptionsRaceFinalsMessage });
        if (raceFinals) return null;

        // Lettered final heats of this section, and which of them have scored races (read the labels with FinalsTiers, so
        // "A Final Part 1" counts and "Grand Final" doesn't).
        var heats = (await _db.Heats.AsNoTracking()
                .Where(h => h.Session!.CompetitionSectionId == section.Id && h.RaceRoundStage == RaceRoundStage.None
                    && h.Label != null && h.Label.Contains(" Final"))
                .Select(h => new { h.Label, Scored = h.Races.Any(r => r.Results.Any()) })
                .ToListAsync())
            .Where(h => FinalsTiers.ParseLabel(h.Label) is not null).ToList();
        if (req.HasFinal == false && section.HasFinal && heats.Count > 0)
            return Conflict(new { message = "This age group already has a final. Remove its finals session before turning the final off." });
        if (req.DoublePointsInFinal.HasValue && req.DoublePointsInFinal != section.DoublePointsInFinal && heats.Any(h => h.Scored))
            return Conflict(new { message = "Final races have already been scored, so double points can't be changed. Points are not recalculated." });
        return null;
    }

    /// <summary>409 when finals are requested for an age group set up with no final.</summary>
    private async Task<ActionResult?> NoFinalErrorAsync(int competitionId, int? sectionId)
    {
        if (sectionId is not { } sid) return null;
        var section = await _db.CompetitionSections.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sid && s.CompetitionId == competitionId);
        return section is not null && !SectionScoring.AllowsFinal(section)
            ? Conflict(new { message = $"{section.DisplayName} is set up with no final." })
            : null;
    }

    [HttpDelete("{id:int}/sections/{sectionId:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> DeleteSection(int id, int sectionId, [FromQuery] bool force = false)
    {
        var section = await _db.CompetitionSections
            .Include(s => s.Teams)
            .Include(s => s.Sessions).ThenInclude(ss => ss.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Sessions).ThenInclude(ss => ss.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == id);
        if (section is null) return NotFound();

        if (await _db.Set<MountedGames.Api.Entities.Seasons.SeasonRound>().AnyAsync(r => r.CompetitionSectionId == sectionId))
            return Conflict(new { message = "This section can't be deleted because it is a round in a season. Remove it from the season first." });

        var hasPaidSignups = await _db.SectionSignups.AnyAsync(
            s => s.CompetitionSectionId == sectionId && s.Status == SignupPaymentStatus.Paid);
        // The section's teams can also sit in another section's combined heat; their entries and results there block the delete too.
        var sectionTeamIds = section.Teams.Select(t => t.Id).ToList();
        var teamResults = await _db.Results.Where(r => sectionTeamIds.Contains(r.TeamId)).ToListAsync();
        var hasScoredResults = teamResults.Count > 0
            || section.Sessions.Any(ss => ss.Heats.Any(h => h.Races.Any(r => r.Results.Count > 0)));
        if (!force && (hasPaidSignups || section.Teams.Count > 0 || hasScoredResults))
            return BadRequest(new { message = "This section already has paid entries, teams or scored results. Pass ?force=true to delete it anyway." });

        // Walk bottom-up so foreign keys don't complain.
        foreach (var ss in section.Sessions)
        foreach (var heat in ss.Heats)
        {
            foreach (var race in heat.Races) _db.Results.RemoveRange(race.Results);
            _db.Races.RemoveRange(heat.Races);
            _db.HeatEntries.RemoveRange(heat.Entries);
        }
        foreach (var ss in section.Sessions) _db.Heats.RemoveRange(ss.Heats);
        // Same as deleting a team: take its place out of any other section's combined heat (and, forced, its results there).
        _db.Results.RemoveRange(teamResults);
        _db.HeatEntries.RemoveRange(await _db.HeatEntries.Where(he => sectionTeamIds.Contains(he.TeamId)).ToListAsync());
        var sectionSessionIds = section.Sessions.Select(ss => ss.Id).ToList();
        if (sectionSessionIds.Count > 0)
        {
            await _db.VolunteerShifts
                .Where(s => s.SessionId != null && sectionSessionIds.Contains(s.SessionId.Value))
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.SessionId, (int?)null));
        }
        _db.Sessions.RemoveRange(section.Sessions);

        var teamIds = section.Teams.Select(t => t.Id).ToList();
        var decForms = await _db.DeclarationForms
            .Include(d => d.Riders)
            .Where(d => teamIds.Contains(d.TeamId))
            .ToListAsync();
        foreach (var d in decForms) _db.RiderEntries.RemoveRange(d.Riders);
        _db.DeclarationForms.RemoveRange(decForms);

        var signups = await _db.SectionSignups.Where(s => s.CompetitionSectionId == sectionId).ToListAsync();
        _db.SectionSignups.RemoveRange(signups);

        _db.Teams.RemoveRange(section.Teams);
        _db.CompetitionSections.Remove(section);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{id:int}/standings")]
    public async Task<ActionResult<IReadOnlyList<StandingRow>>> Standings(int id,
        [FromServices] StandingsService standings, [FromQuery] int? sectionId = null)
        => await standings.RowsAsync(id, sectionId, HttpContext.RequestAborted);

    [HttpGet("{id:int}/archive")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<IActionResult> Archive(
        int id,
        [FromServices] MountedGames.Api.Services.EventTools.EventArchiveService archiveService,
        [FromQuery] string? format = null,
        CancellationToken ct = default)
    {
        var archive = await archiveService.BuildArchiveAsync(id, ct);
        if (archive is null) return NotFound();
        if (string.Equals(format, "zip", StringComparison.OrdinalIgnoreCase))
        {
            return File(MountedGames.Api.Services.EventTools.EventArchiveService.BuildZipBytes(archive), "application/zip", archive.FileName);
        }
        return Ok(archive);
    }

    [HttpPost("{id:int}/shift-day")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<CompetitionDetail>> ShiftDay(int id, [FromQuery] int days = 1)
    {
        var c = await _db.Competitions
            .Include(c => c.Sessions).ThenInclude(s => s.Heats)
            .FirstOrDefaultAsync(c => c.Id == id);
        if (c is null) return NotFound();
        // Shift by UK calendar days, so a wall-clock time stays put across a clock change.
        DateTime Shift(DateTime value) => MountedGames.Api.Services.UkTime.FromUk(MountedGames.Api.Services.UkTime.ToUk(value).AddDays(days));

        // Only push sessions that haven't started yet — preserves history.
        var shiftedSessionIds = new List<int>();
        foreach (var s in c.Sessions.Where(s => s.StartedAt is null && s.Status != SessionStatus.Finished))
        {
            var changed = false;
            if (s.ScheduledStart.HasValue)
            {
                s.ScheduledStart = Shift(s.ScheduledStart.Value);
                changed = true;
            }
            foreach (var h in s.Heats.Where(h => !h.StartedAt.HasValue && !h.FinishedAt.HasValue && h.ScheduledStart.HasValue))
            {
                h.ScheduledStart = Shift(h.ScheduledStart!.Value);
                changed = true;
            }
            if (changed) shiftedSessionIds.Add(s.Id);
        }
        if (c.EndDate.HasValue) c.EndDate = c.EndDate.Value.AddDays(days);
        await _db.SaveChangesAsync();
        var detailResult = await Get(id);
        if (shiftedSessionIds.Count > 0 && detailResult.Value is { } detail)
        {
            foreach (var sessionDto in detail.Sessions.Where(s => shiftedSessionIds.Contains(s.Id)))
                await _live.SessionUpdated(id, sessionDto);
        }
        return detailResult;
    }

    [HttpGet("{id:int}/finals/boundary")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<object>> FinalsBoundary(int id,
        [FromQuery] int topN, [FromQuery] int? sectionId = null, [FromQuery] int lanesPerHeat = 6)
    {
        if (topN < 1) return BadRequest(new { message = "topN must be >= 1." });
        lanesPerHeat = Math.Clamp(lanesPerHeat, 1, 50);
        var (ties, ranked, names) = await RankForFinalsAsync(id, sectionId);
        if (ranked.Count <= topN)
            return new { tied = false, message = "All teams qualify; no boundary tie." };

        // Every cut between finals (A/B, B/C, ... and the last place that goes through) can be tied. Only teams
        // level on points count as a tie; the age group's rule may then settle it, or the organiser has to.
        var cutoffs = Enumerable.Range(1, topN / lanesPerHeat).Select(k => k * lanesPerHeat).Append(topN).Distinct().OrderBy(c => c).ToList();
        var boundaries = new List<BoundaryTie>();
        foreach (var cutoff in cutoffs)
        {
            if (cutoff >= ranked.Count) continue;
            var lastIn = ranked[cutoff - 1];
            var firstOut = ranked[cutoff];
            if (lastIn.Total != firstOut.Total) continue;
            var level = ranked.Where(o => o.Total == lastIn.Total).ToList();
            var settlement = ties.Settle(level, lastIn, firstOut);
            var tied = level
                .Select(o => { var position = ranked.IndexOf(o) + 1; return new BoundaryTeam(o.TeamId, names[o.TeamId], o.Total, o.Wins, position, position <= cutoff); })
                .ToList();
            boundaries.Add(new BoundaryTie(cutoff, lastIn.Total, lastIn.Wins, tied, ties.RuleOf(level), settlement, settlement != TieSettlement.Open));
        }
        if (boundaries.Count == 0) return new { tied = false };
        string? runoffRace = sectionId.HasValue
            ? await _db.CompetitionSections.AsNoTracking().Where(s => s.Id == sectionId.Value && s.CompetitionId == id).Select(s => s.RunoffRaceName).FirstOrDefaultAsync()
            : null;
        // The first tied cut is reported at the top level, as before; every tied cut is in `boundaries`.
        var first = boundaries[0];
        return new
        {
            tied = true, cutoff = first.Cutoff, totalAtCutoff = first.TotalAtCutoff, winsAtCutoff = first.WinsAtCutoff, teams = first.Teams,
            boundaries, unsettled = boundaries.Any(b => !b.Settled), runoffRaceName = runoffRace,
        };
    }

    private sealed record BoundaryTeam(int Id, string Name, double Total, int Wins, int Position, bool GoesThrough);
    private sealed record BoundaryTie(int Cutoff, double TotalAtCutoff, int WinsAtCutoff, IReadOnlyList<BoundaryTeam> Teams,
        TieBreakRule Rule, TieSettlement SettledBy, bool Settled);

    /// <summary>Active, non-HC teams in finals order: points, then the age group's tie-break or the organiser's order.</summary>
    private async Task<(TieBreaker Ties, List<TieFacts> Ranked, Dictionary<int, string> Names)> RankForFinalsAsync(int competitionId, int? sectionId, bool forFinal = false)
    {
        var teamsQ = _db.Teams.AsNoTracking()
            .Include(t => t.Results)
            .Where(t => t.CompetitionId == competitionId && !t.IsHorsConcours && t.EntryStatus == TeamEntryStatus.Active);
        if (sectionId.HasValue) teamsQ = teamsQ.Where(t => t.CompetitionSectionId == sectionId.Value);
        // Making finals for every age group at once leaves out the ones set up with no final.
        if (forFinal) teamsQ = teamsQ.Where(t => t.Section!.UsesRaceFinals || t.Section.HasFinal);
        var teams = await teamsQ.ToListAsync(HttpContext.RequestAborted);
        var ties = await TieBreaker.LoadAsync(_db, competitionId, HttpContext.RequestAborted);
        // Tack check bonus points count here as they do in the standings, so finals are seeded from the table people see.
        var bonus = await Services.TackCheck.TackCheckBonus.ForCompetitionAsync(_db, competitionId, HttpContext.RequestAborted);
        var facts = teams.Select(t =>
        {
            var effective = ties.EffectiveResults(t.Results);
            return ties.Facts(t.Id, t.CompetitionSectionId, effective, effective.Sum(r => r.Points) + bonus.GetValueOrDefault(t.Id));
        });
        return (ties, ties.Rank(facts), teams.ToDictionary(t => t.Id, t => t.DisplayName));
    }

    /// <summary>
    /// Sets the organiser's order for teams level on points (after a run-off, or decided by hand), best first.
    /// It must name every active team in the age group on that total, so a tie is never half ordered.
    /// </summary>
    [HttpPut("{id:int}/finals/tie-order")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<IActionResult> SetTieOrder(int id, SetTieOrderRequest req, [FromServices] StandingsService standings)
    {
        var teamIds = req.TeamIds ?? [];
        if (teamIds.Count < 2 || teamIds.Distinct().Count() != teamIds.Count)
            return BadRequest(new { message = "List at least two different teams, best first." });
        // Totals as the standings count them: tack check bonus included, and a finalist whose section scores its final
        // on its own is level on its final's points.
        var rows = (await standings.RowsAsync(id, ct: HttpContext.RequestAborted)).ToDictionary(r => r.TeamId);
        var teams = (await _db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == id && teamIds.Contains(t.Id))
            .Select(t => new { t.Id, t.CompetitionSectionId, t.IsHorsConcours, t.EntryStatus })
            .ToListAsync())
            .Select(t => new { t.Id, t.CompetitionSectionId, t.IsHorsConcours, t.EntryStatus, Total = rows.TryGetValue(t.Id, out var row) ? row.TotalPoints : 0 })
            .ToList();
        if (teams.Count != teamIds.Count) return BadRequest(new { message = "Every team must be in this competition." });
        if (teams.Any(t => t.IsHorsConcours || t.EntryStatus != TeamEntryStatus.Active))
            return BadRequest(new { message = "Hors concours and withdrawn teams don't take part in ties." });
        var sectionId = teams[0].CompetitionSectionId;
        if (teams.Any(t => t.CompetitionSectionId != sectionId))
            return BadRequest(new { message = "The teams must all be in the same age group." });
        var total = teams[0].Total;
        if (teams.Any(t => t.Total != total))
            return Conflict(new { message = "These teams are no longer level on points. Check the standings and try again." });

        var levelIds = (await _db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == id && t.CompetitionSectionId == sectionId
                && !t.IsHorsConcours && t.EntryStatus == TeamEntryStatus.Active)
            .Select(t => t.Id)
            .ToListAsync())
            .Where(teamId => rows.TryGetValue(teamId, out var row) && row.TotalPoints == total)
            .ToList();
        if (!levelIds.ToHashSet().SetEquals(teamIds))
            return Conflict(new { message = $"Order every team on {PointValues.Format(total)} points in this age group together.", teamIds = levelIds });

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        _db.FinalsTieOrders.RemoveRange(await _db.FinalsTieOrders.Where(o => teamIds.Contains(o.TeamId)).ToListAsync());
        for (var i = 0; i < teamIds.Count; i++)
            _db.FinalsTieOrders.Add(new FinalsTieOrder { CompetitionId = id, TeamId = teamIds[i], Points = total, Position = i + 1, SetByUserId = userId });
        await _db.SaveChangesAsync();
        StandingsService.Invalidate(id);
        return NoContent();
    }

    /// <summary>Clears the organiser's order for these teams, so their age group's rule decides again.</summary>
    [HttpDelete("{id:int}/finals/tie-order")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<IActionResult> ClearTieOrder(int id, [FromQuery] int[] teamIds)
    {
        await _db.FinalsTieOrders.Where(o => o.CompetitionId == id && teamIds.Contains(o.TeamId)).ExecuteDeleteAsync();
        StandingsService.Invalidate(id);
        return NoContent();
    }

    [HttpPost("{id:int}/finals")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<SessionDto>> CreateFinals(int id, CreateFinalsRequest req)
    {
        var comp = await _db.Competitions.FirstOrDefaultAsync(c => c.Id == id);
        if (comp is null) return NotFound();

        var raceNames = req.RaceNames.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).ToList();
        if (raceNames.Count == 0) return BadRequest("At least one race name is required.");
        if (req.TopN < 1) return BadRequest("topN must be >= 1.");
        if (req.CompetitionSectionId.HasValue && !await SectionInCompetitionAsync(id, req.CompetitionSectionId.Value))
            return BadRequest("Section not found in this competition.");
        if (await NoFinalErrorAsync(id, req.CompetitionSectionId) is { } noFinal) return noFinal;

        var (_, ranked, _) = await RankForFinalsAsync(id, req.CompetitionSectionId, forFinal: true);
        var top = ranked.Take(req.TopN).Select(x => x.TeamId).ToList();

        if (top.Count == 0) return BadRequest("No teams with results to seed finals.");

        var maxOrder = await _db.Sessions.Where(s => s.CompetitionId == id).Select(s => (int?)s.OrderIndex).MaxAsync() ?? 0;
        var sectionLabel = req.CompetitionSectionId.HasValue
            ? (await _db.CompetitionSections.Where(s => s.Id == req.CompetitionSectionId.Value).Select(s => s.DisplayName).FirstOrDefaultAsync() ?? "Finals")
            : "Finals";
        var name = string.IsNullOrWhiteSpace(req.Name) ? $"Finals · {sectionLabel}" : req.Name!.Trim();

        var maxHeatSize = req.LanesPerHeat ?? top.Count;
        if (maxHeatSize <= 0) maxHeatSize = top.Count;

        Session? session = null;
        if (req.ExistingSessionId is { } existingId)
        {
            session = await _db.Sessions.Include(s => s.Heats).SingleOrDefaultAsync(s =>
                s.Id == existingId && s.CompetitionId == id && s.CompetitionSectionId == req.CompetitionSectionId);
            if (session is null) return BadRequest("The planned finals session was not found in this age group.");
            if (session.Heats.Count > 0 || session.Status != SessionStatus.Upcoming || session.Kind != SessionKind.Race)
                return Conflict("The planned finals session already has heats or has started. Reload the timetable.");
        }
        if (session is null)
        {
            session = new Session
            {
                CompetitionId = id, CompetitionSectionId = req.CompetitionSectionId,
                Name = name, OrderIndex = maxOrder + 1, Status = SessionStatus.Upcoming,
            };
            _db.Sessions.Add(session);
        }
        session.LanesPerHeat = maxHeatSize;
        await _db.SaveChangesAsync();

        var groups = SplitIntoRankedGroups(top, maxHeatSize);
        var lowestFirst = req.LowestFinalFirst != false;
        for (var gi = 0; gi < groups.Count; gi++)
        {
            // Finals are labelled A Final, B Final, C Final, etc. (top group is A Final).
            // By default (LowestFinalFirst != false), the lowest final runs first (C → B → A).
            var letter = (char)('A' + gi);
            var heat = new Heat
            {
                SessionId = session.Id,
                Label = $"{letter} Final",
                OrderIndex = lowestFirst ? groups.Count - gi : gi + 1
            };
            _db.Heats.Add(heat);
            await _db.SaveChangesAsync();

            var lane = 1;
            foreach (var teamId in groups[gi])
            {
                _db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = teamId, LaneIndex = lane++ });
            }
            var heatRaces = PlannedFinalRaceLists.For(letter, session.PlannedFinalRaces, raceNames);
            for (var ri = 0; ri < heatRaces.Count; ri++)
            {
                _db.Races.Add(new Race { HeatId = heat.Id, Name = heatRaces[ri], OrderIndex = ri + 1 });
            }
        }
        await _db.SaveChangesAsync();

        var reloaded = await SessionsWithDetail().FirstAsync(s => s.Id == session.Id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(id, dto);
        await NotifyFinalsDrawAsync(id, reloaded);
        return dto;
    }

    private async Task NotifyFinalsDrawAsync(int competitionId, Session session)
    {
        if (_push is null) return;
        try
        {
            var messages = new List<(int TeamId, PushPayload Payload)>();
            foreach (var heat in session.Heats.OrderBy(h => h.OrderIndex))
            {
                var heatLabel = !string.IsNullOrWhiteSpace(heat.Label) ? heat.Label! : $"Heat {heat.OrderIndex}";
                foreach (var entry in heat.Entries.OrderBy(e => e.LaneIndex))
                {
                    var teamName = entry.Team?.DisplayName ?? "Unnamed team";
                    messages.Add((entry.TeamId, new PushPayload(
                        Title: "Finals draw published",
                        Body: $"You are in the {heatLabel}, Lane {entry.LaneIndex} ({teamName})",
                        Tag: $"finals-draw:{heat.Id}:{entry.TeamId}",
                        Url: $"/competitions/{competitionId}")));
                }
            }
            if (messages.Count > 0)
                await _push.NotifyPerTeamAsync(messages, HttpContext.RequestAborted);
        }
        catch
        {
            // Never fail finals creation if push notification delivery fails.
        }
    }

    private Task<bool> SectionInCompetitionAsync(int competitionId, int sectionId)
        => _db.CompetitionSections.AnyAsync(s => s.Id == sectionId && s.CompetitionId == competitionId);

    private static List<List<int>> SplitIntoBalancedGroups(IReadOnlyList<int> teamIds, int maxPerGroup)
    {
        var rng = new Random();
        var shuffled = teamIds.OrderBy(_ => rng.Next()).ToList();
        var groupCount = (int)Math.Ceiling(shuffled.Count / (double)maxPerGroup);
        if (groupCount < 1) groupCount = 1;
        var groups = Enumerable.Range(0, groupCount).Select(_ => new List<int>()).ToList();
        for (var i = 0; i < shuffled.Count; i++)
            groups[i % groupCount].Add(shuffled[i]);
        return groups;
    }

    /// <summary>
    /// Cuts the ranked team ids into consecutive blocks: ranks 1..n for the A Final, the
    /// next n for the B Final, and so on. The last block holds whatever is left.
    /// </summary>
    private static List<List<int>> SplitIntoRankedGroups(IReadOnlyList<int> rankedTeamIds, int maxPerGroup)
    {
        var size = Math.Max(1, maxPerGroup);
        return rankedTeamIds.Chunk(size).Select(chunk => chunk.ToList()).ToList();
    }

    [HttpPost("{id:int}/finals/scaffold")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<SessionDto>> ScaffoldFinals(int id, ScaffoldFinalsRequest req)
    {
        var comp = await _db.Competitions.FirstOrDefaultAsync(c => c.Id == id);
        if (comp is null) return NotFound();

        var raceNames = req.RaceNames.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).ToList();
        if (raceNames.Count == 0) return BadRequest(new { message = "At least one race name is required." });
        if (req.NumHeats < 1) return BadRequest(new { message = "numHeats must be >= 1." });
        if (req.LanesPerHeat < 1) return BadRequest(new { message = "lanesPerHeat must be >= 1." });
        if (req.CompetitionSectionId.HasValue && !await SectionInCompetitionAsync(id, req.CompetitionSectionId.Value))
            return BadRequest(new { message = "Section not found in this competition." });
        if (await NoFinalErrorAsync(id, req.CompetitionSectionId) is { } noFinal) return noFinal;

        var maxOrder = await _db.Sessions.Where(s => s.CompetitionId == id).Select(s => (int?)s.OrderIndex).MaxAsync() ?? 0;
        var sectionLabel = req.CompetitionSectionId.HasValue
            ? (await _db.CompetitionSections.Where(s => s.Id == req.CompetitionSectionId.Value).Select(s => s.DisplayName).FirstOrDefaultAsync() ?? "Finals")
            : "Finals";
        var name = string.IsNullOrWhiteSpace(req.Name) ? $"Finals · {sectionLabel}" : req.Name!.Trim();

        Session? session = null;
        if (req.ExistingSessionId is { } existingId)
        {
            session = await _db.Sessions.Include(s => s.Heats).SingleOrDefaultAsync(s =>
                s.Id == existingId && s.CompetitionId == id && s.CompetitionSectionId == req.CompetitionSectionId);
            if (session is null) return BadRequest("The planned finals session was not found in this age group.");
            if (session.Heats.Count > 0 || session.Status != SessionStatus.Upcoming || session.Kind != SessionKind.Race)
                return Conflict("The planned finals session already has heats or has started. Reload the timetable.");
        }
        if (session is null)
        {
            session = new Session
            {
                CompetitionId = id, CompetitionSectionId = req.CompetitionSectionId,
                Name = name, OrderIndex = maxOrder + 1, Status = SessionStatus.Upcoming,
            };
            _db.Sessions.Add(session);
        }
        session.LanesPerHeat = req.LanesPerHeat;
        session.MinutesPerHeat = req.MinutesPerHeat ?? session.MinutesPerHeat;
        session.ScheduledStart = req.ScheduledStart ?? session.ScheduledStart;
        await _db.SaveChangesAsync();

        var lowestFirst = req.LowestFinalFirst != false;
        for (var gi = 0; gi < req.NumHeats; gi++)
        {
            var letter = (char)('A' + gi);
            var heat = new Heat
            {
                SessionId = session.Id,
                Label = $"{letter} Final",
                OrderIndex = lowestFirst ? req.NumHeats - gi : gi + 1
            };
            _db.Heats.Add(heat);
            await _db.SaveChangesAsync();
            var heatRaces = PlannedFinalRaceLists.For(letter, session.PlannedFinalRaces, raceNames);
            for (var ri = 0; ri < heatRaces.Count; ri++)
            {
                _db.Races.Add(new Race { HeatId = heat.Id, Name = heatRaces[ri], OrderIndex = ri + 1 });
            }
        }
        await _db.SaveChangesAsync();

        var reloaded = await SessionsWithDetail().FirstAsync(s => s.Id == session.Id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(id, dto);
        return dto;
    }

    [HttpPost("{id:int}/sessions/{sessionId:int}/populate-finals")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<SessionDto>> PopulateFinals(int id, int sessionId)
    {
        var session = await _db.Sessions
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.CompetitionId == id);
        if (session is null) return NotFound();
        if (await NoFinalErrorAsync(id, session.CompetitionSectionId) is { } noFinal) return noFinal;
        var heats = session.Heats
            .OrderBy(h => FinalsTiers.ParseLabel(h.Label) ?? int.MaxValue)
            .ThenBy(h => h.OrderIndex)
            .ToList();
        if (heats.Count == 0) return BadRequest(new { message = "Session has no heats to populate." });
        if (heats.Any(h => h.Entries.Count > 0))
            return BadRequest(new { message = "Heats already have teams. Clear them first via heat assignments." });

        var (_, ranked, _) = await RankForFinalsAsync(id, session.CompetitionSectionId, forFinal: true);
        var ordered = ranked.Select(x => x.TeamId).ToList();
        if (ordered.Count == 0) return BadRequest(new { message = "No teams with results to seed finals." });

        var perHeat = session.LanesPerHeat ?? 6;
        // Distribute by ranking: top group → A Final, next → B Final, etc.
        var idx = 0;
        foreach (var heat in heats)
        {
            var lane = 1;
            for (var k = 0; k < perHeat && idx < ordered.Count; k++, idx++)
            {
                _db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = ordered[idx], LaneIndex = lane++ });
            }
        }
        await _db.SaveChangesAsync();

        var reloaded = await SessionsWithDetail().FirstAsync(s => s.Id == session.Id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(id, dto);
        await NotifyFinalsDrawAsync(id, reloaded);
        return dto;
    }

    [HttpPost("{id:int}/auto-timetable")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<CompetitionDetail>> AutoTimetable(int id, AutoTimetableRequest req)
    {
        var comp = await _db.Competitions
            .Include(c => c.Sections)
            .Include(c => c.Teams)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .FirstOrDefaultAsync(c => c.Id == id);
        if (comp is null) return NotFound();

        var racesPerHeat = req.RacesPerHeat is > 0 ? req.RacesPerHeat.Value : 5;
        var sessionsPerSection = req.SessionsPerSection is > 0 ? req.SessionsPerSection.Value : 1;
        var maxHeatSize = req.LanesPerHeat is > 0 ? req.LanesPerHeat.Value : 6;
        var minutes = req.MinutesPerHeat is > 0 ? req.MinutesPerHeat.Value : 15;
        var gap = req.MinutesBetweenSessions is > 0 ? req.MinutesBetweenSessions.Value : 10;

        var sectionIds = req.SectionIds?.ToHashSet();
        var sections = comp.Sections
            .Where(s => sectionIds == null || sectionIds.Contains(s.Id))
            // Oldest age group first; sections we can't place follow, then ties by name as before.
            .OrderBy(s => SectionAgeOrder.Rank(s))
            .ThenBy(s => s.DisplayName)
            .ToList();
        if (sections.Count == 0) return BadRequest("No sections to schedule.");

        if (req.ReplaceExisting)
        {
            var raceSessions = comp.Sessions
                .Where(s => s.Kind == SessionKind.Race && !s.Heats.Any(h => h.Races.Any(r => r.Results.Count > 0)))
                .ToList();
            _db.Sessions.RemoveRange(raceSessions);
            await _db.SaveChangesAsync();
        }

        var baseStart = comp.StartDate.Date.AddHours(9);
        var existingMaxOrder = await _db.Sessions.Where(s => s.CompetitionId == id).Select(s => (int?)s.OrderIndex).MaxAsync() ?? 0;
        var order = existingMaxOrder + 1;
        var cursor = baseStart;
        var createdSessions = new List<Session>();

        foreach (var section in sections)
        {
            var sectionTeams = comp.Teams.Where(t => t.CompetitionSectionId == section.Id && t.EntryStatus == TeamEntryStatus.Active).Select(t => t.Id).ToList();
            if (sectionTeams.Count == 0) continue;

            for (var sIdx = 1; sIdx <= sessionsPerSection; sIdx++)
            {
                // Independent random heat split per session — guarantees each team rides only once.
                var groups = SplitIntoBalancedGroups(sectionTeams, maxHeatSize);
                var sessionMinutes = groups.Count * minutes;
                var sessionName = sessionsPerSection > 1
                    ? $"{section.DisplayName} · Session {sIdx}"
                    : section.DisplayName;

                var session = new Session
                {
                    CompetitionId = id,
                    CompetitionSectionId = section.Id,
                    Name = sessionName,
                    ArenaName = "Main Arena",
                    OrderIndex = order++,
                    Status = SessionStatus.Upcoming,
                    ScheduledStart = cursor,
                    Kind = SessionKind.Race,
                    LanesPerHeat = maxHeatSize,
                    MinutesPerHeat = minutes,
                    RaceOrderAlternating = false
                };
                _db.Sessions.Add(session);
                await _db.SaveChangesAsync();

                for (var gi = 0; gi < groups.Count; gi++)
                {
                    var heat = new Heat
                    {
                        SessionId = session.Id,
                        Label = $"Heat {gi + 1}",
                        OrderIndex = gi + 1,
                        DurationMinutes = minutes
                    };
                    _db.Heats.Add(heat);
                    await _db.SaveChangesAsync();
                    var lane = 1;
                    foreach (var teamId in groups[gi])
                    {
                        _db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = teamId, LaneIndex = lane++ });
                    }
                    for (var raceIdx = 1; raceIdx <= racesPerHeat; raceIdx++)
                    {
                        _db.Races.Add(new Race
                        {
                            HeatId = heat.Id,
                            Name = $"Race {raceIdx}",
                            OrderIndex = raceIdx
                        });
                    }
                }
                await _db.SaveChangesAsync();
                createdSessions.Add(session);
                cursor = cursor.AddMinutes(sessionMinutes + gap);
            }
        }

        var refreshed = await _db.Competitions
            .Include(c => c.Sections)
            .Include(c => c.Teams).ThenInclude(t => t.Club)
            .Include(c => c.Teams).ThenInclude(t => t.Section)
            .Include(c => c.Teams).ThenInclude(t => t.Trainer)
            .Include(c => c.Teams).ThenInclude(t => t.Results)
            .Include(c => c.Sessions).ThenInclude(s => s.Section)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team).ThenInclude(t => t!.Results)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(c => c.Id == id);

        var signupCounts = await ActiveSignupCountsAsync(id);
        foreach (var s in createdSessions)
        {
            var dto = refreshed.Sessions.First(x => x.Id == s.Id).ToDto();
            await _live.SessionUpdated(id, dto);
        }

        return refreshed.ToDto(
            refreshed.Sections.OrderBy(s => s.DisplayName).Select(s => s.ToDto(signupCounts.GetValueOrDefault(s.Id))).ToList(),
            refreshed.Teams.OrderBy(t => t.DisplayName).Select(t => t.ToDto()).ToList(),
            refreshed.Sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList(),
            isDemo: await IsDemoCompetitionAsync(refreshed.Id),
            payoutsTo: await _db.PayoutsToAsync(refreshed.CreatedByUserId, refreshed.DecFormConfigJson),
            includePaymentDetails: User.Identity?.IsAuthenticated == true);
    }
}
