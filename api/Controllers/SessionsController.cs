using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{competitionId:int}/sessions")]
public class SessionsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILiveBroadcaster _live;
    private readonly RaceFinalService _raceFinals;

    public SessionsController(AppDbContext db, ILiveBroadcaster live, RaceFinalService raceFinals)
    {
        _db = db;
        _live = live;
        _raceFinals = raceFinals;
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
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> Create(int competitionId, CreateSessionRequest req)
    {
        if (!await _db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();
        if (req.CompetitionSectionId.HasValue &&
            !await _db.CompetitionSections.AnyAsync(cs => cs.Id == req.CompetitionSectionId.Value && cs.CompetitionId == competitionId))
            return BadRequest(new { message = "Section not found in this competition." });
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

    /// <summary>Renames a session, moves it to another arena or sets its start time. Fields left out are not changed.</summary>
    [HttpPut("{id:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> Update(int competitionId, int id, UpdateSessionRequest req)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        if (req.Name is not null)
        {
            if (string.IsNullOrWhiteSpace(req.Name)) return BadRequest(new { message = "A session needs a name." });
            s.Name = req.Name.Trim();
        }
        if (req.ArenaName is not null)
            s.ArenaName = string.IsNullOrWhiteSpace(req.ArenaName) ? null : req.ArenaName.Trim();
        if (req.ScheduledStart.HasValue) s.ScheduledStart = req.ScheduledStart.Value;
        await _db.SaveChangesAsync();

        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpPut("{id:int}/status")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
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
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IActionResult> Delete(int competitionId, int id)
    {
        var s = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        _db.Sessions.Remove(s);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:int}/heats")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<HeatDto>> AddHeat(int competitionId, int id, CreateHeatRequest req)
    {
        var s = await _db.Sessions.FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        if (!await TeamsBelongAsync(competitionId, req.TeamIds)) return BadRequest(new { message = "Some of those teams aren't in this competition." });
        if (await OutTeamNamesAsync(competitionId, req.TeamIds) is { Count: > 0 } outNames)
            return Conflict(new { message = $"{string.Join(", ", outNames)} can't be added to a heat while withdrawn." });

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

    [HttpPost("{id:int}/generate-race-finals")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> GenerateRaceFinals(int competitionId, int id, GenerateRaceFinalsRequest req)
    {
        var s = await _db.Sessions
            .Include(s => s.Heats)
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        if (!await TeamsBelongAsync(competitionId, req.TeamIds)) return BadRequest(new { message = "Some of those teams aren't in this competition." });

        var teamIds = await WithoutOutTeamsAsync(competitionId, req.TeamIds.Distinct().ToList());
        var raceNames = req.RaceNames.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).ToList();
        if (teamIds.Count == 0 || raceNames.Count == 0)
            return BadRequest("At least one team and one race name are required.");

        var lanes = req.LanesPerHeat ?? s.LanesPerHeat ?? Math.Max(1, (int)Math.Ceiling(teamIds.Count / 2.0));
        if (lanes <= 0) lanes = teamIds.Count;
        s.LanesPerHeat = lanes;

        if (req.ReplaceExisting)
        {
            _db.Heats.RemoveRange(s.Heats);
            await _db.SaveChangesAsync();
        }

        // For each race in the list: create 3 heats (Q1, Q2, Final). Q1 + Q2
        // split the teams randomly; the Final stays empty until admin populates.
        var rng = new Random();
        var heatOrder = req.ReplaceExisting ? 1 : s.Heats.Count + 1;
        var roundSeed = req.ReplaceExisting ? 1 : (s.Heats.Select(h => h.RaceRoundId ?? 0).DefaultIfEmpty(0).Max() + 1);

        foreach (var raceName in raceNames)
        {
            var shuffled = teamIds.OrderBy(_ => rng.Next()).ToList();
            var midpoint = (shuffled.Count + 1) / 2;
            var q1Teams = shuffled.Take(midpoint).ToList();
            var q2Teams = shuffled.Skip(midpoint).ToList();
            var roundId = roundSeed++;

            await CreateRoundHeatAsync(s.Id, raceName, $"{raceName} · Q1", heatOrder++, RaceRoundStage.Qualifier, roundId, q1Teams);
            await CreateRoundHeatAsync(s.Id, raceName, $"{raceName} · Q2", heatOrder++, RaceRoundStage.Qualifier, roundId, q2Teams);
            await CreateRoundHeatAsync(s.Id, raceName, $"{raceName} · Final", heatOrder++, RaceRoundStage.Final, roundId, Array.Empty<int>());
        }

        var dto = await SessionsWithDetail().FirstAsync(x => x.Id == id);
        await _live.SessionUpdated(competitionId, dto.ToDto());
        return dto.ToDto();
    }

    private async Task CreateRoundHeatAsync(
        int sessionId, string raceName, string label, int orderIndex,
        RaceRoundStage stage, int roundId, IReadOnlyList<int> teamIds)
    {
        var heat = new Heat
        {
            SessionId = sessionId,
            Label = label,
            OrderIndex = orderIndex,
            RaceRoundId = roundId,
            RaceRoundStage = stage,
        };
        _db.Heats.Add(heat);
        await _db.SaveChangesAsync();

        var lane = 1;
        foreach (var tid in teamIds)
        {
            _db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = tid, LaneIndex = lane++ });
        }
        _db.Races.Add(new Race { HeatId = heat.Id, Name = raceName, OrderIndex = 1 });
        await _db.SaveChangesAsync();
    }

    [HttpPost("{id:int}/heats/{heatId:int}/populate-race-final")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<HeatDto>> PopulateRaceFinal(
        int competitionId, int id, int heatId, PopulateRaceFinalRequest req)
    {
        var finalHeat = await _db.Heats
            .Include(h => h.Session)
            .Include(h => h.Entries)
            .Include(h => h.Races)
            .FirstOrDefaultAsync(h => h.Id == heatId && h.SessionId == id);
        if (finalHeat is null || finalHeat.Session?.CompetitionId != competitionId) return NotFound();
        var problem = await _raceFinals.PopulateAsync(finalHeat, req.TopN);
        if (problem is not null) return BadRequest(problem);

        var refreshed = await _db.Heats
            .Include(h => h.Entries).ThenInclude(e => e.Team)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstAsync(h => h.Id == heatId);
        var sessionDto = await SessionsWithDetail().FirstAsync(x => x.Id == id);
        await _live.SessionUpdated(competitionId, sessionDto.ToDto());
        return refreshed.ToDto();
    }

    [HttpPut("{id:int}/heats/{heatId:int}/scheduled-start")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<HeatDto>> UpdateHeatScheduledStart(
        int competitionId, int id, int heatId, UpdateHeatScheduledStartRequest req)
    {
        var heat = await _db.Heats
            .Include(h => h.Session)
            .Include(h => h.Entries).ThenInclude(e => e.Team)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstOrDefaultAsync(h => h.Id == heatId && h.SessionId == id);
        if (heat is null || heat.Session?.CompetitionId != competitionId) return NotFound();

        heat.ScheduledStart = req.ScheduledStart;
        await _db.SaveChangesAsync();

        var sessionDto = await SessionsWithDetail().FirstAsync(s => s.Id == id);
        await _live.SessionUpdated(competitionId, sessionDto.ToDto());
        return heat.ToDto();
    }

    [HttpPut("{id:int}/heat-assignments")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> UpdateHeatAssignments(int competitionId, int id, UpdateHeatAssignmentsRequest req)
    {
        var s = await _db.Sessions
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        if (!await TeamsBelongAsync(competitionId, req.Assignments.SelectMany(a => a.TeamIds))) return BadRequest(new { message = "Some of those teams aren't in this competition." });
        // A withdrawn team may stay in a heat it is already in (scored before it went out), not be moved into one.
        var alreadyIn = s.Heats.SelectMany(h => h.Entries).Select(e => e.TeamId).ToHashSet();
        if (await OutTeamNamesAsync(competitionId, req.Assignments.SelectMany(a => a.TeamIds).Where(t => !alreadyIn.Contains(t))) is { Count: > 0 } outNames)
            return Conflict(new { message = $"{string.Join(", ", outNames)} can't be added to a heat while withdrawn. Nothing was saved." });

        var teamForLabel = new Dictionary<string, List<int>>();
        foreach (var a in req.Assignments)
        {
            var key = (a.Label ?? string.Empty).Trim();
            if (!teamForLabel.ContainsKey(key)) teamForLabel[key] = new List<int>();
            teamForLabel[key].AddRange(a.TeamIds.Distinct());
        }

        // Only a heat whose teams or lane order actually change is rewritten. The rest keep their
        // lanes and any scores, so fixing one heat doesn't wipe the others.
        var changed = new List<(Heat Heat, List<int> TeamIds)>();
        var heatsInOrder = s.Heats.OrderBy(h => h.OrderIndex).ToList();
        for (var i = 0; i < heatsInOrder.Count; i++)
        {
            var heat = heatsInOrder[i];
            // The web editor calls an unlabelled heat "Heat N" by its position; older callers send a blank label.
            List<int>? teamIds;
            if (!string.IsNullOrWhiteSpace(heat.Label)) teamForLabel.TryGetValue(heat.Label.Trim(), out teamIds);
            else if (!teamForLabel.TryGetValue($"Heat {i + 1}", out teamIds)) teamForLabel.TryGetValue(string.Empty, out teamIds);
            teamIds ??= new List<int>();
            teamIds = teamIds.Distinct().ToList();
            var current = heat.Entries.OrderBy(e => e.LaneIndex).Select(e => e.TeamId);
            if (current.SequenceEqual(teamIds)) continue;
            changed.Add((heat, teamIds));
        }

        // A signed-off race is final; the scoring endpoint refuses to touch it, so this must too.
        var changedRaceIds = changed.SelectMany(c => c.Heat.Races).Select(r => r.Id).ToList();
        if (changedRaceIds.Count > 0)
        {
            var signedOff = (await _db.Set<RaceScoreState>()
                .Where(x => changedRaceIds.Contains(x.RaceId) && x.IsSignedOff)
                .Select(x => x.RaceId)
                .ToListAsync()).ToHashSet();
            var locked = changed
                .Where(c => c.Heat.Races.Any(r => signedOff.Contains(r.Id)))
                .Select(c => string.IsNullOrWhiteSpace(c.Heat.Label) ? $"Heat {c.Heat.OrderIndex}" : c.Heat.Label!.Trim())
                .ToList();
            if (locked.Count > 0)
                return Conflict(new { message = $"Results are signed off for {string.Join(", ", locked)}, so the teams there can't be changed. Nothing was saved." });
        }

        foreach (var (heat, teamIds) in changed)
        {
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
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> SetSettings(int competitionId, int id, UpdateSessionSettingsRequest req)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        s.MinutesPerHeat = req.MinutesPerHeat is > 0 ? req.MinutesPerHeat : null;
        if (req.RaceOrderAlternating.HasValue) s.RaceOrderAlternating = req.RaceOrderAlternating.Value;
        if (req.QualifiersPerHeat.HasValue) s.QualifiersPerHeat = req.QualifiersPerHeat.Value;
        if (req.LaneRotationMode.HasValue)
        {
            if (!Enum.IsDefined(req.LaneRotationMode.Value)) return BadRequest(new { message = "Unknown lane rotation." });
            // Teams that stay in their lane can't share fewer lanes: the ones past the last lane would never race.
            if (req.LaneRotationMode.Value == LaneRotationMode.Stay && s.LanesPerHeat is > 0
                && s.Heats.Any(h => h.Entries.Count > s.LanesPerHeat))
                return BadRequest(new { message = "A heat has more teams than lanes, so teams need to change lane between races." });
            s.LaneRotationMode = req.LaneRotationMode.Value;
        }
        await _db.SaveChangesAsync();

        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpPut("{id:int}/lanes")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
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
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> GenerateHeats(int competitionId, int id, GenerateHeatsRequest req)
    {
        var s = await _db.Sessions
            .Include(s => s.Heats)
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        if (!await TeamsBelongAsync(competitionId, req.TeamIds)) return BadRequest(new { message = "Some of those teams aren't in this competition." });

        var teamIds = await WithoutOutTeamsAsync(competitionId, req.TeamIds.Distinct().ToList());
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

    private async Task<List<int>> OutTeamIdsAsync(int competitionId, IEnumerable<int> teamIds)
    {
        var ids = teamIds.Distinct().ToList();
        return ids.Count == 0 ? [] : await _db.Teams
            .Where(t => t.CompetitionId == competitionId && ids.Contains(t.Id) && t.EntryStatus != TeamEntryStatus.Active)
            .Select(t => t.Id).ToListAsync();
    }

    private async Task<List<string>> OutTeamNamesAsync(int competitionId, IEnumerable<int> teamIds)
    {
        var ids = teamIds.Distinct().ToList();
        return ids.Count == 0 ? [] : await _db.Teams
            .Where(t => t.CompetitionId == competitionId && ids.Contains(t.Id) && t.EntryStatus != TeamEntryStatus.Active)
            .OrderBy(t => t.Id).Select(t => t.DisplayName).ToListAsync();
    }

    private async Task<List<int>> WithoutOutTeamsAsync(int competitionId, List<int> teamIds)
    {
        var outIds = (await OutTeamIdsAsync(competitionId, teamIds)).ToHashSet();
        return teamIds.Where(t => !outIds.Contains(t)).ToList();
    }

    /// <summary>
    /// Team ids sent in a request must all belong to this competition. Owners and their teams run sessions,
    /// so one competition's organiser mustn't be able to pull another competition's teams into a heat.
    /// </summary>
    private async Task<bool> TeamsBelongAsync(int competitionId, IEnumerable<int> teamIds)
    {
        var ids = teamIds.Distinct().ToList();
        return ids.Count == 0 || await _db.Teams.CountAsync(t => t.CompetitionId == competitionId && ids.Contains(t.Id)) == ids.Count;
    }
}
