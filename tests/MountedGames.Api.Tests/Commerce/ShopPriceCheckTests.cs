using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Commerce;

/// <summary>A basket line can carry the price the buyer saw; if the seller changed it since, the order is refused and nothing is created.</summary>
public class ShopPriceCheckTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ShopPriceCheckTests(ApiFactory f) => _f = f;

    private async Task<(int CompetitionId, CompetitionListingDto Listing)> ApprovedAsync(int priceMinor = 2500, int? stock = 10)
    {
        var competitionId = await _f.SeedCompetitionAsync();
        var (seller, _) = await _f.SignupAsync();
        var created = await seller.PostAsJsonAsync("/api/commerce/catalogue",
            new CreateCatalogueItemRequest("Price test item", "Synthetic test item", priceMinor, stock, CommerceItemCategory.Merchandise, null, null, null, []));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var item = await created.ReadAsync<CatalogueItemDto>();
        var submit = await seller.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/listings", new CreateCompetitionListingRequest(item.Id));
        submit.EnsureSuccessStatusCode();
        var listing = await submit.ReadAsync<CompetitionListingDto>();
        var approve = await (await _f.AdminAsync()).PutAsJsonAsync($"/api/commerce/listings/{listing.Id}/approval",
            new UpdateCompetitionListingApprovalRequest(CommerceListingStatus.Approved, null));
        approve.EnsureSuccessStatusCode();
        return (competitionId, await approve.ReadAsync<CompetitionListingDto>());
    }

    private static CreateEventOrderLineRequest L(int listingId, int quantity, int? expectedPrice = null) =>
        new(listingId, quantity, null, null, expectedPrice);

    private Task ChangePriceAsync(CompetitionListingDto listing, int priceMinor) => _f.InDbAsync(async db =>
    {
        (await db.Set<CatalogueItem>().SingleAsync(x => x.Id == listing.CatalogueItemId)).PriceMinor = priceMinor;
        await db.SaveChangesAsync();
    });

    private static Task<HttpResponseMessage> PlaceAsync(HttpClient buyer, int competitionId, string key, params CreateEventOrderLineRequest[] lines) =>
        buyer.PostAsJsonAsync($"/api/commerce/competitions/{competitionId}/orders", new CreateEventOrderRequest(key, lines));

    private Task<int?> StockAsync(CompetitionListingDto listing) => _f.InDbAsync(db =>
        db.Set<CatalogueItem>().AsNoTracking().Where(x => x.Id == listing.CatalogueItemId).Select(x => x.StockQuantity).SingleAsync());

    [Fact]
    public async Task APriceThatStillMatches_OrdersAsNormal()
    {
        var (competitionId, listing) = await ApprovedAsync(2500);
        var (buyer, _) = await _f.SignupAsync();

        var response = await PlaceAsync(buyer, competitionId, $"match-{Guid.NewGuid():N}", L(listing.Id, 2, 2500));

        response.EnsureSuccessStatusCode();
        var order = await response.ReadAsync<EventOrderDto>();
        Assert.Equal(5000, order.TotalMinor);
    }

    [Fact]
    public async Task AChangedPrice_IsRefusedWithTheNewPrice_AndCreatesNothing()
    {
        var (competitionId, listing) = await ApprovedAsync(2500, stock: 10);
        var (buyer, _) = await _f.SignupAsync();
        await ChangePriceAsync(listing, 3000);

        var response = await PlaceAsync(buyer, competitionId, $"changed-{Guid.NewGuid():N}", L(listing.Id, 2, 2500));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("£30.00", body);
        Assert.Contains("changed", body);
        Assert.Empty(await (await buyer.GetAsync("/api/commerce/orders/mine")).ReadAsync<List<EventOrderDto>>());
        Assert.Equal(10, await StockAsync(listing));
    }

    [Fact]
    public async Task WithoutAnExpectedPrice_TheCurrentPriceIsCharged_SoOlderClientsStillWork()
    {
        var (competitionId, listing) = await ApprovedAsync(2500);
        var (buyer, _) = await _f.SignupAsync();
        await ChangePriceAsync(listing, 3000);

        var response = await PlaceAsync(buyer, competitionId, $"legacy-{Guid.NewGuid():N}", L(listing.Id, 1));

        response.EnsureSuccessStatusCode();
        Assert.Equal(3000, (await response.ReadAsync<EventOrderDto>()).TotalMinor);
    }

    [Fact]
    public async Task ARepeatOfAnOrderAlreadyPlaced_ReplaysIt_EvenAfterThePriceMoves()
    {
        var (competitionId, listing) = await ApprovedAsync(2500);
        var (buyer, _) = await _f.SignupAsync();
        var key = $"replay-{Guid.NewGuid():N}";
        var first = await (await PlaceAsync(buyer, competitionId, key, L(listing.Id, 1, 2500))).ReadAsync<EventOrderDto>();
        await ChangePriceAsync(listing, 3000);

        var again = await PlaceAsync(buyer, competitionId, key, L(listing.Id, 1, 2500));

        again.EnsureSuccessStatusCode();
        Assert.Equal(first.Id, (await again.ReadAsync<EventOrderDto>()).Id);
        Assert.Single(await (await buyer.GetAsync("/api/commerce/orders/mine")).ReadAsync<List<EventOrderDto>>());
    }

    [Fact]
    public async Task ANegativeOrConflictingExpectedPrice_IsABadRequest()
    {
        var (competitionId, listing) = await ApprovedAsync(2500);
        var (buyer, _) = await _f.SignupAsync();

        var negative = await PlaceAsync(buyer, competitionId, $"neg-{Guid.NewGuid():N}", L(listing.Id, 1, -1));
        var conflicting = await PlaceAsync(buyer, competitionId, $"two-{Guid.NewGuid():N}",
            L(listing.Id, 1, 2500), L(listing.Id, 1, 2600));

        Assert.Equal(HttpStatusCode.BadRequest, negative.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, conflicting.StatusCode);
    }

    [Fact]
    public async Task TheSameItemSentTwiceWithTheSamePrice_IsOneLine()
    {
        var (competitionId, listing) = await ApprovedAsync(2500);
        var (buyer, _) = await _f.SignupAsync();

        var response = await PlaceAsync(buyer, competitionId, $"dup-{Guid.NewGuid():N}",
            L(listing.Id, 1, 2500), L(listing.Id, 2, 2500));

        response.EnsureSuccessStatusCode();
        var line = Assert.Single((await response.ReadAsync<EventOrderDto>()).Lines);
        Assert.Equal(3, line.Quantity);
    }

    [Fact]
    public async Task AnonymousBuyers_AreStillTurnedAway()
    {
        var (competitionId, listing) = await ApprovedAsync();

        var response = await PlaceAsync(_f.CreateClient(), competitionId, "anon", L(listing.Id, 1, 2500));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
