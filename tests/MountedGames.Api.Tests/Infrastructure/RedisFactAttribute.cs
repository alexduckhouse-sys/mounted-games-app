namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>
/// A test that needs a real Redis. It runs when <c>REDIS_TEST_URL</c> is set (CI starts a Redis service)
/// and is skipped otherwise, e.g. <c>REDIS_TEST_URL=redis://localhost:6379 dotnet test</c> locally.
/// </summary>
public sealed class RedisFactAttribute : FactAttribute
{
    public static string? Url => Environment.GetEnvironmentVariable("REDIS_TEST_URL");

    public RedisFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Url)) Skip = "Set REDIS_TEST_URL to run tests against Redis.";
    }
}

/// <summary>The real API pointed at the test Redis, with its own sign-in limit; two of these act as two instances.</summary>
public sealed class RedisApiFactory(int authPerMinute = 100000, string? redisUrl = null, int authPerIpPerMinute = 100000) : ApiFactory
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Redis:ConnectionString", redisUrl ?? RedisFactAttribute.Url);
        builder.UseSetting("RateLimits:AuthPerMinute", authPerMinute.ToString());
        builder.UseSetting("RateLimits:AuthPerIpPerMinute", authPerIpPerMinute.ToString());
    }
}
