using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Apple;
using MountedGames.Api.Entities.Commerce;
namespace MountedGames.Api.Services.Apple;

public sealed class ArrivalConflict(string message) : Exception(message);

public sealed class ArrivalBookingService(AppDbContext db, AppleOptions options, AppleSecrets secrets, TimeProvider clock)
{
    public Task<T> ExecuteAsync<T>(Func<Task<T>> action, CancellationToken ct) =>
        db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            // A retry repeats the complete transaction with fresh tracked entities.
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            // Lock the collection clock before reading entitlement; the using scope releases it even when this fails.
            await db.Set<AppleChangeClock>().Where(x => x.Id == 1).ExecuteUpdateAsync(s => s.SetProperty(x => x.Value, x => x.Value), ct);
            var result = await action();
            await transaction.CommitAsync(ct);
            return result;
        });

    public Task<ArrivalBooking?> LoadAsync(Guid id, int competitionId, CancellationToken ct) => db.Set<ArrivalBooking>()
        .Include(x => x.Sources).ThenInclude(x => x.Allocations)
        .SingleOrDefaultAsync(x => x.Id == id && x.CompetitionId == competitionId, ct);

    public async Task<ArrivalBookingDto> ProjectAsync(ArrivalBooking booking, CancellationToken ct)
    {
        var competition = await db.Competitions.AsNoTracking().SingleAsync(x => x.Id == booking.CompetitionId, ct);
        var demo = await db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == booking.CompetitionId && x.IsDemo, ct);
        var admission = "none"; var legacyNeedsReview = false;
        if (booking.SignupId is int signupId)
        {
            var signup = await db.SectionSignups.AsNoTracking().SingleOrDefaultAsync(x => x.Id == signupId && x.UserId == booking.OwnerUserId, ct);
            var extras = await db.Set<SignupExtras>().AsNoTracking().SingleOrDefaultAsync(x => x.SignupId == signupId, ct);
            legacyNeedsReview = booking.LegacyReconciledAt == null && extras != null &&
                (extras.StablesCount > 0 || extras.HookupsCount > 0 || !string.IsNullOrWhiteSpace(extras.StableAssignment) || !string.IsNullOrWhiteSpace(extras.HookupAssignment));
            admission = demo || signup == null || extras?.IsWithdrawn == true || extras?.IsWaitlist == true ? "unavailable"
                : signup.Status == SignupPaymentStatus.Paid ? "paid" : signup.Status == SignupPaymentStatus.Pending ? "pending" : "cancelled";
        }
        var ids = booking.Sources.Select(x => x.EventOrderLineId).ToArray();
        var lines = await db.Set<EventOrderLine>().AsNoTracking().Include(x => x.Order).Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        var totals = await db.Set<ArrivalBookingSource>().Where(x => ids.Contains(x.EventOrderLineId))
            .GroupBy(x => x.EventOrderLineId).Select(g => new { Id = g.Key, Quantity = g.Sum(x => x.Quantity) }).ToDictionaryAsync(x => x.Id, x => x.Quantity, ct);
        var benefits = new List<ArrivalBenefitDto>(); var needsReview = legacyNeedsReview;
        foreach (var source in booking.Sources.OrderBy(x => x.Id))
        {
            lines.TryGetValue(source.EventOrderLineId, out var line);
            var validOwner = line?.Order?.CompetitionId == booking.CompetitionId && line.Order.BuyerUserId == booking.OwnerUserId;
            var status = line is null || !validOwner || demo || line.Order!.IsTestOrder ? "unavailable"
                : line.FulfilmentKindSnapshot == ArrivalFulfilmentKind.Unclassified ? "review"
                : totals.GetValueOrDefault(line.Id) > line.Quantity ? "conflict"
                : line.Order.Status == CommerceOrderStatus.Paid ? "paid"
                : line.Order.Status == CommerceOrderStatus.AwaitingManualPayment ? "pending" : "cancelled";
            needsReview |= status is "review" or "conflict";
            var places = status == "paid" ? source.Allocations.OrderBy(x => x.Night).ThenBy(x => x.Resource)
                .Select(x => new ArrivalPlaceDto(x.Resource, x.Night)).ToList() : [];
            benefits.Add(new(source.Id, source.EventOrderLineId, line?.FulfilmentKindSnapshot ?? ArrivalFulfilmentKind.Unclassified,
                source.Quantity, status, line?.FulfilmentFromDate, line?.FulfilmentUntilDate, places));
        }
        if (benefits.Any(x => x.Kind == ArrivalFulfilmentKind.Admission && x.Status == "paid")) admission = "paid";
        var valid = admission == "paid" || benefits.Any(x => x.Status == "paid" && x.Kind is ArrivalFulfilmentKind.Stable or ArrivalFulfilmentKind.Hookup);
        return new(booking.Id, competition.Id, competition.Name, competition.StartDate, competition.EndDate, competition.Location,
            booking.VehicleRegistration, booking.Reference, booking.Revision, admission, benefits, needsReview,
            !valid || !competition.IsActive || competition.IsArchived, options.WalletReady, competition.Latitude, competition.Longitude, booking.SignupId);
    }

    public async Task<ArrivalBooking> SaveAsync(int competitionId, string owner, Guid? id, ArrivalBookingRequest request, CancellationToken ct)
    {
        var booking = id is null ? new ArrivalBooking { Id = Guid.NewGuid(), CompetitionId = competitionId, OwnerUserId = owner,
            Reference = AppleSecrets.NewToken() } : await LoadAsync(id.Value, competitionId, ct) ?? throw new ArrivalConflict("This booking is no longer available.");
        if (booking.OwnerUserId != owner) throw new ArrivalConflict("This booking is no longer available.");
        if (id != null && booking.Revision != request.ExpectedRevision) throw new ArrivalConflict("This booking changed. Refresh it and try again.");
        if (request.Sources.Select(x => x.OrderLineId).Distinct().Count() != request.Sources.Count) throw new ArrivalConflict("Choose each order line once.");
        if (request.SignupId is int signupId && !await db.SectionSignups.AnyAsync(x => x.Id == signupId && x.UserId == owner
            && x.Section!.CompetitionId == competitionId, ct)) throw new ArrivalConflict("That entry is not part of this booking.");
        if (request.SignupId is int used && await db.Set<ArrivalBooking>().AnyAsync(x => x.SignupId == used && x.Id != booking.Id, ct))
            throw new ArrivalConflict("That entry is already linked to an arrival booking.");
        var ids = request.Sources.Select(x => x.OrderLineId).ToArray();
        var lines = await db.Set<EventOrderLine>().Include(x => x.Order).Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        foreach (var requested in request.Sources)
        {
            if (!lines.TryGetValue(requested.OrderLineId, out var line) || line.Order?.CompetitionId != competitionId || line.Order.BuyerUserId != owner
                || line.Order.IsTestOrder || line.FulfilmentKindSnapshot is ArrivalFulfilmentKind.Unclassified or ArrivalFulfilmentKind.Other
                || (line.Order.Status is not (CommerceOrderStatus.Paid or CommerceOrderStatus.AwaitingManualPayment)
                    && !booking.Sources.Any(x => x.EventOrderLineId == line.Id && requested.Quantity <= x.Quantity)))
                throw new ArrivalConflict("That order line is not available for arrival bookings. Ask the organiser to check it.");
            var assigned = await db.Set<ArrivalBookingSource>().Where(x => x.EventOrderLineId == line.Id && x.ArrivalBookingId != booking.Id).SumAsync(x => x.Quantity, ct);
            if (requested.Quantity < 1 || requested.Quantity + assigned > line.Quantity) throw new ArrivalConflict("That quantity is already assigned to another vehicle.");
        }
        if (await db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == competitionId && x.IsDemo, ct)) throw new ArrivalConflict("Test events do not issue arrival passes.");
        booking.SignupId = request.SignupId ?? booking.SignupId; booking.VehicleRegistration = request.VehicleRegistration.Trim().ToUpperInvariant();
        foreach (var removed in booking.Sources.Where(x => !ids.Contains(x.EventOrderLineId)).ToArray()) { db.Remove(removed); booking.Sources.Remove(removed); }
        foreach (var requested in request.Sources)
        {
            var source = booking.Sources.SingleOrDefault(x => x.EventOrderLineId == requested.OrderLineId);
            if (source == null) booking.Sources.Add(new ArrivalBookingSource { EventOrderLineId = requested.OrderLineId, Quantity = requested.Quantity });
            else
            {
                if (source.Allocations.GroupBy(x => x.Night).Any(g => g.Count() > requested.Quantity)) throw new ArrivalConflict("Remove the extra allocations before reducing this quantity.");
                source.Quantity = requested.Quantity;
            }
        }
        booking.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        if (id == null) db.Add(booking); else booking.Revision++;
        await db.SaveChangesAsync(ct); await RefreshPassAsync(booking, false, ct);
        return booking;
    }

    public async Task AllocateAsync(ArrivalBooking booking, ArrivalAllocateRequest request, CancellationToken ct)
    {
        if (booking.Revision != request.ExpectedRevision) throw new ArrivalConflict("This booking changed. Refresh it and try again.");
        var projection = await ProjectAsync(booking, ct);
        foreach (var group in request.Allocations.GroupBy(x => new { x.SourceId, x.Night }))
        {
            var benefit = projection.Benefits.SingleOrDefault(x => x.SourceId == group.Key.SourceId);
            if (benefit == null || benefit.Status != "paid" || benefit.Kind is not (ArrivalFulfilmentKind.Stable or ArrivalFulfilmentKind.Hookup)
                || group.Count() > benefit.Quantity || !DateOnly.TryParseExact(group.Key.Night, "yyyy-MM-dd", out var night)
                || !DateOnly.TryParseExact(benefit.FromDate, "yyyy-MM-dd", out var from) || !DateOnly.TryParseExact(benefit.UntilDate, "yyyy-MM-dd", out var until)
                || night < from || night >= until) throw new ArrivalConflict("Check the paid quantity and booked nights before allocating.");
        }
        var sourceIds = booking.Sources.Select(x => x.Id).ToArray();
        await db.Set<ArrivalAllocation>().Where(x => sourceIds.Contains(x.ArrivalBookingSourceId)).ExecuteDeleteAsync(ct);
        foreach (var source in booking.Sources) source.Allocations.Clear();
        foreach (var allocation in request.Allocations)
        {
            var source = booking.Sources.Single(x => x.Id == allocation.SourceId);
            var benefit = projection.Benefits.Single(x => x.SourceId == source.Id);
            var resource = allocation.Resource.Trim().ToUpperInvariant();
            if (resource.Length == 0) throw new ArrivalConflict("Enter a stable or hook-up number.");
            source.Allocations.Add(new ArrivalAllocation { CompetitionId = booking.CompetitionId, Kind = (int)benefit.Kind, Resource = resource, Night = allocation.Night });
        }
        booking.Revision++; booking.UpdatedAt = clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(ct); await RefreshPassAsync(booking, false, ct);
    }

    // Caller holds the clock row lock for this entire transaction, including entitlement reads.
    public async Task<WalletPass?> RefreshPassAsync(ArrivalBooking booking, bool issue, CancellationToken ct)
    {
        var pass = await db.Set<WalletPass>().SingleOrDefaultAsync(x => x.ArrivalBookingId == booking.Id, ct);
        if (pass == null && !issue) return null;
        var projection = await ProjectAsync(booking, ct);
        if (issue && (projection.NeedsReview || projection.Voided)) throw new ArrivalConflict("This booking needs a check before a pass can be issued.");
        if (pass == null)
        {
            var token = AppleSecrets.NewToken();
            pass = new WalletPass { Id = Guid.NewGuid(), ArrivalBookingId = booking.Id, Serial = Guid.NewGuid().ToString("N"),
                ProtectedAuthenticationToken = secrets.Protect(token, "wallet-auth"), AuthenticationTokenHash = AppleSecrets.Hash(token) };
            db.Add(pass);
        }
        var hash = AppleSecrets.Hash(JsonSerializer.Serialize(projection));
        pass.LastCheckedAt = clock.GetUtcNow().UtcDateTime;
        if (pass.ContentHash == hash) { await db.SaveChangesAsync(ct); return pass; }
        await db.Set<AppleChangeClock>().Where(x => x.Id == 1).ExecuteUpdateAsync(s => s.SetProperty(x => x.Value, x => x.Value + 1), ct);
        var cursor = await db.Set<AppleChangeClock>().Where(x => x.Id == 1).Select(x => x.Value).SingleAsync(ct);
        pass.ContentHash = hash; pass.ChangeCursor = cursor; pass.Revision++; pass.ChangedAt = clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(ct);
        await db.Set<WalletDeviceRegistration>().Where(x => x.WalletPassId == pass.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PendingCursor, cursor)
            .SetProperty(x => x.NextAttemptAt, clock.GetUtcNow().UtcDateTime).SetProperty(x => x.Attempts, 0), ct);
        return pass;
    }
}
