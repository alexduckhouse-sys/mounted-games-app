using System.Threading.RateLimiting;
using System.Security.Claims;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Services;
using RedisRateLimiting;

namespace MountedGames.Api.Security;

public static class RequestLimits
{
    /// <summary>
    /// Per-minute limits for sign-in (per IP), geocoding (per IP) and API writes (per user, or per IP when anonymous).
    /// <c>RateLimits:AuthPerMinute</c>, <c>RateLimits:GeocodePerMinute</c> and <c>RateLimits:WritesPerMinute</c> override the defaults.
    /// </summary>
    public static IServiceCollection AddRequestLimits(this IServiceCollection services, IConfiguration configuration)
    {
        var authPermits = configuration.GetValue("RateLimits:AuthPerMinute", 10);
        var writePermits = configuration.GetValue("RateLimits:WritesPerMinute", 60);
        var geocodePermits = configuration.GetValue("RateLimits:GeocodePerMinute", 20);
        return services.AddRateLimiter(options => Configure(options, authPermits, writePermits, geocodePermits));
    }

    private static void Configure(RateLimiterOptions options, int authPermits, int writePermits, int geocodePermits)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.AddPolicy("auth", context => Partition(context, $"auth:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}", authPermits));
        // Geocoding can call the paid What3Words API, so callers are limited per IP.
        options.AddPolicy("geocode", context => Partition(context, $"geocode:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}", geocodePermits));
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            !context.Request.Path.StartsWithSegments("/api") || HttpMethods.IsGet(context.Request.Method)
                || HttpMethods.IsHead(context.Request.Method) || HttpMethods.IsOptions(context.Request.Method)
                ? RateLimitPartition.GetNoLimiter("read")
                : Partition(context, $"write:{WritePartition(context)}", writePermits));
        options.OnRejected = (context, _) =>
        {
            context.HttpContext.Response.Headers.RetryAfter = "60";
            return ValueTask.CompletedTask;
        };
    }

    /// <summary>
    /// A per-minute window for <paramref name="key"/>. With Redis reachable, the window is shared by every API
    /// instance; otherwise each instance counts on its own. The two use different keys, so a switch starts afresh.
    /// </summary>
    private static RateLimitPartition<string> Partition(HttpContext context, string key, int permits)
    {
        var redis = context.RequestServices.GetService<RedisConnection>()?.Available;
        return redis is null
            ? RateLimitPartition.GetFixedWindowLimiter($"memory:{key}", _ => Window(permits))
            : RedisRateLimitPartition.GetFixedWindowRateLimiter($"mg:rl:{key}", _ => new RedisFixedWindowRateLimiterOptions
            {
                ConnectionMultiplexerFactory = () => redis,
                PermitLimit = permits,
                Window = TimeSpan.FromMinutes(1),
            });
    }

    private static string WritePartition(HttpContext context)
    {
        var uid = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        return context.User.Identity?.IsAuthenticated == true && !string.IsNullOrEmpty(uid)
            ? $"user:{uid}"
            : $"ip:{context.Connection.RemoteIpAddress}";
    }

    private static FixedWindowRateLimiterOptions Window(int permits) => new()
    {
        PermitLimit = permits,
        Window = TimeSpan.FromMinutes(1),
        QueueLimit = 0,
    };
}
