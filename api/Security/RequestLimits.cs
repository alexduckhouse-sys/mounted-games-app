using System.Threading.RateLimiting;
using System.Security.Claims;
using Microsoft.AspNetCore.RateLimiting;

namespace MountedGames.Api.Security;

public static class RequestLimits
{
    /// <summary>
    /// Per-minute limits for sign-in (per IP) and API writes (per user, or per IP when anonymous).
    /// <c>RateLimits:AuthPerMinute</c> and <c>RateLimits:WritesPerMinute</c> override the defaults.
    /// </summary>
    public static IServiceCollection AddRequestLimits(this IServiceCollection services, IConfiguration configuration)
    {
        var authPermits = configuration.GetValue("RateLimits:AuthPerMinute", 10);
        var writePermits = configuration.GetValue("RateLimits:WritesPerMinute", 60);
        return services.AddRateLimiter(options => Configure(options, authPermits, writePermits));
    }

    private static void Configure(RateLimiterOptions options, int authPermits, int writePermits)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => Window(authPermits)));
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            !context.Request.Path.StartsWithSegments("/api") || HttpMethods.IsGet(context.Request.Method)
                || HttpMethods.IsHead(context.Request.Method) || HttpMethods.IsOptions(context.Request.Method)
                ? RateLimitPartition.GetNoLimiter("read")
                : RateLimitPartition.GetFixedWindowLimiter(WritePartition(context), _ => Window(writePermits)));
        options.OnRejected = (context, _) =>
        {
            context.HttpContext.Response.Headers.RetryAfter = "60";
            return ValueTask.CompletedTask;
        };
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
