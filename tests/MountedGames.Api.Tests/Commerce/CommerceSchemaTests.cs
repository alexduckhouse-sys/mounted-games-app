using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Commerce;

public class CommerceSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    public CommerceSchemaTests(ApiFactory factory) => _factory = factory;

    [Fact]
    public async Task ExistingSqliteDatabaseGainsShopTablesAndPreservesOrdersOnRestart()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var competitionId = await db.Competitions.Select(x => x.Id).FirstAsync();
        var userId = await db.Users.Select(x => x.Id).FirstAsync();
        var results = await db.Results.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Points }).ToListAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE TestPaymentRecord; DROP TABLE EventOrderLine; DROP TABLE EventOrder; DROP TABLE CompetitionListing; DROP TABLE EventCommerceSettings; DROP TABLE CatalogueItem;");

        await DbInitializer.SeedAsync(_factory.Services);
        var item = new CatalogueItem { SellerUserId = userId, Title = "Synthetic item", PriceMinor = 500, StockQuantity = 3 };
        var listing = new CompetitionListing { CompetitionId = competitionId, CatalogueItem = item, SellerUserId = userId, Status = CommerceListingStatus.Approved };
        db.Add(listing);
        db.Add(new EventCommerceSettings { CompetitionId = competitionId, IsDemo = true });
        await db.SaveChangesAsync();
        var order = new EventOrder
        {
            CompetitionId = competitionId, BuyerUserId = userId, IdempotencyKey = "synthetic-schema-order", TotalMinor = 500,
            Status = CommerceOrderStatus.Paid, HasStockReservation = true,
            Lines = [new EventOrderLine { CatalogueItemId = item.Id, CompetitionListingId = listing.Id, SellerUserId = userId,
                TitleSnapshot = item.Title, UnitPriceMinorSnapshot = 500, Quantity = 1, ReservedStockQuantity = 1, LineTotalMinor = 500 }],
            TestPayments = [new TestPaymentRecord { CompetitionId = competitionId, OwnerUserId = userId,
                IdempotencyKey = "synthetic-schema-payment", AmountMinor = 500, ReceiptReference = "TEST-schema" }],
        };
        order.MarkAsTestOrder();
        db.Add(order);
        await db.SaveChangesAsync();
        await DbInitializer.SeedAsync(_factory.Services);
        db.ChangeTracker.Clear();

        var saved = await db.Set<EventOrder>().Include(x => x.Lines).Include(x => x.TestPayments).SingleAsync();
        Assert.True(saved.Id > 0);
        Assert.True(saved.IsTestOrder);
        Assert.Equal(500, saved.TotalMinor);
        Assert.Equal(1, Assert.Single(saved.Lines).ReservedStockQuantity);
        Assert.True(Assert.Single(saved.TestPayments).IsTest);
        Assert.Equal(1, (await db.Set<CatalogueItem>().SingleAsync()).Version);
        Assert.Equal(3, (await db.Set<CatalogueItem>().SingleAsync()).StockQuantity);
        Assert.True((await db.Set<EventCommerceSettings>().SingleAsync()).IsDemo);
        Assert.Single(await db.Set<CompetitionListing>().ToListAsync());
        Assert.Equal(results, await db.Results.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.TeamId, x.Points }).ToListAsync());
    }
}
