namespace MountedGames.Api.Entities.Commerce;

public enum CommerceItemCategory
{
    Merchandise = 0,
    Ticket = 1,
    Camping = 2,
    Other = 3,
}

public enum CommerceListingStatus
{
    Pending = 0,
    Approved = 1,
    Rejected = 2,
    Cancelled = 3,
}

public enum CommerceOrderStatus
{
    AwaitingManualPayment = 0,
    AwaitingTestPayment = 1,
    Paid = 2,
    Declined = 3,
    Cancelled = 4,
    Refunded = 5,
}

public enum TestPaymentTarget
{
    Order = 0,
    SectionSignup = 1,
}

public enum TestPaymentOperation
{
    Checkout = 0,
    Refund = 1,
}

public enum FakePaymentOutcome
{
    Success = 0,
    Decline = 1,
    Cancel = 2,
}

public enum TestPaymentStatus
{
    Succeeded = 0,
    Declined = 1,
    Cancelled = 2,
    Refunded = 3,
}

public class CatalogueItem
{
    public int Id { get; set; }
    public string SellerUserId { get; set; } = string.Empty;
    public AppUser? Seller { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public int PriceMinor { get; set; }
    public string Currency { get; private set; } = "GBP";
    public int? StockQuantity { get; set; }
    public CommerceItemCategory Category { get; set; }
    public string? ImageUrl { get; set; }
    /// <summary>What the buyer is asked for with this item, such as "Stable number" (at most 60 characters). Null means nothing is asked.</summary>
    public string? DetailPrompt { get; set; }
    /// <summary>The hint shown inside that field (at most 80 characters).</summary>
    public string? DetailHint { get; set; }
    public bool IsActive { get; set; } = true;
    public long Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>The choices the seller offers, such as sizes ("S", "M", "Age 9-10"). Empty means the item has no options.</summary>
    public ICollection<CatalogueItemOption> Options { get; set; } = new List<CatalogueItemOption>();
}

/// <summary>
/// One choice of a catalogue item (a size, usually), set by the seller. When it has stock, orders reserve and release it
/// here, the same way as <see cref="CatalogueItem.StockQuantity"/>; null stock means no limit for this option.
/// </summary>
public class CatalogueItemOption
{
    /// <summary>The longest label a seller can give an option (matches the column).</summary>
    public const int MaxLabelLength = 40;
    /// <summary>The most options one item can have.</summary>
    public const int MaxOptions = 30;

    public int Id { get; set; }
    public int CatalogueItemId { get; set; }
    public CatalogueItem? CatalogueItem { get; set; }
    public string Label { get; set; } = string.Empty;
    public int? StockQuantity { get; set; }
    public int SortOrder { get; set; }
    public long Version { get; set; } = 1;
}

public class CompetitionListing
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public int CatalogueItemId { get; set; }
    public CatalogueItem? CatalogueItem { get; set; }
    public string SellerUserId { get; set; } = string.Empty;
    public CommerceListingStatus Status { get; set; } = CommerceListingStatus.Pending;
    public string? ReviewNote { get; set; }
    public string? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class EventCommerceSettings
{
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public bool IsDemo { get; set; }
    public string? UpdatedByUserId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class EventOrder
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public string BuyerUserId { get; set; } = string.Empty;
    public AppUser? Buyer { get; set; }
    public string IdempotencyKey { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public CommerceOrderStatus Status { get; set; }
    public int TotalMinor { get; set; }
    public string Currency { get; private set; } = "GBP";
    public bool IsTestOrder { get; private set; }
    public bool HasStockReservation { get; set; }
    public DateTime? PaidAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    public DateTime? RefundedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<EventOrderLine> Lines { get; set; } = new List<EventOrderLine>();
    public ICollection<TestPaymentRecord> TestPayments { get; set; } = new List<TestPaymentRecord>();

    public void MarkAsTestOrder() => IsTestOrder = true;
}

public class EventOrderLine
{
    public int Id { get; set; }
    public int EventOrderId { get; set; }
    public EventOrder? Order { get; set; }
    public int CompetitionListingId { get; set; }
    public int CatalogueItemId { get; set; }
    public string SellerUserId { get; set; } = string.Empty;
    public string TitleSnapshot { get; set; } = string.Empty;
    public int UnitPriceMinorSnapshot { get; set; }
    public int Quantity { get; set; }
    public int ReservedStockQuantity { get; set; }
    public int LineTotalMinor { get; set; }
    /// <summary>What the buyer typed for the item's <see cref="CatalogueItem.DetailPrompt"/> (at most 80 characters). Null when nothing was asked.</summary>
    public string? Detail { get; set; }
    /// <summary>The option the buyer chose (see <see cref="CatalogueItemOption"/>). Null when the item has no options.</summary>
    public int? CatalogueItemOptionId { get; set; }
    /// <summary>The option's label when the order was made ("M"), kept even if the seller later renames or removes it.</summary>
    public string? OptionLabel { get; set; }
    /// <summary>How much of the option's own stock this line holds; released back to that option on cancel or refund.</summary>
    public int ReservedOptionStockQuantity { get; set; }
}

public class TestPaymentRecord
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public TestPaymentTarget Target { get; set; }
    public int TargetId { get; set; }
    public int? EventOrderId { get; set; }
    public EventOrder? EventOrder { get; set; }
    public string OwnerUserId { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;
    public TestPaymentOperation Operation { get; set; }
    public FakePaymentOutcome? RequestedOutcome { get; set; }
    public TestPaymentStatus Status { get; set; }
    public int AmountMinor { get; set; }
    public string Currency { get; private set; } = "GBP";
    public bool IsTest { get; private set; } = true;
    public string Provider { get; private set; } = "fake";
    public string ReceiptReference { get; set; } = string.Empty;
    public string ReceiptLabel { get; private set; } = "TEST PAYMENT — NO MONEY WAS TAKEN";
    public int? RelatedPaymentId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
