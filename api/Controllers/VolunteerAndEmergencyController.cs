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

namespace MountedGames.Api.Controllers;

// Unused in web UI yet — reserved for iOS / upcoming wiring
[ApiController]
[Route("api/competitions/{id:int}")]
public class VolunteerAndEmergencyController(
    AppDbContext db,
    ILiveBroadcaster? live = null,
    PushNotifier? push = null) : ControllerBase
{
    [HttpGet("volunteer-shifts")]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<VolunteerShiftDto>>> ListVolunteerShifts(
        int id, [FromQuery] bool unfilledOnly = false, CancellationToken ct = default)
    {
        if (!await db.Competitions.AsNoTracking().AnyAsync(c => c.Id == id, ct))
            return NotFound();

        var isStaff = await db.CanManageAsync(User, id, ct);
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (isStaff || !string.IsNullOrEmpty(currentUserId))
            Response.Headers.CacheControl = "private, no-store";

        var shifts = await db.VolunteerShifts
            .AsNoTracking()
            .Include(s => s.Session)
            .Include(s => s.AssignedTeam).ThenInclude(t => t!.Club)
            .Include(s => s.Claims)
            .Where(s => s.CompetitionId == id)
            .ToListAsync(ct);

        var checkInTeamIds = await GetViewerCheckInTeamIdsAsync(id, currentUserId, isStaff, ct);
        var viewerClubName = await GetViewerClubNameAsync(currentUserId, ct);

        var ordered = shifts
            .OrderBy(s => s.Session?.OrderIndex ?? int.MaxValue)
            .ThenBy(s => s.LaneNumber ?? int.MaxValue)
            .ThenBy(s => s.Id)
            .Select(s => ToShiftDto(s, isStaff, currentUserId, checkInTeamIds, viewerClubName))
            .Where(dto => !unfilledOnly || !dto.IsFilled)
            .ToList();

        return ordered;
    }

    [HttpPost("volunteer-shifts")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<VolunteerShiftDto>> CreateVolunteerShift(
        int id, CreateVolunteerShiftRequest req, CancellationToken ct = default)
    {
        var role = CompetitionFields.Trimmed(req.Role);
        if (string.IsNullOrEmpty(role))
            return BadRequest(new { message = "A volunteer role is required." });
        if (req.RequiredCount is < 1 or > 50)
            return BadRequest(new { message = "Required count must be between 1 and 50." });

        Session? session = null;
        if (req.SessionId.HasValue)
        {
            session = await db.Sessions.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Id == req.SessionId.Value && s.CompetitionId == id, ct);
            if (session is null)
                return BadRequest(new { message = "The session does not belong to this competition." });
        }

        Team? assignedTeam = null;
        if (req.AssignedTeamId.HasValue)
        {
            assignedTeam = await db.Teams.AsNoTracking()
                .Include(t => t.Club)
                .FirstOrDefaultAsync(t => t.Id == req.AssignedTeamId.Value && t.CompetitionId == id, ct);
            if (assignedTeam is null)
                return BadRequest(new { message = "The assigned team does not belong to this competition." });
        }

        var shift = new VolunteerShift
        {
            CompetitionId = id,
            SessionId = req.SessionId,
            ArenaName = CompetitionFields.Trimmed(req.ArenaName) ?? session?.ArenaName,
            Role = role,
            DutyCategory = NormaliseDutyCategory(req.DutyCategory, req.LaneNumber, role),
            AssignedTeamId = assignedTeam?.Id,
            AssignedClubName = CompetitionFields.Trimmed(req.AssignedClubName) ?? assignedTeam?.Club?.Name,
            LaneNumber = req.LaneNumber,
            AttendanceStatus = "Assigned",
            StartTimeLabel = CompetitionFields.Trimmed(req.StartTimeLabel),
            Notes = CompetitionFields.Trimmed(req.Notes),
            RequiredCount = req.RequiredCount,
            CreatedAt = DateTime.UtcNow,
        };

        db.VolunteerShifts.Add(shift);
        await db.SaveChangesAsync(ct);
        shift.Session = session;
        shift.AssignedTeam = assignedTeam;

        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return ToShiftDto(shift, isStaff: true, currentUserId);
    }

    [HttpPut("volunteer-shifts/{shiftId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<VolunteerShiftDto>> UpdateVolunteerShift(
        int id, int shiftId, UpdateVolunteerShiftRequest req, CancellationToken ct = default)
    {
        var shift = await db.VolunteerShifts
            .Include(s => s.Claims)
            .Include(s => s.AssignedTeam).ThenInclude(t => t!.Club)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.CompetitionId == id, ct);
        if (shift is null) return NotFound();

        var role = CompetitionFields.Trimmed(req.Role);
        if (string.IsNullOrEmpty(role))
            return BadRequest(new { message = "A volunteer role is required." });
        if (req.RequiredCount is < 1 or > 50)
            return BadRequest(new { message = "Required count must be between 1 and 50." });

        Session? session = null;
        if (req.SessionId.HasValue)
        {
            session = await db.Sessions.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Id == req.SessionId.Value && s.CompetitionId == id, ct);
            if (session is null)
                return BadRequest(new { message = "The session does not belong to this competition." });
        }

        Team? assignedTeam = null;
        if (req.AssignedTeamId.HasValue)
        {
            assignedTeam = await db.Teams.AsNoTracking()
                .Include(t => t.Club)
                .FirstOrDefaultAsync(t => t.Id == req.AssignedTeamId.Value && t.CompetitionId == id, ct);
            if (assignedTeam is null)
                return BadRequest(new { message = "The assigned team does not belong to this competition." });
        }

        shift.Role = role;
        shift.SessionId = req.SessionId;
        shift.ArenaName = CompetitionFields.Trimmed(req.ArenaName) ?? session?.ArenaName;
        shift.StartTimeLabel = CompetitionFields.Trimmed(req.StartTimeLabel);
        shift.Notes = CompetitionFields.Trimmed(req.Notes);
        shift.RequiredCount = req.RequiredCount;
        if (req.DutyCategory is not null || req.LaneNumber.HasValue)
            shift.DutyCategory = NormaliseDutyCategory(req.DutyCategory, req.LaneNumber, role);
        if (req.AssignedTeamId.HasValue || req.AssignedClubName is not null)
        {
            shift.AssignedTeamId = assignedTeam?.Id;
            shift.AssignedClubName = CompetitionFields.Trimmed(req.AssignedClubName) ?? assignedTeam?.Club?.Name;
        }
        if (req.LaneNumber.HasValue)
            shift.LaneNumber = req.LaneNumber;

        await db.SaveChangesAsync(ct);
        shift.Session = session;
        shift.AssignedTeam = assignedTeam ?? shift.AssignedTeam;

        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return ToShiftDto(shift, isStaff: true, currentUserId);
    }

    [HttpDelete("volunteer-shifts/{shiftId:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<IActionResult> DeleteVolunteerShift(int id, int shiftId, CancellationToken ct = default)
    {
        var shift = await db.VolunteerShifts
            .Include(s => s.Claims)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.CompetitionId == id, ct);
        if (shift is null) return NotFound();

        db.VolunteerClaims.RemoveRange(shift.Claims);
        db.VolunteerShifts.Remove(shift);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("volunteer-shifts/{shiftId:int}/claim")]
    [Authorize]
    public async Task<ActionResult<VolunteerShiftDto>> ClaimVolunteerShift(
        int id, int shiftId, ClaimVolunteerShiftRequest? req, CancellationToken ct = default)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var shift = await db.VolunteerShifts
            .Include(s => s.Session)
            .Include(s => s.Claims)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.CompetitionId == id, ct);
        if (shift is null) return NotFound();

        if (shift.Claims.Count >= shift.RequiredCount)
            return Conflict(new { message = "All slots for this volunteer shift have already been claimed." });

        var user = await db.Users.AsNoTracking()
            .Include(u => u.Club)
            .FirstOrDefaultAsync(u => u.Id == userId, ct);

        var volunteerName = CompetitionFields.Trimmed(req?.VolunteerName) ?? CompetitionFields.Trimmed(user?.FullName);
        if (string.IsNullOrEmpty(volunteerName))
            return BadRequest(new { message = "A volunteer name is required." });

        if (shift.Claims.Any(c => c.UserId == userId && string.Equals(c.VolunteerName, volunteerName, StringComparison.OrdinalIgnoreCase)))
            return Conflict(new { message = "You have already claimed a slot on this shift." });

        var clubName = CompetitionFields.Trimmed(req?.ClubName) ?? user?.Club?.Name;
        var contactPhone = CompetitionFields.Trimmed(req?.ContactPhone) ?? CompetitionFields.Trimmed(user?.PhoneNumber);

        var claim = new VolunteerClaim
        {
            ShiftId = shift.Id,
            UserId = userId,
            VolunteerName = volunteerName,
            ClubName = clubName,
            ContactPhone = contactPhone,
            ClaimedAt = DateTime.UtcNow,
        };

        db.VolunteerClaims.Add(claim);
        await db.SaveChangesAsync(ct);

        var isStaff = await db.CanManageAsync(User, id, ct);
        return ToShiftDto(shift, isStaff, userId);
    }

    [HttpDelete("volunteer-shifts/{shiftId:int}/claims/{claimId:int}")]
    [Authorize]
    public async Task<ActionResult<VolunteerShiftDto>> UnclaimVolunteerShift(
        int id, int shiftId, int claimId, CancellationToken ct = default)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var shift = await db.VolunteerShifts
            .Include(s => s.Session)
            .Include(s => s.Claims)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.CompetitionId == id, ct);
        if (shift is null) return NotFound();

        var claim = shift.Claims.FirstOrDefault(c => c.Id == claimId);
        if (claim is null) return NotFound();

        var isStaff = await db.CanManageAsync(User, id, ct);
        if (claim.UserId != userId && !isStaff)
            return Forbid();

        shift.Claims.Remove(claim);
        db.VolunteerClaims.Remove(claim);
        await db.SaveChangesAsync(ct);

        return ToShiftDto(shift, isStaff, userId);
    }

    [HttpPost("sessions/{sessionId:int}/duty-assignments")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<IReadOnlyList<VolunteerShiftDto>>> AssignSessionDuties(
        int id, int sessionId, AssignSessionDutiesRequest? req, CancellationToken ct = default)
    {
        var session = await db.Sessions
            .AsNoTracking()
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.CompetitionId == id, ct);
        if (session is null)
            return NotFound(new { message = "Session not found in this competition." });

        req ??= new AssignSessionDutiesRequest(AutoAssignNonRidingTeams: true);

        var activeTeams = await db.Teams
            .AsNoTracking()
            .Include(t => t.Club)
            .Where(t => t.CompetitionId == id && t.EntryStatus == TeamEntryStatus.Active && !t.IsHorsConcours)
            .OrderBy(t => t.Id)
            .ToListAsync(ct);
        var teamsById = activeTeams.ToDictionary(t => t.Id);

        var existingDuties = req.ReplaceExistingSessionDuties
            ? await db.VolunteerShifts
                .Include(s => s.Claims)
                .Where(s => s.CompetitionId == id
                    && s.SessionId == sessionId
                    && (s.AssignedTeamId != null || s.AssignedClubName != null || s.DutyCategory != "General"))
                .ToListAsync(ct)
            : [];
        var replacedDutyIds = existingDuties.Select(s => s.Id).ToList();

        var dutiesToCreate = new List<SessionDutyRoleAssignmentInput>();
        if (req.Duties is { Count: > 0 })
        {
            dutiesToCreate.AddRange(req.Duties);
        }
        else
        {
            var lanes = Math.Clamp(session.LanesPerHeat ?? 5, 1, 10);
            dutiesToCreate.Add(new SessionDutyRoleAssignmentInput(
                Role: "Arena Crew (Centre Props)",
                DutyCategory: "ArenaCrew",
                RequiredCount: 2));
            for (var lane = 1; lane <= lanes; lane++)
            {
                dutiesToCreate.Add(new SessionDutyRoleAssignmentInput(
                    Role: $"Start/Finish Line Steward — Lane {lane}",
                    DutyCategory: "LineSteward",
                    LaneNumber: lane,
                    RequiredCount: 1));
            }
            if (req.IncludeChangeoverLineStewards)
            {
                for (var lane = 1; lane <= lanes; lane++)
                {
                    dutiesToCreate.Add(new SessionDutyRoleAssignmentInput(
                        Role: $"Changeover Line Steward — Lane {lane}",
                        DutyCategory: "ChangeoverSteward",
                        LaneNumber: lane,
                        RequiredCount: 1));
                }
            }
        }

        // Balance auto-assignment across active teams not riding in this session.
        var ridingTeamIds = session.Heats.SelectMany(h => h.Entries).Select(e => e.TeamId).ToHashSet();
        if (ridingTeamIds.Count == 0 && session.CompetitionSectionId.HasValue)
        {
            foreach (var t in activeTeams.Where(t => t.CompetitionSectionId == session.CompetitionSectionId.Value))
                ridingTeamIds.Add(t.Id);
        }

        var nonRidingCandidates = activeTeams
            .Where(t => !ridingTeamIds.Contains(t.Id))
            .ToList();
        if (nonRidingCandidates.Count == 0)
            nonRidingCandidates = activeTeams.ToList();

        var existingCounts = await db.VolunteerShifts
            .AsNoTracking()
            .Where(s => s.CompetitionId == id && s.AssignedTeamId != null && !replacedDutyIds.Contains(s.Id))
            .GroupBy(s => s.AssignedTeamId!.Value)
            .Select(g => new { TeamId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.TeamId, x => x.Count, ct);

        var startTimeLabel = session.ScheduledStart?.ToString("HH:mm");
        var now = DateTime.UtcNow;
        var createdShifts = new List<VolunteerShift>();

        foreach (var item in dutiesToCreate)
        {
            var role = CompetitionFields.Trimmed(item.Role);
            if (string.IsNullOrEmpty(role)) continue;

            Team? chosenTeam = null;
            if (item.AssignedTeamId.HasValue)
            {
                if (!teamsById.TryGetValue(item.AssignedTeamId.Value, out var explicitTeam))
                    return BadRequest(new { message = "Assigned team does not belong to an active team in this competition." });
                chosenTeam = explicitTeam;
            }
            else if (req.AutoAssignNonRidingTeams && string.IsNullOrWhiteSpace(item.AssignedClubName) && nonRidingCandidates.Count > 0)
            {
                chosenTeam = nonRidingCandidates
                    .OrderBy(t => existingCounts.GetValueOrDefault(t.Id, 0))
                    .ThenBy(t => t.CompetitionSectionId == session.CompetitionSectionId ? 1 : 0)
                    .ThenBy(t => t.Id)
                    .First();
                existingCounts[chosenTeam.Id] = existingCounts.GetValueOrDefault(chosenTeam.Id, 0) + 1;
            }

            var shift = new VolunteerShift
            {
                CompetitionId = id,
                SessionId = sessionId,
                ArenaName = session.ArenaName,
                Role = role,
                DutyCategory = NormaliseDutyCategory(item.DutyCategory, item.LaneNumber, role),
                AssignedTeamId = chosenTeam?.Id,
                AssignedClubName = CompetitionFields.Trimmed(item.AssignedClubName) ?? chosenTeam?.Club?.Name,
                LaneNumber = item.LaneNumber,
                AttendanceStatus = "Assigned",
                StartTimeLabel = CompetitionFields.Trimmed(item.StartTimeLabel) ?? startTimeLabel,
                Notes = CompetitionFields.Trimmed(item.Notes),
                RequiredCount = Math.Clamp(item.RequiredCount, 1, 50),
                CreatedAt = now,
            };

            createdShifts.Add(shift);
        }

        // Validate the complete replacement before changing tracked rows. One SaveChanges transaction
        // preserves the old rota and its claims if any replacement insert fails.
        db.VolunteerClaims.RemoveRange(existingDuties.SelectMany(s => s.Claims));
        db.VolunteerShifts.RemoveRange(existingDuties);
        db.VolunteerShifts.AddRange(createdShifts);
        await db.SaveChangesAsync(ct);

        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var loaded = await db.VolunteerShifts
            .AsNoTracking()
            .Include(s => s.Session)
            .Include(s => s.AssignedTeam).ThenInclude(t => t!.Club)
            .Include(s => s.Claims)
            .Where(s => s.CompetitionId == id && s.SessionId == sessionId)
            .OrderBy(s => s.LaneNumber ?? int.MaxValue)
            .ThenBy(s => s.Id)
            .ToListAsync(ct);

        return loaded.Select(s => ToShiftDto(s, isStaff: true, currentUserId)).ToList();
    }

    [HttpPost("volunteer-shifts/{shiftId:int}/check-in")]
    [Authorize]
    public async Task<ActionResult<VolunteerShiftDto>> CheckInVolunteerShift(
        int id, int shiftId, [FromBody] CheckInVolunteerShiftRequest? req = null, CancellationToken ct = default)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(userId)) return Unauthorized();

        var shift = await db.VolunteerShifts
            .Include(s => s.Session)
            .Include(s => s.AssignedTeam).ThenInclude(t => t!.Club)
            .Include(s => s.Claims)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.CompetitionId == id, ct);
        if (shift is null) return NotFound();

        var isStaff = await db.CanManageAsync(User, id, ct);
        var checkInTeamIds = await GetViewerCheckInTeamIdsAsync(id, userId, isStaff, ct);
        var viewerClubName = await GetViewerClubNameAsync(userId, ct);

        if (!CanViewerCheckInShift(shift, isStaff, userId, checkInTeamIds, viewerClubName))
            return Forbid();

        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
        var checkedInName = CompetitionFields.Trimmed(req?.CheckedInByName)
            ?? CompetitionFields.Trimmed(user?.FullName)
            ?? shift.AssignedTeam?.DisplayName
            ?? shift.AssignedClubName
            ?? "Volunteer";

        shift.AttendanceStatus = "Here";
        shift.CheckedInAt = DateTime.UtcNow;
        shift.CheckedInByUserId = userId;
        shift.CheckedInByName = checkedInName;
        shift.CheckedInByStaffOverride = false;

        var removedIds = await ClearMissingStewardAnnouncementsAsync(id, shift.Id, ct);
        await db.SaveChangesAsync(ct);
        await BroadcastDeletedAnnouncementsAsync(id, removedIds);

        return ToShiftDto(shift, isStaff, userId, checkInTeamIds, viewerClubName);
    }

    [HttpPut("volunteer-shifts/{shiftId:int}/attendance")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<VolunteerShiftDto>> UpdateVolunteerAttendance(
        int id, int shiftId, UpdateVolunteerAttendanceRequest req, CancellationToken ct = default)
    {
        var shift = await db.VolunteerShifts
            .Include(s => s.Session)
            .Include(s => s.AssignedTeam).ThenInclude(t => t!.Club)
            .Include(s => s.Claims)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.CompetitionId == id, ct);
        if (shift is null) return NotFound();

        var normalised = NormaliseAttendanceStatus(req.Status);
        if (normalised is null)
            return BadRequest(new { message = "Status must be 'Assigned', 'Here', or 'Missing'." });

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        shift.AttendanceStatus = normalised;

        List<int> removedIds = [];
        if (normalised == "Here")
        {
            var user = string.IsNullOrEmpty(userId)
                ? null
                : await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
            shift.CheckedInAt = DateTime.UtcNow;
            shift.CheckedInByUserId = userId;
            shift.CheckedInByName = CompetitionFields.Trimmed(req.CheckedInByName)
                ?? CompetitionFields.Trimmed(user?.FullName)
                ?? "Staff";
            shift.CheckedInByStaffOverride = true;
            removedIds = await ClearMissingStewardAnnouncementsAsync(id, shift.Id, ct);
        }
        else
        {
            shift.CheckedInAt = null;
            shift.CheckedInByUserId = null;
            shift.CheckedInByName = null;
            shift.CheckedInByStaffOverride = false;
        }

        await db.SaveChangesAsync(ct);
        await BroadcastDeletedAnnouncementsAsync(id, removedIds);
        return ToShiftDto(shift, isStaff: true, userId);
    }

    [HttpPost("volunteer-shifts/{shiftId:int}/call-missing")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<CallMissingStewardResultDto>> CallMissingSteward(
        int id, int shiftId, [FromBody] CallMissingStewardRequest? req = null, CancellationToken ct = default)
    {
        var shift = await db.VolunteerShifts
            .Include(s => s.Session)
            .Include(s => s.AssignedTeam).ThenInclude(t => t!.Club)
            .Include(s => s.Claims)
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.CompetitionId == id, ct);
        if (shift is null) return NotFound();

        if (string.Equals(shift.AttendanceStatus, "Here", StringComparison.OrdinalIgnoreCase))
            return Conflict(new { message = "This steward or team has already checked in as here." });

        shift.AttendanceStatus = "Missing";

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = string.IsNullOrEmpty(userId)
            ? null
            : await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
        var authorName = CompetitionFields.Trimmed(user?.FullName) ?? "Ring Steward";
        if (authorName.Length > 60) authorName = authorName[..60];

        var arena = CompetitionFields.Trimmed(shift.ArenaName)
            ?? CompetitionFields.Trimmed(shift.Session?.ArenaName)
            ?? "Main Arena";
        var targetLabel = shift.AssignedTeam?.DisplayName
            ?? CompetitionFields.Trimmed(shift.AssignedClubName)
            ?? shift.Claims.Select(c => c.VolunteerName).FirstOrDefault()
            ?? "Assigned steward";
        var sessionSuffix = shift.Session is not null ? $" for {shift.Session.Name}" : string.Empty;
        var defaultBody = $"📣 Steward call ({arena}): {targetLabel} needed now at {shift.Role}{sessionSuffix}.";
        var body = CompetitionFields.Trimmed(req?.CustomMessage) ?? defaultBody;

        var msg = new ChatMessage
        {
            CompetitionId = id,
            UserId = userId,
            AuthorName = authorName,
            Body = body,
            Type = ChatMessageType.Announcement,
            Tag = $"missing-steward:{shift.Id}",
            CreatedAt = DateTime.UtcNow,
        };
        db.ChatMessages.Add(msg);
        await db.SaveChangesAsync(ct);

        var msgDto = msg.ToDto();
        if (live is not null)
            await live.ChatMessage(id, msgDto);

        if (push is not null && shift.AssignedTeamId.HasValue)
        {
            try
            {
                await push.NotifyPerTeamAsync(
                [
                    (shift.AssignedTeamId.Value, new PushPayload(
                        Title: $"Steward call ({arena})",
                        Body: body,
                        Tag: $"missing-steward:{shift.Id}",
                        Url: $"/competitions/{id}"))
                ], ct);
            }
            catch
            {
                // Push notifications are best-effort; keep the saved announcement.
            }
        }

        var shiftDto = ToShiftDto(shift, isStaff: true, userId);
        return new CallMissingStewardResultDto(shiftDto, msgDto);
    }

    [HttpGet("emergency-contacts")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("id")]
    public async Task<ActionResult<IReadOnlyList<EmergencyContactLookupDto>>> SearchEmergencyContacts(
        int id, [FromQuery] string? q = null, CancellationToken ct = default)
    {
        if (q?.Length > 200)
            return BadRequest(new { message = "Search query must be at most 200 characters." });

        Response.Headers.CacheControl = "private, no-store";

        var teams = await db.Teams
            .AsNoTracking()
            .AsSplitQuery()
            .Include(t => t.Section)
            .Include(t => t.Club)
            .Include(t => t.Trainer)
            .Include(t => t.DeclarationForms).ThenInclude(d => d.Riders)
            .Include(t => t.DeclarationForms).ThenInclude(d => d.SubmittedBy)
            .Where(t => t.CompetitionId == id)
            .ToListAsync(ct);

        var signups = await db.SectionSignups
            .AsNoTracking()
            .Include(s => s.Section)
            .Where(s => s.Section!.CompetitionId == id && s.Status != Entities.SignupPaymentStatus.Cancelled && s.Status != Entities.SignupPaymentStatus.Refunded)
            .ToListAsync(ct);
        var signupIds = signups.Select(s => s.Id).ToList();
        var guestDetailsMap = signupIds.Count == 0
            ? new Dictionary<int, Entities.SignupGuestDetails>()
            : await db.Set<Entities.SignupGuestDetails>()
                .AsNoTracking()
                .Where(g => signupIds.Contains(g.SignupId))
                .ToDictionaryAsync(g => g.SignupId, ct);
        var signupTeamLinks = signupIds.Count == 0
            ? []
            : await db.Set<Entities.SignupTeamLink>()
                .AsNoTracking()
                .Where(l => signupIds.Contains(l.SignupId))
                .ToListAsync(ct);
        var signupsById = signups.ToDictionary(s => s.Id);
        var signupsByTeamId = signups
            .Where(s => s.TeamId.HasValue)
            .Select(s => (TeamId: s.TeamId!.Value, Signup: s))
            .Concat(signupTeamLinks
                .Where(l => signupsById.ContainsKey(l.SignupId))
                .Select(l => (l.TeamId, Signup: signupsById[l.SignupId])))
            .GroupBy(x => x.TeamId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Signup).DistinctBy(s => s.Id).ToList());

        var results = new List<EmergencyContactLookupDto>();
        var coveredSignupIds = new HashSet<int>();
        foreach (var team in teams.OrderBy(t => t.Section?.DisplayName ?? string.Empty).ThenBy(t => t.DisplayName))
        {
            var latestForm = team.DeclarationForms
                .OrderByDescending(d => d.SubmittedAt)
                .ThenByDescending(d => d.Id)
                .FirstOrDefault();
            if (latestForm is null) continue;

            var teamSignups = signupsByTeamId.GetValueOrDefault(team.Id) ?? [];
            foreach (var ts in teamSignups) coveredSignupIds.Add(ts.Id);
            var primarySignup = teamSignups.FirstOrDefault();

            var trainerName = CompetitionFields.Trimmed(latestForm.TrainerName)
                ?? CompetitionFields.Trimmed(latestForm.SubmittedBy?.FullName)
                ?? CompetitionFields.Trimmed(team.Trainer?.FullName)
                ?? CompetitionFields.Trimmed(primarySignup?.FullName);
            var trainerPhone = CompetitionFields.Trimmed(latestForm.TrainerPhone)
                ?? CompetitionFields.Trimmed(latestForm.SubmittedBy?.PhoneNumber)
                ?? CompetitionFields.Trimmed(team.Trainer?.PhoneNumber)
                ?? CompetitionFields.Trimmed(primarySignup?.ContactInfo);
            var teamBibDesc = ResultStatuses.PublicBibDescription(team.BibDescription);

            foreach (var rider in latestForm.Riders.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id))
            {
                var bibColour = CompetitionFields.Trimmed(rider.BibColour)
                    ?? CompetitionFields.Trimmed(team.BibColour)
                    ?? CompetitionFields.Trimmed(team.Club?.BibColour);

                var matchingGuest = teamSignups
                    .Select(s => guestDetailsMap.GetValueOrDefault(s.Id))
                    .FirstOrDefault(g => g is not null && (
                        string.Equals(CompetitionFields.Trimmed(g.RiderName), CompetitionFields.Trimmed(rider.FullName), StringComparison.OrdinalIgnoreCase)
                        || teamSignups.Count == 1));

                var emergencyName = CompetitionFields.Trimmed(rider.EmergencyContactName)
                    ?? CompetitionFields.Trimmed(matchingGuest?.EmergencyContactName)
                    ?? CompetitionFields.Trimmed(matchingGuest?.GuardianName);
                var emergencyPhone = CompetitionFields.Trimmed(rider.EmergencyContactPhone)
                    ?? CompetitionFields.Trimmed(matchingGuest?.EmergencyContactPhone)
                    ?? CompetitionFields.Trimmed(matchingGuest?.GuardianPhone);

                results.Add(new EmergencyContactLookupDto(
                    RiderEntryId: rider.Id,
                    RiderName: rider.FullName,
                    PonyName: CompetitionFields.Trimmed(rider.HorseName) ?? CompetitionFields.Trimmed(matchingGuest?.PonyName),
                    TeamId: team.Id,
                    TeamName: team.DisplayName,
                    SectionId: team.CompetitionSectionId,
                    SectionName: team.Section?.DisplayName ?? string.Empty,
                    ClubName: team.Club?.Name ?? string.Empty,
                    BibColour: bibColour,
                    BibDescription: teamBibDesc,
                    IsReserve: rider.IsReserve,
                    EmergencyContactName: emergencyName,
                    EmergencyContactPhone: emergencyPhone,
                    MedicalNotes: rider.MedicalNotes,
                    TrainerName: trainerName,
                    TrainerPhone: trainerPhone));
            }
        }

        var teamsById = teams.ToDictionary(t => t.Id);
        foreach (var signup in signups.Where(s => !coveredSignupIds.Contains(s.Id)))
        {
            if (!guestDetailsMap.TryGetValue(signup.Id, out var guest)) continue;
            var riderName = CompetitionFields.Trimmed(guest.RiderName);
            var emergencyName = CompetitionFields.Trimmed(guest.EmergencyContactName) ?? CompetitionFields.Trimmed(guest.GuardianName);
            var emergencyPhone = CompetitionFields.Trimmed(guest.EmergencyContactPhone) ?? CompetitionFields.Trimmed(guest.GuardianPhone);
            if (string.IsNullOrEmpty(riderName) && string.IsNullOrEmpty(emergencyName) && string.IsNullOrEmpty(emergencyPhone))
                continue;

            var linkedTeam = signup.TeamId.HasValue ? teamsById.GetValueOrDefault(signup.TeamId.Value) : null;
            results.Add(new EmergencyContactLookupDto(
                RiderEntryId: -signup.Id,
                RiderName: riderName ?? CompetitionFields.Trimmed(signup.FullName) ?? "Entry Rider",
                PonyName: CompetitionFields.Trimmed(guest.PonyName),
                TeamId: linkedTeam?.Id ?? 0,
                TeamName: linkedTeam?.DisplayName ?? (CompetitionFields.Trimmed(signup.TeamName) ?? CompetitionFields.Trimmed(signup.PonyClubName) ?? "Pending Entry"),
                SectionId: signup.CompetitionSectionId,
                SectionName: signup.Section?.DisplayName ?? linkedTeam?.Section?.DisplayName ?? string.Empty,
                ClubName: CompetitionFields.Trimmed(signup.PonyClubName) ?? linkedTeam?.Club?.Name ?? string.Empty,
                BibColour: CompetitionFields.Trimmed(linkedTeam?.BibColour) ?? CompetitionFields.Trimmed(linkedTeam?.Club?.BibColour),
                BibDescription: ResultStatuses.PublicBibDescription(linkedTeam?.BibDescription),
                IsReserve: false,
                EmergencyContactName: emergencyName,
                EmergencyContactPhone: emergencyPhone,
                MedicalNotes: null,
                TrainerName: CompetitionFields.Trimmed(signup.FullName),
                TrainerPhone: CompetitionFields.Trimmed(signup.ContactInfo)));
        }

        var tokens = string.IsNullOrWhiteSpace(q)
            ? []
            : q.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (tokens.Length > 0)
        {
            results = results
                .Where(r => tokens.All(token => MatchesToken(r, token)))
                .ToList();
        }

        return results;
    }

    private static bool MatchesToken(EmergencyContactLookupDto row, string token) =>
        ContainsIgnoreCase(row.RiderName, token)
        || ContainsIgnoreCase(row.PonyName, token)
        || ContainsIgnoreCase(row.TeamName, token)
        || ContainsIgnoreCase(row.SectionName, token)
        || ContainsIgnoreCase(row.ClubName, token)
        || ContainsIgnoreCase(row.BibColour, token)
        || ContainsIgnoreCase(row.BibDescription, token)
        || ContainsIgnoreCase(row.EmergencyContactName, token)
        || ContainsIgnoreCase(row.TrainerName, token);

    private static bool ContainsIgnoreCase(string? source, string token) =>
        !string.IsNullOrEmpty(source) && source.Contains(token, StringComparison.OrdinalIgnoreCase);

    private static string NormaliseDutyCategory(string? rawCategory, int? laneNumber, string role)
    {
        var trimmed = CompetitionFields.Trimmed(rawCategory);
        if (!string.IsNullOrEmpty(trimmed)) return trimmed;
        if (laneNumber.HasValue || role.Contains("Line Steward", StringComparison.OrdinalIgnoreCase))
            return role.Contains("Changeover", StringComparison.OrdinalIgnoreCase) ? "ChangeoverSteward" : "LineSteward";
        if (role.Contains("Arena Crew", StringComparison.OrdinalIgnoreCase) || role.Contains("Arena Party", StringComparison.OrdinalIgnoreCase))
            return "ArenaCrew";
        return "General";
    }

    private static string? NormaliseAttendanceStatus(string? rawStatus)
    {
        var trimmed = CompetitionFields.Trimmed(rawStatus);
        if (string.Equals(trimmed, "Here", StringComparison.OrdinalIgnoreCase)) return "Here";
        if (string.Equals(trimmed, "Missing", StringComparison.OrdinalIgnoreCase)) return "Missing";
        if (string.Equals(trimmed, "Assigned", StringComparison.OrdinalIgnoreCase)) return "Assigned";
        return null;
    }

    private async Task<HashSet<int>> GetViewerCheckInTeamIdsAsync(int competitionId, string? userId, bool isStaff, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(userId)) return [];
        if (isStaff)
        {
            var allIds = await db.Teams.AsNoTracking()
                .Where(t => t.CompetitionId == competitionId)
                .Select(t => t.Id)
                .ToListAsync(ct);
            return allIds.ToHashSet();
        }

        var userClubId = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.ClubId)
            .FirstOrDefaultAsync(ct);

        var directTeamIds = await db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == competitionId && (
                t.TrainerUserId == userId
                || (userClubId.HasValue && t.ClubId == userClubId.Value)
                || t.Supporters.Any(sp => sp.UserId == userId && sp.Status == TeamSupporterStatus.Accepted)
                || t.DeclarationForms.Any(df => df.SubmittedByUserId == userId)))
            .Select(t => t.Id)
            .ToListAsync(ct);

        var userSignupIds = await db.SectionSignups.AsNoTracking()
            .Where(s => s.Section!.CompetitionId == competitionId
                && s.UserId == userId
                && s.Status != SignupPaymentStatus.Cancelled
                && s.Status != SignupPaymentStatus.Refunded)
            .Select(s => new { s.Id, s.TeamId })
            .ToListAsync(ct);
        var signupTeamIds = userSignupIds
            .Where(s => s.TeamId.HasValue)
            .Select(s => s.TeamId!.Value)
            .ToList();
        var activeSignupIds = userSignupIds.Select(s => s.Id).ToList();
        var linkedTeamIds = activeSignupIds.Count == 0
            ? []
            : await db.Set<SignupTeamLink>().AsNoTracking()
                .Where(l => activeSignupIds.Contains(l.SignupId))
                .Select(l => l.TeamId)
                .ToListAsync(ct);

        var result = directTeamIds.ToHashSet();
        foreach (var tid in signupTeamIds) result.Add(tid);
        foreach (var tid in linkedTeamIds) result.Add(tid);
        return result;
    }

    private async Task<string?> GetViewerClubNameAsync(string? userId, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(userId)) return null;
        return await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.Club != null ? u.Club.Name : null)
            .FirstOrDefaultAsync(ct);
    }

    private static bool CanViewerCheckInShift(
        VolunteerShift s,
        bool isStaff,
        string? currentUserId,
        HashSet<int>? checkInTeamIds = null,
        string? viewerClubName = null)
    {
        if (string.IsNullOrEmpty(currentUserId)) return false;
        if (isStaff) return true;
        if (s.Claims.Any(c => c.UserId == currentUserId)) return true;
        if (s.AssignedTeamId.HasValue && checkInTeamIds?.Contains(s.AssignedTeamId.Value) == true) return true;
        var shiftClub = s.AssignedClubName ?? s.AssignedTeam?.Club?.Name;
        if (!string.IsNullOrWhiteSpace(shiftClub)
            && !string.IsNullOrWhiteSpace(viewerClubName)
            && string.Equals(shiftClub.Trim(), viewerClubName.Trim(), StringComparison.OrdinalIgnoreCase))
            return true;
        return false;
    }

    private async Task<List<int>> ClearMissingStewardAnnouncementsAsync(int competitionId, int shiftId, CancellationToken ct)
    {
        var tag = $"missing-steward:{shiftId}";
        var existingCalls = await db.ChatMessages
            .Where(m => m.CompetitionId == competitionId && m.Tag == tag && m.Type == ChatMessageType.Announcement)
            .ToListAsync(ct);
        if (existingCalls.Count == 0) return [];

        var removedIds = existingCalls.Select(m => m.Id).ToList();
        db.ChatMessages.RemoveRange(existingCalls);
        return removedIds;
    }

    private async Task BroadcastDeletedAnnouncementsAsync(int competitionId, IReadOnlyList<int> removedIds)
    {
        if (live is null || removedIds.Count == 0) return;
        foreach (var msgId in removedIds)
            await live.ChatMessageDeleted(competitionId, msgId);
    }

    private static VolunteerShiftDto ToShiftDto(
        VolunteerShift s,
        bool isStaff,
        string? currentUserId,
        HashSet<int>? checkInTeamIds = null,
        string? viewerClubName = null)
    {
        var claims = s.Claims
            .OrderBy(c => c.ClaimedAt)
            .ThenBy(c => c.Id)
            .Select(c => new VolunteerClaimDto(
                Id: c.Id,
                ShiftId: c.ShiftId,
                UserId: isStaff || (!string.IsNullOrEmpty(currentUserId) && c.UserId == currentUserId) ? c.UserId : string.Empty,
                VolunteerName: c.VolunteerName,
                ClubName: c.ClubName,
                ContactPhone: isStaff ? c.ContactPhone : null,
                ClaimedAt: DateTime.SpecifyKind(c.ClaimedAt, DateTimeKind.Utc),
                IsMine: !string.IsNullOrEmpty(currentUserId) && c.UserId == currentUserId))
            .ToList();

        var claimedCount = claims.Count;
        var hasTeamAssignment = s.AssignedTeamId.HasValue || !string.IsNullOrWhiteSpace(s.AssignedClubName);
        var isHere = string.Equals(s.AttendanceStatus, "Here", StringComparison.OrdinalIgnoreCase);
        var isFilled = claimedCount >= s.RequiredCount || hasTeamAssignment || isHere;
        var remainingCount = isFilled ? 0 : Math.Max(0, s.RequiredCount - claimedCount);
        var canCheckIn = CanViewerCheckInShift(s, isStaff, currentUserId, checkInTeamIds, viewerClubName);

        return new VolunteerShiftDto(
            Id: s.Id,
            CompetitionId: s.CompetitionId,
            SessionId: s.SessionId,
            SessionName: s.Session?.Name,
            ArenaName: s.ArenaName ?? s.Session?.ArenaName,
            Role: s.Role,
            StartTimeLabel: s.StartTimeLabel,
            Notes: s.Notes,
            RequiredCount: s.RequiredCount,
            ClaimedCount: claimedCount,
            RemainingCount: remainingCount,
            IsFilled: isFilled,
            Claims: claims,
            DutyCategory: string.IsNullOrWhiteSpace(s.DutyCategory) ? "General" : s.DutyCategory,
            AssignedTeamId: s.AssignedTeamId,
            AssignedTeamName: s.AssignedTeam?.DisplayName,
            AssignedClubName: s.AssignedClubName ?? s.AssignedTeam?.Club?.Name,
            LaneNumber: s.LaneNumber,
            AttendanceStatus: string.IsNullOrWhiteSpace(s.AttendanceStatus) ? "Assigned" : s.AttendanceStatus,
            CheckedInAt: s.CheckedInAt.HasValue ? DateTime.SpecifyKind(s.CheckedInAt.Value, DateTimeKind.Utc) : null,
            CheckedInByName: s.CheckedInByName,
            CheckedInByStaffOverride: s.CheckedInByStaffOverride,
            CanViewerCheckIn: canCheckIn);
    }
}
