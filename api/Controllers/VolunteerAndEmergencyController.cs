using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{id:int}")]
public class VolunteerAndEmergencyController(AppDbContext db) : ControllerBase
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
            .Include(s => s.Claims)
            .Where(s => s.CompetitionId == id)
            .ToListAsync(ct);

        var ordered = shifts
            .OrderBy(s => s.Session?.OrderIndex ?? int.MaxValue)
            .ThenBy(s => s.Id)
            .Select(s => ToShiftDto(s, isStaff, currentUserId))
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

        Entities.Session? session = null;
        if (req.SessionId.HasValue)
        {
            session = await db.Sessions.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Id == req.SessionId.Value && s.CompetitionId == id, ct);
            if (session is null)
                return BadRequest(new { message = "The session does not belong to this competition." });
        }

        var shift = new VolunteerShift
        {
            CompetitionId = id,
            SessionId = req.SessionId,
            ArenaName = CompetitionFields.Trimmed(req.ArenaName) ?? session?.ArenaName,
            Role = role,
            StartTimeLabel = CompetitionFields.Trimmed(req.StartTimeLabel),
            Notes = CompetitionFields.Trimmed(req.Notes),
            RequiredCount = req.RequiredCount,
            CreatedAt = DateTime.UtcNow,
        };

        db.VolunteerShifts.Add(shift);
        await db.SaveChangesAsync(ct);
        shift.Session = session;

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
            .FirstOrDefaultAsync(s => s.Id == shiftId && s.CompetitionId == id, ct);
        if (shift is null) return NotFound();

        var role = CompetitionFields.Trimmed(req.Role);
        if (string.IsNullOrEmpty(role))
            return BadRequest(new { message = "A volunteer role is required." });
        if (req.RequiredCount is < 1 or > 50)
            return BadRequest(new { message = "Required count must be between 1 and 50." });

        Entities.Session? session = null;
        if (req.SessionId.HasValue)
        {
            session = await db.Sessions.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Id == req.SessionId.Value && s.CompetitionId == id, ct);
            if (session is null)
                return BadRequest(new { message = "The session does not belong to this competition." });
        }

        shift.Role = role;
        shift.SessionId = req.SessionId;
        shift.ArenaName = CompetitionFields.Trimmed(req.ArenaName) ?? session?.ArenaName;
        shift.StartTimeLabel = CompetitionFields.Trimmed(req.StartTimeLabel);
        shift.Notes = CompetitionFields.Trimmed(req.Notes);
        shift.RequiredCount = req.RequiredCount;

        await db.SaveChangesAsync(ct);
        shift.Session = session;

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
        var signupsByTeamId = signups
            .Where(s => s.TeamId.HasValue)
            .GroupBy(s => s.TeamId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());

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

    private static VolunteerShiftDto ToShiftDto(VolunteerShift s, bool isStaff, string? currentUserId)
    {
        var claims = s.Claims
            .OrderBy(c => c.ClaimedAt)
            .ThenBy(c => c.Id)
            .Select(c => new VolunteerClaimDto(
                Id: c.Id,
                ShiftId: c.ShiftId,
                UserId: c.UserId,
                VolunteerName: c.VolunteerName,
                ClubName: c.ClubName,
                ContactPhone: isStaff ? c.ContactPhone : null,
                ClaimedAt: DateTime.SpecifyKind(c.ClaimedAt, DateTimeKind.Utc),
                IsMine: !string.IsNullOrEmpty(currentUserId) && c.UserId == currentUserId))
            .ToList();

        var claimedCount = claims.Count;
        var remainingCount = Math.Max(0, s.RequiredCount - claimedCount);
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
            IsFilled: claimedCount >= s.RequiredCount,
            Claims: claims);
    }
}
