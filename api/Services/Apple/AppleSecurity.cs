using System.Security.Cryptography;
using System.Text;
namespace MountedGames.Api.Services.Apple;

public sealed class AppleOptions(IConfiguration config)
{
    public string? EncryptionKey => config["Apple:EncryptionKey"];
    public string? WakeKey => config["Apple:WakeKey"];
    public string? TeamId => config["Apple:TeamId"];
    public string? BundleId => config["Apple:BundleId"];
    public string? KeyId => config["Apple:ApnsKeyId"];
    public string? PrivateKey => config["Apple:ApnsPrivateKey"];
    public bool Sandbox => config.GetValue<bool>("Apple:Sandbox");
    public string? PassTypeId => config["Apple:PassTypeId"];
    public string? Certificate => config["Apple:PassCertificateBase64"];
    public string? CertificatePassword => config["Apple:PassCertificatePassword"];
    public string? Intermediate => config["Apple:PassIntermediateBase64"];
    public string? PublicBaseUrl => config["Sharing:PublicBaseUrl"];
    public bool ProtectedStorageReady => !string.IsNullOrWhiteSpace(EncryptionKey) && TryKey(EncryptionKey);
    public bool LiveReady => config.GetValue<bool>("Apple:LiveActivitiesEnabled") && ProtectedStorageReady
        && !string.IsNullOrWhiteSpace(TeamId) && !string.IsNullOrWhiteSpace(BundleId)
        && !string.IsNullOrWhiteSpace(KeyId) && !string.IsNullOrWhiteSpace(PrivateKey) && WakeKey?.Length >= 32;
    public bool WalletReady => config.GetValue<bool>("Apple:WalletEnabled") && ProtectedStorageReady
        && !string.IsNullOrWhiteSpace(TeamId) && !string.IsNullOrWhiteSpace(PassTypeId)
        && !string.IsNullOrWhiteSpace(Certificate) && !string.IsNullOrWhiteSpace(Intermediate)
        && Uri.TryCreate(PublicBaseUrl, UriKind.Absolute, out var url) && url.Scheme == "https" && WakeKey?.Length >= 32;
    private static bool TryKey(string key) { try { return Convert.FromBase64String(key).Length == 32; } catch (FormatException) { return false; } }
}

public sealed class AppleSecrets(AppleOptions options)
{
    public static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static bool Matches(string value, string hash) => CryptographicOperations.FixedTimeEquals(
        Encoding.ASCII.GetBytes(Hash(value)), Encoding.ASCII.GetBytes(hash));
    public string Protect(string value, string purpose)
    {
        var plain = Encoding.UTF8.GetBytes(value); var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[plain.Length]; var tag = new byte[16];
        using var aes = new AesGcm(Convert.FromBase64String(options.EncryptionKey!), 16);
        aes.Encrypt(nonce, plain, cipher, tag, Encoding.UTF8.GetBytes(purpose));
        return Convert.ToBase64String(nonce.Concat(tag).Concat(cipher).ToArray());
    }
    public string Unprotect(string value, string purpose)
    {
        var bytes = Convert.FromBase64String(value); if (bytes.Length < 28) throw new CryptographicException();
        var plain = new byte[bytes.Length - 28];
        using var aes = new AesGcm(Convert.FromBase64String(options.EncryptionKey!), 16);
        aes.Decrypt(bytes.AsSpan(0, 12), bytes.AsSpan(28), bytes.AsSpan(12, 16), plain, Encoding.UTF8.GetBytes(purpose));
        return Encoding.UTF8.GetString(plain);
    }
}
