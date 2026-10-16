using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Commerce;

public class CommerceEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CommerceEndpointsTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task Catalogue_IsAuthenticatedAndOwnerScoped()
    {
        var (owner, _) = await _f.SignupAsync();
        var (other, _) = await _f.SignupAsync();
        var created = await CreateItemAsync(owner, "Owner item");

        var anonymous = await _f.CreateClient().GetAsync("/api/commerce/catalogue");
        var otherRows = await (await other.GetAsync("/api/commerce/catalogue")).ReadAsync<List<CatalogueItemDto>>();
        var otherUpdate = await other.PutAsJsonAsync($"/api/commerce/catalogue/{created.Id}",
            ToUpdate(ItemRequest("Changed", stock: 2)));

        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Empty(otherRows);
        Assert.Equal(HttpStatusCode.NotFound, otherUpdate.StatusCode);
    }

    [Fact]
    public async Task Catalogue_UsesGbpAndAcceptsOnlyHttpsImages()
    {
        var (seller, _) = await _f.SignupAsync();

        var invalid = await seller.PostAsJsonAsync("/api/commerce/catalogue",
            ItemRequest("Tent pitch", imageUrl: "http://example.test/tent.jpg"));
        var valid = await CreateItemAsync(seller, "Tent pitch", imageUrl: "https://example.test/tent.jpg");

        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(("GBP", "https://example.test/tent.jpg"), (valid.Currency, valid.ImageUrl));
    }

    [Fact]
    public async Task Catalogue_MaterialEditAndReactivationRequireFreshListingApproval()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var item = await CreateItemAsync(seller, "Original programme", price: 1200, stock: 5);
        var listing = await SubmitAsync(seller, competitionId, item.Id);
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/commerce/listings/{listing.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));

        var editedResponse = await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}",
            new UpdateCatalogueItemRequest(
                "Changed after approval", "Different sales copy", 9900, 5,
                CommerceItemCategory.Other, "https://example.test/changed.jpg", true, item.Version));
        editedResponse.EnsureSuccessStatusCode();
        var edited = await editedResponse.ReadAsync<CatalogueItemDto>();
        var (buyer, _) = await _f.SignupAsync();
        var hiddenOrder = await buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders",
            OrderRequest("edited-hidden", (listing.Id, 1)));

        Assert.Equal(CommerceListingStatus.Pending, await ListingStatusAsync(listing.Id));
        Assert.Empty(await PublicListingsAsync(competitionId));
        Assert.Equal(HttpStatusCode.Conflict, hiddenOrder.StatusCode);

        await admin.PutAsJsonAsync($"/api/commerce/listings/{listing.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));
        Assert.Equal(HttpStatusCode.NoContent,
            (await seller.DeleteAsync($"/api/commerce/catalogue/{item.Id}")).StatusCode);
        Assert.Empty(await PublicListingsAsync(competitionId));
        var archived = (await (await seller.GetAsync("/api/commerce/catalogue"))
            .ReadAsync<List<CatalogueItemDto>>()).Single(x => x.Id == item.Id);
        var restoredResponse = await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}",
            new UpdateCatalogueItemRequest(
                edited.Title, edited.Description, edited.PriceMinor, archived.StockQuantity,
                edited.Category, edited.ImageUrl, true, archived.Version));

        restoredResponse.EnsureSuccessStatusCode();
        Assert.Equal(CommerceListingStatus.Pending, await ListingStatusAsync(listing.Id));
        Assert.Empty(await PublicListingsAsync(competitionId));
    }

    [Fact]
    public async Task Catalogue_StaleAbsoluteStockEditCannotOverwriteReservation()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var item = await CreateItemAsync(seller, "Limited item", stock: 10);
        var listing = await SubmitAsync(seller, competitionId, item.Id);
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/commerce/listings/{listing.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));
        var (buyer, _) = await _f.SignupAsync();
        await CreateOrderAsync(buyer, competitionId, "reserve-two", (listing.Id, 2));

        var stale = await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}",
            new UpdateCatalogueItemRequest(
                "Stale title edit", item.Description, item.PriceMinor, 10,
                item.Category, item.ImageUrl, true, item.Version));

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(8, await StockAsync(item.Id));
        Assert.Equal("Limited item", await _f.InDbAsync(db => db.Set<CatalogueItem>()
            .Where(x => x.Id == item.Id).Select(x => x.Title).SingleAsync()));
    }

    [Fact]
    public async Task UnlimitedReservationDoesNotFabricateStockAfterInventoryBecomesFinite()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var item = await CreateItemAsync(seller, "Initially unlimited");
        var listing = await SubmitAsync(seller, competitionId, item.Id);
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/commerce/listings/{listing.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));
        var (buyer, _) = await _f.SignupAsync();
        var order = await CreateOrderAsync(buyer, competitionId, "unlimited-order", (listing.Id, 2));
        Assert.Equal(0, await _f.InDbAsync(db => db.Set<EventOrderLine>()
            .Where(x => x.EventOrderId == order.Id).Select(x => x.ReservedStockQuantity).SingleAsync()));
        var current = (await (await seller.GetAsync("/api/commerce/catalogue"))
            .ReadAsync<List<CatalogueItemDto>>()).Single(x => x.Id == item.Id);
        var finite = await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}",
            new UpdateCatalogueItemRequest(
                current.Title, current.Description, current.PriceMinor, 5,
                current.Category, current.ImageUrl, true, current.Version));
        finite.EnsureSuccessStatusCode();

        var cancelled = await buyer.PostAsync($"/api/commerce/orders/{order.Id}/cancel", null);

        cancelled.EnsureSuccessStatusCode();
        Assert.Equal(5, await StockAsync(item.Id));
    }

    [Fact]
    public async Task SellerCanReuseItemAcrossEvents_ApprovalControlsPublicVisibility()
    {
        var (seller, _) = await _f.SignupAsync();
        var item = await CreateItemAsync(seller, "Event hoodie");
        var firstCompetition = await CompetitionAsync();
        var secondCompetition = await CompetitionAsync();

        var first = await SubmitAsync(seller, firstCompetition, item.Id);
        var second = await SubmitAsync(seller, secondCompetition, item.Id);
        var before = await PublicListingsAsync(firstCompetition);
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/commerce/listings/{first.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));
        var after = await PublicListingsAsync(firstCompetition);

        Assert.Equal(CommerceListingStatus.Pending, first.Status);
        Assert.Equal(CommerceListingStatus.Pending, second.Status);
        Assert.Empty(before);
        Assert.Equal(item.Id, Assert.Single(after).CatalogueItemId);
    }

    [Fact]
    public async Task SellerCanWithdrawOnlyOwnPendingListing()
    {
        var (seller, _) = await _f.SignupAsync();
        var (other, _) = await _f.SignupAsync();
        var listing = await SubmitAsync(seller, await CompetitionAsync(), (await CreateItemAsync(seller)).Id);

        var hidden = await other.DeleteAsync($"/api/commerce/listings/{listing.Id}");
        var withdrawn = await seller.DeleteAsync($"/api/commerce/listings/{listing.Id}");

        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, withdrawn.StatusCode);
        Assert.Equal(CommerceListingStatus.Cancelled,
            await _f.InDbAsync(db => db.Set<CompetitionListing>().Where(x => x.Id == listing.Id).Select(x => x.Status).SingleAsync()));
    }

    [Fact]
    public async Task CompetitionOwnerItemIsApprovedImmediately()
    {
        var (organiser, auth) = await _f.SignupAsync();
        var competitionId = await CompetitionAsync(ownerUserId: auth.User.Id);
        var item = await CreateItemAsync(organiser);

        var listing = await SubmitAsync(organiser, competitionId, item.Id);

        Assert.Equal(CommerceListingStatus.Approved, listing.Status);
        Assert.Single(await PublicListingsAsync(competitionId));
    }

    [Fact]
    public async Task Settings_DefaultToReal_OnlyOrganiserCanChange_ThenLock()
    {
        var competitionId = await CompetitionAsync();
        var (member, _) = await _f.SignupAsync(role: "Member");
        var defaults = await (await _f.CreateClient().GetAsync($"/api/commerce/competitions/{competitionId}/settings"))
            .ReadAsync<EventCommerceSettingsDto>();
        var forbidden = await member.PutAsJsonAsync($"/api/commerce/competitions/{competitionId}/settings",
            new UpdateEventCommerceSettingsRequest(true));
        var admin = await _f.AdminAsync();
        var configured = await (await admin.PutAsJsonAsync($"/api/commerce/competitions/{competitionId}/settings",
            new UpdateEventCommerceSettingsRequest(true))).ReadAsync<EventCommerceSettingsDto>();

        var (seller, _) = await _f.SignupAsync();
        var listing = await ApprovedListingAsync(seller, competitionId, stock: 1);
        var (buyer, _) = await _f.SignupAsync();
        await CreateOrderAsync(buyer, competitionId, "locks-demo", (listing.Id, 1));
        var change = await admin.PutAsJsonAsync($"/api/commerce/competitions/{competitionId}/settings",
            new UpdateEventCommerceSettingsRequest(false));

        Assert.Equal((false, false), (defaults.IsDemo, defaults.IsLocked));
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        Assert.True(configured.IsDemo);
        Assert.Equal(HttpStatusCode.Conflict, change.StatusCode);
    }

    [Fact]
    public async Task OrderSnapshotsServerPriceAndReservesStock()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var listing = await ApprovedListingAsync(seller, competitionId, price: 2345, stock: 3);
        var (buyer, _) = await _f.SignupAsync();

        var order = await CreateOrderAsync(buyer, competitionId, "price-stock", (listing.Id, 2));

        Assert.Equal((4690, 2345, CommerceOrderStatus.AwaitingManualPayment),
            (order.TotalMinor, order.Lines.Single().UnitPriceMinor, order.Status));
        Assert.Equal(1, await StockAsync(listing.CatalogueItemId));
    }

    [Fact]
    public async Task OrderIdempotencyReservesStockOnce_AndRejectsKeyReuseForDifferentOrder()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var listing = await ApprovedListingAsync(seller, competitionId, stock: 4);
        var (buyer, _) = await _f.SignupAsync();
        var request = OrderRequest("same-key", (listing.Id, 2));

        var first = await (await buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders", request))
            .ReadAsync<EventOrderDto>();
        var replay = await (await buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders", request))
            .ReadAsync<EventOrderDto>();
        var mismatch = await buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders",
            OrderRequest("same-key", (listing.Id, 1)));

        Assert.Equal(first.Id, replay.Id);
        Assert.Equal(2, await StockAsync(listing.CatalogueItemId));
        Assert.Equal(HttpStatusCode.Conflict, mismatch.StatusCode);
    }

    [Fact]
    public async Task OrderBoundsLineCountAndTotalBeforeReservingStock()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var listing = await ApprovedListingAsync(seller, competitionId, price: 100_000_000, stock: 2);
        var (buyer, _) = await _f.SignupAsync();

        var tooManyLines = await buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders",
            new CreateEventOrderRequest("too-many-lines", Enumerable.Range(0, 51)
                .Select(_ => new CreateEventOrderLineRequest(listing.Id, 1)).ToList()));
        var tooLarge = await buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders",
            OrderRequest("too-large", (listing.Id, 2)));

        Assert.Equal((HttpStatusCode.BadRequest, HttpStatusCode.BadRequest), (tooManyLines.StatusCode, tooLarge.StatusCode));
        Assert.Equal(2, await StockAsync(listing.CatalogueItemId));
    }

    [Fact]
    public async Task ConcurrentOrdersCannotOversell()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var listing = await ApprovedListingAsync(seller, competitionId, stock: 1);
        var (firstBuyer, _) = await _f.SignupAsync();
        var (secondBuyer, _) = await _f.SignupAsync();

        var responses = await Task.WhenAll(
            firstBuyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders", OrderRequest("race-a", (listing.Id, 1))),
            secondBuyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders", OrderRequest("race-b", (listing.Id, 1))));

        Assert.Equal(1, responses.Count(x => x.StatusCode == HttpStatusCode.OK));
        Assert.Equal(1, responses.Count(x => x.StatusCode == HttpStatusCode.Conflict));
        Assert.Equal(0, await StockAsync(listing.CatalogueItemId));
    }

    [Fact]
    public async Task OrderRejectsUnapprovedOrOutOfStockListings()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var item = await CreateItemAsync(seller, stock: 1);
        var pending = await SubmitAsync(seller, competitionId, item.Id);
        var (buyer, _) = await _f.SignupAsync();

        var unapproved = await buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders",
            OrderRequest("pending", (pending.Id, 1)));
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/commerce/listings/{pending.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));
        var noStock = await buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders",
            OrderRequest("too-many", (pending.Id, 2)));

        Assert.Equal((HttpStatusCode.Conflict, HttpStatusCode.Conflict), (unapproved.StatusCode, noStock.StatusCode));
    }

    [Fact]
    public async Task BuyerSellerAndOrganiserViewsAreScoped()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var (otherSeller, _) = await _f.SignupAsync();
        var first = await ApprovedListingAsync(seller, competitionId, title: "Mine");
        var second = await ApprovedListingAsync(otherSeller, competitionId, title: "Theirs");
        var (buyer, _) = await _f.SignupAsync();
        var (stranger, _) = await _f.SignupAsync();
        var order = await CreateOrderAsync(buyer, competitionId, "scoped", (first.Id, 1), (second.Id, 1));

        var buyerRows = await (await buyer.GetAsync("/api/commerce/orders/mine")).ReadAsync<List<EventOrderDto>>();
        var strangerOrder = await stranger.GetAsync($"/api/commerce/orders/{order.Id}");
        var sales = await (await seller.GetAsync("/api/commerce/sales/mine")).ReadAsync<List<SellerSaleDto>>();
        var adminRows = await (await (await _f.AdminAsync()).GetAsync($"/api/commerce/competitions/{competitionId}/orders"))
            .ReadAsync<List<EventOrderDto>>();

        Assert.Contains(buyerRows, x => x.Id == order.Id);
        Assert.Equal(HttpStatusCode.NotFound, strangerOrder.StatusCode);
        Assert.Equal("Mine", Assert.Single(sales.Single(x => x.OrderId == order.Id).Lines).Title);
        Assert.Contains(adminRows, x => x.Id == order.Id);
    }

    [Fact]
    public async Task RealOrderRejectsFakeActions_AndNeedsExplicitManualConfirmation()
    {
        var competitionId = await CompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var listing = await ApprovedListingAsync(seller, competitionId);
        var (buyer, _) = await _f.SignupAsync();
        var order = await CreateOrderAsync(buyer, competitionId, "real", (listing.Id, 1));

        var fake = await buyer.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-checkout", Checkout("fake", FakePaymentOutcome.Success));
        var admin = await _f.AdminAsync();
        var notConfirmed = await admin.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/manual-payment",
            new ConfirmManualPaymentRequest(false));
        var confirmed = await (await admin.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/manual-payment",
            new ConfirmManualPaymentRequest(true))).ReadAsync<EventOrderDto>();

        Assert.Equal(HttpStatusCode.Conflict, fake.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, notConfirmed.StatusCode);
        Assert.Equal(CommerceOrderStatus.Paid, confirmed.Status);
        Assert.False(confirmed.IsTestOrder);
        Assert.Empty(confirmed.TestPayments);
    }

    [Fact]
    public async Task DemoDeclineReleasesStock_AndRetryCanSucceed()
    {
        var competitionId = await CompetitionAsync(demo: true);
        var (seller, _) = await _f.SignupAsync();
        var listing = await ApprovedListingAsync(seller, competitionId, stock: 1);
        var (buyer, _) = await _f.SignupAsync();
        var order = await CreateOrderAsync(buyer, competitionId, "demo-decline", (listing.Id, 1));

        var declined = await (await buyer.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-checkout",
            Checkout("decline", FakePaymentOutcome.Decline))).ReadAsync<DemoOrderPaymentResultDto>();
        var afterDecline = await StockAsync(listing.CatalogueItemId);
        var paid = await (await buyer.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-checkout",
            Checkout("retry", FakePaymentOutcome.Success))).ReadAsync<DemoOrderPaymentResultDto>();

        Assert.Equal((CommerceOrderStatus.Declined, false, 1),
            (declined.Order.Status, declined.Order.HasStockReservation, afterDecline));
        Assert.Equal((CommerceOrderStatus.Paid, true, 0),
            (paid.Order.Status, paid.Payment.IsTest, await StockAsync(listing.CatalogueItemId)));
        Assert.Contains("TEST PAYMENT", paid.Payment.ReceiptLabel);
        Assert.StartsWith("TEST-", paid.Payment.ReceiptReference);
    }

    [Fact]
    public async Task DemoCancelAndRefundReleaseStockExactlyOnce()
    {
        var competitionId = await CompetitionAsync(demo: true);
        var (seller, _) = await _f.SignupAsync();
        var cancelListing = await ApprovedListingAsync(seller, competitionId, title: "Cancel", stock: 1);
        var refundListing = await ApprovedListingAsync(seller, competitionId, title: "Refund", stock: 1);
        var (buyer, _) = await _f.SignupAsync();
        var cancelledOrder = await CreateOrderAsync(buyer, competitionId, "cancel-order", (cancelListing.Id, 1));
        var paidOrder = await CreateOrderAsync(buyer, competitionId, "refund-order", (refundListing.Id, 1));

        await buyer.PostAsJsonAsync($"/api/commerce/orders/{cancelledOrder.Id}/demo-checkout",
            Checkout("cancel-payment", FakePaymentOutcome.Cancel));
        await buyer.PostAsJsonAsync($"/api/commerce/orders/{paidOrder.Id}/demo-checkout",
            Checkout("pay", FakePaymentOutcome.Success));
        var request = Checkout("refund-once", FakePaymentOutcome.Success);
        var firstRefund = await (await buyer.PostAsJsonAsync($"/api/commerce/orders/{paidOrder.Id}/demo-refund", request))
            .ReadAsync<DemoOrderPaymentResultDto>();
        var replay = await (await buyer.PostAsJsonAsync($"/api/commerce/orders/{paidOrder.Id}/demo-refund", request))
            .ReadAsync<DemoOrderPaymentResultDto>();

        Assert.Equal(1, await StockAsync(cancelListing.CatalogueItemId));
        Assert.Equal(1, await StockAsync(refundListing.CatalogueItemId));
        Assert.Equal(firstRefund.Payment.Id, replay.Payment.Id);
        Assert.Equal(CommerceOrderStatus.Refunded, replay.Order.Status);
    }

    [Fact]
    public async Task ConcurrentCancelAndRefundDoubleClicksReleaseEachReservationOnce()
    {
        var competitionId = await CompetitionAsync(demo: true);
        var (seller, _) = await _f.SignupAsync();
        var cancelListing = await ApprovedListingAsync(seller, competitionId, title: "Concurrent cancel", stock: 1);
        var refundListing = await ApprovedListingAsync(seller, competitionId, title: "Concurrent refund", stock: 1);
        var (buyer, _) = await _f.SignupAsync();
        var cancelledOrder = await CreateOrderAsync(buyer, competitionId, "concurrent-cancel", (cancelListing.Id, 1));
        var paidOrder = await CreateOrderAsync(buyer, competitionId, "concurrent-refund", (refundListing.Id, 1));
        await buyer.PostAsJsonAsync($"/api/commerce/orders/{paidOrder.Id}/demo-checkout",
            Checkout("concurrent-pay", FakePaymentOutcome.Success));

        var cancelResponses = await Task.WhenAll(
            buyer.PostAsync($"/api/commerce/orders/{cancelledOrder.Id}/cancel", null),
            buyer.PostAsync($"/api/commerce/orders/{cancelledOrder.Id}/cancel", null));
        var refundRequest = Checkout("same-refund-key", FakePaymentOutcome.Success);
        var refundResponses = await Task.WhenAll(
            buyer.PostAsJsonAsync($"/api/commerce/orders/{paidOrder.Id}/demo-refund", refundRequest),
            buyer.PostAsJsonAsync($"/api/commerce/orders/{paidOrder.Id}/demo-refund", refundRequest));

        Assert.All(cancelResponses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        Assert.All(refundResponses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        Assert.Equal(1, await StockAsync(cancelListing.CatalogueItemId));
        Assert.Equal(1, await StockAsync(refundListing.CatalogueItemId));
        Assert.Equal(1, await _f.InDbAsync(db => db.Set<TestPaymentRecord>()
            .CountAsync(x => x.EventOrderId == paidOrder.Id && x.Operation == TestPaymentOperation.Refund)));
    }

    [Fact]
    public async Task DemoPaymentActionsAreOwnerOnly()
    {
        var competitionId = await CompetitionAsync(demo: true);
        var (seller, _) = await _f.SignupAsync();
        var listing = await ApprovedListingAsync(seller, competitionId);
        var (buyer, _) = await _f.SignupAsync();
        var (other, _) = await _f.SignupAsync();
        var order = await CreateOrderAsync(buyer, competitionId, "owner", (listing.Id, 1));

        var response = await other.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-checkout",
            Checkout("steal", FakePaymentOutcome.Success));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DemoEntryCheckoutAndRefundAreOwnerOnlyAndTestLabelled()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1750);
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/commerce/competitions/{section.CompetitionId}/settings",
            new UpdateEventCommerceSettingsRequest(true));
        var (owner, _) = await _f.SignupAsync();
        var (other, _) = await _f.SignupAsync();
        var signup = await (await owner.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups",
            new CreateSectionSignupRequest("Test entrant", null, null, null))).ReadAsync<SectionSignupDto>();

        var hidden = await other.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-checkout",
            Checkout("other", FakePaymentOutcome.Success));
        var paid = await (await owner.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-checkout",
            Checkout("entry-pay", FakePaymentOutcome.Success))).ReadAsync<DemoEntryPaymentResultDto>();
        Assert.True(await _f.InDbAsync(db => db.Set<EventCommerceSettings>()
            .AnyAsync(x => x.CompetitionId == section.CompetitionId && x.IsDemo)));
        Assert.True(await _f.InDbAsync(db => db.Set<TestPaymentRecord>()
            .AnyAsync(x => x.Target == TestPaymentTarget.SectionSignup && x.TargetId == signup.Id)));
        var manualFlip = await admin.PutAsJsonAsync($"/api/signups/{signup.Id}/status",
            new UpdateSignupStatusRequest(SignupPaymentStatus.Paid));
        var deletePaid = await admin.DeleteAsync($"/api/signups/{signup.Id}");
        var refundRequest = Checkout("entry-refund", FakePaymentOutcome.Success);
        var refunded = await (await owner.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-refund", refundRequest))
            .ReadAsync<DemoEntryPaymentResultDto>();
        var replay = await (await owner.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-refund", refundRequest))
            .ReadAsync<DemoEntryPaymentResultDto>();

        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Equal((SignupPaymentStatus.Paid, true), (paid.SignupStatus, paid.Payment.IsTest));
        Assert.Equal(HttpStatusCode.Conflict, manualFlip.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, deletePaid.StatusCode);
        Assert.True(await _f.InDbAsync(db => db.SectionSignups.AnyAsync(x => x.Id == signup.Id)));
        Assert.Equal(SignupPaymentStatus.Refunded, refunded.SignupStatus);
        Assert.Equal(refunded.Payment.Id, replay.Payment.Id);
    }

    [Fact]
    public async Task NonDemoEntryCannotUseFakeCheckout()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        var (owner, _) = await _f.SignupAsync();
        var signup = await (await owner.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups",
            new CreateSectionSignupRequest("Real entrant", null, null, null))).ReadAsync<SectionSignupDto>();

        var response = await owner.PostAsJsonAsync($"/api/commerce/signups/{signup.Id}/demo-checkout",
            Checkout("not-demo", FakePaymentOutcome.Success));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(SignupPaymentStatus.Pending,
            await _f.InDbAsync(db => db.SectionSignups.Where(x => x.Id == signup.Id).Select(x => x.Status).SingleAsync()));
    }

    private async Task<int> CompetitionAsync(bool demo = false, string? ownerUserId = null)
        => await _f.InDbAsync(async db =>
        {
            var competition = new Competition
            {
                Name = $"Commerce {Guid.NewGuid():N}",
                StartDate = DateTime.UtcNow.AddDays(10),
                CreatedByUserId = ownerUserId,
            };
            db.Competitions.Add(competition);
            await db.SaveChangesAsync();
            if (demo)
            {
                db.Set<EventCommerceSettings>().Add(new EventCommerceSettings
                {
                    CompetitionId = competition.Id,
                    IsDemo = true,
                });
                await db.SaveChangesAsync();
            }
            return competition.Id;
        });

    private static CreateCatalogueItemRequest ItemRequest(
        string title = "Programme",
        int price = 1200,
        int? stock = null,
        string? imageUrl = null) =>
        new(title, "Collect this at the event", price, stock, CommerceItemCategory.Merchandise, imageUrl);

    private static UpdateCatalogueItemRequest ToUpdate(CreateCatalogueItemRequest request, long expectedVersion = 1) =>
        new(request.Title, request.Description, request.PriceMinor, request.StockQuantity, request.Category, request.ImageUrl, true, expectedVersion);

    private static FakeCheckoutRequest Checkout(string key, FakePaymentOutcome outcome) => new(key, outcome);

    private static CreateEventOrderRequest OrderRequest(
        string key,
        params (int ListingId, int Quantity)[] items) =>
        new(key, items.Select(x => new CreateEventOrderLineRequest(x.ListingId, x.Quantity)).ToList());

    private async Task<CatalogueItemDto> CreateItemAsync(
        HttpClient seller,
        string title = "Programme",
        int price = 1200,
        int? stock = null,
        string? imageUrl = null)
    {
        var response = await seller.PostAsJsonAsync("/api/commerce/catalogue", ItemRequest(title, price, stock, imageUrl));
        response.EnsureSuccessStatusCode();
        return await response.ReadAsync<CatalogueItemDto>();
    }

    private async Task<CompetitionListingDto> SubmitAsync(HttpClient seller, int competitionId, int itemId)
    {
        var response = await seller.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/listings",
            new CreateCompetitionListingRequest(itemId));
        response.EnsureSuccessStatusCode();
        return await response.ReadAsync<CompetitionListingDto>();
    }

    private async Task<CompetitionListingDto> ApprovedListingAsync(
        HttpClient seller,
        int competitionId,
        string title = "Programme",
        int price = 1200,
        int? stock = null)
    {
        var listing = await SubmitAsync(seller, competitionId, (await CreateItemAsync(seller, title, price, stock)).Id);
        var admin = await _f.AdminAsync();
        var response = await admin.PutAsJsonAsync($"/api/commerce/listings/{listing.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));
        response.EnsureSuccessStatusCode();
        return await response.ReadAsync<CompetitionListingDto>();
    }

    private async Task<List<PublicCompetitionListingDto>> PublicListingsAsync(int competitionId) =>
        await (await _f.CreateClient().GetAsync($"/api/commerce/competitions/{competitionId}/listings"))
            .ReadAsync<List<PublicCompetitionListingDto>>();

    private async Task<EventOrderDto> CreateOrderAsync(
        HttpClient buyer,
        int competitionId,
        string key,
        params (int ListingId, int Quantity)[] items)
    {
        var response = await buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders", OrderRequest(key, items));
        response.EnsureSuccessStatusCode();
        return await response.ReadAsync<EventOrderDto>();
    }

    private Task<int?> StockAsync(int itemId) =>
        _f.InDbAsync(db => db.Set<CatalogueItem>().Where(x => x.Id == itemId).Select(x => x.StockQuantity).SingleAsync());

    private Task<CommerceListingStatus> ListingStatusAsync(int listingId) =>
        _f.InDbAsync(db => db.Set<CompetitionListing>().Where(x => x.Id == listingId).Select(x => x.Status).SingleAsync());
}
