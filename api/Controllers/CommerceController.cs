using System.Data;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Commerce;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/commerce")]
public class CommerceController(AppDbContext db) : ControllerBase
{
    private readonly CommerceOrderService _orders = new(db);
    private readonly IPaymentProvider _fakePayments = new FakePaymentProvider();

    [HttpGet("catalogue")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<CatalogueItemDto>>> Catalogue(CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var items = await db.Set<CatalogueItem>()
            .Where(x => x.SellerUserId == userId)
            .OrderByDescending(x => x.UpdatedAt)
            .ToListAsync(cancellationToken);
        return items.Select(x => x.ToDto()).ToList();
    }

    [HttpPost("catalogue")]
    [Authorize]
    public async Task<ActionResult<CatalogueItemDto>> CreateCatalogueItem(
        CreateCatalogueItemRequest request,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var error = ValidateCatalogueRequest(
            request.Title,
            request.Description,
            request.PriceMinor,
            request.StockQuantity,
            request.Category,
            request.ImageUrl,
            request.DetailPrompt,
            request.DetailHint,
            out var imageUrl,
            out var detailPrompt,
            out var detailHint);
        if (error is not null) return BadRequest(new { message = error });
        var now = DateTime.UtcNow;
        var item = new CatalogueItem
        {
            SellerUserId = userId,
            Title = request.Title!.Trim(),
            Description = request.Description!.Trim(),
            PriceMinor = request.PriceMinor,
            StockQuantity = request.StockQuantity,
            Category = request.Category,
            ImageUrl = imageUrl,
            DetailPrompt = detailPrompt,
            DetailHint = detailHint,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Set<CatalogueItem>().Add(item);
        await db.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(Catalogue), item.ToDto());
    }

    [HttpPut("catalogue/{id:int}")]
    [Authorize]
    public async Task<ActionResult<CatalogueItemDto>> UpdateCatalogueItem(
        int id,
        UpdateCatalogueItemRequest request,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var error = ValidateCatalogueRequest(
            request.Title,
            request.Description,
            request.PriceMinor,
            request.StockQuantity,
            request.Category,
            request.ImageUrl,
            request.DetailPrompt,
            request.DetailHint,
            out var imageUrl,
            out var detailPrompt,
            out var detailHint);
        if (error is not null) return BadRequest(new { message = error });
        if (request.ExpectedVersion < 1)
            return BadRequest(new { message = "The current catalogue item version is required." });
        return await InSerializableTransactionAsync<CatalogueItemDto>(async () =>
        {
            var item = await db.Set<CatalogueItem>().AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == id && x.SellerUserId == userId, cancellationToken);
            if (item is null) return NotFound();
            if (item.Version != request.ExpectedVersion)
                return Conflict(new { message = "This item changed after you opened it. Refresh the catalogue and try again." });

            var title = request.Title!.Trim();
            var description = request.Description!.Trim();
            var needsFreshApproval = item.Title != title || item.Description != description ||
                item.PriceMinor != request.PriceMinor || item.Category != request.Category ||
                item.ImageUrl != imageUrl || (!item.IsActive && request.IsActive);
            var now = DateTime.UtcNow;
            var updated = await db.Set<CatalogueItem>()
                .Where(x => x.Id == id && x.SellerUserId == userId && x.Version == request.ExpectedVersion)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.Title, title)
                    .SetProperty(x => x.Description, description)
                    .SetProperty(x => x.PriceMinor, request.PriceMinor)
                    .SetProperty(x => x.StockQuantity, request.StockQuantity)
                    .SetProperty(x => x.Category, request.Category)
                    .SetProperty(x => x.ImageUrl, imageUrl)
                    .SetProperty(x => x.DetailPrompt, detailPrompt)
                    .SetProperty(x => x.DetailHint, detailHint)
                    .SetProperty(x => x.IsActive, request.IsActive)
                    .SetProperty(x => x.Version, x => x.Version + 1)
                    .SetProperty(x => x.UpdatedAt, now), cancellationToken);
            if (updated != 1)
                return Conflict(new { message = "This item changed while you were saving it. Refresh the catalogue and try again." });

            if (needsFreshApproval && !User.IsInRole(Roles.Admin))
            {
                var approved = db.Set<CompetitionListing>()
                    .Where(x => x.CatalogueItemId == id && x.Status == CommerceListingStatus.Approved);
                if (User.IsInRole(Roles.Trainer))
                    approved = approved.Where(x => x.Competition!.CreatedByUserId == null ||
                        x.Competition.CreatedByUserId != userId);
                await approved.ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.Status, CommerceListingStatus.Pending)
                    .SetProperty(x => x.ReviewNote, (string?)null)
                    .SetProperty(x => x.ReviewedAt, (DateTime?)null)
                    .SetProperty(x => x.ReviewedByUserId, (string?)null)
                    .SetProperty(x => x.UpdatedAt, now), cancellationToken);
            }

            db.ChangeTracker.Clear();
            var saved = await db.Set<CatalogueItem>().AsNoTracking()
                .SingleAsync(x => x.Id == id, cancellationToken);
            return saved.ToDto();
        }, cancellationToken);
    }

    [HttpDelete("catalogue/{id:int}")]
    [Authorize]
    public async Task<IActionResult> ArchiveCatalogueItem(int id, CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var updated = await db.Set<CatalogueItem>()
            .Where(x => x.Id == id && x.SellerUserId == userId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.IsActive, false)
                .SetProperty(x => x.Version, x => x.Version + 1)
                .SetProperty(x => x.UpdatedAt, DateTime.UtcNow), cancellationToken);
        if (updated == 0) return NotFound();
        return NoContent();
    }

    [HttpPost("competitions/{competitionId:int}/listings")]
    [Authorize]
    public async Task<ActionResult<CompetitionListingDto>> SubmitListing(
        int competitionId,
        CreateCompetitionListingRequest request,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        if (!await db.Competitions.AnyAsync(x => x.Id == competitionId, cancellationToken)) return NotFound();
        var item = await db.Set<CatalogueItem>()
            .SingleOrDefaultAsync(x => x.Id == request.CatalogueItemId && x.SellerUserId == userId, cancellationToken);
        if (item is null) return NotFound();
        if (!item.IsActive) return Conflict(new { message = "Archived catalogue items cannot be submitted." });
        var autoApprove = await CanManageCompetitionAsync(competitionId, cancellationToken);
        var now = DateTime.UtcNow;
        var listing = await db.Set<CompetitionListing>()
            .Include(x => x.CatalogueItem)
            .SingleOrDefaultAsync(x => x.CompetitionId == competitionId && x.CatalogueItemId == item.Id, cancellationToken);
        if (listing is null)
        {
            listing = new CompetitionListing
            {
                CompetitionId = competitionId,
                CatalogueItemId = item.Id,
                CatalogueItem = item,
                SellerUserId = userId,
                CreatedAt = now,
            };
            db.Set<CompetitionListing>().Add(listing);
        }
        else if (listing.SellerUserId != userId)
        {
            return NotFound();
        }
        else if (listing.Status is CommerceListingStatus.Pending or CommerceListingStatus.Approved)
        {
            return listing.ToDto();
        }
        listing.Status = autoApprove ? CommerceListingStatus.Approved : CommerceListingStatus.Pending;
        listing.ReviewedAt = autoApprove ? now : null;
        listing.ReviewedByUserId = autoApprove ? userId : null;
        listing.ReviewNote = null;
        listing.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        return listing.ToDto();
    }

    [HttpGet("listings/mine")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<CompetitionListingDto>>> MyListings(CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var listings = await db.Set<CompetitionListing>()
            .Include(x => x.CatalogueItem)
            .Where(x => x.SellerUserId == userId)
            .OrderByDescending(x => x.UpdatedAt)
            .ToListAsync(cancellationToken);
        return listings.Select(x => x.ToDto()).ToList();
    }

    [HttpDelete("listings/{id:int}")]
    [Authorize]
    public async Task<IActionResult> WithdrawPendingListing(int id, CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var listing = await db.Set<CompetitionListing>()
            .SingleOrDefaultAsync(x => x.Id == id && x.SellerUserId == userId, cancellationToken);
        if (listing is null) return NotFound();
        if (listing.Status != CommerceListingStatus.Pending)
            return Conflict(new { message = "Only pending listings can be withdrawn by the seller." });
        listing.Status = CommerceListingStatus.Cancelled;
        listing.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpGet("competitions/{competitionId:int}/listings")]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<PublicCompetitionListingDto>>> PublicListings(
        int competitionId,
        CancellationToken cancellationToken)
    {
        if (!await db.Competitions.AnyAsync(x => x.Id == competitionId, cancellationToken)) return NotFound();
        var listings = await db.Set<CompetitionListing>()
            .AsNoTracking()
            .Include(x => x.CatalogueItem)
            .Where(x => x.CompetitionId == competitionId &&
                x.Status == CommerceListingStatus.Approved && x.CatalogueItem!.IsActive)
            .OrderBy(x => x.CatalogueItem!.Category)
            .ThenBy(x => x.CatalogueItem!.Title)
            .ToListAsync(cancellationToken);
        return listings.Select(x => x.ToPublicDto()).ToList();
    }

    [HttpGet("competitions/{competitionId:int}/listings/manage")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IReadOnlyList<CompetitionListingDto>>> ManageListings(
        int competitionId,
        CancellationToken cancellationToken)
    {
        var listings = await db.Set<CompetitionListing>()
            .Include(x => x.CatalogueItem)
            .Where(x => x.CompetitionId == competitionId)
            .OrderBy(x => x.Status)
            .ThenByDescending(x => x.UpdatedAt)
            .ToListAsync(cancellationToken);
        var names = await NamesAsync(listings.Select(x => x.SellerUserId), cancellationToken);
        return listings.Select(x => x.ToDto() with { SellerName = names.GetValueOrDefault(x.SellerUserId) }).ToList();
    }

    /// <summary>Event names for a set of competition ids, so a buyer or seller can see which event an order was for.</summary>
    private async Task<Dictionary<int, string>> EventNamesAsync(IEnumerable<int> competitionIds, CancellationToken cancellationToken)
    {
        var ids = competitionIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        return await db.Competitions
            .Where(x => ids.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => x.Name, cancellationToken);
    }

    /// <summary>Full names for a set of user ids, so organiser screens can say who is selling or buying.</summary>
    private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string> userIds, CancellationToken cancellationToken)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        return await db.Users
            .Where(x => ids.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => x.FullName, cancellationToken);
    }

    [HttpPut("listings/{id:int}/approval")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    public async Task<ActionResult<CompetitionListingDto>> ReviewListing(
        int id,
        UpdateCompetitionListingApprovalRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Status is not (CommerceListingStatus.Approved or CommerceListingStatus.Rejected))
            return BadRequest(new { message = "A listing can only be approved or rejected." });
        var listing = await db.Set<CompetitionListing>()
            .Include(x => x.CatalogueItem)
            .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (listing is null || !await CanManageCompetitionAsync(listing.CompetitionId, cancellationToken)) return NotFound();
        if (listing.Status == CommerceListingStatus.Cancelled)
            return Conflict(new { message = "The seller has withdrawn this listing." });
        listing.Status = request.Status;
        listing.ReviewNote = TrimOrNull(request.ReviewNote, 500);
        listing.ReviewedByUserId = CurrentUserId();
        listing.ReviewedAt = DateTime.UtcNow;
        listing.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return listing.ToDto();
    }

    [HttpGet("competitions/{competitionId:int}/settings")]
    [AllowAnonymous]
    public async Task<ActionResult<EventCommerceSettingsDto>> Settings(
        int competitionId,
        CancellationToken cancellationToken)
    {
        if (!await db.Competitions.AnyAsync(x => x.Id == competitionId, cancellationToken)) return NotFound();
        var settings = await db.Set<EventCommerceSettings>().AsNoTracking()
            .SingleOrDefaultAsync(x => x.CompetitionId == competitionId, cancellationToken);
        var locked = await IsDemoClassificationLockedAsync(competitionId, cancellationToken);
        return new EventCommerceSettingsDto(competitionId, settings?.IsDemo ?? false, locked, settings?.UpdatedAt);
    }

    [HttpPut("competitions/{competitionId:int}/settings")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<EventCommerceSettingsDto>> UpdateSettings(
        int competitionId,
        UpdateEventCommerceSettingsRequest request,
        CancellationToken cancellationToken)
    {
        return await InSerializableTransactionAsync<EventCommerceSettingsDto>(async () =>
        {
            var settings = await db.Set<EventCommerceSettings>()
                .SingleOrDefaultAsync(x => x.CompetitionId == competitionId, cancellationToken);
            var current = settings?.IsDemo ?? false;
            var locked = await IsDemoClassificationLockedAsync(competitionId, cancellationToken);
            if (locked && current != request.IsDemo)
                return Conflict(new { message = "Demo mode cannot change after an order or test payment exists." });
            // A real event must never become payable by test checkout: once it has priced entries, demo mode stays off.
            if (request.IsDemo && !current && await db.SectionSignups.AnyAsync(
                    x => x.Section!.CompetitionId == competitionId && x.AmountMinor > 0, cancellationToken))
                return Conflict(new { message = "Demo mode cannot be turned on once paid entries exist." });
            if (settings is null)
            {
                settings = new EventCommerceSettings { CompetitionId = competitionId };
                db.Set<EventCommerceSettings>().Add(settings);
            }
            settings.IsDemo = request.IsDemo;
            settings.UpdatedByUserId = CurrentUserId();
            settings.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return new EventCommerceSettingsDto(competitionId, settings.IsDemo, locked, settings.UpdatedAt);
        }, cancellationToken);
    }

    [HttpPost("competitions/{competitionId:int}/orders")]
    [Authorize]
    public async Task<ActionResult<EventOrderDto>> CreateOrder(
        int competitionId,
        CreateEventOrderRequest request,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var result = await _orders.CreateAsync(competitionId, userId, request, cancellationToken);
        if (result.Order is not null) return result.Order.ToDto();
        return result.Error switch
        {
            CreateOrderError.CompetitionNotFound => NotFound(),
            CreateOrderError.IdempotencyConflict or CreateOrderError.ListingUnavailable or CreateOrderError.OutOfStock
                => Conflict(new { message = result.Message }),
            _ => BadRequest(new { message = result.Message }),
        };
    }

    [HttpGet("orders/mine")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<EventOrderDto>>> MyOrders(CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var orders = await db.Set<EventOrder>()
            .Include(x => x.Lines)
            .Include(x => x.TestPayments)
            .Where(x => x.BuyerUserId == userId)
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
        var events = await EventNamesAsync(orders.Select(x => x.CompetitionId), cancellationToken);
        return orders.Select(x => x.ToDto() with { CompetitionName = events.GetValueOrDefault(x.CompetitionId) }).ToList();
    }

    [HttpGet("orders/{id:int}")]
    [Authorize]
    public async Task<ActionResult<EventOrderDto>> Order(int id, CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var order = await _orders.LoadAsync(id, cancellationToken);
        if (order is null || order.BuyerUserId != userId) return NotFound();
        var events = await EventNamesAsync([order.CompetitionId], cancellationToken);
        return order.ToDto() with { CompetitionName = events.GetValueOrDefault(order.CompetitionId) };
    }

    [HttpGet("sales/mine")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<SellerSaleDto>>> MySales(CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var orders = await db.Set<EventOrder>()
            .Include(x => x.Lines)
            .Where(x => x.Lines.Any(line => line.SellerUserId == userId))
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
        var events = await EventNamesAsync(orders.Select(x => x.CompetitionId), cancellationToken);
        return orders.Select(order =>
        {
            var lines = order.Lines.Where(x => x.SellerUserId == userId).OrderBy(x => x.Id).ToList();
            return new SellerSaleDto(
                order.Id,
                order.CompetitionId,
                order.Status,
                lines.Sum(x => x.LineTotalMinor),
                order.Currency,
                order.IsTestOrder,
                lines.Select(x => x.ToDto()).ToList(),
                order.CreatedAt,
                events.GetValueOrDefault(order.CompetitionId));
        }).ToList();
    }

    [HttpGet("competitions/{competitionId:int}/orders")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<IReadOnlyList<EventOrderDto>>> CompetitionOrders(
        int competitionId,
        CancellationToken cancellationToken)
    {
        var orders = await db.Set<EventOrder>()
            .Include(x => x.Lines)
            .Include(x => x.TestPayments)
            .Where(x => x.CompetitionId == competitionId)
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
        var names = await NamesAsync(orders.Select(x => x.BuyerUserId), cancellationToken);
        return orders.Select(x => x.ToDto() with { BuyerName = names.GetValueOrDefault(x.BuyerUserId) }).ToList();
    }

    [HttpPost("orders/{id:int}/cancel")]
    [Authorize]
    public async Task<ActionResult<EventOrderDto>> CancelOrder(int id, CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        return await InSerializableTransactionAsync<EventOrderDto>(async () =>
        {
            var order = await _orders.LoadAsync(id, cancellationToken);
            if (order is null) return NotFound();
            var isBuyer = order.BuyerUserId == userId;
            var isSeller = order.Lines.Count > 0 && order.Lines.All(line => line.SellerUserId == userId);
            var isOrganiser = await CanManageCompetitionAsync(order.CompetitionId, cancellationToken);
            if (!isBuyer && !isSeller && !isOrganiser) return NotFound();
            if (order.Status == CommerceOrderStatus.Cancelled) return order.ToDto();
            if (order.Status is not (CommerceOrderStatus.AwaitingManualPayment or CommerceOrderStatus.AwaitingTestPayment or CommerceOrderStatus.Declined))
                return Conflict(new { message = "This order can no longer be cancelled by the buyer." });
            if (order.HasStockReservation)
            {
                await _orders.ReleaseLinesAsync(order, cancellationToken);
                order.HasStockReservation = false;
            }
            order.Status = CommerceOrderStatus.Cancelled;
            order.CancelledAt = DateTime.UtcNow;
            order.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return (await _orders.LoadAsync(id, cancellationToken))!.ToDto();
        }, cancellationToken);
    }

    [HttpPost("orders/{id:int}/demo-checkout")]
    [Authorize]
    public async Task<ActionResult<DemoOrderPaymentResultDto>> DemoOrderCheckout(
        int id,
        FakeCheckoutRequest request,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var validation = ValidateFakeRequest(request);
        if (validation is not null) return BadRequest(new { message = validation });
        return await InSerializableTransactionAsync<DemoOrderPaymentResultDto>(async () =>
        {
            var order = await _orders.LoadAsync(id, cancellationToken);
            if (order is null || order.BuyerUserId != userId) return NotFound();
            if (!order.IsTestOrder || !await IsDemoAsync(order.CompetitionId, cancellationToken))
                return Conflict(new { message = "Fake checkout is available only for demo competitions." });
            var replay = await FindPaymentReplayAsync(userId, request.IdempotencyKey!, cancellationToken);
            if (replay is not null)
            {
                if (!Matches(replay, TestPaymentTarget.Order, id, TestPaymentOperation.Checkout, request.Outcome))
                    return Conflict(new { message = "That idempotency key was already used for a different payment action." });
                return new DemoOrderPaymentResultDto(order.ToDto(), replay.ToDto());
            }
            if (order.Status is CommerceOrderStatus.Paid or CommerceOrderStatus.Cancelled or CommerceOrderStatus.Refunded)
                return Conflict(new { message = "This order cannot start another test checkout." });

            if (request.Outcome == FakePaymentOutcome.Success && !order.HasStockReservation)
            {
                if (!await _orders.ReserveExistingLinesAsync(order, cancellationToken))
                    return Conflict(new { message = "An item no longer has enough stock for this retry." });
                order.HasStockReservation = true;
            }

            var providerResult = _fakePayments.Checkout(request.Outcome);
            if (providerResult.Status == TestPaymentStatus.Succeeded)
            {
                order.Status = CommerceOrderStatus.Paid;
                order.PaidAt = DateTime.UtcNow;
            }
            else if (providerResult.Status == TestPaymentStatus.Declined)
            {
                if (order.HasStockReservation)
                {
                    await _orders.ReleaseLinesAsync(order, cancellationToken);
                    order.HasStockReservation = false;
                }
                order.Status = CommerceOrderStatus.Declined;
            }
            else
            {
                if (order.HasStockReservation)
                {
                    await _orders.ReleaseLinesAsync(order, cancellationToken);
                    order.HasStockReservation = false;
                }
                order.Status = CommerceOrderStatus.Cancelled;
                order.CancelledAt = DateTime.UtcNow;
            }
            order.UpdatedAt = DateTime.UtcNow;
            var payment = NewTestPayment(
                order.CompetitionId,
                TestPaymentTarget.Order,
                order.Id,
                order.Id,
                userId,
                request.IdempotencyKey!,
                TestPaymentOperation.Checkout,
                request.Outcome,
                providerResult.Status,
                order.TotalMinor,
                providerResult.ReceiptReference);
            db.Set<TestPaymentRecord>().Add(payment);
            await db.SaveChangesAsync(cancellationToken);
            var loaded = (await _orders.LoadAsync(id, cancellationToken))!;
            return new DemoOrderPaymentResultDto(loaded.ToDto(), payment.ToDto());
        }, cancellationToken);
    }

    [HttpPost("orders/{id:int}/demo-refund")]
    [Authorize]
    public async Task<ActionResult<DemoOrderPaymentResultDto>> DemoOrderRefund(
        int id,
        FakeCheckoutRequest request,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var key = request.IdempotencyKey?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > 100)
            return BadRequest(new { message = "An idempotency key of at most 100 characters is required." });
        return await InSerializableTransactionAsync<DemoOrderPaymentResultDto>(async () =>
        {
            var order = await _orders.LoadAsync(id, cancellationToken);
            if (order is null || order.BuyerUserId != userId) return NotFound();
            if (!order.IsTestOrder || !await IsDemoAsync(order.CompetitionId, cancellationToken))
                return Conflict(new { message = "Fake refunds are available only for demo competitions." });
            var replay = await FindPaymentReplayAsync(userId, key, cancellationToken);
            if (replay is not null)
            {
                if (!Matches(replay, TestPaymentTarget.Order, id, TestPaymentOperation.Refund, null))
                    return Conflict(new { message = "That idempotency key was already used for a different payment action." });
                return new DemoOrderPaymentResultDto(order.ToDto(), replay.ToDto());
            }
            var paidPayment = order.TestPayments
                .FirstOrDefault(x => x.Operation == TestPaymentOperation.Checkout && x.Status == TestPaymentStatus.Succeeded);
            if (order.Status != CommerceOrderStatus.Paid || paidPayment is null)
                return Conflict(new { message = "Only a successful test payment can be refunded." });
            if (order.HasStockReservation)
            {
                await _orders.ReleaseLinesAsync(order, cancellationToken);
                order.HasStockReservation = false;
            }
            order.Status = CommerceOrderStatus.Refunded;
            order.RefundedAt = DateTime.UtcNow;
            order.UpdatedAt = DateTime.UtcNow;
            var payment = NewTestPayment(
                order.CompetitionId,
                TestPaymentTarget.Order,
                order.Id,
                order.Id,
                userId,
                key,
                TestPaymentOperation.Refund,
                null,
                TestPaymentStatus.Refunded,
                order.TotalMinor,
                $"TEST-REFUND-{Guid.NewGuid():N}".ToUpperInvariant(),
                paidPayment.Id);
            db.Set<TestPaymentRecord>().Add(payment);
            await db.SaveChangesAsync(cancellationToken);
            var loaded = (await _orders.LoadAsync(id, cancellationToken))!;
            return new DemoOrderPaymentResultDto(loaded.ToDto(), payment.ToDto());
        }, cancellationToken);
    }

    [HttpPost("orders/{id:int}/manual-payment")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    public async Task<ActionResult<EventOrderDto>> ConfirmManualPayment(
        int id,
        ConfirmManualPaymentRequest request,
        CancellationToken cancellationToken)
    {
        return await InSerializableTransactionAsync<EventOrderDto>(async () =>
        {
            var order = await _orders.LoadAsync(id, cancellationToken);
            if (order is null || !await CanManageCompetitionAsync(order.CompetitionId, cancellationToken)) return NotFound();
            if (order.IsTestOrder || await IsDemoAsync(order.CompetitionId, cancellationToken))
                return Conflict(new { message = "Demo orders must use the labelled test checkout." });
            if (!request.ConfirmedExternally)
                return BadRequest(new { message = "Confirm that the organiser received payment outside this app." });
            if (order.Status == CommerceOrderStatus.Paid) return order.ToDto();
            if (order.Status != CommerceOrderStatus.AwaitingManualPayment)
                return Conflict(new { message = "This order is not awaiting manual payment." });
            order.Status = CommerceOrderStatus.Paid;
            order.PaidAt = DateTime.UtcNow;
            order.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return order.ToDto();
        }, cancellationToken);
    }

    [HttpPost("orders/{id:int}/manual-refund")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    public async Task<ActionResult<EventOrderDto>> ConfirmManualRefund(
        int id,
        ConfirmManualPaymentRequest request,
        CancellationToken cancellationToken)
    {
        return await InSerializableTransactionAsync<EventOrderDto>(async () =>
        {
            var order = await _orders.LoadAsync(id, cancellationToken);
            if (order is null || !await CanManageCompetitionAsync(order.CompetitionId, cancellationToken)) return NotFound();
            if (order.IsTestOrder || await IsDemoAsync(order.CompetitionId, cancellationToken))
                return Conflict(new { message = "Demo orders must use the labelled test refund." });
            if (!request.ConfirmedExternally)
                return BadRequest(new { message = "Confirm that the organiser refunded payment outside this app." });
            if (order.Status == CommerceOrderStatus.Refunded) return order.ToDto();
            if (order.Status != CommerceOrderStatus.Paid)
                return Conflict(new { message = "Only a paid order can be refunded." });
            if (order.HasStockReservation)
            {
                await _orders.ReleaseLinesAsync(order, cancellationToken);
                order.HasStockReservation = false;
            }
            order.Status = CommerceOrderStatus.Refunded;
            order.RefundedAt = DateTime.UtcNow;
            order.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            return (await _orders.LoadAsync(id, cancellationToken))!.ToDto();
        }, cancellationToken);
    }

    [HttpPost("signups/{id:int}/demo-checkout")]
    [Authorize]
    public async Task<ActionResult<DemoEntryPaymentResultDto>> DemoEntryCheckout(
        int id,
        FakeCheckoutRequest request,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var validation = ValidateFakeRequest(request);
        if (validation is not null) return BadRequest(new { message = validation });
        return await InSerializableTransactionAsync<DemoEntryPaymentResultDto>(async () =>
        {
            var signup = await db.SectionSignups.Include(x => x.Section)
                .SingleOrDefaultAsync(x => x.Id == id && x.UserId == userId, cancellationToken);
            if (signup?.Section is null) return NotFound();
            var competitionId = signup.Section.CompetitionId;
            if (!await IsDemoAsync(competitionId, cancellationToken))
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "Test payments are available only for demo competitions." });
            if (signup.AmountMinor <= 0)
                return Conflict(new { message = "Free entries do not use checkout." });
            var replay = await FindPaymentReplayAsync(userId, request.IdempotencyKey!, cancellationToken);
            if (replay is not null)
            {
                if (!Matches(replay, TestPaymentTarget.SectionSignup, id, TestPaymentOperation.Checkout, request.Outcome))
                    return Conflict(new { message = "That idempotency key was already used for a different payment action." });
                return new DemoEntryPaymentResultDto(signup.Id, signup.Status, signup.PaidAt, replay.ToDto());
            }
            if (signup.Status != SignupPaymentStatus.Pending)
                return Conflict(new { message = "This entry is not awaiting payment." });
            var providerResult = _fakePayments.Checkout(request.Outcome);
            if (providerResult.Status == TestPaymentStatus.Succeeded)
            {
                signup.Status = SignupPaymentStatus.Paid;
                signup.PaidAt = DateTime.UtcNow;
            }
            var payment = NewTestPayment(
                competitionId,
                TestPaymentTarget.SectionSignup,
                signup.Id,
                null,
                userId,
                request.IdempotencyKey!,
                TestPaymentOperation.Checkout,
                request.Outcome,
                providerResult.Status,
                signup.AmountMinor,
                providerResult.ReceiptReference);
            db.Set<TestPaymentRecord>().Add(payment);
            await db.SaveChangesAsync(cancellationToken);
            return new DemoEntryPaymentResultDto(signup.Id, signup.Status, signup.PaidAt, payment.ToDto());
        }, cancellationToken);
    }

    [HttpGet("signups/{id:int}/demo-settings")]
    [Authorize]
    public async Task<ActionResult<EventCommerceSettingsDto>> EntryDemoSettings(
        int id,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var competitionId = await db.SectionSignups
            .Where(x => x.Id == id && x.UserId == userId)
            .Select(x => (int?)x.Section!.CompetitionId)
            .SingleOrDefaultAsync(cancellationToken);
        if (!competitionId.HasValue) return NotFound();
        var settings = await db.Set<EventCommerceSettings>().AsNoTracking()
            .SingleOrDefaultAsync(x => x.CompetitionId == competitionId.Value, cancellationToken);
        var locked = await IsDemoClassificationLockedAsync(competitionId.Value, cancellationToken);
        return new EventCommerceSettingsDto(
            competitionId.Value,
            settings?.IsDemo ?? false,
            locked,
            settings?.UpdatedAt);
    }

    [HttpPost("signups/{id:int}/demo-refund")]
    [Authorize]
    public async Task<ActionResult<DemoEntryPaymentResultDto>> DemoEntryRefund(
        int id,
        FakeCheckoutRequest request,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var key = request.IdempotencyKey?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > 100)
            return BadRequest(new { message = "An idempotency key of at most 100 characters is required." });
        return await InSerializableTransactionAsync<DemoEntryPaymentResultDto>(async () =>
        {
            var signup = await db.SectionSignups.Include(x => x.Section)
                .SingleOrDefaultAsync(x => x.Id == id && x.UserId == userId, cancellationToken);
            if (signup?.Section is null) return NotFound();
            var competitionId = signup.Section.CompetitionId;
            if (!await IsDemoAsync(competitionId, cancellationToken))
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "Test refunds are available only for demo competitions." });
            var replay = await FindPaymentReplayAsync(userId, key, cancellationToken);
            if (replay is not null)
            {
                if (!Matches(replay, TestPaymentTarget.SectionSignup, id, TestPaymentOperation.Refund, null))
                    return Conflict(new { message = "That idempotency key was already used for a different payment action." });
                return new DemoEntryPaymentResultDto(signup.Id, signup.Status, signup.PaidAt, replay.ToDto());
            }
            var paidPayment = await db.Set<TestPaymentRecord>()
                .Where(x => x.Target == TestPaymentTarget.SectionSignup && x.TargetId == id &&
                    x.Operation == TestPaymentOperation.Checkout && x.Status == TestPaymentStatus.Succeeded)
                .OrderBy(x => x.Id)
                .FirstOrDefaultAsync(cancellationToken);
            if (signup.Status != SignupPaymentStatus.Paid || paidPayment is null)
                return Conflict(new { message = "Only a successful test payment can be refunded." });
            signup.Status = SignupPaymentStatus.Refunded;
            signup.PaidAt = null;
            var payment = NewTestPayment(
                competitionId,
                TestPaymentTarget.SectionSignup,
                signup.Id,
                null,
                userId,
                key,
                TestPaymentOperation.Refund,
                null,
                TestPaymentStatus.Refunded,
                signup.AmountMinor,
                $"TEST-REFUND-{Guid.NewGuid():N}".ToUpperInvariant(),
                paidPayment.Id);
            db.Set<TestPaymentRecord>().Add(payment);
            await db.SaveChangesAsync(cancellationToken);
            return new DemoEntryPaymentResultDto(signup.Id, signup.Status, signup.PaidAt, payment.ToDto());
        }, cancellationToken);
    }

    [HttpGet("entry-payments/mine")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<TestPaymentDto>>> MyEntryPayments(CancellationToken cancellationToken)
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized();
        var payments = await db.Set<TestPaymentRecord>()
            .Where(x => x.OwnerUserId == userId && x.Target == TestPaymentTarget.SectionSignup)
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
        return payments.Select(x => x.ToDto()).ToList();
    }

    private string? CurrentUserId() => User.FindFirstValue(ClaimTypes.NameIdentifier);

    private async Task<ActionResult<T>> InSerializableTransactionAsync<T>(
        Func<Task<ActionResult<T>>> operation,
        CancellationToken cancellationToken)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            for (var attempt = 0; ; attempt++)
            {
                db.ChangeTracker.Clear();
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                try
                {
                    var result = await operation();
                    var statusCode = result.Result switch
                    {
                        StatusCodeResult status => status.StatusCode,
                        ObjectResult { StatusCode: not null } value => value.StatusCode.Value,
                        _ => StatusCodes.Status200OK,
                    };
                    if (statusCode < StatusCodes.Status400BadRequest)
                        await transaction.CommitAsync(cancellationToken);
                    else
                        await transaction.RollbackAsync(cancellationToken);
                    return result;
                }
                catch (DbUpdateException) when (attempt == 0)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    // A concurrent request may have inserted the same idempotency key.
                    // Reload once so the operation can return that immutable result.
                }
            }
        });
    }

    private Task<bool> CanManageCompetitionAsync(int competitionId, CancellationToken cancellationToken) =>
        db.CanManageAsync(User, competitionId, cancellationToken);

    private Task<bool> IsDemoAsync(int competitionId, CancellationToken cancellationToken) =>
        db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == competitionId && x.IsDemo, cancellationToken);

    private async Task<bool> IsDemoClassificationLockedAsync(int competitionId, CancellationToken cancellationToken) =>
        await db.Set<EventOrder>().AnyAsync(x => x.CompetitionId == competitionId, cancellationToken) ||
        await db.Set<TestPaymentRecord>().AnyAsync(x => x.CompetitionId == competitionId, cancellationToken);

    private Task<TestPaymentRecord?> FindPaymentReplayAsync(
        string userId,
        string key,
        CancellationToken cancellationToken) =>
        db.Set<TestPaymentRecord>().SingleOrDefaultAsync(
            x => x.OwnerUserId == userId && x.IdempotencyKey == key.Trim(), cancellationToken);

    private static bool Matches(
        TestPaymentRecord payment,
        TestPaymentTarget target,
        int targetId,
        TestPaymentOperation operation,
        FakePaymentOutcome? outcome) =>
        payment.Target == target && payment.TargetId == targetId && payment.Operation == operation &&
        payment.RequestedOutcome == outcome;

    private static TestPaymentRecord NewTestPayment(
        int competitionId,
        TestPaymentTarget target,
        int targetId,
        int? eventOrderId,
        string ownerUserId,
        string idempotencyKey,
        TestPaymentOperation operation,
        FakePaymentOutcome? outcome,
        TestPaymentStatus status,
        int amountMinor,
        string receiptReference,
        int? relatedPaymentId = null) => new()
        {
            CompetitionId = competitionId,
            Target = target,
            TargetId = targetId,
            EventOrderId = eventOrderId,
            OwnerUserId = ownerUserId,
            IdempotencyKey = idempotencyKey.Trim(),
            Operation = operation,
            RequestedOutcome = outcome,
            Status = status,
            AmountMinor = amountMinor,
            ReceiptReference = receiptReference,
            RelatedPaymentId = relatedPaymentId,
        };

    private static string? ValidateFakeRequest(FakeCheckoutRequest request)
    {
        var key = request.IdempotencyKey?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > 100)
            return "An idempotency key of at most 100 characters is required.";
        return Enum.IsDefined(request.Outcome) ? null : "Invalid test outcome.";
    }

    private static string? ValidateCatalogueRequest(
        string? title,
        string? description,
        int priceMinor,
        int? stockQuantity,
        CommerceItemCategory category,
        string? imageUrl,
        string? detailPrompt,
        string? detailHint,
        out string? normalisedImageUrl,
        out string? normalisedPrompt,
        out string? normalisedHint)
    {
        normalisedImageUrl = TrimOrNull(imageUrl, 2048);
        normalisedPrompt = detailPrompt?.Trim();
        normalisedHint = detailHint?.Trim();
        if (string.IsNullOrEmpty(normalisedPrompt)) normalisedPrompt = null;
        if (string.IsNullOrEmpty(normalisedHint)) normalisedHint = null;
        if (normalisedPrompt?.Length > 60)
            return "What you ask the buyer for must be at most 60 characters.";
        if (normalisedHint?.Length > 80)
            return "The hint must be at most 80 characters.";
        // A hint with no question has nowhere to show, so it is dropped rather than kept out of sight.
        if (normalisedPrompt is null) normalisedHint = null;
        if (string.IsNullOrWhiteSpace(title) || title.Trim().Length > 200)
            return "Title is required and must be at most 200 characters.";
        if (string.IsNullOrWhiteSpace(description) || description.Trim().Length > 4000)
            return "Description is required and must be at most 4,000 characters.";
        if (priceMinor is < 0 or > 100_000_000)
            return "Price must be between £0 and £1,000,000.";
        if (stockQuantity is < 0)
            return "Stock cannot be negative.";
        if (!Enum.IsDefined(category))
            return "Invalid item category.";
        if (normalisedImageUrl is not null &&
            (!Uri.TryCreate(normalisedImageUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps))
            return "Image URL must be an absolute HTTPS URL.";
        return null;
    }

    private static string? TrimOrNull(string? value, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }
}
