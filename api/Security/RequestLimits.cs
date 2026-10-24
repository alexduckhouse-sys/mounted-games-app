using System.Threading.RateLimiting;
using System.Security.Claims;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Services;
using RedisRateLimiting;

namespace MountedGames.Api.Security;

public static class RequestLimits
{
    /// <summary>The statistics hub: search and profiles, per signed-in user or per address (<c>RateLimits:StatsPerMinute</c>, 60).</summary>
    public const string StatsPolicy = "stats";

    /// <summary>"Resend my confirmation email": per signed-in user (<c>RateLimits:EmailResendPerMinute</c>, 3).</summary>
    public const string EmailResendPolicy = "email-resend";

    /// <summary>Entering a competition section (which can send a confirmation email): per signed-in user or IP (<c>RateLimits:SignupPerMinute</c>, 15).</summary>
    public const string SignupPolicy = "signup";

    /// <summary>Joining a team: per signed-in user (RateLimits:TeamJoinPerMinute, 10).</summary>
    public const string TeamJoinPolicy = "team-join";

    /// <summary>Reporting a listing: per IP (RateLimits:ShopReportsPerMinute, 10).</summary>
    public const string ShopReportPolicy = "shop-report";

    /// <summary>Unsubscribing from emails: per IP (RateLimits:UnsubscribePerMinute, 10).</summary>
    public const string UnsubscribePolicy = "unsubscribe";

    /// <summary>Interactive scorer-link reads: per IP, separate from previews and weather (RateLimits:ScorerReadsPerMinute, 120).</summary>
    public const string ScorerReadPolicy = "scorer-read";

    /// <summary>
    /// Per-minute limits for sign-in (per IP), geocoding (per IP), API writes (per user, or per IP when anonymous), the public
    /// calendar and link-preview reads (per IP) and sponsor "shown" counts (per IP). <c>RateLimits:AuthPerMinute</c>,
    /// <c>RateLimits:GeocodePerMinute</c>, <c>RateLimits:WritesPerMinute</c>, <c>RateLimits:PublicReadsPerMinute</c> and
    /// <c>RateLimits:SponsorExposurePerMinute</c> override the defaults.
    /// </summary>
    public static IServiceCollection AddRequestLimits(this IServiceCollection services, IConfiguration configuration)
    {
        var authPermits = configuration.GetValue("RateLimits:AuthPerMinute", 10);
        var writePermits = configuration.GetValue("RateLimits:WritesPerMinute", 60);
        // Volunteers at one venue often share an address, so scorer-link saves get a roomier per-IP allowance.
        var scorerPermits = configuration.GetValue("RateLimits:ScorerWritesPerMinute", 240);
        var geocodePermits = configuration.GetValue("RateLimits:GeocodePerMinute", 20);
        var publicReadPermits = configuration.GetValue("RateLimits:PublicReadsPerMinute", 120);
        var exposurePermits = configuration.GetValue("RateLimits:SponsorExposurePerMinute", 12);
        // Each search reads across every competition, so the web waits for a pause in typing before it asks.
        var statsPermits = configuration.GetValue("RateLimits:StatsPerMinute", 60);
        var resendPermits = configuration.GetValue("RateLimits:EmailResendPerMinute", 3);
        var signupPermits = configuration.GetValue("RateLimits:SignupPerMinute", 15);
        var joinPermits = configuration.GetValue("RateLimits:TeamJoinPerMinute", 10);
        var reportPermits = configuration.GetValue("RateLimits:ShopReportsPerMinute", 10);
        var unsubscribePermits = configuration.GetValue("RateLimits:UnsubscribePerMinute", 10);
        var scorerReadPermits = configuration.GetValue("RateLimits:ScorerReadsPerMinute", 120);
        return services.AddRateLimiter(options =>
        {
            Configure(options, authPermits, writePermits, geocodePermits, scorerPermits, publicReadPermits, exposurePermits);
            options.AddPolicy(StatsPolicy, context => Partition(context, $"stats:{WritePartition(context)}", statsPermits));
            options.AddPolicy(EmailResendPolicy, context => Partition(context, $"email-resend:{WritePartition(context)}", resendPermits));
            options.AddPolicy(SignupPolicy, context => Partition(context, $"signup:{WritePartition(context)}", signupPermits));
            options.AddPolicy(TeamJoinPolicy, context => Partition(context, $"team-join:{WritePartition(context)}", joinPermits));
            options.AddPolicy(ShopReportPolicy, context => Partition(context, $"shop-report:{context.Connection.RemoteIpAddress}", reportPermits));
            options.AddPolicy(UnsubscribePolicy, context => Partition(context, $"unsubscribe:{context.Connection.RemoteIpAddress}", unsubscribePermits));
            options.AddPolicy(ScorerReadPolicy, context => Partition(context, $"scorer-read:{context.Connection.RemoteIpAddress}", scorerReadPermits));
        });
    }

    private static void Configure(RateLimiterOptions options, int authPermits, int writePermits, int geocodePermits, int scorerPermits, int publicReadPermits, int exposurePermits)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.AddPolicy("auth", context => Partition(context, $"auth:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}", authPermits));
        // Geocoding can call the paid What3Words API, so callers are limited per IP.
        options.AddPolicy("geocode", context => Partition(context, $"geocode:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}", geocodePermits));
        // Anonymous reads made by crawlers and calendar apps (link previews, calendar files and feeds).
        options.AddPolicy("public-read", context => Partition(context, $"public-read:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}", publicReadPermits));
        // Sponsor "shown" counts are anonymous, so they are limited per IP; the web batches them to a couple a minute.
        options.AddPolicy("sponsor-exposure", context => Partition(context, $"sponsor-exposure:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}", exposurePermits));
        options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            !context.Request.Path.StartsWithSegments("/api") || HttpMethods.IsGet(context.Request.Method)
                || HttpMethods.IsHead(context.Request.Method) || HttpMethods.IsOptions(context.Request.Method)
                ? RateLimitPartition.GetNoLimiter("read")
                : context.Request.Path.StartsWithSegments("/api/scorer")
                    ? Partition(context, $"scorer:{context.Connection.RemoteIpAddress}", scorerPermits)
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
