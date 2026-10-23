using System.Security.Cryptography;
using System.Text;

namespace MountedGames.Api.Services.Calendar;

/// <summary>
/// The secret in a team's calendar feed link. Calendar apps can't send a sign-in header, so the link itself
/// is the credential: 32 random bytes, which can't be guessed. Only a SHA-256 hash is stored (the token is
/// random and long, so a plain hash is enough), so a database copy can't be used to read or rebuild a link.
/// </summary>
public static class CalendarFeedTokens
{
    public static string Generate() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>True when <paramref name="token"/> matches the stored hash. Compares in constant time.</summary>
    public static bool Matches(string? storedHash, string? token)
    {
        if (string.IsNullOrEmpty(storedHash) || string.IsNullOrEmpty(token)) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(storedHash), Encoding.ASCII.GetBytes(Hash(token)));
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
