namespace MountedGames.Api.Security;

public sealed class SecurityHeadersMiddleware(RequestDelegate next, IWebHostEnvironment environment)
{
    // The Vite build uses external scripts and self-hosted fonts. Keep this in
    // step with web/vercel.json; the parity test covers both deployment paths.
    public const string ContentSecurityPolicy = "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-elem 'self'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://mounted-games-api.vercel.app wss://mounted-games-api.vercel.app; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; media-src 'self'; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests";

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

    // The embeddable results widget (/embed/...) is the one place the site may be framed. Only
    // frame-ancestors changes in the policy: any https page may frame it (a club's own site), nothing else.
    // The strict policy above still applies everywhere else. Keep in step with the /embed/ rule in web/vercel.json.
    public const string EmbedContentSecurityPolicy = "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-elem 'self'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://mounted-games-api.vercel.app wss://mounted-games-api.vercel.app; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv; frame-ancestors https:; base-uri 'none'; form-action 'self'; object-src 'none'; media-src 'self'; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests";

    /// <summary>
    /// Headers for /embed/ pages: no X-Frame-Options (it cannot name a list of parents and DENY would block the
    /// frame), a cross-origin resource policy so a host page that isolates itself can still load the frame,
    /// and no camera or microphone, which the widget never uses.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> EmbedHeaders = Headers
        .Where(h => h.Key != "X-Frame-Options")
        .ToDictionary(h => h.Key, h => h.Key switch
        {
            "Content-Security-Policy" => EmbedContentSecurityPolicy,
            "Cross-Origin-Resource-Policy" => "cross-origin",
            "Permissions-Policy" => "camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()",
            _ => h.Value,
        });

    /// <summary>
    /// True for /embed/ followed by anything. Case-sensitive on purpose: Vercel's rule must agree, and a
    /// path that only one side recognises stays unframeable.
    /// </summary>
    public static bool IsEmbedPath(PathString path) => (path.Value ?? "").StartsWith("/embed/", StringComparison.Ordinal);

    public async Task InvokeAsync(HttpContext context)
    {
        var headers = IsEmbedPath(context.Request.Path) ? EmbedHeaders : Headers;
        context.Response.OnStarting(() =>
        {
            foreach (var (key, value) in headers)
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

    // Built once. The timeout is generous so a busy host can't turn a match into an exception.
    private static readonly System.Text.RegularExpressions.Regex PublicCacheablePath = new(
        @"^/api/(competitions(/picker|/[1-9]\d*(/standings|/first-view|/overlays)?)?|race-templates|weather/(at|current|forecast))/?$",
        System.Text.RegularExpressions.RegexOptions.Compiled | System.Text.RegularExpressions.RegexOptions.CultureInvariant,
        TimeSpan.FromSeconds(1));

    private static bool IsPublicCacheable(PathString path) => PublicCacheablePath.IsMatch(path.Value ?? "");
}
