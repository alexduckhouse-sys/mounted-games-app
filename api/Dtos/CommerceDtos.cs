using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;

namespace MountedGames.Api.Dtos;

public record CreateCatalogueItemRequest(
    string? Title,
    string? Description,
    int PriceMinor,
    int? StockQuantity,
    CommerceItemCategory Category,
    string? ImageUrl,
    string? DetailPrompt = null,
    string? DetailHint = null,
    IReadOnlyList<CatalogueItemOptionInput>? Options = null);

/// <param name="Id">An existing option's id, to keep it (and its sales) when editing; null for a new option.</param>
/// <param name="StockQuantity">Stock for this option alone; null means no limit.</param>
public record CatalogueItemOptionInput(int? Id, string? Label, int? StockQuantity);

public record CatalogueItemOptionDto(int Id, string Label, int? StockQuantity);

public record UpdateCatalogueItemRequest(
    string? Title,
    string? Description,
    int PriceMinor,
    int? StockQuantity,
    CommerceItemCategory Category,
    string? ImageUrl,
    bool IsActive,
    long ExpectedVersion,
    string? DetailPrompt = null,
    string? DetailHint = null,
    // Null leaves the options as they are; an empty list removes them all.
    IReadOnlyList<CatalogueItemOptionInput>? Options = null);

public record CatalogueItemDto(
    int Id,
    string Title,
    string Description,
    int PriceMinor,
    string Currency,
    int? StockQuantity,
    CommerceItemCategory Category,
    string? ImageUrl,
    bool IsActive,
    long Version,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? DetailPrompt = null,
    string? DetailHint = null,
    IReadOnlyList<CatalogueItemOptionDto>? Options = null);

public record CreateCompetitionListingRequest(int CatalogueItemId);

public record UpdateCompetitionListingApprovalRequest(CommerceListingStatus Status, string? ReviewNote);

public record CompetitionListingDto(
    int Id,
    int CompetitionId,
    int CatalogueItemId,
    string SellerUserId,
    CommerceListingStatus Status,
    string? ReviewNote,
    DateTime? ReviewedAt,
    CatalogueItemDto Item,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? SellerName = null);

public record PublicCompetitionListingDto(
    int Id,
    int CompetitionId,
    int CatalogueItemId,
    string Title,
    string Description,
    int PriceMinor,
    string Currency,
    int? StockQuantity,
    CommerceItemCategory Category,
    string? ImageUrl,
    string? DetailPrompt = null,
    string? DetailHint = null,
    IReadOnlyList<CatalogueItemOptionDto>? Options = null);

public record EventCommerceSettingsDto(
    int CompetitionId,
    bool IsDemo,
    bool IsLocked,
    DateTime? UpdatedAt,
    int? MaxStables = null,
    int? MaxHookups = null,
    int StablesBooked = 0,
    int HookupsBooked = 0,
    int? StablesRemaining = null,
    int? HookupsRemaining = null);

public record UpdateEventCommerceSettingsRequest(bool IsDemo);

/// <param name="Detail">What the buyer typed for the item's <c>DetailPrompt</c>, at most 80 characters.</param>
/// <param name="OptionId">The chosen option (size) when the item has options; required then, and refused otherwise.</param>
/// <param name="ExpectedUnitPriceMinor">The unit price in pence the buyer was shown. When sent and the price has changed since, the order is refused (409) with the new price. Optional, so older clients still work.</param>
public record CreateEventOrderLineRequest(int ListingId, int Quantity, string? Detail = null, int? OptionId = null, int? ExpectedUnitPriceMinor = null);

public record CreateEventOrderRequest(string? IdempotencyKey, IReadOnlyList<CreateEventOrderLineRequest>? Items);

public record EventOrderLineDto(
    int Id,
    int ListingId,
    int CatalogueItemId,
    string SellerUserId,
    string Title,
    int UnitPriceMinor,
    int Quantity,
    int LineTotalMinor,
    string? Detail = null,
    int? OptionId = null,
    string? OptionLabel = null);

public record EventOrderDto(
    int Id,
    int CompetitionId,
    string BuyerUserId,
    CommerceOrderStatus Status,
    int TotalMinor,
    string Currency,
    bool IsTestOrder,
    bool HasStockReservation,
    DateTime? PaidAt,
    DateTime? CancelledAt,
    DateTime? RefundedAt,
    IReadOnlyList<EventOrderLineDto> Lines,
    IReadOnlyList<TestPaymentDto> TestPayments,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? BuyerName = null,
    string? CompetitionName = null);

public record SellerSaleDto(
    int OrderId,
    int CompetitionId,
    CommerceOrderStatus Status,
    int SellerTotalMinor,
    string Currency,
    bool IsTestOrder,
    IReadOnlyList<EventOrderLineDto> Lines,
    DateTime CreatedAt,
    string? CompetitionName = null);

public record FakeCheckoutRequest(string? IdempotencyKey, FakePaymentOutcome Outcome);

public record TestPaymentDto(
    int Id,
    int CompetitionId,
    TestPaymentTarget Target,
    int TargetId,
    TestPaymentOperation Operation,
    FakePaymentOutcome? RequestedOutcome,
    TestPaymentStatus Status,
    int AmountMinor,
    string Currency,
    bool IsTest,
    string Provider,
    string ReceiptReference,
    string ReceiptLabel,
    DateTime CreatedAt);

public record DemoOrderPaymentResultDto(EventOrderDto Order, TestPaymentDto Payment);

public record DemoEntryPaymentResultDto(
    int SignupId,
    SignupPaymentStatus SignupStatus,
    DateTime? PaidAt,
    TestPaymentDto Payment);

public record ConfirmManualPaymentRequest(bool ConfirmedExternally);

internal static class CommerceDtoMappings
{
    public static CatalogueItemDto ToDto(this CatalogueItem item) => new(
        item.Id,
        item.Title,
        item.Description,
        item.PriceMinor,
        item.Currency,
        item.StockQuantity,
        item.Category,
        item.ImageUrl,
        item.IsActive,
        item.Version,
        item.CreatedAt,
        item.UpdatedAt,
        item.DetailPrompt,
        item.DetailHint,
        item.Options.ToDtos());

    public static IReadOnlyList<CatalogueItemOptionDto> ToDtos(this IEnumerable<CatalogueItemOption> options) =>
        options.OrderBy(x => x.SortOrder).ThenBy(x => x.Id).Select(x => new CatalogueItemOptionDto(x.Id, x.Label, x.StockQuantity)).ToList();

    public static CompetitionListingDto ToDto(this CompetitionListing listing) => new(
        listing.Id,
        listing.CompetitionId,
        listing.CatalogueItemId,
        listing.SellerUserId,
        listing.Status,
        listing.ReviewNote,
        listing.ReviewedAt,
        listing.CatalogueItem!.ToDto(),
        listing.CreatedAt,
        listing.UpdatedAt);

    public static PublicCompetitionListingDto ToPublicDto(this CompetitionListing listing) => new(
        listing.Id,
        listing.CompetitionId,
        listing.CatalogueItemId,
        listing.CatalogueItem!.Title,
        listing.CatalogueItem.Description,
        listing.CatalogueItem.PriceMinor,
        listing.CatalogueItem.Currency,
        listing.CatalogueItem.StockQuantity,
        listing.CatalogueItem.Category,
        listing.CatalogueItem.ImageUrl,
        listing.CatalogueItem.DetailPrompt,
        listing.CatalogueItem.DetailHint,
        listing.CatalogueItem.Options.ToDtos());

    public static EventOrderLineDto ToDto(this EventOrderLine line) => new(
        line.Id,
        line.CompetitionListingId,
        line.CatalogueItemId,
        line.SellerUserId,
        line.TitleSnapshot,
        line.UnitPriceMinorSnapshot,
        line.Quantity,
        line.LineTotalMinor,
        line.Detail,
        line.CatalogueItemOptionId,
        line.OptionLabel);

    public static TestPaymentDto ToDto(this TestPaymentRecord payment) => new(
        payment.Id,
        payment.CompetitionId,
        payment.Target,
        payment.TargetId,
        payment.Operation,
        payment.RequestedOutcome,
        payment.Status,
        payment.AmountMinor,
        payment.Currency,
        payment.IsTest,
        payment.Provider,
        payment.ReceiptReference,
        payment.ReceiptLabel,
        payment.CreatedAt);

    public static EventOrderDto ToDto(this EventOrder order) => new(
        order.Id,
        order.CompetitionId,
        order.BuyerUserId,
        order.Status,
        order.TotalMinor,
        order.Currency,
        order.IsTestOrder,
        order.HasStockReservation,
        order.PaidAt,
        order.CancelledAt,
        order.RefundedAt,
        order.Lines.OrderBy(x => x.Id).Select(x => x.ToDto()).ToList(),
        order.TestPayments.OrderBy(x => x.Id).Select(x => x.ToDto()).ToList(),
        order.CreatedAt,
        order.UpdatedAt);
}
