using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Security;

public class AuthRateLimitTests
{
    private sealed class LimitedFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("RateLimits:AuthPerMinute", "8");
            builder.UseSetting("RateLimits:AuthPerIpPerMinute", "60");
        }
    }

    [Fact]
    public async Task ExternalSignInHasAVenueBudgetWithoutAnEightPersonBottleneck()
    {
        using var factory = new LimitedFactory();
        using var client = factory.CreateClient();
        for (var i = 0; i < 60; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/external", new { provider = "fake-provider", idToken = "fake-token" });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/auth/external", new { provider = "fake-provider", idToken = "fake-token" })).StatusCode);
    }

    [Fact]
    public async Task EquivalentUnicodeAccountNamesShareTheIdentityNormalisationBudget()
    {
        using var factory = new LimitedFactory();
        using var client = factory.CreateClient();
        for (var i = 0; i < 8; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/login", new { email = "fake-é@example.invalid", password = "wrong" });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/auth/login", new { email = "fake-e\u0301@example.invalid", password = "wrong" })).StatusCode);
    }

    [Fact]
    public async Task BareSignupAliasesAndTheirLoginMailboxShareOneAccountBudget()
    {
        using var factory = new LimitedFactory();
        using var client = factory.CreateClient();
        // Invalid passwords avoid creating any accounts while exercising real username binding.
        for (var i = 0; i < 8; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/signup-trainer", new { username = i % 2 == 0 ? "Fake Name!" : "FAKE NAME", password = "" });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/auth/login", new { email = "fakename@trainer.mg.local", password = "wrong" })).StatusCode);
    }
}
