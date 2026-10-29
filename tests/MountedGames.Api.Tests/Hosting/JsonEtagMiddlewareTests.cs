using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Hosting;

/// <summary>Branches the end-to-end host can't reach (handlers that already set their own caching headers).</summary>
public class JsonEtagMiddlewareTests
{
    [Theory]
    [InlineData("file")]
    [InlineData("text")]
    [InlineData("json")]
    public async Task ActualResultClassificationStreamsBinaryAndText_WhileJsonStillGetsEtag(string kind)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = "GET";
        using var original = new MemoryStream();
        context.Response.Body = original;
        await new JsonEtagMiddleware(async c =>
        {
            IActionResult result = kind switch
            {
                "file" => new FileContentResult([1, 2, 3], "application/zip"),
                "text" => new ContentResult { ContentType = "text/calendar" },
                _ => new JsonResult(new { Name = "Synthetic" }),
            };
            var action = new ActionContext(c, new RouteData(), new ActionDescriptor());
            var executing = new ResultExecutingContext(action, [], result, new object());
            await new JsonEtagResultFilter().OnResultExecutionAsync(executing, async () =>
            {
                Assert.Equal(kind != "json", ReferenceEquals(original, c.Response.Body));
                c.Response.ContentType = kind == "json" ? "application/json" : "application/octet-stream";
                await c.Response.Body.WriteAsync(new byte[] { 1, 2, 3 });
                return new ResultExecutedContext(action, [], result, new object());
            });
        }).InvokeAsync(context);
        Assert.Equal(new byte[] { 1, 2, 3 }, original.ToArray());
        Assert.Equal(kind == "json", context.Response.Headers.ContainsKey("ETag"));
    }

    [Fact]
    public async Task MutationsWriteStraightThroughWithoutBuffering()
    {
        var context = new DefaultHttpContext();
        context.Request.Method = "POST";
        using var original = new MemoryStream(); context.Response.Body = original;
        await new JsonEtagMiddleware(c =>
        {
            Assert.Same(original, c.Response.Body);
            return Task.CompletedTask;
        }).InvokeAsync(context);
    }

    private static async Task<DefaultHttpContext> RunAsync(Action<HttpContext> handler)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = "GET";
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
