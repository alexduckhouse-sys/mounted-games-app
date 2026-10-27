using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using MountedGames.Api.Services;
using StackExchange.Redis;

namespace MountedGames.Api.Auth;

/// <summary>
/// Remembers each Google or Apple sign-in (provider, subject and the nonce hash) until its token expires, so a token and
/// nonce pair is accepted once. Shared through Redis when it's configured, so every API instance agrees; otherwise, or
/// if Redis fails, this instance's memory, the same fallback the rate limits and viewer counts use.
/// </summary>
public sealed class ExternalTokenReplayGuard(RedisConnection redis, TimeProvider time, ILogger<ExternalTokenReplayGuard> log)
{
    private const int PruneEvery = 256;
    private readonly ConcurrentDictionary<string, DateTimeOffset> _used = new(StringComparer.Ordinal);
    private int _sincePrune;

    /// <summary>True the first time this sign-in is seen; false if it has been used already.</summary>
    /// <param name="expires">The token's own expiry. The record is kept until then, plus the allowed clock skew.</param>
    public async Task<bool> TryUseAsync(string provider, string subject, string nonceHash, DateTimeOffset expires)
    {
        var now = time.GetUtcNow();
        var keepFor = expires - now + ExternalTokenValidator.ClockSkew;
        if (keepFor < ExternalTokenValidator.ClockSkew) keepFor = ExternalTokenValidator.ClockSkew;
        var key = Key(provider, subject, nonceHash);

        if (redis.Available?.GetDatabase() is { } db)
        {
            try
            {
                return await db.StringSetAsync(key, "1", keepFor, When.NotExists);
            }
            catch (Exception ex) when (ex is RedisException or TimeoutException)
            {
                log.LogWarning("Couldn't record a sign-in in Redis ({Error}); using this instance's memory.", ex.GetType().Name);
            }
        }
        return UseHere(key, now, now + keepFor);
    }

    /// <summary>Hashed, so the store never holds an account's provider id.</summary>
    private static string Key(string provider, string subject, string nonceHash)
        => $"mg:external-signin:{provider}:{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{subject}\n{nonceHash}")))}";

    private bool UseHere(string key, DateTimeOffset now, DateTimeOffset until)
    {
        if (Interlocked.Increment(ref _sincePrune) >= PruneEvery)
        {
            Interlocked.Exchange(ref _sincePrune, 0);
            foreach (var entry in _used)
                if (entry.Value <= now) _used.TryRemove(entry);
        }
        while (true)
        {
            if (_used.TryAdd(key, until)) return true;
            if (!_used.TryGetValue(key, out var kept)) continue;
            if (kept > now) return false;
            if (_used.TryUpdate(key, until, kept)) return true;
        }
    }
}

/// <summary>Who a provider said signed in, carried by a sign-up ticket while they pick their club and role.</summary>
/// <param name="Email">Null when the provider gave none (Facebook can't always); the person types one in.</param>
/// <param name="EmailVouched"><see cref="ExternalIdentity.MayLinkByEmail"/>: the new account starts with its email confirmed.</param>
public sealed record ExternalSignupTicket(string Provider, string Subject, string? Email, bool EmailVouched, string SuggestedName);

/// <summary>
/// The short-lived pass returned when a provider sign-in finds no account. Finishing the sign-up presents this instead
/// of the ID token, which has already been used (<see cref="ExternalTokenReplayGuard"/>). It is signed with a key derived
/// from <c>Jwt:Key</c> (Data Protection keys aren't shared between the API's instances), expires after ten minutes and
/// can make at most one account, because that provider sign-in is then linked. It holds no secret of the provider's.
/// </summary>
public sealed class ExternalSignupTickets(IConfiguration configuration, TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
    private const int MaxLength = 4096;

    private sealed record Payload(string P, string S, string? E, bool V, string N, long X);

    private byte[] Key()
    {
        var jwt = configuration["Jwt:Key"] ?? "dev-only-secret-please-change-me-256-bit-min!!";
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(jwt), Encoding.UTF8.GetBytes("mg:external-signup:v1"));
    }

    private string Sign(string body) => WebEncoders.Base64UrlEncode(HMACSHA256.HashData(Key(), Encoding.ASCII.GetBytes(body)));

    public string Create(ExternalSignupTicket ticket)
    {
        var expires = clock.GetUtcNow().Add(Lifetime).ToUnixTimeSeconds();
        var body = WebEncoders.Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(
            new Payload(ticket.Provider, ticket.Subject, ticket.Email, ticket.EmailVouched, ticket.SuggestedName, expires)));
        return $"{body}.{Sign(body)}";
    }

    /// <summary>The ticket's contents, or null when it is missing, altered or out of date.</summary>
    public ExternalSignupTicket? Read(string? ticket)
    {
        if (string.IsNullOrEmpty(ticket) || ticket.Length > MaxLength) return null;
        var dot = ticket.IndexOf('.');
        if (dot < 1) return null;
        var body = ticket[..dot];
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(ticket[(dot + 1)..]), Encoding.ASCII.GetBytes(Sign(body))))
            return null;
        // The signature matched, so the body is one this API wrote.
        var payload = JsonSerializer.Deserialize<Payload>(WebEncoders.Base64UrlDecode(body))!;
        if (clock.GetUtcNow().ToUnixTimeSeconds() > payload.X) return null;
        return new ExternalSignupTicket(payload.P, payload.S, payload.E, payload.V, payload.N);
    }
}
