using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Auth;

/// <summary>Makes, hashes and shapes scorer-link tokens. Only the hash is ever stored.</summary>
public static class ScorerLinkTokens
{
    public const string Header = "X-Scorer-Token";
    private const string Prefix = "mgs_";
    // 32 random bytes in base64url is 43 characters.
    private const int MaxTokenLength = 64;

    /// <summary>A new unguessable token: 256 bits from the system random generator.</summary>
    public static string Generate() => Prefix + Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>Cheap shape check, so junk is rejected without touching the database.</summary>
    public static bool LooksValid(string token) =>
        token.Length > Prefix.Length && token.Length <= MaxTokenLength && token.StartsWith(Prefix, StringComparison.Ordinal)
        && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-');

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>
/// Counts unknown-token attempts per client IP so a guesser is slowed to a crawl. Tokens carry 256 bits, so
/// guessing one is hopeless anyway; this keeps the noise, and the database lookups, down. Counts are per API
/// instance and live in memory.
/// </summary>
public sealed class ScorerTokenGuard(IConfiguration configuration, TimeProvider time)
{
    private readonly int _limit = configuration.GetValue("RateLimits:ScorerFailuresPerMinute", 20);
    private readonly ConcurrentDictionary<string, (long Window, int Count)> _failures = new();

    public bool IsBlocked(string ip) =>
        _failures.TryGetValue(ip, out var f) && f.Window == Window() && f.Count >= _limit;

    public void RecordFailure(string ip)
    {
        var window = Window();
        if (_failures.Count > 10_000)
            foreach (var key in _failures.Where(kv => kv.Value.Window != window).Select(kv => kv.Key).ToList())
                _failures.TryRemove(key, out _);
        _failures.AddOrUpdate(ip, (window, 1), (_, old) => old.Window == window ? (window, old.Count + 1) : (window, 1));
    }

    private long Window() => time.GetUtcNow().ToUnixTimeSeconds() / 60;
}

/// <summary>
/// Gate for the scorer-link endpoints. Reads <c>X-Scorer-Token</c> and finds the link by its hash. Missing token
/// 401; an unknown or malformed one 404 (the same answer whatever was sent, so nothing can be enumerated);
/// revoked or expired 410. Too many unknown tokens from one address 429. The matched link goes to
/// <c>HttpContext.Items</c>; read it with <see cref="Current"/>.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class ScorerLinkAccessAttribute : Attribute, IAsyncAuthorizationFilter
{
    public const string ItemKey = "MountedGames.ScorerLink";

    public static ScorerLink Current(HttpContext context) => (ScorerLink)context.Items[ItemKey]!;
    public static ScorerLink? TryGetCurrent(HttpContext context) => context.Items.TryGetValue(ItemKey, out var v) ? v as ScorerLink : null;

    /// <summary>
    /// Authenticates a camera (<c>Scope == 1</c>) or score-and-stream (<c>Scope == 2</c>) scorer token
    /// exclusively for the explicitly listed publisher endpoints. Controller links may also send arena-scoped commands.
    /// Score-only links and competition-wide overlays are never accepted here.
    /// </summary>
    public static async Task<ScorerLink?> TryAuthenticateStreamLinkAsync(HttpContext http)
    {
        // Use the matched controller/action and method, never a substring supplied in the URL.
        var action = http.GetEndpoint()?.Metadata.GetMetadata<ControllerActionDescriptor>();
        if (action?.ControllerTypeInfo.AsType() != typeof(Controllers.StreamsController)) return null;
        var publisherRoute = (http.Request.Method, action.ActionName) is
            ("GET", "IceServers") or ("POST", "Start") or ("POST", "Ready") or ("POST", "Republish")
            or ("PATCH", "Update") or ("POST", "Heartbeat") or ("POST", "End");
        var commandRoute = http.Request.Method == "POST" && action.ActionName == "Command";
        if (!publisherRoute && !commandRoute) return null;

        var token = http.Request.Headers[ScorerLinkTokens.Header].ToString().Trim();
        if (token.Length == 0 || !ScorerLinkTokens.LooksValid(token)) return null;

        if (!http.Request.RouteValues.TryGetValue("competitionId", out var compVal)
            || !int.TryParse(compVal?.ToString(), out var competitionId))
            return null;

        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var guard = http.RequestServices.GetService<ScorerTokenGuard>();
        if (guard?.IsBlocked(ip) == true) return null;

        var db = http.RequestServices.GetRequiredService<AppDbContext>();
        var hash = ScorerLinkTokens.Hash(token);
        var link = await db.ScorerLinks.AsNoTracking().FirstOrDefaultAsync(l => l.TokenHash == hash, http.RequestAborted);
        if (link is null)
        {
            guard?.RecordFailure(ip);
            return null;
        }

        var now = http.RequestServices.GetService<TimeProvider>()?.GetUtcNow().UtcDateTime ?? DateTime.UtcNow;
        if (link.RevokedAt is not null || link.ExpiresAt <= now || link.CompetitionId != competitionId)
            return null;

        if (link.Scope is not (ScorerLink.ScopeCamera or ScorerLink.ScopeScoreAndStream)
            || (commandRoute && link.Scope != ScorerLink.ScopeScoreAndStream))
            return null;

        http.Items[ItemKey] = link;
        var claims = new[]
        {
            new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, $"scorer-link:{link.Id}"),
            new System.Security.Claims.Claim("ScorerLinkCompetitionId", link.CompetitionId.ToString()),
            new System.Security.Claims.Claim("ScorerLinkScope", link.Scope.ToString()),
            new System.Security.Claims.Claim("ScorerLinkArena", link.ArenaName),
        };
        http.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(claims, "ScorerLink"));
        return link;
    }

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        var token = http.Request.Headers[ScorerLinkTokens.Header].ToString().Trim();
        if (token.Length == 0)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var guard = http.RequestServices.GetRequiredService<ScorerTokenGuard>();
        if (guard.IsBlocked(ip))
        {
            http.Response.Headers.RetryAfter = "60";
            context.Result = new StatusCodeResult(StatusCodes.Status429TooManyRequests);
            return;
        }

        ScorerLink? link = null;
        if (ScorerLinkTokens.LooksValid(token))
        {
            var hash = ScorerLinkTokens.Hash(token);
            var db = http.RequestServices.GetRequiredService<AppDbContext>();
            link = await db.ScorerLinks.AsNoTracking().FirstOrDefaultAsync(l => l.TokenHash == hash, http.RequestAborted);
        }
        if (link is null)
        {
            guard.RecordFailure(ip);
            context.Result = new NotFoundResult();
            return;
        }

        var now = http.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow().UtcDateTime;
        if (link.RevokedAt is not null || link.ExpiresAt <= now)
        {
            context.Result = new StatusCodeResult(StatusCodes.Status410Gone);
            return;
        }

        // Last used is for the organiser's list; once a minute is plenty and spares a write per tap.
        if (link.LastUsedAt is null || now - link.LastUsedAt > TimeSpan.FromMinutes(1))
        {
            var db = http.RequestServices.GetRequiredService<AppDbContext>();
            await db.ScorerLinks.Where(l => l.Id == link.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.LastUsedAt, now), http.RequestAborted);
            link.LastUsedAt = now;
        }
        http.Items[ItemKey] = link;
    }
}
