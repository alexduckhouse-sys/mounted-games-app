using System.Security.Claims;
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
using MountedGames.Api.Services.Calendar;
using MountedGames.Api.Services.EventTools;
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
        if (PlannedFinalRaceLists.FirstInvalidKey(req.PlannedFinalRaces) is { } badKey)
            return BadRequest(new { message = $"'{badKey}' isn't a final. Use a single letter from B to Z." });
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
            PlannedRaces = kind == SessionKind.Race ? PlannedRaceList.Write(req.PlannedRaces) : null,
            PlannedFinalRaces = kind == SessionKind.Race ? PlannedFinalRaceLists.Write(req.PlannedFinalRaces) : null
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
        if (PlannedFinalRaceLists.FirstInvalidKey(req.PlannedFinalRaces) is { } badKey)
            return BadRequest(new { message = $"'{badKey}' isn't a final. Use a single letter from B to Z." });
        if (req.LanesPerHeat.HasValue || req.PlannedRaces is not null || req.PlannedFinalRaces is not null)
        {
            // Heat size and the race list are structure: they can't change once the session has started or been scored.
            if (HasScores(s) && ((req.LanesPerHeat.HasValue && req.LanesPerHeat != s.LanesPerHeat)
                || (req.PlannedRaces is not null && PlannedRaceList.Write(req.PlannedRaces) != s.PlannedRaces)
                || (req.PlannedFinalRaces is not null && PlannedFinalRaceLists.Write(req.PlannedFinalRaces) != s.PlannedFinalRaces)))
                return Conflict(new { message = "This session has started or has scores, so its structure can't change." });
            if (req.LanesPerHeat.HasValue) s.LanesPerHeat = req.LanesPerHeat.Value;
            if (req.PlannedRaces is not null) s.PlannedRaces = PlannedRaceList.Write(req.PlannedRaces);
            if (req.PlannedFinalRaces is not null) s.PlannedFinalRaces = PlannedFinalRaceLists.Write(req.PlannedFinalRaces);
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

        var now = DateTime.UtcNow;
        s.Status = req.Status;
        if (req.Status == SessionStatus.InArena && s.StartedAt is null) s.StartedAt = now;
        if (req.Status == SessionStatus.Finished)
        {
            s.FinishedAt ??= now;
            s.ProvisionalUntil = now.AddMinutes(15);
            s.OfficialConfirmedAt = null;
        }
        else
        {
            s.ProvisionalUntil = null;
            s.OfficialConfirmedAt = null;
        }
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

    [HttpPost("{id:int}/confirm-official")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> ConfirmOfficial(
        int competitionId,
        int id,
        [FromBody] ConfirmSessionOfficialRequest? req = null)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        if (s.Status != SessionStatus.Finished)
            return Conflict(new { message = "Only finished sessions can have their results confirmed." });

        var now = DateTime.UtcNow;
        if (req?.ReopenQueries == true)
        {
            var minutes = Math.Clamp(req.ProvisionalMinutes ?? 15, 1, 120);
            s.OfficialConfirmedAt = null;
            s.ProvisionalUntil = now.AddMinutes(minutes);
        }
        else
        {
            var hasUnderReview = s.Heats.Any(h => h.Races.Any(r => r.Results.Any(res => ScoringService.IsUnderReview(res.RefereeNote))));
            if (hasUnderReview)
                return Conflict(new { message = "Resolve or clear all results flagged under review before confirming official results." });
            // An open protest (logged against a race or its whole heat) holds the results provisional the same way.
            if (s.Heats.Any(h => h.Races.Any(r => r.HasOpenProtest)))
                return Conflict(new { message = "Decide or withdraw the open protests before confirming official results." });

            s.OfficialConfirmedAt = now;
            s.ProvisionalUntil = now;
        }

        await _db.SaveChangesAsync();
        var dto = s.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpGet("{id:int}/heats/{heatId:int}/commentator-briefing")]
    [AllowAnonymous]
    public async Task<ActionResult<CommentatorBriefingDto>> GetCommentatorBriefing(
        int competitionId,
        int id,
        int heatId,
        CancellationToken cancellationToken = default)
    {
        try
        {
            return await new CommentatorBriefingService(_db)
                .GetAsync(competitionId, id, heatId, cancellationToken);
        }
        catch (KeyNotFoundException) { return NotFound(); }
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

    [HttpDelete("{id:int}/heats/{heatId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> DeleteHeat(int competitionId, int id, int heatId)
    {
        var s = await _db.Sessions
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        var heat = s.Heats.FirstOrDefault(h => h.Id == heatId);
        if (heat is null) return NotFound();
        if (heat.Races.Any(r => r.IsComplete || r.Results.Count > 0))
            return Conflict(new { message = "This heat already has race results, so it can't be deleted." });

        var heatLabel = !string.IsNullOrWhiteSpace(heat.Label) ? heat.Label!.Trim() : $"Heat {heat.OrderIndex}";
        DrawUndoService.RecordSessionSnapshot(
            _db,
            competitionId,
            s,
            "DeleteHeat",
            $"Deleted {heatLabel} in {s.Name}",
            User.FindFirstValue(ClaimTypes.NameIdentifier));

        _db.Heats.Remove(heat);
        s.Heats.Remove(heat);
        var remaining = s.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id).ToList();
        for (var i = 0; i < remaining.Count; i++)
            remaining[i].OrderIndex = i + 1;

        await _db.SaveChangesAsync();
        var reloaded = await SessionsWithDetail().FirstAsync(x => x.Id == id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpDelete("{id:int}/heats")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> ClearHeats(int competitionId, int id)
    {
        var s = await _db.Sessions
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();
        if (s.Heats.Any(h => h.Races.Any(r => r.IsComplete || r.Results.Count > 0)))
            return Conflict(new { message = "This session already has race results, so its heats can't be cleared." });

        if (s.Heats.Count > 0)
        {
            DrawUndoService.RecordSessionSnapshot(
                _db,
                competitionId,
                s,
                "ClearHeats",
                $"Cleared {s.Heats.Count} {(s.Heats.Count == 1 ? "heat" : "heats")} in {s.Name}",
                User.FindFirstValue(ClaimTypes.NameIdentifier));
            _db.Heats.RemoveRange(s.Heats);
            await _db.SaveChangesAsync();
        }

        var reloaded = await SessionsWithDetail().FirstAsync(x => x.Id == id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    [HttpPost("{id:int}/generate-race-finals")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> GenerateRaceFinals(int competitionId, int id, GenerateRaceFinalsRequest req)
    {
        var s = await _db.Sessions
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races)
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
            if (s.Heats.Count > 0)
            {
                DrawUndoService.RecordSessionSnapshot(
                    _db,
                    competitionId,
                    s,
                    "GenerateRaceFinals",
                    $"Regenerated race finals in {s.Name}",
                    User.FindFirstValue(ClaimTypes.NameIdentifier));
            }
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
    public async Task<ActionResult<SessionDto>> UpdateHeatAssignments(
        int competitionId, int id, UpdateHeatAssignmentsRequest req,
        [FromQuery] bool preserveCompletedScores = false)
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
        if (changed.Count > 0)
        {
            var scoreStates = await _db.Set<RaceScoreState>().AsNoTracking()
                .Where(x => changedRaceIds.Contains(x.RaceId) && (x.IsSignedOff || x.Revision > 0))
                .Select(x => new { x.RaceId, x.IsSignedOff })
                .ToListAsync();
            var signedOff = scoreStates.Where(x => x.IsSignedOff).Select(x => x.RaceId).ToHashSet();
            if (preserveCompletedScores)
            {
                var recordedRaceIds = scoreStates.Select(x => x.RaceId).ToHashSet();
                var protectedHeats = changed
                    .Where(c => HeatProtection.IsProtected(c.Heat, s, recordedRaceIds))
                    .Select(c => string.IsNullOrWhiteSpace(c.Heat.Label) ? $"Heat {c.Heat.OrderIndex}" : c.Heat.Label!.Trim())
                    .ToList();
                if (protectedHeats.Count > 0)
                    return Conflict(new { message = $"{string.Join(", ", protectedHeats)} already has race activity. Its teams and lanes can't be changed while preserving scores. Nothing was saved." });
            }
            var locked = changed
                .Where(c => c.Heat.Races.Any(r => signedOff.Contains(r.Id)))
                .Select(c => string.IsNullOrWhiteSpace(c.Heat.Label) ? $"Heat {c.Heat.OrderIndex}" : c.Heat.Label!.Trim())
                .ToList();
            if (locked.Count > 0)
                return Conflict(new { message = $"Results are signed off for {string.Join(", ", locked)}, so the teams there can't be changed. Nothing was saved." });

            DrawUndoService.RecordSessionSnapshot(
                _db,
                competitionId,
                s,
                "UpdateHeatAssignments",
                $"Updated heat lanes in {s.Name}",
                User.FindFirstValue(ClaimTypes.NameIdentifier));
        }

        foreach (var (heat, teamIds) in changed)
        {
            var existingOverrides = heat.Entries
                .Where(e => !string.IsNullOrWhiteSpace(e.BibColourOverride))
                .GroupBy(e => e.TeamId)
                .ToDictionary(g => g.Key, g => g.First().BibColourOverride);
            _db.HeatEntries.RemoveRange(heat.Entries);
            foreach (var race in heat.Races)
            {
                if (preserveCompletedScores && race.IsComplete)
                    continue;
                _db.Results.RemoveRange(race.Results);
                race.IsComplete = false;
                race.StartedAt = null;
                race.FinishedAt = null;
            }
            if (!preserveCompletedScores || !heat.Races.Any(r => r.IsComplete))
                heat.StartedAt = null;
            if (!preserveCompletedScores || heat.Races.Any(r => !r.IsComplete))
                heat.FinishedAt = null;
            var lane = 1;
            foreach (var tid in teamIds)
            {
                existingOverrides.TryGetValue(tid, out var bibOverride);
                _db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = tid, LaneIndex = lane++, BibColourOverride = bibOverride });
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
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races)
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
            if (s.Heats.Count > 0)
            {
                DrawUndoService.RecordSessionSnapshot(
                    _db,
                    competitionId,
                    s,
                    "GenerateHeats",
                    $"Regenerated heats in {s.Name}",
                    User.FindFirstValue(ClaimTypes.NameIdentifier));
            }
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
        List<Race> RacesToRemove(Heat heat) => targetHeat.RaceRoundId.HasValue && heat.RaceRoundId == targetHeat.RaceRoundId
            ? heat.Races.ToList()
            : heat.Races.Where(r => r.OrderIndex == targetOrder).ToList();

        // Cancelling deletes the race and its results, so refuse when any affected race has scores on record.
        var affected = s.Heats.SelectMany(RacesToRemove).ToList();
        var affectedIds = affected.Select(r => r.Id).ToList();
        var hasScoreState = await _db.Set<RaceScoreState>().AsNoTracking()
            .AnyAsync(x => affectedIds.Contains(x.RaceId) && (x.IsSignedOff || x.Revision > 0));
        if (hasScoreState || affected.Any(r => r.Results.Count > 0))
            return Conflict(new { message = "This race has recorded or signed-off results, so it can't be cancelled. Clear its results first." });

        foreach (var heat in s.Heats.ToList())
        {
            var toRemove = RacesToRemove(heat);
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
    public async Task<ActionResult<RaceScoreDto>> ClearRaceResults(
        int raceId, int? competitionId = null, int? id = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var race = await _db.Races.AsNoTracking()
                .Include(r => r.Heat).ThenInclude(h => h!.Session)
                .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken);
            if (race?.Heat?.Session is null) return NotFound();
            if ((competitionId.HasValue && race.Heat.Session.CompetitionId != competitionId.Value)
                || (id.HasValue && race.Heat.SessionId != id.Value))
                return NotFound();

            var actor = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            var score = await _scoring.ClearRaceForRerunAsync(raceId, actor, "Cleared for re-run.", cancellationToken);
            if (race.Heat.Session is { } session)
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
        int raceId, int teamId, SetUnderReviewRequest req, int? competitionId = null, int? id = null, CancellationToken cancellationToken = default)
    {
        try
        {
            if (competitionId.HasValue || id.HasValue)
            {
                var race = await _db.Races.AsNoTracking()
                    .Include(r => r.Heat).ThenInclude(h => h!.Session)
                    .FirstOrDefaultAsync(r => r.Id == raceId, cancellationToken);
                if (race?.Heat?.Session is null) return NotFound();
                if ((competitionId.HasValue && race.Heat.Session.CompetitionId != competitionId.Value)
                    || (id.HasValue && race.Heat.SessionId != id.Value))
                    return NotFound();
            }
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
            // Organisers type UK clock times, but the API runs in UTC, so the day and the time are read as UK time.
            var firstScheduled = unstarted.FirstOrDefault(s => s.ScheduledStart.HasValue)?.ScheduledStart;
            var baseDate = firstScheduled.HasValue
                ? CompetitionSetup.ToLondonWallClock(firstScheduled.Value).Date
                : CompetitionSetup.AnchorWallClock(comp.StartDate).Date;
            if (TimeSpan.TryParse(resumeDisplay, out var timeOfDay))
            {
                var targetStart = CompetitionSetup.FromLondonWallClock(baseDate.Add(timeOfDay));
                if (firstScheduled.HasValue)
                    shift = targetStart - firstScheduled.Value;
                else if (unstarted.Count > 0)
                    unstarted[0].ScheduledStart = targetStart;
            }
            else if (DateTime.TryParse(resumeDisplay, out var parsedDt))
            {
                // A date and time with no zone is UK time; one with a zone is converted.
                var parsedUtc = parsedDt.Kind == DateTimeKind.Unspecified
                    ? CompetitionSetup.FromLondonWallClock(parsedDt)
                    : parsedDt.ToUniversalTime();
                if (firstScheduled.HasValue)
                    shift = parsedUtc - firstScheduled.Value;
                resumeDisplay = CompetitionSetup.ToLondonWallClock(parsedUtc).ToString("HH:mm");
            }
        }
        else if (req.DelayMinutes.HasValue)
        {
            shift = TimeSpan.FromMinutes(req.DelayMinutes.Value);
        }

        var shiftedSessions = new List<Session>();
        if (shift != TimeSpan.Zero)
        {
            foreach (var us in unstarted)
            {
                var changed = false;
                if (us.ScheduledStart.HasValue)
                {
                    us.ScheduledStart = us.ScheduledStart.Value.Add(shift);
                    changed = true;
                }
                foreach (var h in us.Heats.Where(h => h.ScheduledStart.HasValue))
                {
                    h.ScheduledStart = h.ScheduledStart!.Value.Add(shift);
                    changed = true;
                }
                if (changed) shiftedSessions.Add(us);
            }
        }
        else if (unstarted.Count > 0 && unstarted[0].ScheduledStart.HasValue)
        {
            shiftedSessions.Add(unstarted[0]);
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

        foreach (var shifted in shiftedSessions)
            await _live.SessionUpdated(competitionId, shifted.ToDto());

        return sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList();
    }

    /// <summary>Updates the uncompleted races across all heats in a session, preserving any already-completed races in place.</summary>
    [HttpPut("{id:int}/races")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> UpdateSessionRaces(
        int competitionId, int id, UpdateSessionRacesRequest req)
    {
        var s = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (s is null) return NotFound();

        var names = (req.RaceNames ?? Array.Empty<string>())
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => r.Trim())
            .ToList();
        if (names.Count == 0)
            return BadRequest(new { message = "At least one race name is required." });
        if (names.Any(name => name.Length > 150))
            return BadRequest(new { message = "Race names must be 150 characters or fewer." });

        var raceIds = s.Heats.SelectMany(h => h.Races).Select(r => r.Id).ToList();
        var recordedIds = (await _db.Set<RaceScoreState>()
            .Where(state => raceIds.Contains(state.RaceId) && (state.Revision > 0 || state.IsSignedOff))
            .Select(state => state.RaceId).ToListAsync()).ToHashSet();
        var programmes = s.Heats.Select(heat => new
        {
            Heat = heat,
            Races = heat.Races.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id).ToList(),
        }).ToList();
        // The request is the full programme. Validate every heat before changing anything: a
        // different completion order must never shift recorded races or erase another heat's game.
        foreach (var programme in programmes)
        {
            for (var index = 0; index < programme.Races.Count; index++)
            {
                var race = programme.Races[index];
                var protectedRace = race.IsComplete || race.StartedAt.HasValue || race.Results.Count > 0 || recordedIds.Contains(race.Id);
                if (protectedRace && (index >= names.Count || !string.Equals(race.Name, names[index], StringComparison.OrdinalIgnoreCase)))
                    return Conflict(new { message = "The race programmes differ at a recorded or started race. Keep those races in their original positions; nothing was saved." });
            }
        }

        var hasUncompleted = false;
        foreach (var programme in programmes)
        {
            for (var index = 0; index < programme.Races.Count; index++)
            {
                var race = programme.Races[index];
                if (index >= names.Count) { _db.Races.Remove(race); continue; }
                // Preserve IDs and order even for an unchanged future game (offline scorers refer to them).
                if (!race.IsComplete && !race.StartedAt.HasValue && !recordedIds.Contains(race.Id)) race.Name = names[index];
            }
            var order = programme.Races.Select(r => r.OrderIndex).DefaultIfEmpty(0).Max();
            for (var index = programme.Races.Count; index < names.Count; index++)
                _db.Races.Add(new Race { HeatId = programme.Heat.Id, Name = names[index], OrderIndex = ++order });
            var heatHasUncompleted = names.Count > programme.Races.Count || programme.Races.Take(names.Count).Any(r => !r.IsComplete);
            if (heatHasUncompleted) programme.Heat.FinishedAt = null;
            hasUncompleted |= heatHasUncompleted;
        }
        s.PlannedRaces = PlannedRaceList.Write(names);
        if (s.Status == SessionStatus.Finished && hasUncompleted)
        {
            s.Status = SessionStatus.InArena;
            s.FinishedAt = null;
            s.ProvisionalUntil = null;
            s.OfficialConfirmedAt = null;
        }

        await _db.SaveChangesAsync();
        var reloaded = await SessionsWithDetail().FirstAsync(x => x.Id == id);
        var dto = reloaded.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    /// <summary>Shifts ScheduledStart on all uncompleted sessions (and their uncompleted heats) by DeltaMinutes.</summary>
    [HttpPost("shift-times")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IEnumerable<SessionDto>>> ShiftSessionTimes(
        int competitionId, ShiftSessionTimesRequest req)
    {
        if (req.DeltaMinutes is 0 or < -720 or > 720)
            return BadRequest(new { message = "Shift must be between -720 and 720 minutes (non-zero)." });

        var sessions = await SessionsWithDetail()
            .Where(s => s.CompetitionId == competitionId)
            .OrderBy(s => s.OrderIndex)
            .ToListAsync();

        var delta = TimeSpan.FromMinutes(req.DeltaMinutes);
        var targetSessions = sessions.Where(s =>
            s.Status != SessionStatus.Finished
            && (string.IsNullOrWhiteSpace(req.ArenaName)
                || string.Equals(s.ArenaName?.Trim(), req.ArenaName.Trim(), StringComparison.OrdinalIgnoreCase)))
            .ToList();

        foreach (var s in targetSessions)
        {
            if (s.ScheduledStart.HasValue)
            {
                s.ScheduledStart = s.ScheduledStart.Value.Add(delta);
                s.Notes = ApplyShiftNote(s.Notes, req.DeltaMinutes);
            }
            foreach (var h in s.Heats.Where(h => !h.FinishedAt.HasValue && h.ScheduledStart.HasValue))
                h.ScheduledStart = h.ScheduledStart!.Value.Add(delta);
        }

        await _db.SaveChangesAsync();
        foreach (var s in targetSessions)
            await _live.SessionUpdated(competitionId, s.ToDto());

        return sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList();
    }

    /// <summary>Marks uncompleted sessions in the competition (or optional arena) as paused at the current UTC timestamp.</summary>
    [HttpPost("pause")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IEnumerable<SessionDto>>> PauseTimetable(
        int competitionId, PauseTimetableRequest? req = null)
    {
        var sessions = await SessionsWithDetail()
            .Where(s => s.CompetitionId == competitionId)
            .OrderBy(s => s.OrderIndex)
            .ToListAsync();

        var reason = req?.Reason?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(reason) && !PauseReasons.Contains(reason))
            return BadRequest(new { message = "Reason must be 'thunder' or 'rain'." });
        if (!IsValidAnnouncement(req?.Announcement))
            return BadRequest(new { message = "The announcement must be 2000 characters or fewer." });

        var arenaName = req?.ArenaName;
        var targetSessions = sessions.Where(s =>
            s.Status != SessionStatus.Finished
            && (string.IsNullOrWhiteSpace(arenaName)
                || string.Equals(s.ArenaName?.Trim(), arenaName.Trim(), StringComparison.OrdinalIgnoreCase)))
            .ToList();

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var s in targetSessions)
        {
            if (!ParsePauseNoteMs(s.Notes).HasValue) s.Notes = ApplyPauseNote(s.Notes, nowMs);
            // A session already paused keeps its original pause time; it only learns why.
            if (!string.IsNullOrEmpty(reason)) s.Notes = ApplyPauseReason(s.Notes, reason);
        }

        var message = AddWeatherAnnouncement(competitionId, req?.Announcement);
        await _db.SaveChangesAsync();
        foreach (var s in targetSessions)
            await _live.SessionUpdated(competitionId, s.ToDto());
        await BroadcastAsync(competitionId, message);

        return sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList();
    }

    /// <summary>Resumes paused sessions in the competition (or optional arena), converting elapsed pause time into a permanent shift.</summary>
    [HttpPost("resume")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IEnumerable<SessionDto>>> ResumeTimetable(
        int competitionId, ResumeTimetableRequest? req = null)
    {
        var sessions = await SessionsWithDetail()
            .Where(s => s.CompetitionId == competitionId)
            .OrderBy(s => s.OrderIndex)
            .ToListAsync();

        if (!IsValidAnnouncement(req?.Announcement))
            return BadRequest(new { message = "The announcement must be 2000 characters or fewer." });

        var arenaName = req?.ArenaName;
        var targetSessions = sessions.Where(s =>
            s.Status != SessionStatus.Finished
            && (string.IsNullOrWhiteSpace(arenaName)
                || string.Equals(s.ArenaName?.Trim(), arenaName.Trim(), StringComparison.OrdinalIgnoreCase)))
            .ToList();

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var updatedSessions = new List<Session>();
        var pausedSessionStarts = new Dictionary<int, DateTime?>();
        var pausedTimings = TimetableTimes.Compute(sessions, DateTimeOffset.FromUnixTimeMilliseconds(nowMs).UtcDateTime, pausedSessionStarts);
        foreach (var s in targetSessions)
        {
            var pausedMs = ParsePauseNoteMs(s.Notes);
            if (!pausedMs.HasValue) continue;

            var cleanedNotes = RemovePauseNote(s.Notes);
            s.Notes = cleanedNotes;
            var elapsedMs = Math.Max(0, nowMs - pausedMs.Value);
            var deltaMinutes = elapsedMs >= 30_000 ? Math.Max(1, (int)Math.Round(elapsedMs / 60_000.0, MidpointRounding.AwayFromZero)) : 0;
            if (deltaMinutes > 0)
            {
                var appliedShift = deltaMinutes;
                if (!s.StartedAt.HasValue && pausedSessionStarts.TryGetValue(s.Id, out var pausedStart) && pausedStart.HasValue)
                {
                    // Include any delay already inherited from earlier sessions. A manual shift
                    // replaces that delay, so adding only the pause would make the timetable jump back.
                    if (s.ScheduledStart.HasValue)
                        appliedShift = (int)Math.Round((pausedStart.Value - s.ScheduledStart.Value).TotalMinutes, MidpointRounding.AwayFromZero);
                    else
                        s.ScheduledStart = pausedStart.Value.AddMinutes(-appliedShift);
                }
                if (s.ScheduledStart.HasValue)
                {
                    s.ScheduledStart = s.ScheduledStart.Value.AddMinutes(appliedShift);
                    s.Notes = ApplyShiftNote(s.Notes, appliedShift);
                }
                foreach (var h in s.Heats.Where(h => !h.FinishedAt.HasValue && !h.StartedAt.HasValue))
                {
                    // A live session keeps its actual start. Pin its remaining heats to the paused
                    // timetable so the elapsed pause survives the StartedAt override on resume.
                    if (s.StartedAt.HasValue && pausedTimings.TryGetValue(h.Id, out var timing))
                        h.ScheduledStart = timing.Start;
                    else if (h.ScheduledStart.HasValue)
                        h.ScheduledStart = h.ScheduledStart.Value.AddMinutes(appliedShift);
                }
            }
            updatedSessions.Add(s);
        }

        var message = AddWeatherAnnouncement(competitionId, req?.Announcement);
        await _db.SaveChangesAsync();
        foreach (var s in updatedSessions)
            await _live.SessionUpdated(competitionId, s.ToDto());
        await BroadcastAsync(competitionId, message);

        return sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList();
    }

    /// <summary>
    /// Tells everyone about the weather without pausing or resuming anything (the organiser's "Tell everyone" for
    /// heavy rain). It lives here, not on the chat endpoint, because that one is for site admins only while the
    /// pause and resume it sits beside are open to every organiser.
    /// </summary>
    [HttpPost("weather-notice")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<ChatMessageDto>> PostWeatherNotice(int competitionId, WeatherNoticeRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Body) || !IsValidAnnouncement(req.Body))
            return BadRequest(new { message = "Write an announcement of up to 2000 characters." });
        if (!await _db.Competitions.AnyAsync(c => c.Id == competitionId)) return NotFound();

        var message = AddWeatherAnnouncement(competitionId, req.Body)!;
        await _db.SaveChangesAsync();
        await BroadcastAsync(competitionId, message);
        return message.ToDto();
    }

    private const int MaxAnnouncementLength = 2000;
    private static readonly string[] PauseReasons = ["thunder", "rain"];

    private static bool IsValidAnnouncement(string? body) => body is null || body.Length <= MaxAnnouncementLength;

    /// <summary>Adds the weather announcement to the context (saved with the caller's other changes), or returns null when there is no text.</summary>
    private ChatMessage? AddWeatherAnnouncement(int competitionId, string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        var authorName = User.FindFirst("fullName")?.Value ?? "Organiser";
        var message = new ChatMessage
        {
            CompetitionId = competitionId,
            UserId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value,
            AuthorName = authorName.Length > 60 ? authorName[..60] : authorName,
            Body = ProfanityFilter.Clean(body.Trim()),
            Type = ChatMessageType.Announcement,
            Tag = "weather",
        };
        _db.ChatMessages.Add(message);
        return message;
    }

    private async Task BroadcastAsync(int competitionId, ChatMessage? message)
    {
        if (message is null) return;
        var dto = message.ToDto();
        await _live.Announcement(competitionId, dto);
        await _live.ChatMessage(competitionId, dto);
    }

    /// <summary>Returns the learned minutes-per-race pace and duration multiplier for the competition.</summary>
    [HttpGet("pace-prediction")]
    [AllowAnonymous]
    [MountedGames.Api.Security.PublicRead]
    [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("public-read")]
    public async Task<ActionResult<PacePredictionDto>> GetPacePrediction(int competitionId)
    {
        var comp = await _db.Competitions.AsNoTracking().FirstOrDefaultAsync(c => c.Id == competitionId);
        if (comp is null) return NotFound();

        var sessions = await _db.Sessions
            .AsNoTracking()
            .Where(s => s.CompetitionId == competitionId)
            .Include(s => s.Heats).ThenInclude(h => h.Races)
            .OrderBy(s => s.OrderIndex)
            .ToListAsync();

        double? historicalAvg = null;
        var initial = TimetableTimes.PredictPace(sessions);
        if (initial.AvgMinutesPerRace is null && !string.IsNullOrEmpty(comp.CreatedByUserId))
        {
            var pastSessions = await _db.Sessions
                .AsNoTracking()
                .Where(s => s.CompetitionId != competitionId && s.Competition != null && s.Competition.CreatedByUserId == comp.CreatedByUserId)
                .Include(s => s.Heats).ThenInclude(h => h.Races)
                .ToListAsync();
            var pastPace = TimetableTimes.PredictPace(pastSessions);
            historicalAvg = pastPace.AvgMinutesPerRace;
        }

        var pace = TimetableTimes.PredictPace(sessions, historicalAvg);
        return new PacePredictionDto(
            pace.AvgMinutesPerRace,
            pace.RecommendedMinutesPer5RaceHeat,
            pace.Multiplier,
            pace.SampleHeats);
    }

    /// <summary>Updates or clears a lane's collecting-ring gate check-in status (<c>at-gate</c>, <c>warming-up</c>, <c>missing</c>, or <c>null</c>).</summary>
    [HttpPut("{id:int}/heats/{heatId:int}/gate-check")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<SessionDto>> UpdateGateCheck(
        int competitionId, int id, int heatId, UpdateGateCheckRequest req)
    {
        if (!TryNormalizeGateCheckStatus(req.Status, out var normalizedStatus))
            return BadRequest(new { message = "Status must be 'at-gate', 'warming-up', 'missing', or null." });

        var session = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (session is null) return NotFound();

        var heat = session.Heats.FirstOrDefault(h => h.Id == heatId);
        if (heat is null) return NotFound();

        if (!heat.Entries.Any(e => e.TeamId == req.TeamId))
            return BadRequest(new { message = "Team is not in this heat." });

        session.Notes = ApplyGateCheckNote(session.Notes, heatId, req.TeamId, normalizedStatus);
        await _db.SaveChangesAsync();

        var dto = session.ToDto();
        await _live.SessionUpdated(competitionId, dto);
        return dto;
    }

    /// <summary>Sends a priority Farrier / Vet / First Aid call for an arena to competition notices and optionally pauses the arena.</summary>
    [HttpPost("{id:int}/assistance")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<ChatMessageDto>> RequestArenaAssistance(
        int competitionId, int id, RequestArenaAssistanceRequest req)
    {
        var (serviceKey, serviceTitle) = NormalizeAssistanceService(req.Service);
        if (serviceKey is null || serviceTitle is null)
            return BadRequest(new { message = "Service must be 'farrier', 'vet', or 'first-aid'." });
        if (req.Note is { Length: > 300 })
            return BadRequest(new { message = "Note must be 300 characters or fewer." });

        var session = await SessionsWithDetail()
            .FirstOrDefaultAsync(s => s.Id == id && s.CompetitionId == competitionId);
        if (session is null) return NotFound();

        var arena = !string.IsNullOrWhiteSpace(req.ArenaName)
            ? req.ArenaName.Trim()
            : (!string.IsNullOrWhiteSpace(session.ArenaName) ? session.ArenaName.Trim() : "Main Arena");
        var extraNote = req.Note?.Trim();
        var body = !string.IsNullOrEmpty(extraNote)
            ? $"{serviceTitle} needed at {arena} — {extraNote}"
            : $"{serviceTitle} needed at {arena}";

        var pausedSessions = new List<Session>();
        if (req.HoldArena)
        {
            var arenaSessions = await SessionsWithDetail()
                .Where(s => s.CompetitionId == competitionId && s.Status != SessionStatus.Finished)
                .OrderBy(s => s.OrderIndex)
                .ToListAsync();
            var sessionArena = string.IsNullOrWhiteSpace(session.ArenaName) ? "Main Arena" : session.ArenaName.Trim();
            var targetSessions = arenaSessions
                .Where(s => s.Id == session.Id
                    || string.Equals(
                        string.IsNullOrWhiteSpace(s.ArenaName) ? "Main Arena" : s.ArenaName.Trim(),
                        sessionArena,
                        StringComparison.OrdinalIgnoreCase)
                    || string.Equals(
                        string.IsNullOrWhiteSpace(s.ArenaName) ? "Main Arena" : s.ArenaName.Trim(),
                        arena,
                        StringComparison.OrdinalIgnoreCase))
                .ToList();
            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            foreach (var target in targetSessions)
            {
                if (!ParsePauseNoteMs(target.Notes).HasValue)
                {
                    target.Notes = ApplyPauseNote(target.Notes, nowMs);
                    pausedSessions.Add(target);
                }
            }
        }

        var authorName = User.FindFirst("fullName")?.Value ?? "Organiser";
        var msg = new ChatMessage
        {
            CompetitionId = competitionId,
            UserId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
            AuthorName = authorName.Length > 60 ? authorName[..60] : authorName,
            Body = body,
            Type = ChatMessageType.Announcement,
            Tag = $"assistance:{serviceKey}",
        };
        _db.ChatMessages.Add(msg);
        await _db.SaveChangesAsync();

        foreach (var paused in pausedSessions)
            await _live.SessionUpdated(competitionId, paused.ToDto());

        var msgDto = msg.ToDto();
        await _live.Announcement(competitionId, msgDto);
        await _live.ChatMessage(competitionId, msgDto);
        return msgDto;
    }

    internal static bool TryNormalizeGateCheckStatus(string? raw, out string? normalized)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            normalized = null;
            return true;
        }
        var trimmed = raw.Trim().ToLowerInvariant();
        if (trimmed is "at-gate" or "warming-up" or "missing")
        {
            normalized = trimmed;
            return true;
        }
        normalized = null;
        return false;
    }

    internal static string? ApplyGateCheckNote(string? notes, int heatId, int teamId, string? status)
    {
        var raw = notes ?? string.Empty;
        var pattern = $@"\s*\[gate:{heatId}:{teamId}=[^\]]*\]\s*";
        var cleaned = System.Text.RegularExpressions.Regex.Replace(raw, pattern, " ").Trim();
        if (string.IsNullOrEmpty(status))
            return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
        var tag = $"[gate:{heatId}:{teamId}={status}]";
        return string.IsNullOrWhiteSpace(cleaned) ? tag : $"{cleaned} {tag}";
    }

    private static (string? Key, string? Title) NormalizeAssistanceService(string? raw)
    {
        var key = raw?.Trim().ToLowerInvariant();
        return key switch
        {
            "farrier" => ("farrier", "Farrier"),
            "vet" => ("vet", "Vet"),
            "first-aid" or "firstaid" or "first aid" => ("first-aid", "First Aid"),
            _ => (null, null),
        };
    }

    public static readonly IReadOnlyList<string> SpareBibColours =
        ["red", "blue", "yellow", "green", "white", "orange", "purple", "pink"];

    [HttpPut("/api/heats/{heatId:int}/entries/{teamId:int}/bib-override")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("heatId", CompetitionResource.Heat)]
    public Task<ActionResult<HeatDto>> SetHeatEntryBibOverrideByHeat(
        int heatId, int teamId, [FromBody] SetBibOverrideRequest? req)
        => SetBibOverrideCoreAsync(heatId, teamId, req);

    [HttpPut("/api/competitions/{competitionId:int}/heats/{heatId:int}/entries/{teamId:int}/bib-override")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<HeatDto>> SetHeatEntryBibOverrideByCompetition(
        int competitionId, int heatId, int teamId, [FromBody] SetBibOverrideRequest? req)
        => SetBibOverrideCoreAsync(heatId, teamId, req, competitionId);

    [HttpPut("{id:int}/heats/{heatId:int}/entries/{teamId:int}/bib-override")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<HeatDto>> SetHeatEntryBibOverrideBySession(
        int competitionId, int id, int heatId, int teamId, [FromBody] SetBibOverrideRequest? req)
        => SetBibOverrideCoreAsync(heatId, teamId, req, competitionId, id);

    private async Task<ActionResult<HeatDto>> SetBibOverrideCoreAsync(
        int heatId, int teamId, SetBibOverrideRequest? req, int? competitionId = null, int? sessionId = null)
    {
        var trimmed = string.IsNullOrWhiteSpace(req?.BibColourOverride) ? null : req!.BibColourOverride.Trim();
        if (trimmed is not null && trimmed.Length > 80)
            return BadRequest(new { message = "Bib colour must be 80 characters or fewer." });

        var heat = await _db.Heats
            .Include(h => h.Session)
            .Include(h => h.Entries).ThenInclude(e => e.Team)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstOrDefaultAsync(h => h.Id == heatId);
        if (heat is null || heat.Session is null) return NotFound();
        if (competitionId.HasValue && heat.Session.CompetitionId != competitionId.Value) return NotFound();
        if (sessionId.HasValue && heat.SessionId != sessionId.Value) return NotFound();

        var entry = heat.Entries.FirstOrDefault(e => e.TeamId == teamId);
        if (entry is null) return NotFound(new { message = "That team is not in this heat." });

        entry.BibColourOverride = trimmed;
        await _db.SaveChangesAsync();

        var sessionDto = await SessionsWithDetail().FirstAsync(s => s.Id == heat.SessionId);
        await _live.SessionUpdated(heat.Session.CompetitionId, sessionDto.ToDto());
        return heat.ToDto();
    }

    [HttpPost("/api/competitions/{competitionId:int}/heats/{heatId:int}/resolve-bib-clashes")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<HeatDto>> ResolveHeatBibClashesByCompetition(int competitionId, int heatId)
        => ResolveBibClashesCoreAsync(heatId, competitionId);

    [HttpPost("/api/heats/{heatId:int}/resolve-bib-clashes")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("heatId", CompetitionResource.Heat)]
    public Task<ActionResult<HeatDto>> ResolveHeatBibClashesByHeat(int heatId)
        => ResolveBibClashesCoreAsync(heatId);

    [HttpPost("{id:int}/heats/{heatId:int}/resolve-bib-clashes")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<HeatDto>> ResolveHeatBibClashesBySession(int competitionId, int id, int heatId)
        => ResolveBibClashesCoreAsync(heatId, competitionId, id);

    private async Task<ActionResult<HeatDto>> ResolveBibClashesCoreAsync(
        int heatId, int? competitionId = null, int? sessionId = null)
    {
        var heat = await _db.Heats
            .Include(h => h.Session)
            .Include(h => h.Entries).ThenInclude(e => e.Team)
            .Include(h => h.Races).ThenInclude(r => r.Results).ThenInclude(rs => rs.Team)
            .FirstOrDefaultAsync(h => h.Id == heatId);
        if (heat is null || heat.Session is null) return NotFound();
        if (competitionId.HasValue && heat.Session.CompetitionId != competitionId.Value) return NotFound();
        if (sessionId.HasValue && heat.SessionId != sessionId.Value) return NotFound();

        var orderedEntries = heat.Entries
            .OrderBy(e => e.LaneIndex)
            .ThenBy(e => e.Id)
            .Select(e => new
            {
                Entry = e,
                EffectiveKey = NormaliseBibColourKey(string.IsNullOrWhiteSpace(e.BibColourOverride) ? e.Team?.BibColour : e.BibColourOverride),
                BaseKey = NormaliseBibColourKey(e.Team?.BibColour),
            })
            .Where(x => x.EffectiveKey is not null)
            .ToList();

        var groups = orderedEntries
            .GroupBy(x => x.EffectiveKey!, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var usedColours = groups.Select(g => g.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var changed = false;

        foreach (var g in groups.Where(g => g.Count() > 1))
        {
            var prioritised = g
                .OrderBy(x => string.IsNullOrWhiteSpace(x.Entry.BibColourOverride) ? 0 : 1)
                .ThenBy(x => x.Entry.LaneIndex)
                .ThenBy(x => x.Entry.Id)
                .ToList();

            foreach (var item in prioritised.Skip(1))
            {
                string? chosen;
                if (item.BaseKey is not null && !usedColours.Contains(item.BaseKey))
                {
                    chosen = item.BaseKey;
                }
                else
                {
                    chosen = SpareBibColours.FirstOrDefault(c => !usedColours.Contains(c));
                }

                if (chosen is null) continue;
                usedColours.Add(chosen);
                var nextOverride = string.Equals(chosen, item.BaseKey, StringComparison.OrdinalIgnoreCase) ? null : chosen;
                if (!string.Equals(item.Entry.BibColourOverride, nextOverride, StringComparison.Ordinal))
                {
                    item.Entry.BibColourOverride = nextOverride;
                    changed = true;
                }
            }
        }

        if (changed)
        {
            await _db.SaveChangesAsync();
            var sessionDto = await SessionsWithDetail().FirstAsync(s => s.Id == heat.SessionId);
            await _live.SessionUpdated(heat.Session.CompetitionId, sessionDto.ToDto());
        }

        return heat.ToDto();
    }

    public static string? NormaliseBibColourKey(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var stripped = System.Text.RegularExpressions.Regex.Replace(raw, @"^\[flag:[a-z0-9-]+\]\s*", string.Empty, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var collapsed = System.Text.RegularExpressions.Regex.Replace(stripped, @"\s+", " ").Trim().ToLowerInvariant();
        if (collapsed.EndsWith(" bibs", StringComparison.Ordinal))
            collapsed = collapsed[..^5].TrimEnd();
        else if (collapsed.EndsWith(" bib", StringComparison.Ordinal))
            collapsed = collapsed[..^4].TrimEnd();
        collapsed = System.Text.RegularExpressions.Regex.Replace(collapsed, @"\bgray\b", "grey");
        return string.IsNullOrEmpty(collapsed) ? null : collapsed;
    }

    private static string ApplyPauseNote(string? notes, long timestampMs)
    {
        var cleaned = RemovePauseNote(notes);
        var tag = $"[paused:{timestampMs}]";
        return string.IsNullOrWhiteSpace(cleaned) ? tag : $"{cleaned} {tag}";
    }

    private static long? ParsePauseNoteMs(string? notes)
    {
        if (string.IsNullOrEmpty(notes)) return null;
        var match = System.Text.RegularExpressions.Regex.Match(notes, @"\[paused:(\d+)\]");
        return match.Success && long.TryParse(match.Groups[1].Value, out var ms) ? ms : null;
    }

    private static string? RemovePauseNote(string? notes)
    {
        if (string.IsNullOrWhiteSpace(notes)) return null;
        var cleaned = System.Text.RegularExpressions.Regex.Replace(notes, @"\s*\[(?:paused:\d+|pausefor:[a-z]+)\]\s*", " ").Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
    }

    /// <summary>Records why a session is paused (<c>[pausefor:thunder]</c> or <c>rain</c>), replacing any earlier reason.</summary>
    private static string ApplyPauseReason(string? notes, string reason)
    {
        var cleaned = System.Text.RegularExpressions.Regex.Replace(notes ?? string.Empty, @"\s*\[pausefor:[a-z]+\]\s*", " ").Trim();
        var tag = $"[pausefor:{reason}]";
        return string.IsNullOrWhiteSpace(cleaned) ? tag : $"{cleaned} {tag}";
    }

    private static string? ApplyShiftNote(string? notes, int deltaMinutes)
    {
        var raw = notes ?? string.Empty;
        var match = System.Text.RegularExpressions.Regex.Match(raw, @"\[shift:([+-]?\d+)\]");
        var current = match.Success && int.TryParse(match.Groups[1].Value, out var parsed) ? parsed : 0;
        var total = current + deltaMinutes;
        var cleaned = System.Text.RegularExpressions.Regex.Replace(raw, @"\s*\[shift:[+-]?\d+\]\s*", " ").Trim();
        if (total == 0)
            return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
        var tag = $"[shift:{(total > 0 ? "+" : "")}{total}]";
        return string.IsNullOrWhiteSpace(cleaned) ? tag : $"{cleaned} {tag}";
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
public record UpdateSessionRacesRequest(IReadOnlyList<string> RaceNames);
public record ShiftSessionTimesRequest(int DeltaMinutes, string? ArenaName = null);
public record PauseTimetableRequest(string? ArenaName = null, string? Reason = null, string? Announcement = null);
public record ResumeTimetableRequest(string? ArenaName = null, string? Announcement = null);
public record WeatherNoticeRequest(string Body);
public record PacePredictionDto(double? AvgMinutesPerRace, int? RecommendedMinutesPer5RaceHeat, double Multiplier, int SampleHeats);
public record UpdateGateCheckRequest(int TeamId, string? Status);
public record RequestArenaAssistanceRequest(string Service, string? ArenaName = null, string? Note = null, bool HoldArena = true);
