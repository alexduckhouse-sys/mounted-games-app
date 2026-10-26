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
    string? DetailHint = null);

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
    string? DetailHint = null);

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
    string? DetailHint = null);

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
    string? DetailHint = null);

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
public record CreateEventOrderLineRequest(int ListingId, int Quantity, string? Detail = null);

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
    string? Detail = null);

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
        item.DetailHint);

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
        listing.CatalogueItem.DetailHint);

    public static EventOrderLineDto ToDto(this EventOrderLine line) => new(
        line.Id,
        line.CompetitionListingId,
        line.CatalogueItemId,
        line.SellerUserId,
        line.TitleSnapshot,
        line.UnitPriceMinorSnapshot,
        line.Quantity,
        line.LineTotalMinor,
        line.Detail);

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
