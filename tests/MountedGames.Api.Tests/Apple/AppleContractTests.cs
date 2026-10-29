using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Apple;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Apple;
namespace MountedGames.Api.Tests.Apple;

public class AppleContractTests
{
    [Fact]
    public void ActivityPayload_UsesSwiftReferenceDateAndUnixEnvelope()
    {
        var observed = new DateTimeOffset(2026, 10, 29, 12, 0, 0, TimeSpan.Zero);
        var snapshot = new TeamProgressSnapshotDto(new(1, 2, TeamProgressStatus.Paused, 3, 4, 2, 1, "Arena", "Heat 4"), observed, observed.AddMinutes(5));
        using var json = JsonDocument.Parse(ApplePushProvider.LivePayload(snapshot, observed.ToUnixTimeSeconds(), false));
        var aps = json.RootElement.GetProperty("aps");
        Assert.Equal("update", aps.GetProperty("event").GetString());
        Assert.Equal(observed.ToUnixTimeSeconds(), aps.GetProperty("timestamp").GetInt64());
        Assert.Equal((observed - new DateTimeOffset(2001, 1, 1, 0, 0, 0, TimeSpan.Zero)).TotalSeconds,
            aps.GetProperty("content-state").GetProperty("observedAt").GetDouble());
        Assert.Equal(3, aps.GetProperty("content-state").GetProperty("status").GetInt32());
        Assert.Equal(observed.AddMinutes(5).ToUnixTimeSeconds(), aps.GetProperty("stale-date").GetInt64());
        using var ended = JsonDocument.Parse(ApplePushProvider.LivePayload(snapshot, observed.ToUnixTimeSeconds(), true));
        Assert.Equal("end", ended.RootElement.GetProperty("aps").GetProperty("event").GetString());
    }
    [Fact]
    public void Tokens_AreProtectedAndBoundToPurpose()
    {
        var secrets = new AppleSecrets(Options()); var token = AppleSecrets.NewToken(); var cipher = secrets.Protect(token, "wallet-auth");
        Assert.DoesNotContain(token, cipher); Assert.Equal(token, secrets.Unprotect(cipher, "wallet-auth"));
        Assert.ThrowsAny<CryptographicException>(() => secrets.Unprotect(cipher, "activity-push"));
        Assert.True(AppleSecrets.Matches(token, AppleSecrets.Hash(token))); Assert.False(AppleSecrets.Matches(token + "a", AppleSecrets.Hash(token)));
        Assert.False(Options().LiveReady); Assert.False(Options().WalletReady);
    }
    [Fact]
    public async Task PaidEntry_DoesNotGrantStabling_AndUnpaidLineStaysPending()
    {
        await using var test = await Fixture.Create();
        var entry = new SectionSignup { Section = test.Section, UserId = "owner", Status = SignupPaymentStatus.Paid, FullName = "Example Entrant" };
        test.Db.Add(entry); await test.Db.SaveChangesAsync();
        await using var tx = await test.BeginAsync();
        var booking = await test.Service.SaveAsync(test.Competition.Id, "owner", null, new(0, entry.Id, "EXAMPLE", []), default);
        var view = await test.Service.ProjectAsync(booking, default);
        Assert.Equal("paid", view.Admission); Assert.Empty(view.Benefits);
        await tx.CommitAsync();
        test.Order.Status = CommerceOrderStatus.AwaitingManualPayment; await test.Db.SaveChangesAsync();
        await using var next = await test.BeginAsync();
        var pending = await test.Service.SaveAsync(test.Competition.Id, "owner", null, new(0, null, "EXAMPLE2", [new(test.Line.Id, 1)]), default);
        view = await test.Service.ProjectAsync(pending, default); Assert.True(view.Voided); Assert.Equal("pending", Assert.Single(view.Benefits).Status);
    }
    [Fact]
    public async Task PaidStablingWithoutSignup_IsValid_RefundRemovesOnlyThatBenefit()
    {
        await using var test = await Fixture.Create();
        var entry = new SectionSignup { Section = test.Section, UserId = "owner", Status = SignupPaymentStatus.Paid, FullName = "Example Entrant" };
        test.Db.Add(entry); await test.Db.SaveChangesAsync();
        await using (var tx = await test.BeginAsync()) {
            var booking = await test.Service.SaveAsync(test.Competition.Id, "owner", null, new(0, entry.Id, "EXAMPLE", [new(test.Line.Id, 1)]), default);
            Assert.Equal("paid", Assert.Single((await test.Service.ProjectAsync(booking, default)).Benefits).Status); await tx.CommitAsync();
        }
        test.Order.Status = CommerceOrderStatus.Refunded; await test.Db.SaveChangesAsync();
        var row = await test.Db.Set<ArrivalBooking>().Include(x => x.Sources).ThenInclude(x => x.Allocations).SingleAsync();
        var view = await test.Service.ProjectAsync(row, default); Assert.Equal("paid", view.Admission); Assert.False(view.Voided); Assert.Equal("cancelled", Assert.Single(view.Benefits).Status);
    }
    [Fact]
    public async Task Quantities_AreConservedAcrossVehicles_AndOwnerCannotBorrowAnotherOrder()
    {
        await using var test = await Fixture.Create();
        await using (var tx = await test.BeginAsync()) {
            await test.Service.SaveAsync(test.Competition.Id, "owner", null, new(0, null, "ONE", [new(test.Line.Id, 1)]), default); await tx.CommitAsync();
        }
        await using var next = await test.BeginAsync();
        await Assert.ThrowsAsync<ArrivalConflict>(() => test.Service.SaveAsync(test.Competition.Id, "owner", null, new(0, null, "TWO", [new(test.Line.Id, 1)]), default));
        await Assert.ThrowsAsync<ArrivalConflict>(() => test.Service.SaveAsync(test.Competition.Id, "someone-else", null, new(0, null, "THREE", [new(test.Line.Id, 1)]), default));
    }
    [Fact]
    public async Task Allocation_RejectsUnpaidOrOutOfDateAndStaleEdits()
    {
        await using var test = await Fixture.Create(); await using var tx = await test.BeginAsync();
        var booking = await test.Service.SaveAsync(test.Competition.Id, "owner", null, new(0, null, "EXAMPLE", [new(test.Line.Id, 1)]), default);
        var source = booking.Sources.Single().Id;
        await Assert.ThrowsAsync<ArrivalConflict>(() => test.Service.AllocateAsync(booking, new(booking.Revision, [new(source, "A1", "2026-11-01")]), default));
        await Assert.ThrowsAsync<ArrivalConflict>(() => test.Service.AllocateAsync(booking, new(0, [new(source, "A1", "2026-10-29")]), default));
        await test.Service.AllocateAsync(booking, new(booking.Revision, [new(source, "A1", "2026-10-29")]), default);
        Assert.Equal("A1", Assert.Single(Assert.Single((await test.Service.ProjectAsync(booking, default)).Benefits).Allocations).Resource);
    }
    [Fact]
    public async Task GlobalCursor_SeesLowRevisionPassAfterHighRevisionPass_AndPreservesToken()
    {
        await using var test = await Fixture.Create(); test.Line.Quantity = 2; await test.Db.SaveChangesAsync();
        ArrivalBooking a, b; WalletPass pa, pb;
        await using (var tx = await test.BeginAsync()) {
            a = await test.Service.SaveAsync(test.Competition.Id, "owner", null, new(0, null, "A", [new(test.Line.Id, 1)]), default);
            b = await test.Service.SaveAsync(test.Competition.Id, "owner", null, new(0, null, "B", [new(test.Line.Id, 1)]), default);
            pa = (await test.Service.RefreshPassAsync(a, true, default))!; pb = (await test.Service.RefreshPassAsync(b, true, default))!; await tx.CommitAsync();
        }
        var token = pb.ProtectedAuthenticationToken;
        for (var n = 0; n < 10; n++) { await using var tx = await test.BeginAsync(); a.VehicleRegistration = $"A{n}"; await test.Service.RefreshPassAsync(a, false, default); await tx.CommitAsync(); }
        var watermark = pa.ChangeCursor;
        await using (var tx = await test.BeginAsync()) { b.VehicleRegistration = "B2"; await test.Service.RefreshPassAsync(b, false, default); await tx.CommitAsync(); }
        Assert.True(pb.ChangeCursor > watermark); Assert.Equal(2, pb.Revision); Assert.Equal(token, pb.ProtectedAuthenticationToken); Assert.NotEqual(pa.Serial, pb.Serial);
    }
    [Fact]
    public async Task SqliteUpgrade_IsIdempotentAndPreservesExistingRows()
    {
        await using var test = await Fixture.Create(); await AppleFeatures.EnsureAppleSqliteSchema(test.Db); await AppleFeatures.EnsureAppleSqliteSchema(test.Db);
        Assert.Equal("Example event", (await test.Db.Competitions.SingleAsync()).Name);
        Assert.Equal(1, await test.Db.Set<AppleChangeClock>().CountAsync());
    }
    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task TestOrdersAndDemoEvents_CannotIssueRealEntitlements(bool testOrder, bool demoEvent)
    {
        await using var test = await Fixture.Create();
        await using (var tx = await test.BeginAsync()) {
            await test.Service.SaveAsync(test.Competition.Id, "owner", null, new(0, null, "EXAMPLE", [new(test.Line.Id, 1)]), default); await tx.CommitAsync();
        }
        if (testOrder) test.Order.MarkAsTestOrder();
        if (demoEvent) test.Db.Add(new EventCommerceSettings { CompetitionId = test.Competition.Id, IsDemo = true });
        await test.Db.SaveChangesAsync();
        var booking = await test.Db.Set<ArrivalBooking>().Include(x => x.Sources).ThenInclude(x => x.Allocations).SingleAsync();
        var view = await test.Service.ProjectAsync(booking, default); Assert.True(view.Voided); Assert.Equal("unavailable", Assert.Single(view.Benefits).Status);
        await using var next = await test.BeginAsync();
        await Assert.ThrowsAsync<ArrivalConflict>(() => test.Service.RefreshPassAsync(booking, true, default));
    }
    internal static AppleOptions Options() => new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
        ["Apple:EncryptionKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) }).Build());
    private sealed class TestDb(DbContextOptions<AppDbContext> options) : AppDbContext(options)
    { protected override void OnModelCreating(ModelBuilder b) { base.OnModelCreating(b); if (b.Model.FindEntityType(typeof(AppleChangeClock)) == null) b.ConfigureAppleModels(); } }
    private sealed class Fixture : IAsyncDisposable
    {
        public required AppDbContext Db; public required SqliteConnection Connection; public required ArrivalBookingService Service;
        public required Competition Competition; public required CompetitionSection Section; public required EventOrder Order; public required EventOrderLine Line;
        public static async Task<Fixture> Create()
        {
            var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
            var db = new TestDb(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options); await db.Database.EnsureCreatedAsync();
            var options = Options(); var owner = new AppUser { Id = "owner", UserName = "example-owner" };
            var competition = new Competition { Name = "Example event", StartDate = new(2026, 10, 29), EndDate = new(2026, 10, 31) };
            var section = new CompetitionSection { Competition = competition, DisplayName = "Example section" };
            var item = new CatalogueItem { Seller = owner, Title = "Example stable", FulfilmentKind = ArrivalFulfilmentKind.Stable };
            var listing = new CompetitionListing { Competition = competition, CatalogueItem = item, SellerUserId = "owner" };
            var order = new EventOrder { Competition = competition, Buyer = owner, BuyerUserId = "owner", Status = CommerceOrderStatus.Paid, IdempotencyKey = Guid.NewGuid().ToString(), RequestHash = "example" };
            db.AddRange(owner, competition, section, item, listing, order); await db.SaveChangesAsync();
            var line = new EventOrderLine { EventOrderId = order.Id, CatalogueItemId = item.Id, CompetitionListingId = listing.Id, SellerUserId = "owner", TitleSnapshot = "Example stable", Quantity = 1,
                FulfilmentKindSnapshot = ArrivalFulfilmentKind.Stable, FulfilmentFromDate = "2026-10-29", FulfilmentUntilDate = "2026-10-31" };
            db.Add(line); await db.SaveChangesAsync();
            return new() { Db = db, Connection = connection, Service = new(db, options, new(options), TimeProvider.System), Competition = competition, Section = section, Order = order, Line = line };
        }
        public async Task<Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction> BeginAsync()
        {
            var tx = await Db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
            try {
                await Db.Set<AppleChangeClock>().Where(x => x.Id == 1).ExecuteUpdateAsync(s => s.SetProperty(x => x.Value, x => x.Value));
                return tx;
            } catch { await tx.DisposeAsync(); throw; }
        }
        public async ValueTask DisposeAsync() { await Db.DisposeAsync(); await Connection.DisposeAsync(); }
    }
}
