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
using MountedGames.Api.Services.Operations;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{competitionId:int}/sessions")]
public class SessionsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILiveBroadcaster _live;
    private readonly RaceFinalService _raceFinals;
    private readonly ScoringService _scoring;
    private readonly PushNotifier? _push;

    public SessionsController(AppDbContext db, ILiveBroadcaster live, RaceFinalService raceFinals, ScoringService? scoring = null, PushNotifier? push = null)
    {
        _db = db;
        _live = live;
        _raceFinals = raceFinals;
        _scoring = scoring ?? new ScoringService(db);
        _push = push;
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
            Location = req.Location,
            LanesPerHeat = req.LanesPerHeat,
            MinutesPerHeat = req.MinutesPerHeat,
            PlannedRaces = kind == SessionKind.Race ? PlannedRaceList.Write(req.PlannedRaces) : null
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
        var prevScheduled = s.ScheduledStart;
        if (req.Name is not null)
        {
            if (string.IsNullOrWhiteSpace(req.Name)) return BadRequest(new { message = "A session needs a name." });
            s.Name = req.Name.Trim();
        }
        if (req.ArenaName is not null)
            s.ArenaName = string.IsNullOrWhiteSpace(req.ArenaName) ? null : req.ArenaName.Trim();
        if (req.ScheduledStart.HasValue) s.ScheduledStart = req.ScheduledStart.Value;
        if (req.MinutesPerHeat.HasValue) s.MinutesPerHeat = req.MinutesPerHeat.Value;
        if (req.DurationMinutes.HasValue && s.Heats.Count == 0) s.DurationMinutes = req.DurationMinutes.Value;
        if (req.LanesPerHeat.HasValue || req.PlannedRaces is not null)
        {
            // Heat size and the race list are structure: they can't change once the session has started or been scored.
            if (HasScores(s) && ((req.LanesPerHeat.HasValue && req.LanesPerHeat != s.LanesPerHeat)
                || (req.PlannedRaces is not null && PlannedRaceList.Write(req.PlannedRaces) != s.PlannedRaces)))
                return Conflict(new { message = "This session has started or has scores, so its structure can't change." });
            if (req.LanesPerHeat.HasValue) s.LanesPerHeat = req.LanesPerHeat.Value;
            if (req.PlannedRaces is not null) s.PlannedRaces = PlannedRaceList.Write(req.PlannedRaces);
        }
        await _db.SaveChangesAsync();

        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        if (prevScheduled.HasValue && s.ScheduledStart.HasValue)
        {
            var delayMin = (int)Math.Round((s.ScheduledStart.Value - prevScheduled.Value).TotalMinutes);
            if (delayMin >= 5)
                await NotifySessionDelayAsync(competitionId, s, delayMin);
        }
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
        if (req.Status == SessionStatus.InArena && s.ScheduledStart.HasValue && s.StartedAt.HasValue)
        {
            var delayMin = (int)Math.Round((s.StartedAt.Value - s.ScheduledStart.Value).TotalMinutes);
            if (delayMin >= 5)
                await NotifySessionDelayAsync(competitionId, s, delayMin);
        }

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
        var s = await _db.Sessions.Include(s => s.Heats).ThenInclude(h => h.Races)
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        if (HasScores(s))
            return Conflict(new { message = "This session has started or has scores, so it can't be removed." });
        _db.Sessions.Remove(s);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Started, finished or with a race marked complete. Needs heats and races loaded.</summary>
    private static bool HasScores(Session s) =>
        s.Status != SessionStatus.Upcoming || s.Heats.Any(h => h.Races.Any(r => r.IsComplete));

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

        var existingHeatCount = req.ReplaceExisting ? 0 : s.Heats.Count;
        var nextRoundSeed = req.ReplaceExisting ? 1 : (s.Heats.Select(h => h.RaceRoundId ?? 0).DefaultIfEmpty(0).Max() + 1);

        if (req.ReplaceExisting)
        {
            _db.Heats.RemoveRange(s.Heats);
            await _db.SaveChangesAsync();
        }

        // For each race in the list: create 3 heats (Q1, Q2, Final). Q1 + Q2
        // split the teams using the fair seeded draw; the Final stays empty until qualifiers complete.
        var (teamsWithClub, opponentCounts, laneCounts, smallHeatCounts) =
            await LoadDrawStateAsync(competitionId, s.CompetitionSectionId, s.Id, teamIds);
        var heatOrder = existingHeatCount + 1;
        var roundSeed = nextRoundSeed;

        foreach (var raceName in raceNames)
        {
            var roundId = roundSeed++;
            var groups = CompetitionDrawService.DrawGroups(
                teamsWithClub, 2, competitionId * 397 ^ s.Id, s.Id * 100 + roundId,
                opponentCounts, laneCounts, smallHeatCounts);
            var q1Teams = groups[0];
            var q2Teams = groups.Count > 1 ? groups[1] : new List<int>();

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
        if (changed.Count > 0)
            await NotifyRedrawAsync(competitionId, reloaded, changed.Select(c => c.Heat.Id).ToHashSet());
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
        var existingCount = req.ReplaceExisting ? 0 : s.Heats.Count;

        if (req.ReplaceExisting)
        {
            _db.Heats.RemoveRange(s.Heats);
            await _db.SaveChangesAsync();
        }

        var (teamsWithClub, opponentCounts, laneCounts, smallHeatCounts) =
            await LoadDrawStateAsync(competitionId, s.CompetitionSectionId, s.Id, teamIds);
        var groupCount = Math.Max(1, (int)Math.Ceiling(teamIds.Count / (double)maxHeatSize));
        var groups = CompetitionDrawService.DrawGroups(
            teamsWithClub, groupCount, competitionId * 397 ^ s.Id, s.Id,
            opponentCounts, laneCounts, smallHeatCounts);

        s.LanesPerHeat = maxHeatSize;

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
        if (req.ReplaceExisting)
            await NotifyRedrawAsync(competitionId, reloaded, null);
        return dto;
    }

    private async Task NotifySessionDelayAsync(int competitionId, Session s, int delayMinutes)
    {
        if (_push is null) return;
        try
        {
            var teamIds = s.Heats.SelectMany(h => h.Entries).Select(e => e.TeamId).Distinct().ToList();
            if (teamIds.Count == 0 && s.CompetitionSectionId.HasValue)
            {
                teamIds = await _db.Teams.AsNoTracking()
                    .Where(t => t.CompetitionId == competitionId && t.CompetitionSectionId == s.CompetitionSectionId.Value)
                    .Select(t => t.Id)
                    .ToListAsync(HttpContext.RequestAborted);
            }
            if (teamIds.Count == 0) return;
            await _push.NotifyTeamsAsync(teamIds, new PushPayload(
                Title: "Timetable delay / Redraw alert",
                Body: $"{s.Name} is now +{delayMinutes} min.",
                Tag: $"session-delay:{s.Id}",
                Url: $"/competitions/{competitionId}"), HttpContext.RequestAborted);
        }
        catch
        {
            // Never fail session update if push notification delivery fails.
        }
    }

    private async Task NotifyRedrawAsync(int competitionId, Session s, HashSet<int>? changedHeatIds)
    {
        if (_push is null) return;
        try
        {
            var messages = new List<(int TeamId, PushPayload Payload)>();
            foreach (var heat in s.Heats.OrderBy(h => h.OrderIndex))
            {
                if (changedHeatIds is not null && !changedHeatIds.Contains(heat.Id)) continue;
                var heatLabel = !string.IsNullOrWhiteSpace(heat.Label) ? heat.Label! : $"Heat {heat.OrderIndex}";
                foreach (var entry in heat.Entries.OrderBy(e => e.LaneIndex))
                {
                    var teamName = entry.Team?.DisplayName ?? $"Team {entry.TeamId}";
                    messages.Add((entry.TeamId, new PushPayload(
                        Title: "Timetable delay / Redraw alert",
                        Body: $"Heats redrawn for {s.Name} — {teamName} is in {heatLabel}, Lane {entry.LaneIndex}.",
                        Tag: $"session-redraw:{s.Id}:{heat.Id}:{entry.TeamId}",
                        Url: $"/competitions/{competitionId}")));
                }
            }
            if (messages.Count > 0)
                await _push.NotifyPerTeamAsync(messages, HttpContext.RequestAborted);
        }
        catch
        {
            // Never fail heat assignment update if push notification delivery fails.
        }
    }

    private async Task<(
        List<(int TeamId, int ClubId)> Teams,
        Dictionary<(int Low, int High), int> OpponentCounts,
        Dictionary<int, Dictionary<int, int>> LaneCounts,
        Dictionary<int, int> SmallHeatCounts)> LoadDrawStateAsync(
        int competitionId, int? sectionId, int currentSessionId, IReadOnlyList<int> teamIds)
    {
        var clubMap = await _db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == competitionId && teamIds.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id, t => t.ClubId);
        var teams = teamIds.Select(tid => (tid, clubMap.GetValueOrDefault(tid))).ToList();
        var opponentCounts = new Dictionary<(int Low, int High), int>();
        var laneCounts = new Dictionary<int, Dictionary<int, int>>();
        var smallHeatCounts = new Dictionary<int, int>();

        var existingHeats = await _db.Heats.AsNoTracking()
            .Include(h => h.Entries)
            .Include(h => h.Session)
            .Where(h => h.Session!.CompetitionId == competitionId
                && (sectionId.HasValue ? h.Session.CompetitionSectionId == sectionId.Value : h.SessionId == currentSessionId))
            .OrderBy(h => h.Session!.OrderIndex).ThenBy(h => h.OrderIndex)
            .ToListAsync();
        CompetitionDrawService.RecordExistingHeats(existingHeats, opponentCounts, laneCounts, smallHeatCounts);
        return (teams, opponentCounts, laneCounts, smallHeatCounts);
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

    /// <summary>Mid-session rename or replacement of a race across all heats of the session.</summary>
    [HttpPut("{id:int}/races/{raceId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> ChangeRace(
        int competitionId, int id, int raceId, ChangeSessionRaceRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.NewName))
            return BadRequest(new { message = "A race name is required." });
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        var targetHeat = s.Heats.FirstOrDefault(h => h.Races.Any(r => r.Id == raceId));
        var targetRace = targetHeat?.Races.FirstOrDefault(r => r.Id == raceId);
        if (targetRace is null || targetHeat is null) return NotFound();

        var newName = req.NewName.Trim();
        var oldName = targetRace.Name;
        var targetOrder = targetRace.OrderIndex;

        if (req.ApplyToAllHeats)
        {
            foreach (var heat in s.Heats)
            {
                if (targetHeat.RaceRoundId.HasValue && heat.RaceRoundId == targetHeat.RaceRoundId)
                {
                    foreach (var r in heat.Races) r.Name = newName;
                    if (!string.IsNullOrWhiteSpace(heat.Label) && heat.Label.StartsWith(oldName + " ·", StringComparison.OrdinalIgnoreCase))
                        heat.Label = newName + heat.Label[oldName.Length..];
                }
                else if (!targetHeat.RaceRoundId.HasValue)
                {
                    foreach (var r in heat.Races.Where(r => r.OrderIndex == targetOrder))
                        r.Name = newName;
                }
            }
            var planned = PlannedRaceList.Read(s.PlannedRaces)?.ToList();
            if (planned is not null && targetOrder >= 1 && targetOrder <= planned.Count)
            {
                planned[targetOrder - 1] = newName;
                s.PlannedRaces = PlannedRaceList.Write(planned);
            }
        }
        else
        {
            targetRace.Name = newName;
        }

        await _db.SaveChangesAsync();
        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    /// <summary>Mid-session cancellation/removal of a race across all heats of the session.</summary>
    [HttpDelete("{id:int}/races/{raceId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> CancelRace(int competitionId, int id, int raceId)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        var targetHeat = s.Heats.FirstOrDefault(h => h.Races.Any(r => r.Id == raceId));
        var targetRace = targetHeat?.Races.FirstOrDefault(r => r.Id == raceId);
        if (targetRace is null || targetHeat is null) return NotFound();

        var targetOrder = targetRace.OrderIndex;
        foreach (var heat in s.Heats.ToList())
        {
            var toRemove = targetHeat.RaceRoundId.HasValue && heat.RaceRoundId == targetHeat.RaceRoundId
                ? heat.Races.ToList()
                : heat.Races.Where(r => r.OrderIndex == targetOrder).ToList();
            foreach (var r in toRemove)
            {
                _db.Results.RemoveRange(r.Results);
                _db.Races.Remove(r);
                heat.Races.Remove(r);
            }
            var order = 1;
            foreach (var remaining in heat.Races.OrderBy(r => r.OrderIndex))
                remaining.OrderIndex = order++;
        }

        await _db.SaveChangesAsync();
        var reloaded = await SessionsWithDetail().FirstAsync(x => x.Id == id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    /// <summary>Clears recorded results and clock for a stopped race so it can be re-run cleanly.</summary>
    [HttpDelete("{id:int}/races/{raceId:int}/results")]
    [HttpDelete("/api/sessions/races/{raceId:int}/results")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<RaceScoreDto>> ClearRaceResults(int raceId, CancellationToken cancellationToken = default)
    {
        try
        {
            var actor = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            var score = await _scoring.ClearRaceForRerunAsync(raceId, actor, "Cleared for re-run.", cancellationToken);
            var race = await _db.Races.AsNoTracking()
                .Include(r => r.Heat).ThenInclude(h => h!.Session)
                .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken);
            if (race?.Heat?.Session is { } session)
            {
                var sessionDto = await SessionsWithDetail().FirstAsync(s => s.Id == session.Id, cancellationToken);
                await _live.SessionUpdated(session.CompetitionId, sessionDto.ToDto());
            }
            return score;
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
    }

    /// <summary>Flags or unflags a team's result in a race as Under Review ([under-review] in RefereeNote).</summary>
    [HttpPut("{id:int}/races/{raceId:int}/results/{teamId:int}/under-review")]
    [HttpPut("/api/sessions/races/{raceId:int}/results/{teamId:int}/under-review")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("raceId", CompetitionResource.Race)]
    public async Task<ActionResult<RaceScoreDto>> SetUnderReview(
        int raceId, int teamId, SetUnderReviewRequest req, CancellationToken cancellationToken = default)
    {
        try
        {
            var actor = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            return await _scoring.SetUnderReviewAsync(raceId, teamId, req.UnderReview, req.Note, actor, cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (ScoreSignedOffException ex) { return Conflict(new { message = ex.Message }); }
        catch (ScoreValidationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Combines another small section or session's teams into this session's arena heat with a scoring mode (BySection or Combined).</summary>
    [HttpPost("{id:int}/combine-heat")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> CombineHeat(
        int competitionId, int id, CombineHeatRequest req)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        Session? sourceSession = null;
        if (req.SourceSessionId.HasValue && req.SourceSessionId.Value != id)
        {
            sourceSession = await SessionsWithDetail()
                .FirstOrDefaultAsync(x => x.Id == req.SourceSessionId.Value && x.CompetitionId == competitionId);
            if (sourceSession is null) return NotFound();
        }

        var teamIdsToMerge = new List<int>();
        if (req.TeamIds is { Count: > 0 })
        {
            if (!await TeamsBelongAsync(competitionId, req.TeamIds))
                return BadRequest(new { message = "Some of those teams aren't in this competition." });
            teamIdsToMerge.AddRange(req.TeamIds);
        }
        if (sourceSession is not null)
        {
            var fromHeats = sourceSession.Heats.SelectMany(h => h.Entries).OrderBy(e => e.LaneIndex).Select(e => e.TeamId).ToList();
            if (fromHeats.Count > 0)
            {
                teamIdsToMerge.AddRange(fromHeats);
            }
            else if (sourceSession.CompetitionSectionId.HasValue)
            {
                var secTeams = await _db.Teams
                    .Where(t => t.CompetitionId == competitionId && t.CompetitionSectionId == sourceSession.CompetitionSectionId.Value && t.EntryStatus == TeamEntryStatus.Active)
                    .Select(t => t.Id)
                    .ToListAsync();
                teamIdsToMerge.AddRange(secTeams);
            }
        }
        teamIdsToMerge = await WithoutOutTeamsAsync(competitionId, teamIdsToMerge.Distinct().ToList());

        var targetHeat = s.Heats.OrderBy(h => h.OrderIndex)
            .FirstOrDefault(h => !req.TargetHeatId.HasValue || h.Id == req.TargetHeatId.Value);
        if (targetHeat is null)
        {
            targetHeat = new Heat
            {
                SessionId = s.Id,
                Label = "Combined Heat 1",
                OrderIndex = 1,
            };
            _db.Heats.Add(targetHeat);
            await _db.SaveChangesAsync();
            var planned = PlannedRaceList.Read(s.PlannedRaces) ?? ["Bending", "Flag", "Mug"];
            var rOrder = 1;
            foreach (var rName in planned)
                _db.Races.Add(new Race { HeatId = targetHeat.Id, Name = rName, OrderIndex = rOrder++ });
            await _db.SaveChangesAsync();
        }

        var existingTeamIds = targetHeat.Entries.Select(e => e.TeamId).ToHashSet();
        var nextLane = targetHeat.Entries.Count == 0 ? 1 : targetHeat.Entries.Max(e => e.LaneIndex) + 1;
        foreach (var tid in teamIdsToMerge.Where(t => !existingTeamIds.Contains(t)))
        {
            _db.HeatEntries.Add(new HeatEntry { HeatId = targetHeat.Id, TeamId = tid, LaneIndex = nextLane++ });
            existingTeamIds.Add(tid);
        }

        var mode = ParseScoringMode(req.ScoringMode);
        s.Notes = ScoringService.ApplyScoringModeTag(s.Notes, mode);
        s.LanesPerHeat = Math.Max(s.LanesPerHeat ?? 0, existingTeamIds.Count);
        if (sourceSession is not null && !s.Name.Contains('+'))
            s.Name = $"{s.Name} + {sourceSession.Name}";
        if (sourceSession is not null && req.RemoveSourceSession && !HasScores(sourceSession))
            _db.Sessions.Remove(sourceSession);

        await _db.SaveChangesAsync();
        var reloaded = await SessionsWithDetail().FirstAsync(x => x.Id == s.Id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpPut("{id:int}/combined-scoring")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> SetCombinedScoring(
        int competitionId, int id, SetCombinedScoringRequest req)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        var mode = ParseScoringMode(req.ScoringMode);
        s.Notes = ScoringService.ApplyScoringModeTag(s.Notes, mode);
        await _db.SaveChangesAsync();
        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    /// <summary>Places the competition (or arena) on hold, shifting remaining unstarted sessions to a custom resume time or by delay minutes.</summary>
    [HttpPost("hold")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IEnumerable<SessionDto>>> HoldCompetition(
        int competitionId, HoldCompetitionRequest req)
    {
        var comp = await _db.Competitions.FirstOrDefaultAsync(c => c.Id == competitionId);
        if (comp is null) return NotFound();

        var sessions = await SessionsWithDetail()
            .Where(s => s.CompetitionId == competitionId)
            .OrderBy(s => s.ScheduledStart ?? DateTime.MaxValue)
            .ThenBy(s => s.OrderIndex)
            .ToListAsync();

        var unstarted = sessions
            .Where(s => s.Status == SessionStatus.Upcoming && s.StartedAt is null
                && (string.IsNullOrWhiteSpace(req.ArenaName) || string.Equals(s.ArenaName?.Trim(), req.ArenaName.Trim(), StringComparison.OrdinalIgnoreCase)))
            .ToList();

        TimeSpan shift = TimeSpan.Zero;
        string? resumeDisplay = req.ResumeTime?.Trim();
        if (!string.IsNullOrWhiteSpace(resumeDisplay))
        {
            var baseDate = unstarted.FirstOrDefault(s => s.ScheduledStart.HasValue)?.ScheduledStart?.Date ?? comp.StartDate.Date;
            if (TimeSpan.TryParse(resumeDisplay, out var timeOfDay))
            {
                var targetStart = DateTime.SpecifyKind(baseDate.Add(timeOfDay), DateTimeKind.Utc);
                var firstScheduled = unstarted.FirstOrDefault(s => s.ScheduledStart.HasValue)?.ScheduledStart;
                if (firstScheduled.HasValue)
                    shift = targetStart - firstScheduled.Value;
                else if (unstarted.Count > 0)
                    unstarted[0].ScheduledStart = targetStart;
            }
            else if (DateTime.TryParse(resumeDisplay, out var parsedDt))
            {
                var firstScheduled = unstarted.FirstOrDefault(s => s.ScheduledStart.HasValue)?.ScheduledStart;
                if (firstScheduled.HasValue)
                    shift = parsedDt.ToUniversalTime() - firstScheduled.Value;
                resumeDisplay = parsedDt.ToString("HH:mm");
            }
        }
        else if (req.DelayMinutes.HasValue)
        {
            shift = TimeSpan.FromMinutes(req.DelayMinutes.Value);
        }

        if (shift != TimeSpan.Zero)
        {
            foreach (var us in unstarted)
            {
                if (us.ScheduledStart.HasValue)
                    us.ScheduledStart = us.ScheduledStart.Value.Add(shift);
                foreach (var h in us.Heats.Where(h => h.ScheduledStart.HasValue))
                    h.ScheduledStart = h.ScheduledStart!.Value.Add(shift);
            }
        }

        if (req.PostAnnouncement)
        {
            var body = !string.IsNullOrWhiteSpace(resumeDisplay)
                ? $"Competition on hold — we will continue at {resumeDisplay}"
                : $"Competition on hold — delayed by {req.DelayMinutes ?? 0} minutes";
            var msg = new ChatMessage
            {
                CompetitionId = competitionId,
                AuthorName = "Organiser",
                Body = body,
                Type = ChatMessageType.Announcement,
                Tag = "hold",
            };
            _db.ChatMessages.Add(msg);
            await _db.SaveChangesAsync();
            var msgDto = msg.ToDto();
            await _live.Announcement(competitionId, msgDto);
            await _live.ChatMessage(competitionId, msgDto);
        }
        else
        {
            await _db.SaveChangesAsync();
        }

        return sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList();
    }

    private static CombinedHeatScoringMode ParseScoringMode(string? raw)
        => string.Equals(raw?.Trim(), "Combined", StringComparison.OrdinalIgnoreCase) || raw?.Trim() == "1"
            ? CombinedHeatScoringMode.Combined
            : CombinedHeatScoringMode.BySection;
}

public record ChangeSessionRaceRequest(string NewName, bool ApplyToAllHeats = true);
public record SetUnderReviewRequest(bool UnderReview, string? Note = null);
public record CombineHeatRequest(int? SourceSessionId = null, IReadOnlyList<int>? TeamIds = null, string? ScoringMode = "BySection", int? TargetHeatId = null, bool RemoveSourceSession = false);
public record SetCombinedScoringRequest(string ScoringMode);
public record HoldCompetitionRequest(string? ResumeTime = null, int? DelayMinutes = null, string? ArenaName = null, bool PostAnnouncement = true);
