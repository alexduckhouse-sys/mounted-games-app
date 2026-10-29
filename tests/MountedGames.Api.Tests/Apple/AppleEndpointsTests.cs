using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Apple;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Apple;
using MountedGames.Api.Tests.Infrastructure;
namespace MountedGames.Api.Tests.Apple;

public sealed class AppleApiFactory : ApiFactory
{
    public FakeApplePush Push { get; } = new();
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Apple:EncryptionKey", Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)));
        builder.UseSetting("Apple:LiveActivitiesEnabled", "true"); builder.UseSetting("Apple:WalletEnabled", "true");
        builder.UseSetting("Apple:TeamId", "EXAMPLE"); builder.UseSetting("Apple:BundleId", "example.test"); builder.UseSetting("Apple:ApnsKeyId", "EXAMPLE");
        // These are deliberately unusable markers: protocol tests replace delivery, never create signing credentials.
        builder.UseSetting("Apple:ApnsPrivateKey", "unused-test-double"); builder.UseSetting("Apple:PassCertificateBase64", "unused-test-double");
        builder.UseSetting("Apple:PassIntermediateBase64", "unused-test-double"); builder.UseSetting("Apple:PassTypeId", "pass.example.test");
        builder.UseSetting("Apple:WakeKey", new string('x', 40)); builder.UseSetting("Sharing:PublicBaseUrl", "https://example.invalid");
        builder.ConfigureServices(services => {
            var worker = services.FirstOrDefault(x => x.ServiceType == typeof(IHostedService) && x.ImplementationType == typeof(AppleDeliveryWorker));
            if (worker != null) services.Remove(worker);
            services.RemoveAll<IApplePushProvider>(); services.AddSingleton<IApplePushProvider>(Push);
            services.AddDbContext<AppDbContext>(options => options.ReplaceService<IExecutionStrategyFactory, AppleTestExecutionStrategyFactory>());
        });
    }
}
public sealed class FakeApplePush : IApplePushProvider
{
    public ApplePushResult Outcome { get; set; } = ApplePushResult.Accepted;
    public List<string> LiveTokens { get; } = [];
    public Task<ApplePushResult> LiveAsync(string token, bool sandbox, string payload, DateTime expires, CancellationToken ct) { LiveTokens.Add(token); return Task.FromResult(Outcome); }
    public Task<ApplePushResult> WalletAsync(string token, CancellationToken ct) => Task.FromResult(Outcome);
}
public sealed class AppleEndpointsTests(AppleApiFactory f) : IClassFixture<AppleApiFactory>
{
    [Fact]
    public async Task GateAndBookings_EnforceOwnerAndCompetitionStaffAccess()
    {
        var (owner, auth) = await f.SignupAsync("Member"); var (other, _) = await f.SignupAsync("Member");
        var section = await f.NewSectionAsync(); var path = $"/api/competitions/{section.CompetitionId}/arrival-bookings";
        var signup = await f.InDbAsync(async db => { var entry = new SectionSignup { CompetitionSectionId = section.Id, UserId = auth.User.Id, FullName = "Example rider", Status = SignupPaymentStatus.Paid }; db.Add(entry); await db.SaveChangesAsync(); return entry.Id; });
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync(path)).StatusCode);
        var created = await owner.PostAsJsonAsync(path, new ArrivalBookingRequest(0, signup, "EXAMPLE", [])); created.EnsureSuccessStatusCode(); var booking = await created.ReadAsync<ArrivalBookingDto>();
        Assert.Empty(await (await other.GetAsync(path)).ReadAsync<List<ArrivalBookingDto>>());
        Assert.Equal(HttpStatusCode.Conflict, (await other.PutAsJsonAsync(path + "/" + booking.Id, new ArrivalBookingRequest(booking.Revision, null, "OTHER", []))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.GetAsync(path + "/gate/" + booking.Reference)).StatusCode);
        var trainer = await f.TrainerAsync(); Assert.Equal(HttpStatusCode.NotFound, (await trainer.GetAsync(path + "/gate/" + booking.Reference)).StatusCode);
        var admin = await f.AdminAsync(); var gate = await admin.GetAsync(path + "/gate/" + booking.Reference); gate.EnsureSuccessStatusCode();
        var current = await gate.ReadAsync<ArrivalBookingDto>(); Assert.Equal("paid", current.Admission); Assert.Empty(current.Benefits);
    }
    [Fact]
    public async Task FinalQuantityAndStableNight_CannotBeAssignedToTwoVehicles()
    {
        var (client, auth) = await f.SignupAsync("Member"); var section = await f.NewSectionAsync(); var line = await Line(section.CompetitionId, auth.User.Id, 2);
        var path = $"/api/competitions/{section.CompetitionId}/arrival-bookings";
        var a = await (await client.PostAsJsonAsync(path, new ArrivalBookingRequest(0, null, "ONE", [new(line, 1)]))).ReadAsync<ArrivalBookingDto>();
        var b = await (await client.PostAsJsonAsync(path, new ArrivalBookingRequest(0, null, "TWO", [new(line, 1)]))).ReadAsync<ArrivalBookingDto>();
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(path, new ArrivalBookingRequest(0, null, "THREE", [new(line, 1)]))).StatusCode);
        var admin = await f.AdminAsync();
        var requests = new[] { (a, "A1"), (b, "a1") }.Select(async pair => await admin.PutAsJsonAsync(path + $"/{pair.Item1.Id}/allocations",
            new ArrivalAllocateRequest(pair.Item1.Revision, [new(pair.Item1.Benefits.Single().SourceId, pair.Item2, "2026-10-29")])));
        var replies = await Task.WhenAll(requests); Assert.Single(replies, x => x.IsSuccessStatusCode); Assert.Single(replies, x => x.StatusCode == HttpStatusCode.Conflict);
    }
    [Fact]
    public async Task PassKit_StableTokenAndGlobalCursor_OnlyReturnRegisteredSerials()
    {
        var (client, auth) = await f.SignupAsync("Member"); var section = await f.NewSectionAsync(); var line = await Line(section.CompetitionId, auth.User.Id, 2);
        var path = $"/api/competitions/{section.CompetitionId}/arrival-bookings";
        var a = await (await client.PostAsJsonAsync(path, new ArrivalBookingRequest(0, null, "A", [new(line, 1)]))).ReadAsync<ArrivalBookingDto>();
        var b = await (await client.PostAsJsonAsync(path, new ArrivalBookingRequest(0, null, "B", [new(line, 1)]))).ReadAsync<ArrivalBookingDto>();
        async Task<(string Serial, string Token)> Issue(Guid id) {
            using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var service = scope.ServiceProvider.GetRequiredService<ArrivalBookingService>();
            return await service.ExecuteAsync(async () => {
                var booking = await service.LoadAsync(id, section.CompetitionId, default);
                var pass = (await service.RefreshPassAsync(booking!, true, default))!;
                return (pass.Serial, scope.ServiceProvider.GetRequiredService<AppleSecrets>().Unprotect(pass.ProtectedAuthenticationToken, "wallet-auth"));
            }, default);
        }
        var pa = await Issue(a.Id); var pb = await Issue(b.Id); var device = Guid.NewGuid().ToString("N");
        var wallet = f.CreateClient(); var registration = $"/api/apple/wallet/v1/devices/{device}/registrations/pass.example.test";
        wallet.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("ApplePass", pb.Token);
        Assert.Equal(HttpStatusCode.Created, (await wallet.PostAsJsonAsync(registration + "/" + pb.Serial, new WalletRegisterRequest(new string('a', 64)))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await wallet.PostAsJsonAsync(registration + "/" + pb.Serial, new WalletRegisterRequest(new string('b', 64)))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await wallet.PostAsJsonAsync(registration + "/" + pa.Serial, new WalletRegisterRequest(new string('c', 64)))).StatusCode);
        for (var n = 0; n < 10; n++) { a = await (await client.PutAsJsonAsync(path + "/" + a.Id, new ArrivalBookingRequest(a.Revision, null, $"A{n}", [new(line, 1)]))).ReadAsync<ArrivalBookingDto>(); }
        var first = await (await wallet.GetAsync(registration)).Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var since = first.GetProperty("lastUpdated").GetString(); Assert.Single(first.GetProperty("serialNumbers").EnumerateArray());
        b = await (await client.PutAsJsonAsync(path + "/" + b.Id, new ArrivalBookingRequest(b.Revision, null, "B2", [new(line, 1)]))).ReadAsync<ArrivalBookingDto>();
        var changed = await (await wallet.GetAsync(registration + "?passesUpdatedSince=" + since)).Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(pb.Serial, Assert.Single(changed.GetProperty("serialNumbers").EnumerateArray()).GetString()); Assert.Equal(pb, await Issue(b.Id));
        Assert.Equal(HttpStatusCode.NoContent, (await wallet.GetAsync(registration + "?passesUpdatedSince=" + changed.GetProperty("lastUpdated").GetString())).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await wallet.DeleteAsync(registration + "/" + pb.Serial)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await wallet.GetAsync(registration)).StatusCode);
    }
    [Fact]
    public async Task Installation_RotationRetryAndDismissal_AreScopedAndDurable()
    {
        var section = await f.NewSectionAsync(); var club = await f.SeedClubAsync(); var team = await f.SeedTeamAsync(section.CompetitionId, section.Id, club);
        var client = f.CreateClient(); var installation = await (await client.PostAsync("/api/apple/installations", null)).ReadAsync<NativeInstallationDto>();
        var path = $"/api/apple/installations/{installation.InstallationId}/activities";
        var activity = new AppleActivityRequest(Guid.NewGuid().ToString(), section.CompetitionId, team, new string('a', 64), false, DateTimeOffset.UtcNow);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync(path, activity)).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("AppleInstallation", installation.Capability);
        (await client.PutAsJsonAsync(path, activity)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync(path, activity with { ActivityId = "another" })).StatusCode);
        (await client.PutAsJsonAsync(path, activity with { PushToken = new string('b', 64) })).EnsureSuccessStatusCode();
        var protectedToken = await f.InDbAsync(db => db.Set<LiveActivityRegistration>().Where(x => x.InstallationId == installation.InstallationId).Select(x => x.ProtectedPushToken).SingleAsync());
        Assert.DoesNotContain(new string('b', 64), protectedToken);
        f.Push.Outcome = ApplePushResult.Retry;
        using (var scope = f.Services.CreateScope()) await scope.ServiceProvider.GetRequiredService<AppleDeliveryRunner>().RunAsync(default);
        Assert.Contains(new string('b', 64), f.Push.LiveTokens);
        Assert.True(await f.InDbAsync(db => db.Set<LiveActivityRegistration>().AnyAsync(x => x.InstallationId == installation.InstallationId && x.Attempts == 1 && x.LeaseToken == null)));
        await f.InDbAsync(db => db.Set<LiveActivityRegistration>().Where(x => x.InstallationId == installation.InstallationId).ExecuteUpdateAsync(s => s.SetProperty(x => x.NextAttemptAt, DateTime.UtcNow.AddMinutes(-1))));
        f.Push.Outcome = ApplePushResult.Accepted;
        using (var scope = f.Services.CreateScope()) await scope.ServiceProvider.GetRequiredService<AppleDeliveryRunner>().RunAsync(default);
        (await client.DeleteAsync(path + "/" + activity.ActivityId)).EnsureSuccessStatusCode(); var count = f.Push.LiveTokens.Count;
        using (var scope = f.Services.CreateScope()) await scope.ServiceProvider.GetRequiredService<AppleDeliveryRunner>().RunAsync(default);
        Assert.Equal(count, f.Push.LiveTokens.Count);
    }
    [Fact]
    public async Task CatalogueClassification_RequiresSellerAndPreservesExistingOrderSnapshot()
    {
        var (seller, auth) = await f.SignupAsync("Member"); var (other, _) = await f.SignupAsync("Member");
        var section = await f.NewSectionAsync(); var line = await Line(section.CompetitionId, auth.User.Id, 2);
        var item = await f.InDbAsync(db => db.Set<EventOrderLine>().Where(x => x.Id == line).Select(x => x.CatalogueItemId).SingleAsync());
        var path = $"/api/apple/catalogue/{item}/fulfilment";
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(path)).StatusCode);
        var original = await (await seller.GetAsync(path)).ReadAsync<FulfilmentRequest>();
        var update = new FulfilmentRequest(ArrivalFulfilmentKind.Hookup, "2026-10-30", "2026-11-01", original.ExpectedVersion);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync(path, update)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await seller.PutAsJsonAsync(path, update with { UntilDate = "2026-10-30" })).StatusCode);
        (await seller.PutAsJsonAsync(path, update)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await seller.PutAsJsonAsync(path, update)).StatusCode);
        Assert.Equal(ArrivalFulfilmentKind.Stable, await f.InDbAsync(db => db.Set<EventOrderLine>().Where(x => x.Id == line).Select(x => x.FulfilmentKindSnapshot).SingleAsync()));
    }
    [Fact]
    public async Task StaffCanSplitOneEntrantsPurchaseAcrossVehicles_AndSeeBothBesideEntry()
    {
        var (_, auth) = await f.SignupAsync("Member"); var section = await f.NewSectionAsync(); var line = await Line(section.CompetitionId, auth.User.Id, 2);
        var signup = await f.InDbAsync(async db => { var entry = new SectionSignup { CompetitionSectionId = section.Id, UserId = auth.User.Id, FullName = "Example entrant", Status = SignupPaymentStatus.Paid }; db.Add(entry); await db.SaveChangesAsync(); return entry.Id; });
        var admin = await f.AdminAsync(); var path = $"/api/competitions/{section.CompetitionId}/arrival-bookings";
        (await admin.PostAsJsonAsync(path, new ArrivalBookingRequest(0, signup, "ONE", [new(line, 1)]))).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync(path + $"?forSignupId={signup}", new ArrivalBookingRequest(0, null, "TWO", [new(line, 1)]))).EnsureSuccessStatusCode();
        var rows = await (await admin.GetAsync(path + $"?signupId={signup}")).ReadAsync<List<ArrivalBookingDto>>();
        Assert.Equal(2, rows.Count); Assert.Single(rows, x => x.SignupId == signup); Assert.All(rows, x => Assert.Equal("paid", Assert.Single(x.Benefits).Status));
    }
    [Fact]
    public async Task RetryingProvider_RequiresWholeTransactionDelegate()
    {
        using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.True(db.Database.CreateExecutionStrategy().RetriesOnFailure);
        await using (var transaction = await db.Database.BeginTransactionAsync())
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.Set<AppleChangeClock>().AnyAsync());
        var service = scope.ServiceProvider.GetRequiredService<ArrivalBookingService>();
        Assert.True(await service.ExecuteAsync(() => db.Set<AppleChangeClock>().AnyAsync(), default));
    }
    private Task<int> Line(int competitionId, string owner, int quantity) => f.InDbAsync(async db => {
        var item = new CatalogueItem { SellerUserId = owner, Title = "Example booking" }; var listing = new CompetitionListing { CompetitionId = competitionId, CatalogueItem = item, SellerUserId = owner };
        var order = new EventOrder { CompetitionId = competitionId, BuyerUserId = owner, Status = CommerceOrderStatus.Paid, IdempotencyKey = Guid.NewGuid().ToString(), RequestHash = "example" };
        db.AddRange(item, listing, order); await db.SaveChangesAsync();
        var line = new EventOrderLine { EventOrderId = order.Id, CatalogueItemId = item.Id, CompetitionListingId = listing.Id, SellerUserId = owner, TitleSnapshot = "Example stable", Quantity = quantity,
            FulfilmentKindSnapshot = ArrivalFulfilmentKind.Stable, FulfilmentFromDate = "2026-10-29", FulfilmentUntilDate = "2026-10-31" }; db.Add(line); await db.SaveChangesAsync(); return line.Id;
    });
}

public sealed class AppleTestExecutionStrategyFactory(ExecutionStrategyDependencies dependencies) : IExecutionStrategyFactory
{
    public IExecutionStrategy Create() => new AppleTestExecutionStrategy(dependencies);
}
public sealed class AppleTestExecutionStrategy(ExecutionStrategyDependencies dependencies) : ExecutionStrategy(dependencies, 1, TimeSpan.Zero)
{
    protected override bool ShouldRetryOn(Exception exception) => false;
}
