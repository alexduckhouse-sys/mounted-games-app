using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Email;

/// <summary>
/// The wording shown beside the tick box. Change the text and bump <see cref="Version"/> together: the
/// version stored with each consent says exactly which sentence the person agreed to. The web form
/// (<c>web/src/lib/emailOptIn.ts</c>) shows the same text and sends the version back.
/// </summary>
public static class EmailOptInWording
{
    public const string Version = "alerts-2026-10-22";
    public const string Text = "Email me when new competitions open. I can unsubscribe at any time.";
    public const string SignupSource = "signup-form";
}

public record OptInResult(bool Joined, string? UnsubscribeToken);

/// <summary>
/// Unsubscribe links for emails sent after the sign-up. The token stored with a consent is shown once and only its hash is
/// kept, so a later email can't reuse it. These links are signed instead: <c>n1.{consent id}.{signature}</c>, with the signature
/// an HMAC over the id, keyed from <c>Jwt:Key</c>. They hold no address, can't be forged, need nothing stored, work whichever
/// API instance receives them, and never expire (an unsubscribe link must keep working).
/// </summary>
public static class EmailUnsubscribeTokens
{
    public const string Prefix = "n1.";

    public static string Create(IConfiguration configuration, int optInId)
        => $"{Prefix}{optInId}.{Sign(configuration, optInId)}";

    public static bool TryRead(IConfiguration configuration, string? token, out int optInId)
    {
        optInId = 0;
        if (token is null || !token.StartsWith(Prefix, StringComparison.Ordinal) || token.Length > 80) return false;
        var parts = token.Split('.');
        if (parts.Length != 3 || !int.TryParse(parts[1], out var id) || id < 1) return false;
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(parts[2]), Encoding.ASCII.GetBytes(Sign(configuration, id)))) return false;
        optInId = id;
        return true;
    }

    private static string Sign(IConfiguration configuration, int id)
    {
        var jwt = configuration["Jwt:Key"] ?? "dev-only-secret-please-change-me-256-bit-min!!";
        var key = HMACSHA256.HashData(Encoding.UTF8.GetBytes(jwt), Encoding.UTF8.GetBytes("mg:news-unsubscribe:v1"));
        return Convert.ToBase64String(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes($"optin|{id}"))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}

public class EmailOptInService(AppDbContext db, TimeProvider clock, IConfiguration configuration)
{
    public static string HashToken(string token)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    /// <summary>
    /// Records consent for an already-normalised address. If the address is already on the list nothing changes
    /// (and no new token is made, so the link in the first email keeps working). A new random token is returned
    /// only when a row is created: that is the one time it can go into an email. Saves nothing; the caller saves.
    /// </summary>
    public async Task<OptInResult> AddAsync(string email, string wordingVersion, string source, CancellationToken ct = default)
    {
        var existing = await db.EmailOptIns.AnyAsync(o => o.Email == email && o.UnsubscribedAt == null, ct);
        if (existing) return new OptInResult(false, null);
        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        db.EmailOptIns.Add(new EmailOptIn
        {
            Email = email,
            ConsentedAt = clock.GetUtcNow().UtcDateTime,
            WordingVersion = wordingVersion,
            Source = source,
            UnsubscribeTokenHash = HashToken(token),
        });
        return new OptInResult(true, token);
    }

    /// <summary>
    /// Withdraws consent for the address behind a token. Always completes quietly, whether or not the token
    /// matched, and doing it twice changes nothing, so the answer never says whether an address is on the list.
    /// </summary>
    public async Task UnsubscribeAsync(string? token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200) return;
        token = token.Trim();
        // A signed link from a later email names the consent row; the sign-up link carries the stored token's hash.
        string? email;
        if (EmailUnsubscribeTokens.TryRead(configuration, token, out var optInId))
            email = await db.EmailOptIns.Where(o => o.Id == optInId).Select(o => o.Email).FirstOrDefaultAsync(ct);
        else
        {
            var hash = HashToken(token);
            email = await db.EmailOptIns.Where(o => o.UnsubscribeTokenHash == hash).Select(o => o.Email).FirstOrDefaultAsync(ct);
        }
        if (email is null) return;
        var now = clock.GetUtcNow().UtcDateTime;
        // Every active row for the address, so one click ends all of their consents.
        await db.EmailOptIns.Where(o => o.Email == email && o.UnsubscribedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.UnsubscribedAt, now), ct);
    }

    private static string Base64Url(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
