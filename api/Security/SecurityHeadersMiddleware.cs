namespace MountedGames.Api.Security;

public sealed class SecurityHeadersMiddleware(RequestDelegate next, IWebHostEnvironment environment)
{
    // The Vite build uses external scripts and self-hosted fonts. Keep this in
    // step with web/vercel.json; the parity test covers both deployment paths.
    public const string ContentSecurityPolicy = "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-elem 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://mounted-games-api.vercel.app wss://mounted-games-api.vercel.app; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; media-src 'self'; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests";

    public static readonly IReadOnlyDictionary<string, string> Headers = new Dictionary<string, string>
    {
        ["Content-Security-Policy"] = ContentSecurityPolicy,
        ["X-Content-Type-Options"] = "nosniff",
        ["X-Frame-Options"] = "DENY",
        ["Referrer-Policy"] = "strict-origin-when-cross-origin",
        ["Cross-Origin-Opener-Policy"] = "same-origin",
        ["Cross-Origin-Resource-Policy"] = "same-origin",
        ["Origin-Agent-Cluster"] = "?1",
        ["X-Permitted-Cross-Domain-Policies"] = "none",
        ["X-DNS-Prefetch-Control"] = "off",
        ["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=(), payment=(), browsing-topics=()",
        // No preload/includeSubDomains: ownership of every subdomain isn't established.
        ["Strict-Transport-Security"] = "max-age=63072000",
    };

    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            foreach (var (key, value) in Headers)
            {
                if (environment.IsDevelopment() && key is "Strict-Transport-Security" or "Content-Security-Policy") continue;
                context.Response.Headers[key] = value;
            }
            return Task.CompletedTask;
        });
        // Sensitive responses must not enter browser or intermediary caches.
        if (context.Request.Path.StartsWithSegments("/api") && !IsPublicCacheable(context.Request.Path))
            context.Response.Headers.CacheControl = "no-store";
        await next(context);
    }

    private static bool IsPublicCacheable(PathString path) =>
        System.Text.RegularExpressions.Regex.IsMatch(path.Value ?? "", @"^/api/(competitions(/picker|/[1-9]\d*(/standings|/first-view)?)?|race-templates|weather/(at|current))/?$",
            System.Text.RegularExpressions.RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
}
