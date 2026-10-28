using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using System.Net;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>
/// TestServer leaves HttpContext.Connection.RemoteIpAddress null, so IP-block logic can't be reached.
/// Tests send an <c>X-Test-Ip</c> header and this filter copies it onto the connection before the app runs.
/// </summary>
public class TestIpStartupFilter : IStartupFilter
{
    public const string Header = "X-Test-Ip";
    public const string UntrustedHeader = "X-Test-Ip-Untrusted";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (ctx, nxt) =>
        {
            if (ctx.Request.Headers.TryGetValue(Header, out var ip) && IPAddress.TryParse(ip.ToString(), out var addr))
            {
                ctx.Connection.RemoteIpAddress = addr;
                // Stands in for the keyed proxy: a test that sends an address is simulating a trusted edge.
                if (!ctx.Request.Headers.ContainsKey(UntrustedHeader)) ctx.Items[MountedGames.Api.Security.ProxyClientIpMiddleware.TrustedIpItemKey] = true;
            }
            await nxt();
        });
        next(app);
    };
}
