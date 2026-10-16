using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace MountedGames.Api.Security;

public static class TrustedProxies
{
    public static IServiceCollection AddTrustedProxies(this IServiceCollection services, IConfiguration configuration)
    {
        var addresses = configuration.GetSection("Security:KnownProxies").Get<string[]>() ?? [];
        var proxies = addresses.Select(IPAddress.Parse).ToArray();
        return services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();
            // An empty trust list must not become "trust everyone".
            options.ForwardedHeaders = proxies.Length == 0 ? ForwardedHeaders.None
                : ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.ForwardLimit = 1;
            foreach (var proxy in proxies) options.KnownProxies.Add(proxy);
        });
    }
}
