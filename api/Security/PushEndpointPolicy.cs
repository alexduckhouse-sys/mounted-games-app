namespace MountedGames.Api.Security;

public static class PushEndpointPolicy
{
    public static bool IsAllowed(string? endpoint)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort
            || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0) return false;
        var host = uri.IdnHost;
        return host.Equals("fcm.googleapis.com", StringComparison.OrdinalIgnoreCase)
            || host.Equals("updates.push.services.mozilla.com", StringComparison.OrdinalIgnoreCase)
            || host.Equals("web.push.apple.com", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".notify.windows.com", StringComparison.OrdinalIgnoreCase);
    }
}
