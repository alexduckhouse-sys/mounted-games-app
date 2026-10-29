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
    /// <summary>The longest detail a buyer can give for an item's prompt (matches the column).</summary>
    public const int MaxDetailLength = 80;

    public async Task<CreateOrderResult> CreateAsync(
        int competitionId,
        string buyerUserId,
        CreateEventOrderRequest request,
        CancellationToken cancellationToken)
    {
        var key = request.IdempotencyKey?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > 100)
            return Invalid("Something went wrong sending that order. Refresh the page and try again.");
        if (request.Items is null || request.Items.Count == 0)
            return Invalid("At least one item is required.");
        if (request.Items.Count > 50)
            return Invalid("An order cannot contain more than 50 lines.");
        if (request.Items.Any(x => x is null || x.ListingId <= 0 || x.Quantity is < 1 or > 99))
            return Invalid("Each item needs a valid listing and a quantity from 1 to 99.");
        if (request.Items.Any(x => x.OptionId is <= 0))
            return Invalid("Each item needs a valid option.");

        if (request.Items.Any(x => x.Detail?.Trim().Length > MaxDetailLength))
            return Invalid($"Details can be at most {MaxDetailLength} characters.");
        // One line per listing and option, so an M and an L of the same hoodie are two lines.
        var byLine = request.Items
            .GroupBy(x => (x.ListingId, x.OptionId))
            .Select(g => new
            {
                g.Key.ListingId,
                g.Key.OptionId,
                Quantity = g.Sum(x => x.Quantity),
                Details = g.Select(x => x.Detail?.Trim()).Where(d => !string.IsNullOrEmpty(d)).Distinct().ToList(),
            })
            .OrderBy(x => x.ListingId)
            .ThenBy(x => x.OptionId ?? 0)
            .ToList();
        if (byLine.Any(x => x.Details.Count > 1))
            return Invalid("Send each item once, with a single detail.");
        var grouped = byLine
            .Select(x => new CreateEventOrderLineRequest(x.ListingId, x.Quantity, x.Details.SingleOrDefault(), x.OptionId))
            .ToList();
        if (grouped.GroupBy(x => x.ListingId).Any(g => g.Sum(x => x.Quantity) > 99))
            return Invalid("The total quantity for one listing cannot exceed 99.");

        var requestHash = Hash(competitionId, grouped);
        var replay = await LoadByIdempotencyKeyAsync(buyerUserId, key, cancellationToken);
        if (replay is not null)
            return replay.RequestHash == requestHash
                ? new CreateOrderResult(replay, CreateOrderError.None, null, true)
                : new CreateOrderResult(null, CreateOrderError.IdempotencyConflict, "This order is already being processed. Refresh the page and check your orders.");

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
                        : new CreateOrderResult(null, CreateOrderError.IdempotencyConflict, "This order is already being processed. Refresh the page and check your orders.");
                }

                if (!await db.Competitions.AnyAsync(x => x.Id == competitionId, cancellationToken))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return new CreateOrderResult(null, CreateOrderError.CompetitionNotFound, "Competition not found.");
                }

                var listingIds = grouped.Select(x => x.ListingId).Distinct().ToList();
                var listings = await db.Set<CompetitionListing>()
                    .Include(x => x.CatalogueItem).ThenInclude(x => x!.Options)
                    .Where(x => listingIds.Contains(x.Id) && x.CompetitionId == competitionId)
                    .ToDictionaryAsync(x => x.Id, cancellationToken);
                if (listings.Count != listingIds.Count || listings.Values.Any(x =>
                        x.Status != CommerceListingStatus.Approved || x.CatalogueItem?.IsActive != true))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return new CreateOrderResult(null, CreateOrderError.ListingUnavailable, "One or more listings are no longer available.");
                }
                // An item that asks the buyer for something (a stable number, a number plate) needs an answer.
                foreach (var requested in grouped)
                {
                    var asked = listings[requested.ListingId].CatalogueItem!;
                    if (string.IsNullOrWhiteSpace(asked.DetailPrompt) || !string.IsNullOrWhiteSpace(requested.Detail)) continue;
                    await transaction.RollbackAsync(cancellationToken);
                    return Invalid($"Enter the {Lower(asked.DetailPrompt)} for {asked.Title}.");
                }
                // An item with options (sizes) needs one of them, and only its own; an item without takes none.
                foreach (var requested in grouped)
                {
                    var item = listings[requested.ListingId].CatalogueItem!;
                    if (item.Options.Count > 0 && requested.OptionId is null)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return Invalid($"Choose a size or option for {item.Title}.");
                    }
                    if (requested.OptionId is int optionId && item.Options.All(x => x.Id != optionId))
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return new CreateOrderResult(null, CreateOrderError.ListingUnavailable,
                            $"That option of {item.Title} is no longer available. Refresh the shop and choose again.");
                    }
                }
                var totalMinor = grouped.Sum(x =>
                    (long)listings[x.ListingId].CatalogueItem!.PriceMinor * x.Quantity);
                if (totalMinor > 100_000_000)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return Invalid("The order total cannot exceed £1,000,000.");
                }

                var requestedStables = 0;
                var requestedHookups = 0;
                foreach (var requested in grouped)
                {
                    var item = listings[requested.ListingId].CatalogueItem!;
                    var kind = item.FulfilmentKind;
                    if (VenueCapacity.ReservesStable(kind, item.Title)) requestedStables += requested.Quantity;
                    if (VenueCapacity.ReservesHookup(kind, item.Title)) requestedHookups += requested.Quantity;
                }
                if (requestedStables > 0 || requestedHookups > 0)
                {
                    var capacity = await VenueCapacity.GetCapacityAsync(db, competitionId, ct: cancellationToken);
                    var capErr = VenueCapacity.CheckCapacityError(capacity, requestedStables, requestedHookups);
                    if (capErr is not null)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return new CreateOrderResult(null, CreateOrderError.OutOfStock, capErr);
                    }
                }

                var reservations = new List<Reservation>();
                foreach (var requested in grouped)
                {
                    var item = listings[requested.ListingId].CatalogueItem!;
                    var option = item.Options.SingleOrDefault(x => x.Id == requested.OptionId);
                    var reservation = await ReserveAsync(item.Id, item.Title, option?.Id, option?.Label, requested.Quantity, cancellationToken);
                    if (!reservation.Ok)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return new CreateOrderResult(null, CreateOrderError.OutOfStock, reservation.Message);
                    }
                    reservations.Add(reservation);
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
                foreach (var (requested, reservation) in grouped.Zip(reservations))
                {
                    var listing = listings[requested.ListingId];
                    var item = listing.CatalogueItem!;
                    var option = item.Options.SingleOrDefault(x => x.Id == requested.OptionId);
                    order.Lines.Add(new EventOrderLine
                    {
                        CompetitionListingId = listing.Id,
                        CatalogueItemId = item.Id,
                        SellerUserId = listing.SellerUserId,
                        TitleSnapshot = item.Title,
                        FulfilmentKindSnapshot = item.FulfilmentKind,
                        FulfilmentFromDate = item.FulfilmentFromDate,
                        FulfilmentUntilDate = item.FulfilmentUntilDate,
                        UnitPriceMinorSnapshot = item.PriceMinor,
                        Quantity = requested.Quantity,
                        // Only an item that asks for a detail keeps one.
                        Detail = string.IsNullOrWhiteSpace(item.DetailPrompt) ? null : requested.Detail?.Trim(),
                        ReservedStockQuantity = reservation.ItemQuantity,
                        CatalogueItemOptionId = option?.Id,
                        OptionLabel = option?.Label,
                        ReservedOptionStockQuantity = reservation.OptionQuantity,
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
                        : new CreateOrderResult(null, CreateOrderError.IdempotencyConflict, "This order is already being processed. Refresh the page and check your orders.");
                throw;
            }
        });
    }

    public Task<EventOrder?> LoadAsync(int orderId, CancellationToken cancellationToken) =>
        db.Set<EventOrder>()
            .Include(x => x.Lines)
            .Include(x => x.TestPayments)
            .SingleOrDefaultAsync(x => x.Id == orderId, cancellationToken);

    /// <summary>Reserves stock again for an order that let it go (a declined test payment being retried).</summary>
    /// <returns>Null when everything was reserved, otherwise what ran out, for the buyer. The caller rolls back.</returns>
    public async Task<string?> ReserveExistingLinesAsync(EventOrder order, CancellationToken cancellationToken)
    {
        var requestedStables = 0;
        var requestedHookups = 0;
        foreach (var line in order.Lines)
        {
            if (VenueCapacity.ReservesStable(line.FulfilmentKindSnapshot, line.TitleSnapshot)) requestedStables += line.Quantity;
            if (VenueCapacity.ReservesHookup(line.FulfilmentKindSnapshot, line.TitleSnapshot)) requestedHookups += line.Quantity;
        }
        if (requestedStables > 0 || requestedHookups > 0)
        {
            var capacity = await VenueCapacity.GetCapacityAsync(db, order.CompetitionId, excludeOrderId: order.Id, ct: cancellationToken);
            if (VenueCapacity.CheckCapacityError(capacity, requestedStables, requestedHookups) is { } capErr)
                return capErr;
        }
        foreach (var line in order.Lines)
        {
            var reservation = await ReserveAsync(
                line.CatalogueItemId, line.TitleSnapshot, line.CatalogueItemOptionId, line.OptionLabel, line.Quantity, cancellationToken);
            if (!reservation.Ok) return reservation.Message;
            line.ReservedStockQuantity = reservation.ItemQuantity;
            line.ReservedOptionStockQuantity = reservation.OptionQuantity;
        }
        return null;
    }

    /// <summary>Gives back the stock an order holds: to the item, and to the option (size) the line was for.</summary>
    public async Task ReleaseLinesAsync(EventOrder order, CancellationToken cancellationToken)
    {
        foreach (var line in order.Lines)
        {
            if (line.ReservedStockQuantity > 0)
                await db.Set<CatalogueItem>()
                    .Where(x => x.Id == line.CatalogueItemId && x.StockQuantity != null)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(x => x.StockQuantity, x => x.StockQuantity + line.ReservedStockQuantity)
                        .SetProperty(x => x.Version, x => x.Version + 1)
                        .SetProperty(x => x.UpdatedAt, DateTime.UtcNow), cancellationToken);
            if (line.ReservedOptionStockQuantity > 0 && line.CatalogueItemOptionId is int optionId)
                await db.Set<CatalogueItemOption>()
                    .Where(x => x.Id == optionId && x.CatalogueItemId == line.CatalogueItemId && x.StockQuantity != null)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(x => x.StockQuantity, x => x.StockQuantity + line.ReservedOptionStockQuantity)
                        .SetProperty(x => x.Version, x => x.Version + 1), cancellationToken);
        }
    }

    /// <param name="Ok">False when there wasn't enough stock; <paramref name="Message"/> says what ran out.</param>
    /// <param name="ItemQuantity">How much of the item's own stock was taken (0 when the item has no limit).</param>
    /// <param name="OptionQuantity">How much of the option's stock was taken (0 without an option or a limit).</param>
    private sealed record Reservation(bool Ok, int ItemQuantity, int OptionQuantity, string? Message = null);

    /// <summary>
    /// Takes <paramref name="quantity"/> from the item's stock and, for a line with an option, from that option's stock,
    /// each with one conditional update (the same guarded decrement and version bump for both), so two buyers can never
    /// take the last one. Runs inside the caller's serializable transaction, which rolls back on failure.
    /// </summary>
    private async Task<Reservation> ReserveAsync(
        int itemId,
        string title,
        int? optionId,
        string? optionLabel,
        int quantity,
        CancellationToken cancellationToken)
    {
        var reserved = await db.Set<CatalogueItem>()
            .Where(x => x.Id == itemId && x.IsActive &&
                (x.StockQuantity == null || x.StockQuantity >= quantity))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.StockQuantity,
                    x => x.StockQuantity == null ? null : x.StockQuantity - quantity)
                .SetProperty(x => x.Version, x => x.StockQuantity == null ? x.Version : x.Version + 1)
                .SetProperty(x => x.UpdatedAt, x => x.StockQuantity == null ? x.UpdatedAt : DateTime.UtcNow), cancellationToken);
        if (reserved != 1) return new Reservation(false, 0, 0, "An item no longer has enough stock.");
        var itemStock = await db.Set<CatalogueItem>()
            .Where(x => x.Id == itemId)
            .Select(x => x.StockQuantity)
            .SingleAsync(cancellationToken);
        var itemQuantity = itemStock.HasValue ? quantity : 0;
        if (optionId is not int id) return new Reservation(true, itemQuantity, 0);

        var reservedOption = await db.Set<CatalogueItemOption>()
            .Where(x => x.Id == id && x.CatalogueItemId == itemId &&
                (x.StockQuantity == null || x.StockQuantity >= quantity))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.StockQuantity,
                    x => x.StockQuantity == null ? null : x.StockQuantity - quantity)
                .SetProperty(x => x.Version, x => x.Version + 1), cancellationToken);
        var optionStock = await db.Set<CatalogueItemOption>()
            .Where(x => x.Id == id && x.CatalogueItemId == itemId)
            .Select(x => new { x.StockQuantity, x.Label })
            .SingleOrDefaultAsync(cancellationToken);
        if (reservedOption != 1)
        {
            var label = optionStock?.Label ?? optionLabel ?? "that option";
            var message = optionStock is null
                ? $"{title} in {label} is no longer available. Refresh the shop and choose again."
                : optionStock.StockQuantity is null or <= 0
                    ? $"{title} in {label} has sold out. Choose another option."
                    : $"Only {optionStock.StockQuantity} left of {title} in {label}. Lower the quantity and try again.";
            return new Reservation(false, 0, 0, message);
        }
        return new Reservation(true, itemQuantity, optionStock!.StockQuantity.HasValue ? quantity : 0);
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

    /// <summary>"Stable number" becomes "stable number" for the middle of a sentence; "FEI number" stays as it is.</summary>
    private static string Lower(string prompt)
    {
        var text = prompt.Trim();
        return text.Length > 1 && char.IsUpper(text[0]) && !char.IsUpper(text[1]) ? char.ToLowerInvariant(text[0]) + text[1..] : text;
    }

    private static string Hash(int competitionId, IReadOnlyList<CreateEventOrderLineRequest> items)
    {
        // The detail and option join the hash only when there is one, so older orders still replay.
        var input = $"{competitionId}|{string.Join('|', items.Select(x => $"{x.ListingId}:{x.Quantity}{(string.IsNullOrEmpty(x.Detail) ? "" : ":" + x.Detail)}{(x.OptionId is int option ? "@" + option : "")}"))}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input)));
    }
}
