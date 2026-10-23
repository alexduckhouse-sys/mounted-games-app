using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
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
    private const string ItemKey = "MountedGames.ScorerLink";

    public static ScorerLink Current(HttpContext context) => (ScorerLink)context.Items[ItemKey]!;

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
