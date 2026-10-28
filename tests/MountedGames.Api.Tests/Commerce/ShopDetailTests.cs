using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Commerce;

/// <summary>An item can ask the buyer for something (a stable number); the answer rides on the order line.</summary>
public class ShopDetailTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ShopDetailTests(ApiFactory f) => _f = f;

    private async Task<CatalogueItemDto> ItemAsync(HttpClient seller, string title, string? prompt, string? hint = null)
    {
        var response = await seller.PostAsJsonAsync("/api/commerce/catalogue",
            new CreateCatalogueItemRequest(title, "Collect at the event", 800, null, CommerceItemCategory.Merchandise, null, prompt, hint));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<CatalogueItemDto>();
    }

    private async Task<(int CompetitionId, HttpClient Seller, CompetitionListingDto Listing)> ApprovedAsync(string title, string? prompt, string? hint = null)
    {
        var competitionId = await _f.SeedCompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var item = await ItemAsync(seller, title, prompt, hint);
        var submit = await seller.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/listings", new CreateCompetitionListingRequest(item.Id));
        submit.EnsureSuccessStatusCode();
        var listing = await submit.ReadAsync<CompetitionListingDto>();
        var admin = await _f.AdminAsync();
        var approve = await admin.PutAsJsonAsync($"/api/commerce/listings/{listing.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));
        approve.EnsureSuccessStatusCode();
        return (competitionId, seller, await approve.ReadAsync<CompetitionListingDto>());
    }

    private static CreateEventOrderLineRequest L(int listingId, int quantity, string? detail = null) => new(listingId, quantity, detail);

    private static CreateEventOrderRequest Order(string key, params CreateEventOrderLineRequest[] lines) => new(key, lines);

    private Task<HttpResponseMessage> PlaceAsync(HttpClient buyer, int competitionId, CreateEventOrderRequest order) =>
        buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders", order);

    [Fact]
    public async Task TheItemKeepsItsPromptAndHint_AndThePublicListingCarriesThem()
    {
        var (competitionId, seller, listing) = await ApprovedAsync("Shavings", "  Stable number ", " e.g. B12 ");

        Assert.Equal(("Stable number", "e.g. B12"), (listing.Item.DetailPrompt, listing.Item.DetailHint));
        var publicList = await (await _f.CreateClient().GetAsync($"/api/commerce/competitions/{competitionId}/listings"))
            .ReadAsync<List<PublicCompetitionListingDto>>();
        var shown = Assert.Single(publicList);
        Assert.Equal(("Stable number", "e.g. B12"), (shown.DetailPrompt, shown.DetailHint));

        // The seller can change or drop them with the usual versioned update.
        var item = listing.Item;
        var changed = await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}", new UpdateCatalogueItemRequest(
            item.Title, item.Description, item.PriceMinor, item.StockQuantity, item.Category, item.ImageUrl, true, item.Version, "Number plate", null));
        changed.EnsureSuccessStatusCode();
        var updated = await changed.ReadAsync<CatalogueItemDto>();
        Assert.Equal(("Number plate", null), (updated.DetailPrompt, updated.DetailHint));
        var dropped = await seller.PutAsJsonAsync($"/api/commerce/catalogue/{item.Id}", new UpdateCatalogueItemRequest(
            item.Title, item.Description, item.PriceMinor, item.StockQuantity, item.Category, item.ImageUrl, true, updated.Version, "  ", "Orphan hint"));
        var droppedItem = await dropped.ReadAsync<CatalogueItemDto>();
        // A hint with no question has nowhere to show, so both go.
        Assert.Null(droppedItem.DetailPrompt);
        Assert.Null(droppedItem.DetailHint);
    }

    [Fact]
    public async Task TheShopPageCanAskWhichEventsHaveItemsOnSale()
    {
        var (withItems, _, _) = await ApprovedAsync("Ribbons", null);
        var without = await _f.SeedCompetitionAsync();

        var ids = await (await _f.CreateClient().GetAsync("/api/commerce/competitions/with-items")).ReadAsync<List<int>>();

        Assert.Contains(withItems, ids);
        Assert.DoesNotContain(without, ids);
    }

    [Fact]
    public async Task APromptOrHintThatIsTooLong_IsRefused()
    {
        var (seller, _) = await _f.SignupAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await seller.PostAsJsonAsync("/api/commerce/catalogue",
            new CreateCatalogueItemRequest("Long prompt", "Desc", 100, null, CommerceItemCategory.Other, null, new string('p', 61), null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await seller.PostAsJsonAsync("/api/commerce/catalogue",
            new CreateCatalogueItemRequest("Long hint", "Desc", 100, null, CommerceItemCategory.Other, null, "Prompt", new string('h', 81)))).StatusCode);
    }

    [Fact]
    public async Task AMissingDetail_IsA400NamingThePrompt_AndNothingIsReserved()
    {
        var (competitionId, _, listing) = await ApprovedAsync("Shavings", "Stable number");
        var (buyer, _) = await _f.SignupAsync();

        foreach (var detail in new string?[] { null, "", "   " })
        {
            var response = await PlaceAsync(buyer, competitionId, Order($"missing-{Guid.NewGuid():N}", L(listing.Id, 1, detail)));
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains("Enter the stable number for Shavings.", await response.Content.ReadAsStringAsync());
        }
        Assert.Empty(await _f.InDbAsync(db => db.Set<EventOrder>().Where(o => o.CompetitionId == competitionId).ToListAsync()));
    }

    [Fact]
    public async Task APromptWithCapitals_KeepsThem()
    {
        var (competitionId, _, listing) = await ApprovedAsync("Passport check", "FEI number");
        var (buyer, _) = await _f.SignupAsync();

        var response = await PlaceAsync(buyer, competitionId, Order("caps", L(listing.Id, 1)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Enter the FEI number for Passport check.", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task TheDetail_IsTrimmedStored_AndShownToTheOrganiserTheBuyerAndTheSeller()
    {
        var (competitionId, seller, listing) = await ApprovedAsync("Shavings", "Stable number");
        var (buyer, _) = await _f.SignupAsync();

        var response = await PlaceAsync(buyer, competitionId, Order("with-detail", L(listing.Id, 2, "  B12 ")));
        response.EnsureSuccessStatusCode();
        var order = await response.ReadAsync<EventOrderDto>();
        Assert.Equal("B12", Assert.Single(order.Lines).Detail);

        var admin = await _f.AdminAsync();
        var organiser = await (await admin.GetAsync($"/api/commerce/competitions/{competitionId}/orders")).ReadAsync<List<EventOrderDto>>();
        Assert.Equal("B12", Assert.Single(Assert.Single(organiser).Lines).Detail);
        var mine = await (await buyer.GetAsync("/api/commerce/orders/mine")).ReadAsync<List<EventOrderDto>>();
        Assert.Equal("B12", Assert.Single(Assert.Single(mine).Lines).Detail);
        var sales = await (await seller.GetAsync("/api/commerce/sales/mine")).ReadAsync<List<SellerSaleDto>>();
        Assert.Equal("B12", Assert.Single(Assert.Single(sales).Lines).Detail);
    }

    [Fact]
    public async Task AnItemThatAsksForNothing_DropsAnyDetailSent()
    {
        var (competitionId, _, listing) = await ApprovedAsync("Programme", null);
        var (buyer, _) = await _f.SignupAsync();

        var order = await (await PlaceAsync(buyer, competitionId, Order("no-prompt", L(listing.Id, 1, "stray")))).ReadAsync<EventOrderDto>();

        Assert.Null(Assert.Single(order.Lines).Detail);
    }

    [Fact]
    public async Task ADetailOverEightyCharacters_IsRefused()
    {
        var (competitionId, _, listing) = await ApprovedAsync("Shavings", "Stable number");
        var (buyer, _) = await _f.SignupAsync();

        var response = await PlaceAsync(buyer, competitionId, Order("too-long", L(listing.Id, 1, new string('9', 81))));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task TheSameListingTwice_MergesWhenTheDetailsAgree_AndIsRefusedWhenTheyDiffer()
    {
        var (competitionId, _, listing) = await ApprovedAsync("Shavings", "Stable number");
        var (buyer, _) = await _f.SignupAsync();

        var merged = await PlaceAsync(buyer, competitionId, Order("merge", L(listing.Id, 1, "B12"), L(listing.Id, 2, "B12"), L(listing.Id, 1, null)));
        merged.EnsureSuccessStatusCode();
        var line = Assert.Single((await merged.ReadAsync<EventOrderDto>()).Lines);
        Assert.Equal((4, "B12"), (line.Quantity, line.Detail));

        var clash = await PlaceAsync(buyer, competitionId, Order("clash", L(listing.Id, 1, "B12"), L(listing.Id, 1, "C3")));
        Assert.Equal(HttpStatusCode.BadRequest, clash.StatusCode);
    }

    [Fact]
    public async Task ARetryWithTheSameDetailReplays_ButADifferentDetailUnderTheSameKeyIsAConflict()
    {
        var (competitionId, _, listing) = await ApprovedAsync("Shavings", "Stable number");
        var (buyer, _) = await _f.SignupAsync();
        var first = await (await PlaceAsync(buyer, competitionId, Order("retry", L(listing.Id, 1, "B12")))).ReadAsync<EventOrderDto>();

        var again = await (await PlaceAsync(buyer, competitionId, Order("retry", L(listing.Id, 1, " B12 ")))).ReadAsync<EventOrderDto>();
        var different = await PlaceAsync(buyer, competitionId, Order("retry", L(listing.Id, 1, "C3")));

        Assert.Equal(first.Id, again.Id);
        Assert.Equal(HttpStatusCode.Conflict, different.StatusCode);
    }

    [Fact]
    public async Task AnExistingSqliteDatabaseGainsTheColumns_WithoutLosingData()
    {
        var (competitionId, _, listing) = await ApprovedAsync("Schema item", "Stable number");
        var (buyer, _) = await _f.SignupAsync();
        (await PlaceAsync(buyer, competitionId, Order("schema", L(listing.Id, 1, "A1")))).EnsureSuccessStatusCode();
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE CatalogueItem DROP COLUMN DetailPrompt; ALTER TABLE CatalogueItem DROP COLUMN DetailHint; ALTER TABLE EventOrderLine DROP COLUMN Detail;");

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services); // safe to run again

        db.ChangeTracker.Clear();
        var item = await db.Set<CatalogueItem>().SingleAsync(x => x.Id == listing.CatalogueItemId);
        Assert.Equal("Schema item", item.Title);
        item.DetailPrompt = "Stable number";
        var line = await db.Set<EventOrderLine>().FirstAsync(x => x.CatalogueItemId == item.Id);
        line.Detail = "A1";
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Equal("A1", (await db.Set<EventOrderLine>().FirstAsync(x => x.CatalogueItemId == item.Id)).Detail);
    }
}
