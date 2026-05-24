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
[Route("api/competitions/{competitionId:int}/sessions")]
public class SessionsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILiveBroadcaster _live;

    public SessionsController(AppDbContext db, ILiveBroadcaster live)
    {
        _db = db;
        _live = live;
    }

    private IQueryable<Session> SessionsWithDetail() => _db.Sessions
        .Include(s => s.Section)
        .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
        .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team);

    [HttpGet]
    public async Task<IEnumerable<SessionDto>> List(int competitionId)
    {
        var sessions = await SessionsWithDetail()
            .Where(s => s.CompetitionId == competitionId)
            .OrderBy(s => s.OrderIndex)
            .ToListAsync();
        return sessions.Select(s => s.ToDto());
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<SessionDto>> Get(int competitionId, int id)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        return s is null ? NotFound() : s.ToDto();
    }

    [HttpPost]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> Create(int competitionId, CreateSessionRequest req)
    {
        if (!await _db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();
        var kind = req.Kind ?? (req.IsBreak ? SessionKind.Break : SessionKind.Race);
        var s = new Session
        {
            CompetitionId = competitionId,
            CompetitionSectionId = req.CompetitionSectionId,
            Name = req.Name,
            ArenaName = req.ArenaName,
            ScheduledStart = req.ScheduledStart,
            OrderIndex = req.OrderIndex,
            Notes = req.Notes,
            IsBreak = kind == SessionKind.Break,
            DurationMinutes = req.DurationMinutes,
            Kind = kind,
            Location = req.Location
        };
        _db.Sessions.Add(s);
        await _db.SaveChangesAsync();
        await _db.Entry(s).Reference(x => x.Section).LoadAsync();
        return s.ToDto();
    }

    [HttpPut("{id:int}/status")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> SetStatus(int competitionId, int id, UpdateSessionStatusRequest req)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        s.Status = req.Status;
        if (req.Status == SessionStatus.InArena && s.StartedAt is null) s.StartedAt = DateTime.UtcNow;
        if (req.Status == SessionStatus.Finished && s.FinishedAt is null) s.FinishedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);

        var statusLabel = req.Status switch
        {
            SessionStatus.InArena => "is now in the arena",
            SessionStatus.Finished => "has finished",
            _ => "is upcoming"
        };
        var systemMessage = new ChatMessage
        {
            CompetitionId = competitionId,
            AuthorName = "System",
            Body = $"{s.Name} {statusLabel}.",
            Type = ChatMessageType.System,
            Tag = "session"
        };
        _db.ChatMessages.Add(systemMessage);
        await _db.SaveChangesAsync();
        await _live.ChatMessage(competitionId, systemMessage.ToDto());

        return dto;
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int competitionId, int id)
    {
        var s = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        _db.Sessions.Remove(s);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:int}/heats")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<HeatDto>> AddHeat(int competitionId, int id, CreateHeatRequest req)
    {
        var s = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        var heat = new Heat
        {
            SessionId = id,
            Label = req.Label,
            OrderIndex = req.OrderIndex
        };
        _db.Heats.Add(heat);
        await _db.SaveChangesAsync();

        var lane = 1;
        foreach (var teamId in req.TeamIds.Distinct())
        {
            _db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = teamId, LaneIndex = lane++ });
        }
        var raceOrder = 1;
        foreach (var name in req.RaceNames.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()))
        {
            _db.Races.Add(new Race { HeatId = heat.Id, Name = name, OrderIndex = raceOrder++ });
        }
        await _db.SaveChangesAsync();

        var loaded = await _db.Heats
            .Include(h => h.Entries).ThenInclude(e => e.Team)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(h => h.Id == heat.Id);
        return loaded.ToDto();
    }

    [HttpPut("{id:int}/stream")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> SetStream(int competitionId, int id, UpdateSessionStreamRequest req)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        s.StreamUrl = string.IsNullOrWhiteSpace(req.StreamUrl) ? null : req.StreamUrl.Trim();
        await _db.SaveChangesAsync();
        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpPut("{id:int}/heat-assignments")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> UpdateHeatAssignments(int competitionId, int id, UpdateHeatAssignmentsRequest req)
    {
        var s = await _db.Sessions
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        var teamForLabel = new Dictionary<string, List<int>>();
        foreach (var a in req.Assignments)
        {
            var key = (a.Label ?? string.Empty).Trim();
            if (!teamForLabel.ContainsKey(key)) teamForLabel[key] = new List<int>();
            teamForLabel[key].AddRange(a.TeamIds.Distinct());
        }

        foreach (var heat in s.Heats)
        {
            var key = (heat.Label ?? string.Empty).Trim();
            if (!teamForLabel.TryGetValue(key, out var teamIds)) teamIds = new List<int>();
            _db.HeatEntries.RemoveRange(heat.Entries);
            foreach (var race in heat.Races)
            {
                _db.Results.RemoveRange(race.Results);
                race.IsComplete = false;
                race.StartedAt = null;
                race.FinishedAt = null;
            }
            heat.StartedAt = null;
            heat.FinishedAt = null;
            var lane = 1;
            foreach (var tid in teamIds)
            {
                _db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = tid, LaneIndex = lane++ });
            }
        }
        await _db.SaveChangesAsync();

        var reloaded = await SessionsWithDetail().FirstAsync(x => x.Id == s.Id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpPut("{id:int}/settings")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> SetSettings(int competitionId, int id, UpdateSessionSettingsRequest req)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        s.MinutesPerHeat = req.MinutesPerHeat is > 0 ? req.MinutesPerHeat : null;
        if (req.RaceOrderAlternating.HasValue) s.RaceOrderAlternating = req.RaceOrderAlternating.Value;
        await _db.SaveChangesAsync();

        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpPut("{id:int}/lanes")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> SetLanes(int competitionId, int id, UpdateSessionLanesRequest req)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        s.LanesPerHeat = req.LanesPerHeat is > 0 ? req.LanesPerHeat : null;
        await _db.SaveChangesAsync();
        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpPost("{id:int}/generate-heats")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<SessionDto>> GenerateHeats(int competitionId, int id, GenerateHeatsRequest req)
    {
        var s = await _db.Sessions
            .Include(s => s.Heats)
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        var teamIds = req.TeamIds.Distinct().ToList();
        var raceNames = req.RaceNames.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).ToList();
        if (teamIds.Count == 0 || raceNames.Count == 0)
            return BadRequest("At least one team and one race name are required.");

        var maxHeatSize = req.LanesPerHeat ?? s.LanesPerHeat ?? teamIds.Count;
        if (maxHeatSize <= 0) maxHeatSize = teamIds.Count;
        var groups = SplitIntoBalancedGroups(teamIds, maxHeatSize);

        if (req.ReplaceExisting)
        {
            _db.Heats.RemoveRange(s.Heats);
            await _db.SaveChangesAsync();
        }

        s.LanesPerHeat = maxHeatSize;

        var existingCount = req.ReplaceExisting ? 0 : s.Heats.Count;
        var heatOrder = existingCount + 1;
        for (var gi = 0; gi < groups.Count; gi++)
        {
            var group = groups[gi];
            var heat = new Heat
            {
                SessionId = s.Id,
                Label = $"Heat {heatOrder}",
                OrderIndex = heatOrder
            };
            heatOrder++;
            _db.Heats.Add(heat);
            await _db.SaveChangesAsync();

            var lane = 1;
            foreach (var teamId in group)
            {
                _db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = teamId, LaneIndex = lane++ });
            }
            for (var ri = 0; ri < raceNames.Count; ri++)
            {
                _db.Races.Add(new Race
                {
                    HeatId = heat.Id,
                    Name = raceNames[ri],
                    OrderIndex = ri + 1
                });
            }
        }
        await _db.SaveChangesAsync();

        var reloaded = await SessionsWithDetail().FirstAsync(x => x.Id == s.Id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(competitionId, dto);
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
}
