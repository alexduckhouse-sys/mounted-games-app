using System.Threading.RateLimiting;
using System.Security.Claims;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Services;
using RedisRateLimiting;

namespace MountedGames.Api.Security;

public static class RequestLimits
{
    /// <summary>
    /// Per-minute limits for sign-in (per IP), API writes (per user, or per IP when anonymous) and the public
    /// calendar and link-preview reads (per IP). <c>RateLimits:AuthPerMinute</c>, <c>RateLimits:WritesPerMinute</c>
    /// and <c>RateLimits:PublicReadsPerMinute</c> override the defaults.
    /// </summary>
    public static IServiceCollection AddRequestLimits(this IServiceCollection services, IConfiguration configuration)
    {
        var authPermits = configuration.GetValue("RateLimits:AuthPerMinute", 10);
        var writePermits = configuration.GetValue("RateLimits:WritesPerMinute", 60);
        var publicReadPermits = configuration.GetValue("RateLimits:PublicReadsPerMinute", 120);
        return services.AddRateLimiter(options => Configure(options, authPermits, writePermits, publicReadPermits));
    }

    private static void Configure(RateLimiterOptions options, int authPermits, int writePermits, int publicReadPermits)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.AddPolicy("auth", context => Partition(context, $"auth:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}", authPermits));
        // Anonymous reads made by crawlers and calendar apps (link previews, calendar files and feeds).
        options.AddPolicy("public-read", context => Partition(context, $"public-read:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}", publicReadPermits));
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
