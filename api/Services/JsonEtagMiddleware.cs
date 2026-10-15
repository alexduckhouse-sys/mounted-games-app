using System.Security.Cryptography;
using Microsoft.Net.Http.Headers;

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
        var response = context.Response;
        var original = response.Body;
        using var buffer = new MemoryStream();
        response.Body = buffer;
        try
        {
            await next(context);
        }
        finally
        {
            response.Body = original;
        }

        buffer.Position = 0;
        if (response.StatusCode == StatusCodes.Status200OK
            && response.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true
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
