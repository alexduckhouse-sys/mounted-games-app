namespace MountedGames.Api.Services.Calendar;

/// <summary>
/// Works out the web address to put in a calendar event's link. The API doesn't know which host the website
/// is on (Vercel forwards <c>/api</c> to it), so the website passes its own address as <c>site</c>.
/// <c>Sharing:PublicBaseUrl</c> overrides it when set. Only the scheme and host are used, and never
/// in a response that shared caches may keep, so a made-up value can only change the caller's own file.
/// </summary>
public static class PublicSite
{
    public static string? Resolve(IConfiguration configuration, string? requested)
    {
        return Origin(configuration["Sharing:PublicBaseUrl"]) ?? Origin(requested);
    }

    public static string? Origin(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 300) return null;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme is not ("http" or "https") || string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo)) return null;
        return uri.GetLeftPart(UriPartial.Authority);
    }
}
