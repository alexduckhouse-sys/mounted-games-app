using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MountedGames.Api.Security;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Security;

public class ProxyClientIpTests
{
    private const string Key = "test-proxy-key-0123456789-0123456789-abcd";

    private static async Task<(HttpContext Context, bool Called)> InvokeAsync(string? configuredKey, string? presentedKey, string? clientIp)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Security:ProxyKey"] = configuredKey })
            .Build();
        var called = false;
        var middleware = new ProxyClientIpMiddleware(_ => { called = true; return Task.CompletedTask; },
            configuration, NullLogger<ProxyClientIpMiddleware>.Instance);
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse("10.0.0.5");
        if (presentedKey is not null) context.Request.Headers[ProxyClientIpMiddleware.KeyHeader] = presentedKey;
        if (clientIp is not null) context.Request.Headers[ProxyClientIpMiddleware.ClientIpHeader] = clientIp;
        await middleware.InvokeAsync(context);
        return (context, called);
    }

    [Theory]
    [InlineData("198.51.100.7")]
    [InlineData("2001:db8::7")]
    public async Task TrustsTheForwardedIp_OnlyWithTheRightKey(string ip)
    {
        var (context, called) = await InvokeAsync(Key, Key, ip);
        Assert.True(called);
        Assert.Equal(IPAddress.Parse(ip), context.Connection.RemoteIpAddress);
    }

    [Theory]
    [InlineData(Key, "wrong-key-0123456789-0123456789-0123456789", "198.51.100.7")] // wrong key
    [InlineData(Key, Key + "x", "198.51.100.7")]                                      // longer key
    [InlineData(Key, "", "198.51.100.7")]                                             // empty key
    [InlineData(Key, null, "198.51.100.7")]                                           // no key header
    [InlineData(Key, Key, "not-an-ip")]                                               // unparseable IP
    [InlineData(Key, Key, null)]                                                      // no IP header
    [InlineData(null, Key, "198.51.100.7")]                                           // feature not configured
    [InlineData("too-short-key", "too-short-key", "198.51.100.7")]                    // weak key is ignored
    public async Task KeepsTheConnectionIp_Otherwise(string? configured, string? presented, string? ip)
    {
        var (context, called) = await InvokeAsync(configured, presented, ip);
        Assert.True(called);
        Assert.Equal(IPAddress.Parse("10.0.0.5"), context.Connection.RemoteIpAddress);
    }

    [Theory]
    [InlineData(Key)]
    [InlineData("wrong-key-0123456789-0123456789-0123456789")]
    public async Task AlwaysRemovesBothHeaders_SoNothingDownstreamSeesTheKey(string presented)
    {
        var (context, _) = await InvokeAsync(Key, presented, "198.51.100.7");
        Assert.False(context.Request.Headers.ContainsKey(ProxyClientIpMiddleware.KeyHeader));
        Assert.False(context.Request.Headers.ContainsKey(ProxyClientIpMiddleware.ClientIpHeader));
    }

    private sealed class ProxyKeyApiFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Security:ProxyKey", Key);
            builder.UseSetting("RateLimits:AuthPerMinute", "2");
        }
    }

    private static async Task<HttpStatusCode> SignInAsync(HttpClient client, string? presentedKey, string clientIp)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login")
        {
            Content = JsonContent.Create(new { email = "nobody@example.test", password = "not-the-password" })
        };
        // The connection itself always comes from one address, as it does behind Vercel.
        request.Headers.Add(TestIpStartupFilter.Header, "203.0.113.9");
        if (presentedKey is not null) request.Headers.Add(ProxyClientIpMiddleware.KeyHeader, presentedKey);
        request.Headers.Add(ProxyClientIpMiddleware.ClientIpHeader, clientIp);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    [Fact]
    public async Task EachProxiedVisitorGetsTheirOwnSignInLimit()
    {
        using var f = new ProxyKeyApiFactory();
        var client = f.CreateClient();
        Assert.NotEqual(HttpStatusCode.TooManyRequests, await SignInAsync(client, Key, "198.51.100.1"));
        Assert.NotEqual(HttpStatusCode.TooManyRequests, await SignInAsync(client, Key, "198.51.100.1"));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SignInAsync(client, Key, "198.51.100.1"));
        // Another visitor behind the same proxy still gets in.
        Assert.NotEqual(HttpStatusCode.TooManyRequests, await SignInAsync(client, Key, "198.51.100.2"));
    }

    [Fact]
    public async Task AClaimedIpWithoutTheKeyCannotDodgeTheLimit()
    {
        using var f = new ProxyKeyApiFactory();
        var client = f.CreateClient();
        Assert.NotEqual(HttpStatusCode.TooManyRequests, await SignInAsync(client, "wrong", "198.51.100.1"));
        Assert.NotEqual(HttpStatusCode.TooManyRequests, await SignInAsync(client, "wrong", "198.51.100.2"));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SignInAsync(client, "wrong", "198.51.100.3"));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SignInAsync(client, null, "198.51.100.4"));
    }
}
