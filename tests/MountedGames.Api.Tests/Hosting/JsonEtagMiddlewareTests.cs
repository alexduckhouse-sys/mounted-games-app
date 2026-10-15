using Microsoft.AspNetCore.Http;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Hosting;

/// <summary>Branches the end-to-end host can't reach (handlers that already set their own caching headers).</summary>
public class JsonEtagMiddlewareTests
{
    private static async Task<DefaultHttpContext> RunAsync(Action<HttpContext> handler)
    {
        var ctx = new DefaultHttpContext();
        ctx.Response.Body = new MemoryStream();
        await new JsonEtagMiddleware(c => { handler(c); return c.Response.WriteAsync("{}"); }).InvokeAsync(ctx);
        return ctx;
    }

    [Fact]
    public async Task KeepsHandlerSuppliedEtag()
    {
        var ctx = await RunAsync(c =>
        {
            c.Response.ContentType = "application/json";
            c.Response.Headers.ETag = "\"mine\"";
        });

        Assert.Equal("\"mine\"", ctx.Response.Headers.ETag.ToString());
    }

    [Fact]
    public async Task KeepsHandlerSuppliedCacheControl_WhileStillTagging()
    {
        var ctx = await RunAsync(c =>
        {
            c.Response.ContentType = "application/json";
            c.Response.Headers.CacheControl = "public, max-age=60";
        });

        Assert.Equal(("public, max-age=60", true), (ctx.Response.Headers.CacheControl.ToString(), ctx.Response.Headers.ContainsKey("ETag")));
    }

    [Fact]
    public async Task LeavesNonJsonResponsesAlone()
    {
        var ctx = await RunAsync(c => c.Response.ContentType = "text/plain");

        Assert.False(ctx.Response.Headers.ContainsKey("ETag"));
    }

    [Fact]
    public async Task LeavesResponsesWithoutContentTypeAlone()
    {
        var ctx = await RunAsync(_ => { });

        Assert.False(ctx.Response.Headers.ContainsKey("ETag"));
    }
}
