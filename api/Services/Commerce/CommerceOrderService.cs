using System.Data;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Commerce;

namespace MountedGames.Api.Services.Commerce;

public enum CreateOrderError
{
    None = 0,
    InvalidRequest,
    CompetitionNotFound,
    ListingUnavailable,
    OutOfStock,
    IdempotencyConflict,
}

public sealed record CreateOrderResult(EventOrder? Order, CreateOrderError Error, string? Message, bool Replayed = false);

public sealed class CommerceOrderService(AppDbContext db)
{
    public async Task<CreateOrderResult> CreateAsync(
        int competitionId,
        string buyerUserId,
        CreateEventOrderRequest request,
        CancellationToken cancellationToken)
    {
        var key = request.IdempotencyKey?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > 100)
            return Invalid("An idempotency key of at most 100 characters is required.");
        if (request.Items is null || request.Items.Count == 0)
            return Invalid("At least one item is required.");
        if (request.Items.Count > 50)
            return Invalid("An order cannot contain more than 50 lines.");
        if (request.Items.Any(x => x.ListingId <= 0 || x.Quantity is < 1 or > 99))
            return Invalid("Each item needs a valid listing and a quantity from 1 to 99.");

        var grouped = request.Items
            .GroupBy(x => x.ListingId)
            .Select(g => new CreateEventOrderLineRequest(g.Key, g.Sum(x => x.Quantity)))
            .OrderBy(x => x.ListingId)
            .ToList();
        if (grouped.Any(x => x.Quantity > 99))
            return Invalid("The total quantity for one listing cannot exceed 99.");

        var requestHash = Hash(competitionId, grouped);
        var replay = await LoadByIdempotencyKeyAsync(buyerUserId, key, cancellationToken);
        if (replay is not null)
            return replay.RequestHash == requestHash
                ? new CreateOrderResult(replay, CreateOrderError.None, null, true)
                : new CreateOrderResult(null, CreateOrderError.IdempotencyConflict, "That idempotency key was already used for a different order.");

        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
            try
            {
                replay = await LoadByIdempotencyKeyAsync(buyerUserId, key, cancellationToken);
                if (replay is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return replay.RequestHash == requestHash
                        ? new CreateOrderResult(replay, CreateOrderError.None, null, true)
                        : new CreateOrderResult(null, CreateOrderError.IdempotencyConflict, "That idempotency key was already used for a different order.");
                }

                if (!await db.Competitions.AnyAsync(x => x.Id == competitionId, cancellationToken))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return new CreateOrderResult(null, CreateOrderError.CompetitionNotFound, "Competition not found.");
                }

                var listingIds = grouped.Select(x => x.ListingId).ToList();
                var listings = await db.Set<CompetitionListing>()
                    .Include(x => x.CatalogueItem)
                    .Where(x => listingIds.Contains(x.Id) && x.CompetitionId == competitionId)
                    .ToDictionaryAsync(x => x.Id, cancellationToken);
                if (listings.Count != listingIds.Count || listings.Values.Any(x =>
                        x.Status != CommerceListingStatus.Approved || x.CatalogueItem?.IsActive != true))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return new CreateOrderResult(null, CreateOrderError.ListingUnavailable, "One or more listings are no longer available.");
                }
                var totalMinor = grouped.Sum(x =>
                    (long)listings[x.ListingId].CatalogueItem!.PriceMinor * x.Quantity);
                if (totalMinor > 100_000_000)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return Invalid("The order total cannot exceed £1,000,000.");
                }

                var reservedStockByListing = new Dictionary<int, int>();
                foreach (var requested in grouped)
                {
                    var itemId = listings[requested.ListingId].CatalogueItemId;
                    var reserved = await db.Set<CatalogueItem>()
                        .Where(x => x.Id == itemId && x.IsActive &&
                            (x.StockQuantity == null || x.StockQuantity >= requested.Quantity))
                        .ExecuteUpdateAsync(setters => setters
                            .SetProperty(x => x.StockQuantity,
                                x => x.StockQuantity == null ? null : x.StockQuantity - requested.Quantity)
                            .SetProperty(x => x.Version, x => x.Version + 1)
                            .SetProperty(x => x.UpdatedAt, DateTime.UtcNow), cancellationToken);
                    if (reserved != 1)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return new CreateOrderResult(null, CreateOrderError.OutOfStock, "An item no longer has enough stock.");
                    }
                    var remainingStock = await db.Set<CatalogueItem>()
                        .Where(x => x.Id == itemId)
                        .Select(x => x.StockQuantity)
                        .SingleAsync(cancellationToken);
                    reservedStockByListing[requested.ListingId] = remainingStock.HasValue ? requested.Quantity : 0;
                }

                var isDemo = await db.Set<EventCommerceSettings>()
                    .Where(x => x.CompetitionId == competitionId)
                    .Select(x => x.IsDemo)
                    .SingleOrDefaultAsync(cancellationToken);
                var now = DateTime.UtcNow;
                var order = new EventOrder
                {
                    CompetitionId = competitionId,
                    BuyerUserId = buyerUserId,
                    IdempotencyKey = key,
                    RequestHash = requestHash,
                    Status = isDemo ? CommerceOrderStatus.AwaitingTestPayment : CommerceOrderStatus.AwaitingManualPayment,
                    HasStockReservation = true,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                if (isDemo) order.MarkAsTestOrder();
                foreach (var requested in grouped)
                {
                    var listing = listings[requested.ListingId];
                    var item = listing.CatalogueItem!;
                    order.Lines.Add(new EventOrderLine
                    {
                        CompetitionListingId = listing.Id,
                        CatalogueItemId = item.Id,
                        SellerUserId = listing.SellerUserId,
                        TitleSnapshot = item.Title,
                        UnitPriceMinorSnapshot = item.PriceMinor,
                        Quantity = requested.Quantity,
                        ReservedStockQuantity = reservedStockByListing[listing.Id],
                        LineTotalMinor = checked((int)((long)item.PriceMinor * requested.Quantity)),
                    });
                }
                order.TotalMinor = (int)totalMinor;
                if (order.TotalMinor == 0)
                {
                    order.Status = CommerceOrderStatus.Paid;
                    order.PaidAt = now;
                }
                db.Set<EventOrder>().Add(order);
                await db.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new CreateOrderResult(await LoadAsync(order.Id, cancellationToken), CreateOrderError.None, null);
            }
            catch (DbUpdateException)
            {
                await transaction.RollbackAsync(cancellationToken);
                db.ChangeTracker.Clear();
                replay = await LoadByIdempotencyKeyAsync(buyerUserId, key, cancellationToken);
                if (replay is not null)
                    return replay.RequestHash == requestHash
                        ? new CreateOrderResult(replay, CreateOrderError.None, null, true)
                        : new CreateOrderResult(null, CreateOrderError.IdempotencyConflict, "That idempotency key was already used for a different order.");
                throw;
            }
        });
    }

    public Task<EventOrder?> LoadAsync(int orderId, CancellationToken cancellationToken) =>
        db.Set<EventOrder>()
            .Include(x => x.Lines)
            .Include(x => x.TestPayments)
            .SingleOrDefaultAsync(x => x.Id == orderId, cancellationToken);

    public async Task<bool> ReserveExistingLinesAsync(EventOrder order, CancellationToken cancellationToken)
    {
        foreach (var line in order.Lines)
        {
            var reserved = await db.Set<CatalogueItem>()
                .Where(x => x.Id == line.CatalogueItemId && x.IsActive &&
                    (x.StockQuantity == null || x.StockQuantity >= line.Quantity))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.StockQuantity,
                        x => x.StockQuantity == null ? null : x.StockQuantity - line.Quantity)
                    .SetProperty(x => x.Version, x => x.Version + 1)
                    .SetProperty(x => x.UpdatedAt, DateTime.UtcNow), cancellationToken);
            if (reserved != 1) return false;
            var remainingStock = await db.Set<CatalogueItem>()
                .Where(x => x.Id == line.CatalogueItemId)
                .Select(x => x.StockQuantity)
                .SingleAsync(cancellationToken);
            line.ReservedStockQuantity = remainingStock.HasValue ? line.Quantity : 0;
        }
        return true;
    }

    public async Task ReleaseLinesAsync(EventOrder order, CancellationToken cancellationToken)
    {
        foreach (var line in order.Lines)
        {
            if (line.ReservedStockQuantity <= 0) continue;
            await db.Set<CatalogueItem>()
                .Where(x => x.Id == line.CatalogueItemId && x.StockQuantity != null)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.StockQuantity, x => x.StockQuantity + line.ReservedStockQuantity)
                    .SetProperty(x => x.Version, x => x.Version + 1)
                    .SetProperty(x => x.UpdatedAt, DateTime.UtcNow), cancellationToken);
        }
    }

    private Task<EventOrder?> LoadByIdempotencyKeyAsync(
        string buyerUserId,
        string key,
        CancellationToken cancellationToken) =>
        db.Set<EventOrder>()
            .Include(x => x.Lines)
            .Include(x => x.TestPayments)
            .SingleOrDefaultAsync(x => x.BuyerUserId == buyerUserId && x.IdempotencyKey == key, cancellationToken);

    private static CreateOrderResult Invalid(string message) =>
        new(null, CreateOrderError.InvalidRequest, message);

    private static string Hash(int competitionId, IReadOnlyList<CreateEventOrderLineRequest> items)
    {
        var input = $"{competitionId}|{string.Join('|', items.Select(x => $"{x.ListingId}:{x.Quantity}"))}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input)));
    }
}
