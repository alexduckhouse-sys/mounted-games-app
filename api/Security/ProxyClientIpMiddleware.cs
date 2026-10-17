using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace MountedGames.Api.Security;

/// <summary>
/// Vercel proxies <c>/api</c> to this API, so every visitor arrives from a Vercel address and would share
/// one rate-limit bucket. Vercel's routing middleware (<c>web/middleware.ts</c>) sends the visitor's IP in
/// <see cref="ClientIpHeader"/> with a shared secret in <see cref="KeyHeader"/>. The IP is trusted only
/// when that secret matches <c>Security:ProxyKey</c>; both headers are always removed before the app runs.
/// </summary>
public sealed class ProxyClientIpMiddleware(RequestDelegate next, IConfiguration configuration, ILogger<ProxyClientIpMiddleware> log)
{
    public const string KeyHeader = "X-MG-Proxy-Key";
    public const string ClientIpHeader = "X-MG-Client-IP";
    public const int MinimumKeyBytes = 32;

    private readonly byte[]? _key = LoadKey(configuration["Security:ProxyKey"], log);

    public Task InvokeAsync(HttpContext context)
    {
        var headers = context.Request.Headers;
        var presented = headers[KeyHeader].ToString();
        var claimed = headers[ClientIpHeader].ToString();
        headers.Remove(KeyHeader);
        headers.Remove(ClientIpHeader);
        if (_key is not null && presented.Length > 0
            && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(presented), _key)
            && IPAddress.TryParse(claimed, out var ip))
            context.Connection.RemoteIpAddress = ip;
        return next(context);
    }

    private static byte[]? LoadKey(string? value, ILogger log)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var bytes = Encoding.UTF8.GetBytes(value);
        if (bytes.Length >= MinimumKeyBytes) return bytes;
        // Ignore a weak key rather than refuse to start: visitors then share one bucket, as before.
        log.LogWarning("Security:ProxyKey is shorter than {Minimum} bytes, so forwarded client IPs are ignored.", MinimumKeyBytes);
        return null;
    }
}
