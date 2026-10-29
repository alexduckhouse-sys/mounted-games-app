using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Security.Claims;
using MountedGames.Api.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.Net.Http.Headers;

namespace MountedGames.Api.Security;

/// <summary>Reads only the identifier used by the selected auth action, before its rate limiter runs.</summary>
public sealed class AuthRateLimitIdentityMiddleware(RequestDelegate next)
{
    private static readonly object ItemKey = new();
    private const int MaxBodyBytes = 64 * 1024;
    private static readonly Encoding Utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: true, throwOnInvalidBytes: true);
    private static readonly Encoding Utf16 = new UnicodeEncoding(bigEndian: false, byteOrderMark: true, throwOnInvalidBytes: true);

    internal static string AccountKey(HttpContext context) => context.Items[ItemKey] as string
        ?? (context.User.Identity?.IsAuthenticated == true ? context.User.FindFirstValue(ClaimTypes.NameIdentifier) : null)
        ?? "unidentified";

    internal static bool ExternalSignIn(HttpContext context)
    {
        var path = context.Request.Path.Value?.TrimEnd('/');
        return string.Equals(path, "/api/auth/external", StringComparison.OrdinalIgnoreCase)
            || string.Equals(path, "/api/auth/external/signup", StringComparison.OrdinalIgnoreCase);
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (RequestLimits.Policy(context) == RequestLimits.AuthPolicy && context.Request.HasJsonContentType())
        {
            // Match MVC's case-insensitive JSON properties and last-property-wins behaviour. Do not
            // let an unrelated field choose the bucket: signup uses Username; password login uses Email.
            var path = context.Request.Path.Value?.TrimEnd('/');
            var property = path?.Equals("/api/auth/signup-trainer", StringComparison.OrdinalIgnoreCase) == true ? "username" : "email";
            var canRead = path is not null && new[] { "/api/auth/login", "/api/auth/register", "/api/auth/admin-key", "/api/auth/signup-trainer" }
                .Contains(path, StringComparer.OrdinalIgnoreCase);
            if (canRead)
            {
                var encoding = JsonEncoding(context.Request.ContentType);
                if (encoding is null)
                {
                    context.Response.StatusCode = StatusCodes.Status415UnsupportedMediaType;
                    return;
                }
                context.Request.EnableBuffering(bufferThreshold: MaxBodyBytes + 1, bufferLimit: MaxBodyBytes + 1);
                var bytes = new byte[MaxBodyBytes + 1];
                var length = 0;
                try
                {
                    while (length < bytes.Length)
                    {
                        var read = await context.Request.Body.ReadAsync(bytes.AsMemory(length), context.RequestAborted);
                        if (read == 0) break;
                        length += read;
                    }
                    if (length > MaxBodyBytes)
                    {
                        context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                        return;
                    }
                    if (length <= MaxBodyBytes)
                    {
                        using var json = ParseJson(bytes.AsMemory(0, length), encoding);
                        if (json.RootElement.ValueKind == JsonValueKind.Object)
                        {
                            string? identifier = null;
                            foreach (var item in json.RootElement.EnumerateObject())
                                if (item.Name.Equals(property, StringComparison.OrdinalIgnoreCase))
                                    identifier = item.Value.ValueKind == JsonValueKind.String ? item.Value.GetString() : null;
                            if (!string.IsNullOrWhiteSpace(identifier))
                            {
                                identifier = identifier.Trim();
                                if (property == "username" && !identifier.Contains('@'))
                                    identifier = $"{SignupAccountNames.Sanitise(identifier)}@trainer.mg.local";
                                context.Items[ItemKey] = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(context.RequestServices.GetRequiredService<ILookupNormalizer>().NormalizeEmail(identifier) ?? identifier)));
                            }
                        }
                    }
                }
                catch (JsonException) { /* MVC will reject malformed JSON; it still uses the unidentified bucket. */ }
                catch (DecoderFallbackException) { /* MVC also rejects invalid bytes in a supported encoding. */ }
                finally { context.Request.Body.Position = 0; }
            }
        }
        await next(context);
    }

    private static Encoding? JsonEncoding(string? contentType)
    {
        // Match SystemTextJsonInputFormatter's UTF-8 / little-endian UTF-16 support, including aliases.
        if (!MediaTypeHeaderValue.TryParse(contentType, out var mediaType) || !mediaType.Charset.HasValue) return Utf8;
        try
        {
            var requested = Encoding.GetEncoding(HeaderUtilities.RemoveQuotes(mediaType.Charset).Value!);
            if (requested.CodePage == Utf8.CodePage) return Utf8;
            if (requested.CodePage == Utf16.CodePage) return Utf16;
        }
        catch (ArgumentException) { }
        return null;
    }

    private static JsonDocument ParseJson(ReadOnlyMemory<byte> bytes, Encoding encoding)
    {
        // The MVC stream formatter consumes the encoding's BOM; it must not create an unidentified bucket here.
        var payload = bytes.Span;
        if (payload.StartsWith(encoding.Preamble)) payload = payload[encoding.Preamble.Length..];
        return JsonDocument.Parse(encoding.GetString(payload));
    }
}
