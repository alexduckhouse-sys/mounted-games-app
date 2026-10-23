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

public class EmailOptInService(AppDbContext db, TimeProvider clock)
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
        var hash = HashToken(token.Trim());
        var email = await db.EmailOptIns.Where(o => o.UnsubscribeTokenHash == hash)
            .Select(o => o.Email).FirstOrDefaultAsync(ct);
        if (email is null) return;
        var now = clock.GetUtcNow().UtcDateTime;
        // Every active row for the address, so one click ends all of their consents.
        await db.EmailOptIns.Where(o => o.Email == email && o.UnsubscribedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.UnsubscribedAt, now), ct);
    }

    private static string Base64Url(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
