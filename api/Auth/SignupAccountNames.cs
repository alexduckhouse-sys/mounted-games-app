namespace MountedGames.Api.Auth;

/// <summary>The username-to-mailbox mapping used by account creation and authentication rate limits.</summary>
public static class SignupAccountNames
{
    public static string Sanitise(string value)
    {
        var cleaned = new string(value.Where(c => char.IsLetterOrDigit(c) || c is '.' or '_' or '-').ToArray()).ToLowerInvariant();
        return cleaned.Length == 0 ? "user" : cleaned;
    }
}
