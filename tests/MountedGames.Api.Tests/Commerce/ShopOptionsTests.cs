using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Commerce;

/// <summary>
/// A seller can offer an item in options (sizes), each with its own optional stock. The buyer picks one per line, the
/// choice is stored on the order line, and stock is reserved and released per option.
/// </summary>
public class ShopOptionsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ShopOptionsTests(ApiFactory f) => _f = f;

    private static CatalogueItemOptionInput O(string label, int? stock = null, int? id = null) => new(id, label, stock);

    private static CreateCatalogueItemRequest Item(string title, int? stock, params CatalogueItemOptionInput[] options) =>
        new(title, "Synthetic test item", 2500, stock, CommerceItemCategory.Merchandise, null, null, null, options);

    private static UpdateCatalogueItemRequest Update(CatalogueItemDto item, params CatalogueItemOptionInput[] options) =>
        new(item.Title, item.Description, item.PriceMinor, item.StockQuantity, item.Category, item.ImageUrl, true, item.Version,
            item.DetailPrompt, item.DetailHint, options);

    private async Task<(int CompetitionId, HttpClient Seller, CompetitionListingDto Listing)> ApprovedAsync(
        CreateCatalogueItemRequest request, bool demo = false)
    {
        var competitionId = await _f.SeedCompetitionAsync();
        if (demo)
            await _f.InDbAsync(async db =>
            {
                db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { CompetitionId = competitionId, IsDemo = true });
                await db.SaveChangesAsync();
            });
        var (seller, _) = await _f.SignupAsync();
        var created = await seller.PostAsJsonAsync("/api/commerce/catalogue", request);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var item = await created.ReadAsync<CatalogueItemDto>();
        var submit = await seller.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/listings", new CreateCompetitionListingRequest(item.Id));
        submit.EnsureSuccessStatusCode();
        var listing = await submit.ReadAsync<CompetitionListingDto>();
        var admin = await _f.AdminAsync();
        var approve = await admin.PutAsJsonAsync($"/api/commerce/listings/{listing.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));
        approve.EnsureSuccessStatusCode();
        return (competitionId, seller, await approve.ReadAsync<CompetitionListingDto>());
    }

    private static int OptionId(CompetitionListingDto listing, string label) => listing.Item.Options!.Single(x => x.Label == label).Id;

    private static CreateEventOrderRequest Order(string key, params CreateEventOrderLineRequest[] lines) => new(key, lines);

    private static CreateEventOrderLineRequest L(int listingId, int quantity, int? optionId) => new(listingId, quantity, null, optionId);

    private Task<HttpResponseMessage> PlaceAsync(HttpClient buyer, int competitionId, CreateEventOrderRequest order) =>
        buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders", order);

    private Task<Dictionary<string, int?>> OptionStockAsync(int itemId) => _f.InDbAsync(db =>
        db.Set<CatalogueItemOption>().AsNoTracking().Where(x => x.CatalogueItemId == itemId).ToDictionaryAsync(x => x.Label, x => x.StockQuantity));

    private Task<int?> ItemStockAsync(int itemId) => _f.InDbAsync(db =>
        db.Set<CatalogueItem>().AsNoTracking().Where(x => x.Id == itemId).Select(x => x.StockQuantity).SingleAsync());

    [Fact]
    public async Task TheSellersOptions_AreSavedInOrder_AndThePublicListingShowsOnlyThem()
    {
        var (competitionId, _, listing) = await ApprovedAsync(Item("Hoodie", null, O(" S ", 3), O("M", 5), O("Age 9-10")));

        Assert.Equal(new[] { ("S", (int?)3), ("M", 5), ("Age 9-10", null) },
            listing.Item.Options!.Select(x => (x.Label, x.StockQuantity)).ToArray());
        var shown = Assert.Single(await (await _f.CreateClient().GetAsync($"/api/commerce/competitions/{competitionId}/listings"))
            .ReadAsync<List<PublicCompetitionListingDto>>());
        Assert.Equal(new[] { "S", "M", "Age 9-10" }, shown.Options!.Select(x => x.Label).ToArray());
    }

    [Fact]
    public async Task AnItemWithoutOptions_HasNone_EvenWhenItsTitleSoundsLikeClothing()
    {
        // No guessing from the title: a hoodie the seller gave no sizes has no sizes.
        var (competitionId, _, listing) = await ApprovedAsync(Item("Club hoodie", 4));
        var (buyer, _) = await _f.SignupAsync();

        Assert.Empty(listing.Item.Options!);
        var order = await (await PlaceAsync(buyer, competitionId, Order($"plain-{Guid.NewGuid():N}", L(listing.Id, 1, null)))).ReadAsync<EventOrderDto>();
        Assert.Null(Assert.Single(order.Lines).OptionLabel);
        Assert.Null(order.Lines[0].Detail);
    }

    [Theory]
    [InlineData("dupe")]
    [InlineData("blank")]
    [InlineData("long")]
    [InlineData("negative")]
    [InlineData("many")]
    public async Task BadOptions_AreRefused(string problem)
    {
        var (seller, _) = await _f.SignupAsync();
        CatalogueItemOptionInput[] options = problem switch
        {
            "dupe" => [O("M"), O(" m ")],
            "blank" => [O("  ")],
            "long" => [O(new string('x', CatalogueItemOption.MaxLabelLength + 1))],
            "negative" => [O("M", -1)],
            _ => Enumerable.Range(1, CatalogueItemOption.MaxOptions + 1).Select(i => O($"Size {i}")).ToArray(),
        };

        var response = await seller.PostAsJsonAsync("/api/commerce/catalogue", Item("Bad options", null, options));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AnMAndAnLOfTheSameHoodie_AreTwoLines_EachReservingItsOwnOptionAndTheItem()
    {
        var (competitionId, seller, listing) = await ApprovedAsync(Item("Hoodie", 10, O("M", 3), O("L", 2)));
        var (buyer, _) = await _f.SignupAsync();
        int m = OptionId(listing, "M"), l = OptionId(listing, "L");

        var response = await PlaceAsync(buyer, competitionId, Order("m-and-l", L(listing.Id, 2, m), L(listing.Id, 1, l), L(listing.Id, 1, m)));

        response.EnsureSuccessStatusCode();
        var order = await response.ReadAsync<EventOrderDto>();
        Assert.Equal(new[] { ("M", 3, (int?)m), ("L", 1, l) }.OrderBy(x => x.Item3).ToArray(),
            order.Lines.Select(x => (x.OptionLabel!, x.Quantity, x.OptionId)).OrderBy(x => x.OptionId).ToArray());
        Assert.Equal(new Dictionary<string, int?> { ["M"] = 0, ["L"] = 1 }, await OptionStockAsync(listing.CatalogueItemId));
        Assert.Equal(6, await ItemStockAsync(listing.CatalogueItemId));
        // The option stays its own field: nothing is appended to the detail text.
        Assert.All(order.Lines, x => Assert.Null(x.Detail));
        var sales = await (await seller.GetAsync("/api/commerce/sales/mine")).ReadAsync<List<SellerSaleDto>>();
        Assert.Equal(new[] { "L", "M" }, Assert.Single(sales).Lines.Select(x => x.OptionLabel).OrderBy(x => x).ToArray());
        var mine = await (await buyer.GetAsync("/api/commerce/orders/mine")).ReadAsync<List<EventOrderDto>>();
        Assert.Equal(2, Assert.Single(mine).Lines.Count(x => x.OptionLabel is not null));
    }

    [Fact]
    public async Task AnItemWithOptions_NeedsOne_AndOnlyItsOwn()
    {
        var (competitionId, _, listing) = await ApprovedAsync(Item("Hoodie", null, O("M", 3)));
        var (_, _, other) = await ApprovedAsync(Item("T-shirt", null, O("S", 3)));
        var (plainCompetition, _, plain) = await ApprovedAsync(Item("Programme", null));
        var (buyer, _) = await _f.SignupAsync();

        var missing = await PlaceAsync(buyer, competitionId, Order("missing-option", L(listing.Id, 1, null)));
        var foreign = await PlaceAsync(buyer, competitionId, Order("foreign-option", L(listing.Id, 1, OptionId(other, "S"))));
        var stray = await PlaceAsync(buyer, plainCompetition, Order("stray-option", L(plain.Id, 1, 12345)));
        var invalid = await PlaceAsync(buyer, competitionId, Order("zero-option", L(listing.Id, 1, 0)));

        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Contains("Choose a size or option for Hoodie.", await missing.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Conflict, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, stray.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(3, (await OptionStockAsync(listing.CatalogueItemId))["M"]);
    }

    [Fact]
    public async Task ASoldOutOption_IsRefusedWithAFriendlyMessage_WhileTheOtherOptionsStillSell()
    {
        var (competitionId, _, listing) = await ApprovedAsync(Item("Hoodie", null, O("S", 0), O("M", 1), O("L")));
        var (buyer, _) = await _f.SignupAsync();

        var soldOut = await PlaceAsync(buyer, competitionId, Order("sold-out", L(listing.Id, 1, OptionId(listing, "S"))));
        var tooMany = await PlaceAsync(buyer, competitionId, Order("too-many", L(listing.Id, 2, OptionId(listing, "M"))));
        var mixed = await PlaceAsync(buyer, competitionId, Order("mixed", L(listing.Id, 1, OptionId(listing, "L")), L(listing.Id, 1, OptionId(listing, "S"))));
        var fine = await PlaceAsync(buyer, competitionId, Order("fine", L(listing.Id, 1, OptionId(listing, "M")), L(listing.Id, 4, OptionId(listing, "L"))));

        Assert.Equal(HttpStatusCode.Conflict, soldOut.StatusCode);
        Assert.Contains("Hoodie in S has sold out", await soldOut.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Conflict, tooMany.StatusCode);
        Assert.Contains("Only 1 left of Hoodie in M", await tooMany.Content.ReadAsStringAsync());
        // A refused order takes nothing, not even from the option that had stock.
        Assert.Equal(HttpStatusCode.Conflict, mixed.StatusCode);
        fine.EnsureSuccessStatusCode();
        Assert.Equal(new Dictionary<string, int?> { ["S"] = 0, ["M"] = 0, ["L"] = null }, await OptionStockAsync(listing.CatalogueItemId));
    }

    [Fact]
    public async Task TwoBuyersRacingForTheLastOne_OnlyOneGetsIt()
    {
        var (competitionId, _, listing) = await ApprovedAsync(Item("Hoodie", null, O("M", 1)));
        var (first, _) = await _f.SignupAsync();
        var (second, _) = await _f.SignupAsync();
        var m = OptionId(listing, "M");

        var results = await Task.WhenAll(
            PlaceAsync(first, competitionId, Order("race-a", L(listing.Id, 1, m))),
            PlaceAsync(second, competitionId, Order("race-b", L(listing.Id, 1, m))));

        Assert.Equal(1, results.Count(x => x.IsSuccessStatusCode));
        Assert.Equal(0, (await OptionStockAsync(listing.CatalogueItemId))["M"]);
    }

    [Fact]
    public async Task CancellingAnOrder_PutsTheStockBackOnTheRightOption()
    {
        var (competitionId, _, listing) = await ApprovedAsync(Item("Hoodie", 5, O("M", 2), O("L", 2)));
        var (buyer, _) = await _f.SignupAsync();
        var order = await (await PlaceAsync(buyer, competitionId, Order("cancel-me", L(listing.Id, 2, OptionId(listing, "L")))))
            .ReadAsync<EventOrderDto>();
        Assert.Equal(new Dictionary<string, int?> { ["M"] = 2, ["L"] = 0 }, await OptionStockAsync(listing.CatalogueItemId));

        (await buyer.PostAsync($"/api/commerce/orders/{order.Id}/cancel", null)).EnsureSuccessStatusCode();
        (await buyer.PostAsync($"/api/commerce/orders/{order.Id}/cancel", null)).EnsureSuccessStatusCode(); // released once only

        Assert.Equal(new Dictionary<string, int?> { ["M"] = 2, ["L"] = 2 }, await OptionStockAsync(listing.CatalogueItemId));
        Assert.Equal(5, await ItemStockAsync(listing.CatalogueItemId));
    }

    [Fact]
    public async Task AManualRefund_PutsTheStockBackOnTheRightOption()
    {
        var (competitionId, _, listing) = await ApprovedAsync(Item("Hoodie", null, O("M", 2), O("L", 2)));
        var (buyer, _) = await _f.SignupAsync();
        var order = await (await PlaceAsync(buyer, competitionId, Order("refund-me", L(listing.Id, 1, OptionId(listing, "M")))))
            .ReadAsync<EventOrderDto>();
        var admin = await _f.AdminAsync();
        (await admin.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/manual-payment", new ConfirmManualPaymentRequest(true))).EnsureSuccessStatusCode();
        Assert.Equal(1, (await OptionStockAsync(listing.CatalogueItemId))["M"]);

        var refunded = await (await admin.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/manual-refund", new ConfirmManualPaymentRequest(true)))
            .ReadAsync<EventOrderDto>();

        Assert.Equal(CommerceOrderStatus.Refunded, refunded.Status);
        Assert.Equal("M", Assert.Single(refunded.Lines).OptionLabel);
        Assert.Equal(new Dictionary<string, int?> { ["M"] = 2, ["L"] = 2 }, await OptionStockAsync(listing.CatalogueItemId));
    }

    [Fact]
    public async Task ADemoDecline_ReleasesTheOption_AndARetryReservesItAgainOrSaysItSoldOut()
    {
        var (competitionId, _, listing) = await ApprovedAsync(Item("Hoodie", null, O("M", 1)), demo: true);
        var (buyer, _) = await _f.SignupAsync();
        var (rival, _) = await _f.SignupAsync();
        var m = OptionId(listing, "M");
        var order = await (await PlaceAsync(buyer, competitionId, Order("demo-option", L(listing.Id, 1, m)))).ReadAsync<EventOrderDto>();

        (await buyer.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-checkout", new FakeCheckoutRequest("decline", FakePaymentOutcome.Decline)))
            .EnsureSuccessStatusCode();
        Assert.Equal(1, (await OptionStockAsync(listing.CatalogueItemId))["M"]);
        // Someone else buys the last M while the first order is declined, so the retry is told it sold out.
        var rivalOrder = await (await PlaceAsync(rival, competitionId, Order("rival", L(listing.Id, 1, m)))).ReadAsync<EventOrderDto>();
        var blocked = await buyer.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-checkout", new FakeCheckoutRequest("retry-1", FakePaymentOutcome.Success));
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        Assert.Contains("Hoodie in M has sold out", await blocked.Content.ReadAsStringAsync());

        (await rival.PostAsync($"/api/commerce/orders/{rivalOrder.Id}/cancel", null)).EnsureSuccessStatusCode();
        var retried = await (await buyer.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-checkout", new FakeCheckoutRequest("retry-2", FakePaymentOutcome.Success)))
            .ReadAsync<DemoOrderPaymentResultDto>();
        Assert.Equal(CommerceOrderStatus.Paid, retried.Order.Status);
        Assert.Equal(0, (await OptionStockAsync(listing.CatalogueItemId))["M"]);

        (await buyer.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-refund", new FakeCheckoutRequest("refund", FakePaymentOutcome.Success)))
            .EnsureSuccessStatusCode();
        Assert.Equal(1, (await OptionStockAsync(listing.CatalogueItemId))["M"]);
    }

    [Fact]
    public async Task ARetryWithTheSameOptionReplays_ButADifferentOptionUnderTheSameKeyIsAConflict()
    {
        var (competitionId, _, listing) = await ApprovedAsync(Item("Hoodie", null, O("M", 5), O("L", 5)));
        var (buyer, _) = await _f.SignupAsync();
        var first = await (await PlaceAsync(buyer, competitionId, Order("replay", L(listing.Id, 1, OptionId(listing, "M"))))).ReadAsync<EventOrderDto>();

        var again = await (await PlaceAsync(buyer, competitionId, Order("replay", L(listing.Id, 1, OptionId(listing, "M"))))).ReadAsync<EventOrderDto>();
        var different = await PlaceAsync(buyer, competitionId, Order("replay", L(listing.Id, 1, OptionId(listing, "L"))));

        Assert.Equal(first.Id, again.Id);
        Assert.Equal(HttpStatusCode.Conflict, different.StatusCode);
        Assert.Equal(4, (await OptionStockAsync(listing.CatalogueItemId))["M"]);
    }

    [Fact]
    public async Task TheSellerCanRestockRenameAddAndRemoveOptions_AndNewSizesNeedApprovalAgain()
    {
        var (competitionId, seller, listing) = await ApprovedAsync(Item("Hoodie", null, O("S", 1), O("M", 1)));
        var item = listing.Item;
        int s = OptionId(listing, "S"), m = OptionId(listing, "M");

        // Restocking only keeps the listing on sale.
        var restocked = await (await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}", Update(item, O("S", 4, s), O("M", 6, m))))
            .ReadAsync<CatalogueItemDto>();
        Assert.Equal(new[] { ("S", (int?)4, s), ("M", 6, m) }, restocked.Options!.Select(x => (x.Label, x.StockQuantity, x.Id)).ToArray());
        Assert.Single(await (await _f.CreateClient().GetAsync($"/api/commerce/competitions/{competitionId}/listings"))
            .ReadAsync<List<PublicCompetitionListingDto>>());

        // A stale edit, or one naming an option that isn't the item's, changes nothing.
        Assert.Equal(HttpStatusCode.Conflict, (await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}", Update(item, O("S", 9, s)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}", Update(restocked, O("S", 9, 999_999)))).StatusCode);

        // Dropping S, keeping M (moved to the end) and adding XL: what is on sale changed, so it is reviewed again.
        var reshaped = await (await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}", Update(restocked, O("XL", 2), O("M", 6, m))))
            .ReadAsync<CatalogueItemDto>();
        Assert.Equal(new[] { "XL", "M" }, reshaped.Options!.Select(x => x.Label).ToArray());
        Assert.Equal(m, reshaped.Options![1].Id);
        Assert.Empty(await (await _f.CreateClient().GetAsync($"/api/commerce/competitions/{competitionId}/listings"))
            .ReadAsync<List<PublicCompetitionListingDto>>());

        // Leaving the options out of the request keeps them.
        var kept = await (await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}", Update(reshaped) with { Options = null }))
            .ReadAsync<CatalogueItemDto>();
        Assert.Equal(new[] { "XL", "M" }, kept.Options!.Select(x => x.Label).ToArray());
        // An empty list removes them all.
        var cleared = await (await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}", Update(kept)))
            .ReadAsync<CatalogueItemDto>();
        Assert.Empty(cleared.Options!);
        var listed = await (await seller.GetAsync("/api/commerce/catalogue")).ReadAsync<List<CatalogueItemDto>>();
        Assert.Empty(listed.Single(x => x.Id == item.Id).Options!);
    }

    [Fact]
    public async Task AnOptionSentTwice_OrANullOption_IsRefused()
    {
        var (_, seller, listing) = await ApprovedAsync(Item("Hoodie", null, O("S", 1), O("M", 1)));
        var s = OptionId(listing, "S");

        var twice = await seller.PutAsJsonAsync($"/api/commerce/catalogue/{listing.Item.Id}", Update(listing.Item, O("S", 1, s), O("Small", 1, s)));
        var nullOption = await seller.PostAsync("/api/commerce/catalogue", new StringContent(
            "{\"title\":\"Null option\",\"description\":\"Synthetic\",\"priceMinor\":100,\"category\":0,\"options\":[null]}",
            System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, twice.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, nullOption.StatusCode);
    }

    [Fact]
    public async Task ARetryAfterTheSellerRemovedTheOption_SaysItIsNoLongerAvailable()
    {
        var (competitionId, seller, listing) = await ApprovedAsync(Item("Hoodie", null, O("M", 2), O("L", 2)), demo: true);
        var (buyer, _) = await _f.SignupAsync();
        var order = await (await PlaceAsync(buyer, competitionId, Order("removed-option", L(listing.Id, 1, OptionId(listing, "M"))))).ReadAsync<EventOrderDto>();
        (await buyer.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-checkout", new FakeCheckoutRequest("decline", FakePaymentOutcome.Decline)))
            .EnsureSuccessStatusCode();
        (await seller.PutAsJsonAsync($"/api/commerce/catalogue/{listing.Item.Id}", Update(listing.Item, O("L", 2, OptionId(listing, "L")))))
            .EnsureSuccessStatusCode();

        var retry = await buyer.PostAsJsonAsync($"/api/commerce/orders/{order.Id}/demo-checkout", new FakeCheckoutRequest("retry", FakePaymentOutcome.Success));

        Assert.Equal(HttpStatusCode.Conflict, retry.StatusCode);
        Assert.Contains("Hoodie in M is no longer available", await retry.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AnExistingSqliteDatabaseGainsTheOptionTableAndColumns_WithoutLosingData()
    {
        var (competitionId, _, listing) = await ApprovedAsync(Item("Schema hoodie", null, O("M", 3)));
        var (buyer, _) = await _f.SignupAsync();
        (await PlaceAsync(buyer, competitionId, Order("schema-option", L(listing.Id, 1, OptionId(listing, "M"))))).EnsureSuccessStatusCode();
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("""
            DROP TABLE CatalogueItemOption;
            ALTER TABLE EventOrderLine DROP COLUMN CatalogueItemOptionId;
            ALTER TABLE EventOrderLine DROP COLUMN OptionLabel;
            ALTER TABLE EventOrderLine DROP COLUMN ReservedOptionStockQuantity;
            """);

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services); // safe to run again

        db.ChangeTracker.Clear();
        var line = await db.Set<EventOrderLine>().FirstAsync(x => x.CatalogueItemId == listing.CatalogueItemId);
        Assert.Equal(("Schema hoodie", null, 0), (line.TitleSnapshot, line.OptionLabel, line.ReservedOptionStockQuantity));
        db.Add(new CatalogueItemOption { CatalogueItemId = listing.CatalogueItemId, Label = "L", StockQuantity = 2 });
        line.OptionLabel = "L";
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Equal("L", (await db.Set<EventOrderLine>().FirstAsync(x => x.Id == line.Id)).OptionLabel);
        Assert.Equal(2, (await db.Set<CatalogueItemOption>().SingleAsync(x => x.CatalogueItemId == listing.CatalogueItemId)).StockQuantity);
    }
}
