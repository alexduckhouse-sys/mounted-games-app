using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions")]
public class CompetitionsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILiveBroadcaster _live;
    private readonly GeocodingService _geocode;
    public CompetitionsController(AppDbContext db, ILiveBroadcaster live, GeocodingService geocode)
    {
        _db = db;
        _live = live;
        _geocode = geocode;
    }

    [HttpGet("/api/geocode")]
    [AllowAnonymous]
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
        .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
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

    [HttpGet]
    public async Task<IEnumerable<CompetitionSummary>> List([FromQuery] bool includeArchived = false)
    {
        var q = _db.Competitions
            .Include(c => c.Sections)
            .Include(c => c.Teams)
            .Include(c => c.Sessions)
            .AsQueryable();
        if (!includeArchived) q = q.Where(c => !c.IsArchived);
        return (await q.OrderByDescending(c => c.StartDate).ToListAsync()).Select(c => c.ToSummary());
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<CompetitionDetail>> Get(int id)
    {
        var c = await _db.Competitions
            .Include(c => c.Sections)
            .Include(c => c.Teams).ThenInclude(t => t.Club)
            .Include(c => c.Teams).ThenInclude(t => t.Section)
            .Include(c => c.Teams).ThenInclude(t => t.Trainer)
            .Include(c => c.Sessions).ThenInclude(s => s.Section)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (c is null) return NotFound();

        return new CompetitionDetail(
            c.Id, c.Name, c.Location, c.Description,
            c.Latitude, c.Longitude,
            c.What3Words, c.AppleMapsUrl,
            c.StartDate, c.EndDate,
            c.IsActive, c.IsArchived,
            c.Sections.OrderBy(s => s.DisplayName).Select(s => s.ToDto()).ToList(),
            c.Teams.OrderBy(t => t.DisplayName).Select(t => t.ToDto()).ToList(),
            c.Sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList(),
            c.StreamUrl, c.OrganiserName, c.PaymentDestination,
            c.SignupsLocked);
    }

    /// <summary>
    /// Toggle whether public signups are accepted for this competition.
    /// Used by the format-after-signups flow to "close entries" before forming teams.
    /// </summary>
    [HttpPost("{id:int}/signups-locked")]
    [Authorize(Roles = Roles.Organiser)]
    public async Task<ActionResult<object>> SetSignupsLocked(int id, SetSignupsLockedRequest req)
    {
        var c = await _db.Competitions.FirstOrDefaultAsync(c => c.Id == id);
        if (c is null) return NotFound();
        c.SignupsLocked = req.Locked;
        await _db.SaveChangesAsync();
        return new { signupsLocked = c.SignupsLocked };
    }

    [HttpPost]
    [Authorize(Roles = Roles.Organiser)]
    public async Task<ActionResult<CompetitionSummary>> Create(CreateCompetitionRequest req)
    {
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
        var c = new Competition
        {
            Name = req.Name,
            Location = req.Location,
            Description = req.Description,
            Latitude = lat,
            Longitude = lon,
            What3Words = string.IsNullOrWhiteSpace(req.What3Words) ? null : req.What3Words.Trim(),
            AppleMapsUrl = appleUrl,
            StreamUrl = string.IsNullOrWhiteSpace(req.StreamUrl) ? null : req.StreamUrl.Trim(),
            OrganiserName = string.IsNullOrWhiteSpace(req.OrganiserName) ? null : req.OrganiserName.Trim(),
            PaymentDestination = string.IsNullOrWhiteSpace(req.PaymentDestination) ? null : req.PaymentDestination.Trim(),
            StartDate = req.StartDate,
            EndDate = req.EndDate,
            CreatedByUserId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
        };
        _db.Competitions.Add(c);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = c.Id }, c.ToSummary());
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Organiser)]
    public async Task<ActionResult<CompetitionSummary>> Update(int id, UpdateCompetitionRequest req)
    {
        var c = await _db.Competitions
            .Include(c => c.Sections).Include(c => c.Teams).Include(c => c.Sessions)
            .FirstOrDefaultAsync(c => c.Id == id);
        if (c is null) return NotFound();
        c.Name = req.Name;
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
        c.OrganiserName = string.IsNullOrWhiteSpace(req.OrganiserName) ? null : req.OrganiserName.Trim();
        c.PaymentDestination = string.IsNullOrWhiteSpace(req.PaymentDestination) ? null : req.PaymentDestination.Trim();
        c.StartDate = req.StartDate;
        c.EndDate = req.EndDate;
        c.IsActive = req.IsActive;
        c.IsArchived = req.IsArchived;
        await _db.SaveChangesAsync();
        return c.ToSummary();
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id)
    {
        var c = await _db.Competitions
            .Include(x => x.Sections)
            .Include(x => x.Teams)
            .Include(x => x.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(x => x.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .Include(x => x.ChatMessages)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (c is null) return NotFound();

        // Walk the graph bottom-up so foreign-key constraints don't trip.
        foreach (var session in c.Sessions)
        foreach (var heat in session.Heats)
        {
            foreach (var race in heat.Races) _db.Results.RemoveRange(race.Results);
            _db.Races.RemoveRange(heat.Races);
            _db.HeatEntries.RemoveRange(heat.Entries);
        }
        foreach (var session in c.Sessions) _db.Heats.RemoveRange(session.Heats);
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
        _db.Competitions.Remove(c);

        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:int}/sections")]
    [Authorize(Roles = Roles.Organiser)]
    public async Task<ActionResult<CompetitionSectionDto>> AddSection(int id, CreateSectionRequest req)
    {
        if (!await _db.Competitions.AnyAsync(c => c.Id == id)) return NotFound();
        var display = string.IsNullOrWhiteSpace(req.DisplayName)
            ? $"{req.Format} {req.AgeGroup}".Trim()
            : req.DisplayName!;
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
        };
        _db.CompetitionSections.Add(section);
        await _db.SaveChangesAsync();
        return section.ToDto();
    }

    [HttpPut("{id:int}/sections/{sectionId:int}")]
    [Authorize(Roles = Roles.Organiser)]
    public async Task<ActionResult<CompetitionSectionDto>> UpdateSection(int id, int sectionId, UpdateSectionRequest req)
    {
        var section = await _db.CompetitionSections.FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == id);
        if (section is null) return NotFound();
        section.RunoffRaceName = string.IsNullOrWhiteSpace(req.RunoffRaceName) ? null : req.RunoffRaceName.Trim();
        if (req.UsesRaceFinals.HasValue) section.UsesRaceFinals = req.UsesRaceFinals.Value;
        if (req.PriceMinor.HasValue) section.PriceMinor = Math.Max(0, req.PriceMinor.Value);
        if (req.MaxParticipants.HasValue)
            section.MaxParticipants = req.MaxParticipants.Value > 0 ? req.MaxParticipants.Value : null;
        await _db.SaveChangesAsync();
        return section.ToDto();
    }

    [HttpDelete("{id:int}/sections/{sectionId:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> DeleteSection(int id, int sectionId)
    {
        var section = await _db.CompetitionSections
            .Include(s => s.Teams)
            .Include(s => s.Sessions).ThenInclude(ss => ss.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Sessions).ThenInclude(ss => ss.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .FirstOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == id);
        if (section is null) return NotFound();

        // Walk bottom-up so foreign keys don't complain.
        foreach (var ss in section.Sessions)
        foreach (var heat in ss.Heats)
        {
            foreach (var race in heat.Races) _db.Results.RemoveRange(race.Results);
            _db.Races.RemoveRange(heat.Races);
            _db.HeatEntries.RemoveRange(heat.Entries);
        }
        foreach (var ss in section.Sessions) _db.Heats.RemoveRange(ss.Heats);
        _db.Sessions.RemoveRange(section.Sessions);

        var teamIds = section.Teams.Select(t => t.Id).ToList();
        var decForms = await _db.DeclarationForms
            .Include(d => d.Riders)
            .Where(d => teamIds.Contains(d.TeamId))
            .ToListAsync();
        foreach (var d in decForms) _db.RiderEntries.RemoveRange(d.Riders);
        _db.DeclarationForms.RemoveRange(decForms);

        _db.Teams.RemoveRange(section.Teams);
        _db.CompetitionSections.Remove(section);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{id:int}/standings")]
    public async Task<ActionResult<IReadOnlyList<StandingRow>>> Standings(int id, [FromQuery] int? sectionId = null)
    {
        var teamsQ = _db.Teams
            .Include(t => t.Club)
            .Include(t => t.Results).ThenInclude(r => r.Race)
            .Where(t => t.CompetitionId == id && !t.IsHorsConcours);
        if (sectionId.HasValue) teamsQ = teamsQ.Where(t => t.CompetitionSectionId == sectionId.Value);

        var teams = await teamsQ.ToListAsync();

        var rows = teams.Select(t => new StandingRow(
            t.Id, t.DisplayName, t.Club?.Name ?? string.Empty, t.BibColour,
            t.Results.Sum(r => r.Points),
            t.Results.Count,
            t.Results.Count(r => r.Placing == 1 && !r.Eliminated),
            t.Results.Count(r => r.Eliminated)))
        .OrderByDescending(r => r.TotalPoints)
        .ThenByDescending(r => r.Wins)
        .ToList();

        return rows;
    }

    [HttpPost("{id:int}/shift-day")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<CompetitionDetail>> ShiftDay(int id, [FromQuery] int days = 1)
    {
        var c = await _db.Competitions
            .Include(c => c.Sessions)
            .FirstOrDefaultAsync(c => c.Id == id);
        if (c is null) return NotFound();
        var shift = TimeSpan.FromDays(days);

        // Only push sessions that haven't started yet — preserves history.
        foreach (var s in c.Sessions.Where(s => s.StartedAt is null && s.Status != SessionStatus.Finished))
        {
            if (s.ScheduledStart.HasValue)
                s.ScheduledStart = s.ScheduledStart.Value.Add(shift);
        }
        if (c.EndDate.HasValue) c.EndDate = c.EndDate.Value.Add(shift);
        await _db.SaveChangesAsync();
        return await Get(id);
    }

    [HttpGet("{id:int}/finals/boundary")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<object>> FinalsBoundary(int id,
        [FromQuery] int topN, [FromQuery] int? sectionId = null)
    {
        if (topN < 1) return BadRequest(new { message = "topN must be >= 1." });
        var teamsQ = _db.Teams
            .Include(t => t.Results)
            .Where(t => t.CompetitionId == id && !t.IsHorsConcours);
        if (sectionId.HasValue) teamsQ = teamsQ.Where(t => t.CompetitionSectionId == sectionId.Value);

        var teams = await teamsQ.ToListAsync();
        var ordered = teams
            .Select(t => new
            {
                t.Id,
                Name = t.DisplayName,
                Total = t.Results.Sum(r => r.Points),
                Wins = t.Results.Count(r => r.Placing == 1 && !r.Eliminated)
            })
            .OrderByDescending(x => x.Total)
            .ThenByDescending(x => x.Wins)
            .ToList();
        if (ordered.Count <= topN)
            return new { tied = false, message = "All teams qualify; no boundary tie." };

        // Tie sits at the cutoff if the team just inside (position topN-1) shares total+wins
        // with the team just outside (position topN).
        var lastIn = ordered[topN - 1];
        var firstOut = ordered[topN];
        if (lastIn.Total == firstOut.Total && lastIn.Wins == firstOut.Wins)
        {
            var tied = ordered
                .Where(o => o.Total == lastIn.Total && o.Wins == lastIn.Wins)
                .Select(o => new { o.Id, o.Name, o.Total, o.Wins })
                .ToList();
            return new { tied = true, cutoff = topN, totalAtCutoff = lastIn.Total, winsAtCutoff = lastIn.Wins, teams = tied };
        }
        return new { tied = false };
    }

    [HttpPost("{id:int}/finals")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> CreateFinals(int id, CreateFinalsRequest req)
    {
        var comp = await _db.Competitions.FirstOrDefaultAsync(c => c.Id == id);
        if (comp is null) return NotFound();

        var raceNames = req.RaceNames.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).ToList();
        if (raceNames.Count == 0) return BadRequest("At least one race name is required.");
        if (req.TopN < 1) return BadRequest("topN must be >= 1.");

        var teamsQ = _db.Teams
            .Include(t => t.Results)
            .Where(t => t.CompetitionId == id && !t.IsHorsConcours);
        if (req.CompetitionSectionId.HasValue)
            teamsQ = teamsQ.Where(t => t.CompetitionSectionId == req.CompetitionSectionId.Value);

        var teams = await teamsQ.ToListAsync();
        var top = teams
            .Select(t => new
            {
                t.Id,
                Total = t.Results.Sum(r => r.Points),
                Wins = t.Results.Count(r => r.Placing == 1 && !r.Eliminated)
            })
            .OrderByDescending(x => x.Total)
            .ThenByDescending(x => x.Wins)
            .Take(req.TopN)
            .Select(x => x.Id)
            .ToList();

        if (top.Count == 0) return BadRequest("No teams with results to seed finals.");

        var maxOrder = await _db.Sessions.Where(s => s.CompetitionId == id).Select(s => (int?)s.OrderIndex).MaxAsync() ?? 0;
        var sectionLabel = req.CompetitionSectionId.HasValue
            ? (await _db.CompetitionSections.Where(s => s.Id == req.CompetitionSectionId.Value).Select(s => s.DisplayName).FirstOrDefaultAsync() ?? "Finals")
            : "Finals";
        var name = string.IsNullOrWhiteSpace(req.Name) ? $"Finals · {sectionLabel}" : req.Name!.Trim();

        var maxHeatSize = req.LanesPerHeat ?? top.Count;
        if (maxHeatSize <= 0) maxHeatSize = top.Count;

        var session = new Session
        {
            CompetitionId = id,
            CompetitionSectionId = req.CompetitionSectionId,
            Name = name,
            OrderIndex = maxOrder + 1,
            Status = SessionStatus.Upcoming,
            LanesPerHeat = maxHeatSize
        };
        _db.Sessions.Add(session);
        await _db.SaveChangesAsync();

        var groups = SplitIntoBalancedGroups(top, maxHeatSize);
        for (var gi = 0; gi < groups.Count; gi++)
        {
            // Finals are labelled A Final, B Final, C Final, etc. (top group first).
            var letter = (char)('A' + gi);
            var heat = new Heat
            {
                SessionId = session.Id,
                Label = $"{letter} Final",
                OrderIndex = gi + 1
            };
            _db.Heats.Add(heat);
            await _db.SaveChangesAsync();

            var lane = 1;
            foreach (var teamId in groups[gi])
            {
                _db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = teamId, LaneIndex = lane++ });
            }
            for (var ri = 0; ri < raceNames.Count; ri++)
            {
                _db.Races.Add(new Race { HeatId = heat.Id, Name = raceNames[ri], OrderIndex = ri + 1 });
            }
        }
        await _db.SaveChangesAsync();

        var reloaded = await SessionsWithDetail().FirstAsync(s => s.Id == session.Id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(id, dto);
        return dto;
    }

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

    [HttpPost("{id:int}/finals/scaffold")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> ScaffoldFinals(int id, ScaffoldFinalsRequest req)
    {
        var comp = await _db.Competitions.FirstOrDefaultAsync(c => c.Id == id);
        if (comp is null) return NotFound();

        var raceNames = req.RaceNames.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).ToList();
        if (raceNames.Count == 0) return BadRequest(new { message = "At least one race name is required." });
        if (req.NumHeats < 1) return BadRequest(new { message = "numHeats must be >= 1." });
        if (req.LanesPerHeat < 1) return BadRequest(new { message = "lanesPerHeat must be >= 1." });

        var maxOrder = await _db.Sessions.Where(s => s.CompetitionId == id).Select(s => (int?)s.OrderIndex).MaxAsync() ?? 0;
        var sectionLabel = req.CompetitionSectionId.HasValue
            ? (await _db.CompetitionSections.Where(s => s.Id == req.CompetitionSectionId.Value).Select(s => s.DisplayName).FirstOrDefaultAsync() ?? "Finals")
            : "Finals";
        var name = string.IsNullOrWhiteSpace(req.Name) ? $"Finals · {sectionLabel}" : req.Name!.Trim();

        var session = new Session
        {
            CompetitionId = id,
            CompetitionSectionId = req.CompetitionSectionId,
            Name = name,
            OrderIndex = maxOrder + 1,
            Status = SessionStatus.Upcoming,
            LanesPerHeat = req.LanesPerHeat,
            MinutesPerHeat = req.MinutesPerHeat,
            ScheduledStart = req.ScheduledStart,
        };
        _db.Sessions.Add(session);
        await _db.SaveChangesAsync();

        for (var gi = 0; gi < req.NumHeats; gi++)
        {
            var letter = (char)('A' + gi);
            var heat = new Heat
            {
                SessionId = session.Id,
                Label = $"{letter} Final",
                OrderIndex = gi + 1
            };
            _db.Heats.Add(heat);
            await _db.SaveChangesAsync();
            for (var ri = 0; ri < raceNames.Count; ri++)
            {
                _db.Races.Add(new Race { HeatId = heat.Id, Name = raceNames[ri], OrderIndex = ri + 1 });
            }
        }
        await _db.SaveChangesAsync();

        var reloaded = await SessionsWithDetail().FirstAsync(s => s.Id == session.Id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(id, dto);
        return dto;
    }

    [HttpPost("{id:int}/sessions/{sessionId:int}/populate-finals")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> PopulateFinals(int id, int sessionId)
    {
        var session = await _db.Sessions
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.CompetitionId == id);
        if (session is null) return NotFound();
        var heats = session.Heats.OrderBy(h => h.OrderIndex).ToList();
        if (heats.Count == 0) return BadRequest(new { message = "Session has no heats to populate." });
        if (heats.Any(h => h.Entries.Count > 0))
            return BadRequest(new { message = "Heats already have teams. Clear them first via heat assignments." });

        var teamsQ = _db.Teams
            .Include(t => t.Results)
            .Where(t => t.CompetitionId == id && !t.IsHorsConcours);
        if (session.CompetitionSectionId.HasValue)
            teamsQ = teamsQ.Where(t => t.CompetitionSectionId == session.CompetitionSectionId.Value);
        var teams = await teamsQ.ToListAsync();
        var ordered = teams
            .Select(t => new
            {
                t.Id,
                Total = t.Results.Sum(r => r.Points),
                Wins = t.Results.Count(r => r.Placing == 1 && !r.Eliminated)
            })
            .OrderByDescending(x => x.Total)
            .ThenByDescending(x => x.Wins)
            .Select(x => x.Id)
            .ToList();
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
        return dto;
    }

    [HttpPost("{id:int}/auto-timetable")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<CompetitionDetail>> AutoTimetable(int id, AutoTimetableRequest req)
    {
        var comp = await _db.Competitions
            .Include(c => c.Sections)
            .Include(c => c.Teams)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats)
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
            .OrderBy(s => s.DisplayName)
            .ToList();
        if (sections.Count == 0) return BadRequest("No sections to schedule.");

        if (req.ReplaceExisting)
        {
            var raceSessions = comp.Sessions.Where(s => s.Kind == SessionKind.Race).ToList();
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
            var sectionTeams = comp.Teams.Where(t => t.CompetitionSectionId == section.Id).Select(t => t.Id).ToList();
            if (sectionTeams.Count == 0) continue;

            for (var sIdx = 1; sIdx <= sessionsPerSection; sIdx++)
            {
                // Independent random heat split per session — guarantees each team rides only once.
                var groups = SplitIntoBalancedGroups(sectionTeams, maxHeatSize);
                var sessionMinutes = groups.Count * racesPerHeat * minutes;
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
                        DurationMinutes = racesPerHeat * minutes
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
            .Include(c => c.Sessions).ThenInclude(s => s.Section)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(c => c.Id == id);

        foreach (var s in createdSessions)
        {
            var dto = refreshed.Sessions.First(x => x.Id == s.Id).ToDto();
            await _live.SessionUpdated(id, dto);
        }

        return new CompetitionDetail(
            refreshed.Id, refreshed.Name, refreshed.Location, refreshed.Description,
            refreshed.Latitude, refreshed.Longitude,
            refreshed.What3Words, refreshed.AppleMapsUrl,
            refreshed.StartDate, refreshed.EndDate,
            refreshed.IsActive, refreshed.IsArchived,
            refreshed.Sections.OrderBy(s => s.DisplayName).Select(s => s.ToDto()).ToList(),
            refreshed.Teams.OrderBy(t => t.DisplayName).Select(t => t.ToDto()).ToList(),
            refreshed.Sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList());
    }
}
