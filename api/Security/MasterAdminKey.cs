using System.Security.Cryptography;
using System.Text;

namespace MountedGames.Api.Security;

/// <summary>
/// The master admin key. Only its SHA-256 (<c>MasterAdmin:KeyHash</c>, 64 hex characters) is configured, so neither the
/// host's settings nor the database ever hold the key. Compared in constant time.
/// </summary>
public static class MasterAdminKey
{
    public static bool IsValidHash(string? value) =>
        value is { Length: 64 } && value.All(Uri.IsHexDigit);

    public static string Hash(string key) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key)));

    public static bool Matches(string? key, string configuredHash)
    {
        if (string.IsNullOrEmpty(key) || key.Length > 500 || !IsValidHash(configuredHash)) return false;
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(Hash(key)), Encoding.ASCII.GetBytes(configuredHash.ToLowerInvariant()));
    }
}
