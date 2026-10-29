using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Apple;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Apple;
namespace MountedGames.Api.Controllers;

[ServiceFilter(typeof(AppleConflictFilter))]
[ApiController, Authorize, Route("api/competitions/{competitionId:int}/arrival-bookings")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AppleArrivalController(AppDbContext db, ArrivalBookingService bookings, ApplePassIssuer issuer, AppleOptions options) : ControllerBase
{
    private string UserId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    [HttpGet("/api/apple/arrival-events")]
    public async Task<IActionResult> MyEvents(CancellationToken ct) => Ok(await db.Set<EventOrder>().AsNoTracking()
        .Where(x => x.BuyerUserId == UserId && !x.IsTestOrder && (x.Status == CommerceOrderStatus.Paid || x.Status == CommerceOrderStatus.AwaitingManualPayment))
        .Select(x => new { id = x.CompetitionId, name = x.Competition!.Name })
        .Union(from booking in db.Set<ArrivalBooking>() join competition in db.Competitions on booking.CompetitionId equals competition.Id
            where booking.OwnerUserId == UserId select new { id = competition.Id, name = competition.Name }).Take(50).ToListAsync(ct));
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ArrivalBookingDto>>> List(int competitionId, int? signupId, CancellationToken ct)
    {
        var staff = await db.CanManageAsync(User, competitionId, ct);
        var owner = signupId == null ? null : await db.SectionSignups.Where(x => x.Id == signupId && x.Section!.CompetitionId == competitionId && (staff || x.UserId == UserId)).Select(x => x.UserId).SingleOrDefaultAsync(ct);
        var rows = await db.Set<ArrivalBooking>().Include(x => x.Sources).ThenInclude(x => x.Allocations)
            .Where(x => x.CompetitionId == competitionId && (staff || x.OwnerUserId == UserId) && (signupId == null || x.SignupId == signupId || (x.SignupId == null && x.OwnerUserId == owner)))
            .OrderBy(x => x.UpdatedAt).Take(100).ToListAsync(ct);
        var result = new List<ArrivalBookingDto>(); foreach (var row in rows) result.Add(await bookings.ProjectAsync(row, ct));
        return result;
    }
    [HttpGet("entitlements")]
    public async Task<ActionResult<IReadOnlyList<ArrivalEntitlementDto>>> Entitlements(int competitionId, int? signupId, CancellationToken ct)
    {
        var owner = UserId;
        if (signupId is int sid && await db.CanManageAsync(User, competitionId, ct)) owner = await db.SectionSignups
            .Where(x => x.Id == sid && x.Section!.CompetitionId == competitionId).Select(x => x.UserId).SingleOrDefaultAsync(ct) ?? "";
        var lines = await db.Set<EventOrderLine>().AsNoTracking().Include(x => x.Order)
            .Where(x => x.Order!.CompetitionId == competitionId && x.Order.BuyerUserId == owner && !x.Order.IsTestOrder)
            .OrderBy(x => x.Id).Take(200).ToListAsync(ct);
        var ids = lines.Select(x => x.Id).ToArray();
        var assigned = await db.Set<ArrivalBookingSource>().Where(x => ids.Contains(x.EventOrderLineId)).GroupBy(x => x.EventOrderLineId)
            .Select(g => new { Id = g.Key, Quantity = g.Sum(x => x.Quantity) }).ToDictionaryAsync(x => x.Id, x => x.Quantity, ct);
        return lines.Select(x => new ArrivalEntitlementDto(x.Id, x.TitleSnapshot, x.FulfilmentKindSnapshot, x.Quantity, assigned.GetValueOrDefault(x.Id),
            x.Order!.Status == CommerceOrderStatus.Paid ? "paid" : x.Order.Status == CommerceOrderStatus.AwaitingManualPayment ? "pending" : "cancelled", x.FulfilmentFromDate, x.FulfilmentUntilDate, x.FulfilmentRevision)).ToList();
    }
    [HttpPost]
    public Task<ActionResult<ArrivalBookingDto>> Create(int competitionId, ArrivalBookingRequest request, [FromQuery] int? forSignupId, CancellationToken ct) => Save(competitionId, null, request, ct, forSignupId);
    [HttpPut("{id:guid}")]
    public Task<ActionResult<ArrivalBookingDto>> Update(int competitionId, Guid id, ArrivalBookingRequest request, CancellationToken ct) => Save(competitionId, id, request, ct);
    private async Task<ActionResult<ArrivalBookingDto>> Save(int competitionId, Guid? id, ArrivalBookingRequest request, CancellationToken ct, int? forSignupId = null)
    {
        if (!await db.Competitions.AnyAsync(x => x.Id == competitionId, ct)) return NotFound();
        var owner = UserId;
        if (await db.CanManageAsync(User, competitionId, ct))
        {
            if (id is Guid bookingId) owner = await db.Set<ArrivalBooking>().Where(x => x.Id == bookingId && x.CompetitionId == competitionId).Select(x => x.OwnerUserId).SingleOrDefaultAsync(ct) ?? "";
            else if ((request.SignupId ?? forSignupId) is int sid) owner = await db.SectionSignups.Where(x => x.Id == sid && x.Section!.CompetitionId == competitionId).Select(x => x.UserId).SingleOrDefaultAsync(ct) ?? "";
        }
        if (owner.Length == 0) return NotFound();
        try {
            return await bookings.ExecuteAsync<ArrivalBookingDto>(async () => {

            var booking = await bookings.SaveAsync(competitionId, owner, id, request, ct);
            var result = await bookings.ProjectAsync(booking, ct);  return result;

        }, ct);
        } catch (ArrivalConflict ex) { return Conflict(new { message = ex.Message }); }
        catch (DbUpdateException) { return Conflict(new { message = "This booking changed. Refresh it and try again." }); }
    }
    [HttpPut("{id:guid}/allocations"), Authorize(Policy = CompetitionStaff.Policy), CompetitionAccess("competitionId")]
    public async Task<IActionResult> Allocate(int competitionId, Guid id, ArrivalAllocateRequest request, CancellationToken ct)
    {
        try {
            return await bookings.ExecuteAsync<IActionResult>(async () => {
 var booking = await bookings.LoadAsync(id, competitionId, ct); if (booking == null) return NotFound();
            await bookings.AllocateAsync(booking, request, ct);  return Ok(await bookings.ProjectAsync(booking, ct));

        }, ct);
        } catch (ArrivalConflict ex) { return Conflict(new { message = ex.Message }); }
        catch (DbUpdateException) { return Conflict(new { message = "That stable or hook-up is already allocated for this night. Refresh and choose another." }); }
    }
    [HttpGet("gate/{reference}"), Authorize(Policy = CompetitionStaff.Policy), CompetitionAccess("competitionId")]
    public async Task<ActionResult<ArrivalBookingDto>> Gate(int competitionId, string reference, CancellationToken ct)
    {
        if (reference.Length != 64) return NotFound();
        return await bookings.ExecuteAsync<ActionResult<ArrivalBookingDto>>(async () => {

        var booking = await db.Set<ArrivalBooking>().Include(x => x.Sources).ThenInclude(x => x.Allocations)
            .SingleOrDefaultAsync(x => x.CompetitionId == competitionId && x.Reference == reference, ct);
        if (booking == null) return NotFound();
        var result = await bookings.ProjectAsync(booking, ct);  return result;

        }, ct);
    }
    [HttpGet("{id:guid}/wallet")]
    public async Task<IActionResult> Download(int competitionId, Guid id, CancellationToken ct)
    {
        if (!options.WalletReady) return StatusCode(503, new { message = "Apple Wallet passes are not available yet. You can still download the arrival card." });
        try {
            return await bookings.ExecuteAsync<IActionResult>(async () => {

            var booking = await bookings.LoadAsync(id, competitionId, ct);
            if (booking == null || (booking.OwnerUserId != UserId && !await db.CanManageAsync(User, competitionId, ct))) return NotFound();
            var pass = await bookings.RefreshPassAsync(booking, true, ct); var bytes = issuer.Issue(pass!, await bookings.ProjectAsync(booking, ct));
             Response.Headers.CacheControl = "private, no-store";
            return File(bytes, "application/vnd.apple.pkpass", "arrival.pkpass");

        }, ct);
        } catch (ArrivalConflict ex) { return Conflict(new { message = ex.Message }); }
        catch (Exception ex) when (ex is InvalidOperationException or System.Security.Cryptography.CryptographicException or FormatException) { return StatusCode(503, new { message = "Apple Wallet is unavailable. Use the arrival card and try again later." }); }
    }
    [HttpPut("order-lines/{lineId:int}/fulfilment"), Authorize(Policy = CompetitionStaff.Policy), CompetitionAccess("competitionId")]
    public async Task<IActionResult> Classify(int competitionId, int lineId, FulfilmentRequest request, CancellationToken ct)
    {
        if (!AppleFulfilment.Valid(request)) return BadRequest(new { message = "Choose the booking type, first night and departure date." });
        return await bookings.ExecuteAsync<IActionResult>(async () => {

        var line = await db.Set<EventOrderLine>().Include(x => x.Order).SingleOrDefaultAsync(x => x.Id == lineId && x.Order!.CompetitionId == competitionId, ct);
        if (line == null) return NotFound();
        if (line.FulfilmentRevision != request.ExpectedVersion) return Conflict();
        if (await db.Set<ArrivalBookingSource>().AnyAsync(x => x.EventOrderLineId == lineId, ct)) return Conflict(new { message = "Remove this line from arrival bookings before changing its booking type." });
        line.FulfilmentKindSnapshot = request.Kind; line.FulfilmentFromDate = AppleFulfilment.HasNights(request) ? request.FromDate : null; line.FulfilmentUntilDate = AppleFulfilment.HasNights(request) ? request.UntilDate : null;
        line.FulfilmentRevision++; line.FulfilmentReviewedByUserId = UserId; line.FulfilmentReviewedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);  return NoContent();

        }, ct);
    }
    [HttpPost("{id:guid}/reconcile-legacy"), Authorize(Policy = CompetitionStaff.Policy), CompetitionAccess("competitionId")]
    public async Task<IActionResult> ReconcileLegacy(int competitionId, Guid id, [FromQuery] long expectedRevision, CancellationToken ct)
    {
        return await bookings.ExecuteAsync<IActionResult>(async () => {

        var booking = await bookings.LoadAsync(id, competitionId, ct); if (booking == null || booking.SignupId == null) return NotFound();
        if (booking.Revision != expectedRevision || booking.LegacyReconciledAt != null) return Conflict();
        var extras = await db.Set<MountedGames.Api.Entities.SignupExtras>().SingleOrDefaultAsync(x => x.SignupId == booking.SignupId, ct);
        if (extras == null) return NotFound();
        var current = await bookings.ProjectAsync(booking, ct);
        if (current.Benefits.Where(x => x.Kind == ArrivalFulfilmentKind.Stable && x.Status == "paid").Sum(x => x.Quantity) < extras.StablesCount
            || current.Benefits.Where(x => x.Kind == ArrivalFulfilmentKind.Hookup && x.Status == "paid").Sum(x => x.Quantity) < extras.HookupsCount)
            return Conflict(new { message = "Link the paid shop quantities before reconciling the old allocation." });
        booking.LegacyAllocationSnapshot = System.Text.Json.JsonSerializer.Serialize(new { extras.StablesCount, extras.HookupsCount, extras.StableAssignment, extras.HookupAssignment, ReviewedBy = UserId });
        booking.LegacyReconciledAt = DateTime.UtcNow; booking.Revision++; await db.SaveChangesAsync(ct);
        await bookings.RefreshPassAsync(booking, false, ct);  return Ok(await bookings.ProjectAsync(booking, ct));

        }, ct);
    }
}
