using System.Security.Cryptography;
using Microsoft.Net.Http.Headers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace MountedGames.Api.Services;

/// <summary>
/// Adds a content-hash ETag to JSON GET responses and answers 304 Not Modified
/// when the browser already has the same copy. Phones refetch the competition
/// on every reconnect and unlock; on patchy signal an unchanged timetable then
/// costs a few hundred bytes instead of the whole payload.
/// </summary>
public sealed class JsonEtagMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (!HttpMethods.IsGet(context.Request.Method)) { await next(context); return; }
        var response = context.Response;
        var original = response.Body;
        using var buffer = new MemoryStream();
        response.Body = buffer;
        var capture = new EtagCapture(original);
        context.Features.Set(capture);
        try
        {
            await next(context);
        }
        finally
        {
            response.Body = original;
            context.Features.Set<EtagCapture>(null);
        }

        if (capture.Bypassed) return;

        buffer.Position = 0;
        if (response.StatusCode == StatusCodes.Status200OK
            && response.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true
            && !response.Headers.CacheControl.ToString().Contains("no-store", StringComparison.OrdinalIgnoreCase)
            && !response.Headers.ContainsKey(HeaderNames.ETag))
        {
            // Weak: compression further out changes the bytes but not the content.
            var etag = new EntityTagHeaderValue($"\"{Convert.ToHexString(SHA256.HashData(buffer), 0, 16)}\"", isWeak: true);
            response.Headers.ETag = etag.ToString();
            // Let the browser keep the copy but always check it with us first.
            if (!response.Headers.ContainsKey(HeaderNames.CacheControl))
                response.Headers.CacheControl = "private, no-cache";

            var ifNoneMatch = context.Request.GetTypedHeaders().IfNoneMatch;
            if (ifNoneMatch.Any(t => t.Equals(EntityTagHeaderValue.Any) || t.Compare(etag, useStrongComparison: false)))
            {
                response.StatusCode = StatusCodes.Status304NotModified;
                response.ContentLength = null;
                response.Headers.Remove(HeaderNames.ContentType);
                return;
            }
            buffer.Position = 0;
        }

        await buffer.CopyToAsync(original, context.RequestAborted);
    }
}

internal sealed class EtagCapture(Stream original)
{
    public Stream Original { get; } = original;
    public bool Bypassed { get; set; }
}

/// <summary>Choose after MVC knows the actual result, before it writes any bytes (including archive?format=zip).</summary>
public sealed class JsonEtagResultFilter : IAsyncResultFilter
{
    public async Task OnResultExecutionAsync(ResultExecutingContext context, ResultExecutionDelegate next)
    {
        if ((context.Result is FileResult || context.Result is ContentResult { ContentType: { } type }
                && !type.StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
            && context.HttpContext.Features.Get<EtagCapture>() is { } capture)
        {
            capture.Bypassed = true;
            context.HttpContext.Response.Body = capture.Original;
        }
        await next();
    }
}
