using StackExchange.Redis;

namespace MountedGames.Api.Services;

/// <summary>
/// Shares live-hub messages between API instances through Redis, so a score saved on one instance reaches
/// phones connected to another. Off unless a Redis connection is configured.
/// </summary>
public static class RedisBackplane
{
    /// <summary>
    /// Reads <c>Redis:ConnectionString</c>, or <c>REDIS_URL</c>/<c>KV_URL</c> as the Upstash integration sets
    /// them on Vercel. Accepts a <c>redis://</c> or <c>rediss://</c> URL or a StackExchange.Redis string.
    /// </summary>
    public static ConfigurationOptions? Options(IConfiguration config)
    {
        var raw = new[] { config["Redis:ConnectionString"], config["REDIS_URL"], config["KV_URL"] }
            .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
        if (raw is null) return null;
        var options = raw.StartsWith("redis://", StringComparison.OrdinalIgnoreCase) || raw.StartsWith("rediss://", StringComparison.OrdinalIgnoreCase)
            ? FromUrl(new Uri(raw))
            : ConfigurationOptions.Parse(raw);
        // Start even if Redis is briefly unreachable; the connection retries in the background.
        options.AbortOnConnectFail = false;
        return options;
    }

    private static ConfigurationOptions FromUrl(Uri uri)
    {
        var options = new ConfigurationOptions { Ssl = uri.Scheme.Equals("rediss", StringComparison.OrdinalIgnoreCase) };
        options.EndPoints.Add(uri.Host, uri.Port > 0 ? uri.Port : 6379);
        if (options.Ssl) options.SslHost = uri.Host;
        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            var parts = uri.UserInfo.Split(':', 2);
            var user = Uri.UnescapeDataString(parts[0]);
            if (parts.Length == 2)
            {
                if (user.Length > 0) options.User = user;
                options.Password = Uri.UnescapeDataString(parts[1]);
            }
            else options.Password = user;
        }
        return options;
    }
}
