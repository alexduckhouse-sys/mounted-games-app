using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Push;

public class PushTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public PushTests(ApiFactory f) => _f = f;

    /// <summary>An endpoint on a push host the API accepts.</summary>
    public static string AllowedEndpoint(string? id = null) => $"https://fcm.googleapis.com/fcm/send/{id ?? Guid.NewGuid().ToString("N")}";

    [Fact]
    public async Task VapidPublicKey_IsPublic_AndStableAcrossCalls()
    {
        var c = _f.CreateClient();

        var a = await (await c.GetAsync("/api/push/vapid-public-key")).ReadAsync<VapidPublicKeyResponse>();
        var b = await (await c.GetAsync("/api/push/vapid-public-key")).ReadAsync<VapidPublicKeyResponse>();

        Assert.Equal((false, a.PublicKey), (string.IsNullOrEmpty(a.PublicKey), b.PublicKey));
    }

    [Fact]
    public async Task Subscribe_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest("https://x/1", "p", "a"));

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Subscribe_Returns400_WhenEndpointBlank()
    {
        var (me, _) = await _f.SignupAsync();

        var r = await me.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(" ", "p", "a"));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Subscribe_AddsSubscription_ThenUpdatesKeysForSameOwner()
    {
        var endpoint = AllowedEndpoint();
        var (me, auth) = await _f.SignupAsync();
        await me.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(endpoint, "old", "old"));

        var r = await me.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(endpoint, "new-key", "new-auth"));

        var rows = await _f.InDbAsync(db => db.PushSubscriptions.Where(s => s.Endpoint == endpoint).ToListAsync());
        Assert.Equal(
            (HttpStatusCode.NoContent, 1, auth.User.Id, "new-key"),
            (r.StatusCode, rows.Count, rows[0].UserId, rows[0].P256dh));
    }

    [Fact]
    public async Task Subscribe_Returns409_WhenAnotherUserClaimsTheEndpoint()
    {
        var endpoint = AllowedEndpoint();
        var (first, firstAuth) = await _f.SignupAsync();
        var (second, _) = await _f.SignupAsync();
        await first.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(endpoint, "old", "old"));

        var r = await second.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(endpoint, "new-key", "new-auth"));

        var row = await _f.InDbAsync(db => db.PushSubscriptions.SingleAsync(s => s.Endpoint == endpoint));
        Assert.Equal((HttpStatusCode.Conflict, firstAuth.User.Id, "old"), (r.StatusCode, row.UserId, row.P256dh));
    }

    [Fact]
    public async Task Subscribe_Returns400_ForEndpointOutsideKnownPushServices()
    {
        var (me, _) = await _f.SignupAsync();

        var r = await me.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest("https://push.example/abc", "p", "a"));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Unsubscribe_WithEndpoint_RemovesOnlyThatOwnSubscription()
    {
        var (me, auth) = await _f.SignupAsync();
        var keep = AllowedEndpoint();
        var drop = AllowedEndpoint();
        await me.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(keep, "p", "a"));
        await me.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(drop, "p", "a"));

        var r = await me.DeleteAsync($"/api/push/subscribe?endpoint={Uri.EscapeDataString(drop)}");

        var left = await _f.InDbAsync(db => db.PushSubscriptions.Where(s => s.UserId == auth.User.Id).Select(s => s.Endpoint).ToListAsync());
        Assert.Equal((HttpStatusCode.NoContent, keep), (r.StatusCode, left.Single()));
    }

    [Fact]
    public async Task Unsubscribe_WithUnknownEndpoint_IsNoOp()
    {
        var (me, _) = await _f.SignupAsync();

        var r = await me.DeleteAsync("/api/push/subscribe?endpoint=https%3A%2F%2Fnope.example%2Fx");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
    }

    [Fact]
    public async Task Unsubscribe_WithoutEndpoint_RemovesAllOfMySubscriptions_NotOthers()
    {
        var (me, myAuth) = await _f.SignupAsync();
        var (other, otherAuth) = await _f.SignupAsync();
        await me.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(AllowedEndpoint(), "p", "a"));
        await me.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(AllowedEndpoint(), "p", "a"));
        await other.PostAsJsonAsync("/api/push/subscribe", new PushSubscribeRequest(AllowedEndpoint(), "p", "a"));

        await me.DeleteAsync("/api/push/subscribe");

        var counts = await _f.InDbAsync(async db =>
            (await db.PushSubscriptions.CountAsync(s => s.UserId == myAuth.User.Id),
             await db.PushSubscriptions.CountAsync(s => s.UserId == otherAuth.User.Id)));
        Assert.Equal((0, 1), counts);
    }

    [Fact]
    public async Task Unsubscribe_Returns401_WhenAnonymous()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().DeleteAsync("/api/push/subscribe")).StatusCode);
    }

    [Fact]
    public async Task Test_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/push/test", new SendTestPushRequest(null, null));

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Test_WithNoSubscriptions_Succeeds()
    {
        var (me, _) = await _f.SignupAsync();

        var r = await me.PostAsJsonAsync("/api/push/test", new SendTestPushRequest("Hi", "There"));

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
    }

    [Fact]
    public async Task Test_AcceptsEmptyBody()
    {
        var (me, _) = await _f.SignupAsync();

        var r = await me.PostAsync("/api/push/test", new StringContent("null", System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
    }

    [Fact]
    public async Task Test_DeliversPayloadToSubscribedEndpoint()
    {
        using var push = new FakePushService(_f.Http, HttpStatusCode.Created);
        var (me, _) = await _f.SignupAsync();
        await me.PostAsJsonAsync("/api/push/subscribe", FakePushService.Subscription(push.Endpoint));

        await me.PostAsJsonAsync("/api/push/test", new SendTestPushRequest("Hello", "World"));

        Assert.Equal(1, push.Received);
    }

    [Fact]
    public async Task Test_RemovesSubscription_WhenPushServiceSaysGone()
    {
        using var push = new FakePushService(_f.Http, HttpStatusCode.Gone);
        var (me, auth) = await _f.SignupAsync();
        await me.PostAsJsonAsync("/api/push/subscribe", FakePushService.Subscription(push.Endpoint));

        await me.PostAsJsonAsync("/api/push/test", new SendTestPushRequest(null, null));

        Assert.Equal(0, await _f.InDbAsync(db => db.PushSubscriptions.CountAsync(s => s.UserId == auth.User.Id)));
    }

    [Fact]
    public async Task Test_KeepsSubscription_WhenPushServiceFailsTransiently()
    {
        using var push = new FakePushService(_f.Http, HttpStatusCode.InternalServerError);
        var (me, auth) = await _f.SignupAsync();
        await me.PostAsJsonAsync("/api/push/subscribe", FakePushService.Subscription(push.Endpoint));

        var r = await me.PostAsJsonAsync("/api/push/test", new SendTestPushRequest(null, null));

        Assert.Equal(
            (HttpStatusCode.NoContent, 1),
            (r.StatusCode, await _f.InDbAsync(db => db.PushSubscriptions.CountAsync(s => s.UserId == auth.User.Id))));
    }

    [Fact]
    public async Task Notifier_SendToUsers_DoesNothing_ForEmptyUserList()
    {
        using var scope = _f.Services.CreateScope();
        var notifier = scope.ServiceProvider.GetRequiredService<PushNotifier>();

        await notifier.SendToUsersAsync(Array.Empty<string>(), new PushPayload("t", "b"));
    }

    [Fact]
    public void VapidKeyService_ReusesKeysPersistedOnDisk()
    {
        var a = _f.Services.GetRequiredService<VapidKeyService>();
        var env = _f.Services.GetRequiredService<IWebHostEnvironment>();

        var again = new VapidKeyService(env, _f.Services.GetRequiredService<IConfiguration>());

        Assert.Equal((a.PublicKey, a.PrivateKey), (again.PublicKey, again.PrivateKey));
    }

    [Fact]
    public void VapidKeyService_Throws_WhenKeyFileMalformed()
    {
        var dir = Directory.CreateTempSubdirectory();
        try
        {
            File.WriteAllText(Path.Combine(dir.FullName, "vapid-keys.json"), "null");
            var env = new StubEnv(dir.FullName);

            Assert.Throws<InvalidOperationException>(() => new VapidKeyService(env, new ConfigurationBuilder().Build()));
        }
        finally { dir.Delete(true); }
    }

    [Fact]
    public void VapidKeyService_GeneratesAndPersistsKeys_WhenNoneExist()
    {
        var dir = Directory.CreateTempSubdirectory();
        try
        {
            var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Push:Subject"] = "mailto:x@y.z" }).Build();

            var svc = new VapidKeyService(new StubEnv(dir.FullName), cfg);

            Assert.Equal(
                (true, "mailto:x@y.z", svc.PublicKey),
                (File.Exists(Path.Combine(dir.FullName, "vapid-keys.json")), svc.Subject, svc.Details().PublicKey));
        }
        finally { dir.Delete(true); }
    }

    private sealed class StubEnv : IWebHostEnvironment
    {
        public StubEnv(string root) => ContentRootPath = root;
        public string ApplicationName { get; set; } = "t";
        public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; } = null!;
        public string WebRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Testing";
        public string ContentRootPath { get; set; }
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }
}

/// <summary>A loopback HTTP listener standing in for a browser vendor's push service.</summary>
/// <summary>
/// A push service reached through the test host's <see cref="StubHttp"/>. Its endpoint is on an
/// allowed push host (see PushEndpointPolicy) and unique, so each instance counts only its own sends.
/// </summary>
public sealed class FakePushService : IDisposable
{
    private readonly HttpStatusCode _status;
    private int _received;
    private readonly SemaphoreSlim _arrived = new(0);

    public string Endpoint { get; }
    public int Received => Volatile.Read(ref _received);

    public FakePushService(StubHttp http, HttpStatusCode status)
    {
        _status = status;
        var id = Guid.NewGuid().ToString("N");
        Endpoint = PushTests.AllowedEndpoint(id);
        http.Respond(id, _ =>
        {
            Interlocked.Increment(ref _received);
            _arrived.Release();
            return new HttpResponseMessage(_status);
        });
    }

    /// <summary>A valid-looking subscription (real P-256 public key + 16-byte auth secret) pointing at this listener.</summary>
    public static PushSubscribeRequest Subscription(string endpoint)
    {
        using var ec = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var p = ec.ExportParameters(false);
        var key = new byte[65];
        key[0] = 4;
        p.Q.X!.CopyTo(key, 1);
        p.Q.Y!.CopyTo(key, 33);
        return new PushSubscribeRequest(endpoint, B64Url(key), B64Url(RandomNumberGenerator.GetBytes(16)));
    }

    private static string B64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Waits (bounded) until <paramref name="count"/> requests have arrived.</summary>
    public async Task WaitForAsync(int count)
    {
        for (var i = 0; i < count; i++)
            if (!await _arrived.WaitAsync(TimeSpan.FromSeconds(15)))
                throw new TimeoutException($"Expected {count} push request(s); only {i} arrived.");
    }

    public void Dispose() => _arrived.Dispose();
}
