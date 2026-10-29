using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Operations;

namespace MountedGames.Api.Controllers;

[ApiController, Authorize]
[Route("api/competitions/{competitionId:int}/substitution-requests")]
public class SubstitutionRequestsController(AppDbContext db) : ControllerBase
{
    private string? UserId => User.FindFirstValue(ClaimTypes.NameIdentifier);
    private async Task<bool> IsStaff(int competitionId, CancellationToken ct) => User.IsInRole(Roles.Admin)
        || await db.Competitions.AnyAsync(c => c.Id == competitionId && c.CreatedByUserId == UserId && User.IsInRole(Roles.Trainer), ct)
        || await db.CompetitionCollaborators.AnyAsync(c => c.CompetitionId == competitionId && c.UserId == UserId, ct);

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<SubstitutionRequestDto>>> List(int competitionId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        var staff = await IsStaff(competitionId, ct);
        var rows = await db.Set<SubstitutionRequest>().AsNoTracking().Include(x => x.DeclarationForm).ThenInclude(f => f!.Team)
            .Include(x => x.DeclarationForm).ThenInclude(f => f!.Riders)
            .Where(x => x.CompetitionId == competitionId && (staff || x.RequestedByUserId == UserId))
            .OrderByDescending(x => x.Id).Take(200).ToListAsync(ct);
        return Ok(rows.Select(ToDto).ToList());
    }

    [HttpPost("declarations/{formId:int}")]
    public Task<ActionResult<SubstitutionRequestDto>> Create(int competitionId, int formId, RequestSubstitutionDto request, CancellationToken ct)
        => db.Database.CreateExecutionStrategy().ExecuteAsync(() => CreateOnceAsync(competitionId, formId, request, ct));

    private async Task<ActionResult<SubstitutionRequestDto>> CreateOnceAsync(int competitionId, int formId, RequestSubstitutionDto request, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        Response.Headers.CacheControl = "private, no-store";
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.DeclarationForms.Where(f => f.Id == formId && f.Team!.CompetitionId == competitionId)
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.TeamId, f => f.TeamId), ct);
        var form = await db.DeclarationForms.Include(f => f.Team).Include(f => f.Riders)
            .SingleOrDefaultAsync(f => f.Id == formId && f.Team!.CompetitionId == competitionId, ct);
        if (form is null) return NotFound();
        var clubManager = form.Team!.ClubId is { } clubId && await db.IsClubManagerAsync(User, clubId, ct);
        if (form.SubmittedByUserId != UserId && form.Team.TrainerUserId != UserId && !clubManager) return NotFound();
        var latest = await db.DeclarationForms.Where(f => f.TeamId == form.TeamId)
            .OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).Select(f => f.Id).FirstAsync(ct);
        if (latest != formId) return Conflict(new { message = "Use the team's latest declaration." });
        var closedAt = await db.Set<CompetitionDeclarationLock>().Where(x => x.CompetitionId == competitionId)
            .Select(x => x.DeclarationsCloseAt).SingleOrDefaultAsync(ct);
        if (!form.IsLocked && !(closedAt <= DateTime.UtcNow)) return BadRequest(new { message = "Edit the declaration while it is still open." });
        var outgoing = form.Riders.FirstOrDefault(r => r.Id == request.OutRiderEntryId && !r.IsReserve);
        if (outgoing is null) return BadRequest(new { message = "Choose a rider currently in the team." });
        if (string.IsNullOrWhiteSpace(request.Reason)) return BadRequest(new { message = "Give a short reason for the change." });
        if (request.InRiderEntryId > 0 && !form.Riders.Any(r => r.Id == request.InRiderEntryId && r.IsReserve))
            return BadRequest(new { message = "Choose a reserve from this declaration." });
        if (request.InRiderEntryId == 0 && string.IsNullOrWhiteSpace(request.ReplacementRiderName) && string.IsNullOrWhiteSpace(request.ReplacementHorseName))
            return BadRequest(new { message = "Enter the replacement rider or pony." });
        var fingerprint = DeclarationFingerprint.Of(form);
        var existing = await db.Set<SubstitutionRequest>().Include(x => x.DeclarationForm).ThenInclude(f => f!.Team)
            .Include(x => x.DeclarationForm).ThenInclude(f => f!.Riders)
            .FirstOrDefaultAsync(x => x.DeclarationFormId == formId && x.RequestedByUserId == UserId
                && x.Status == "pending" && x.DeclarationFingerprint == fingerprint && x.OutRiderEntryId == request.OutRiderEntryId, ct);
        if (existing is not null)
        {
            if (existing.InRiderEntryId == request.InRiderEntryId && existing.Reason == request.Reason.Trim()
                && existing.ReplacementRiderName == (request.InRiderEntryId == 0 ? request.ReplacementRiderName?.Trim() : null)
                && existing.ReplacementHorseName == (request.InRiderEntryId == 0 ? request.ReplacementHorseName?.Trim() : null))
                return Ok(ToDto(existing));
            return Conflict(new { message = "There is already a pending request for this rider. Ask the organiser to decide it before sending a different replacement." });
        }
        var row = new SubstitutionRequest { CompetitionId = competitionId, DeclarationFormId = formId, DeclarationForm = form,
            RequestedByUserId = UserId!, OutRiderEntryId = request.OutRiderEntryId, InRiderEntryId = request.InRiderEntryId,
            ReplacementRiderName = request.InRiderEntryId == 0 ? request.ReplacementRiderName?.Trim() : null,
            ReplacementHorseName = request.InRiderEntryId == 0 ? request.ReplacementHorseName?.Trim() : null,
            Reason = request.Reason.Trim(), DeclarationFingerprint = fingerprint };
        db.Add(row);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Ok(ToDto(row));
    }

    [HttpPost("{requestId:int}/decision"), Authorize(Policy = CompetitionStaff.Policy), CompetitionAccess("competitionId")]
    public async Task<ActionResult> Decide(int competitionId, int requestId, DecideSubstitutionDto decision, CancellationToken ct)
    {
        var row = await db.Set<SubstitutionRequest>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == requestId && x.CompetitionId == competitionId, ct);
        if (row is null) return NotFound();
        if (row.Status != "pending") return row.Status == (decision.Approve ? "approved" : "declined") ? NoContent() : Conflict(new { message = "This request has already been decided." });
        if (!decision.Approve)
        {
            var updated = await db.Set<SubstitutionRequest>().Where(x => x.Id == requestId && x.Status == "pending")
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, "declined").SetProperty(x => x.DecidedAt, DateTime.UtcNow)
                    .SetProperty(x => x.DecidedByUserId, UserId), ct);
            return updated == 1 ? NoContent() : Conflict(new { message = "This request changed on another device. Refresh and check it." });
        }
        try
        {
            await new RiderSwapService(db).SwapAsync(competitionId, row.DeclarationFormId,
                new SwapRiderRequest(row.OutRiderEntryId, row.InRiderEntryId, row.Reason, true, $"substitution-{row.Id}"), UserId, ct,
                new EmergencyReplacementInput(row.ReplacementRiderName, row.ReplacementHorseName), row.Id);
            return NoContent();
        }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (EntryValidationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (DrawValidationException ex) { return Conflict(new { message = ex.Message }); }
        catch (DbUpdateException) { return Conflict(new { message = "The declaration changed. Refresh and check the request." }); }
    }

    private static SubstitutionRequestDto ToDto(SubstitutionRequest x) => new(x.Id, x.DeclarationFormId, x.DeclarationForm!.TeamId,
        x.DeclarationForm.Team!.DisplayName, x.OutRiderEntryId, x.InRiderEntryId,
        x.DeclarationForm.Riders.FirstOrDefault(r => r.Id == x.OutRiderEntryId)?.FullName ?? "Previous rider",
        x.DeclarationForm.Riders.FirstOrDefault(r => r.Id == x.InRiderEntryId)?.FullName,
        x.ReplacementRiderName, x.ReplacementHorseName, x.Reason, x.Status, x.RequestedAt, x.DecidedAt);
}
