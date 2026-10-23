namespace MountedGames.Api.Services.Sponsors;

/// <summary>
/// What counts as a sponsor logo: png, jpeg or webp up to 200 KB, judged by the file's first bytes rather than
/// by what the upload claims to be. No SVG: it can carry scripts and links.
/// </summary>
public static class SponsorLogos
{
    public const int MaxBytes = 200 * 1024;
    public static readonly string[] ContentTypes = ["image/png", "image/jpeg", "image/webp"];

    /// <summary>The content type the bytes really are, or null when they are not an allowed image.</summary>
    public static string? Detect(ReadOnlySpan<byte> data)
    {
        if (data.Length >= 8 && data[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return "image/png";
        if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) return "image/jpeg";
        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data[8..12].SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }

    /// <summary>An https address with a host and no embedded credentials; null when <paramref name="value"/> is blank.</summary>
    public static bool TryNormaliseLink(string? value, out string? link)
    {
        link = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo))
            return false;
        link = uri.AbsoluteUri;
        return link.Length <= 300;
    }
}
