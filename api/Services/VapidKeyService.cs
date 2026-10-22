using System.Text.Json;
using WebPush;

namespace MountedGames.Api.Services;

/// <summary>
/// The VAPID keypair used to sign web-push messages. Production sets <c>Push:VapidPublicKey</c> and
/// <c>Push:VapidPrivateKey</c>, so every instance signs with the same keys and subscriptions survive new
/// instances and deploys. Without them (local runs) the keys are generated once and kept in
/// <c>vapid-keys.json</c> in the content root.
/// </summary>
public class VapidKeyService
{
    public string PublicKey { get; }
    public string PrivateKey { get; }
    public string Subject { get; }

    private record VapidFile(string PublicKey, string PrivateKey);

    public VapidKeyService(IWebHostEnvironment env, IConfiguration config)
    {
        Subject = config["Push:Subject"] ?? "mailto:admin@mountedgames.local";
        var (configuredPublic, configuredPrivate) = (config["Push:VapidPublicKey"], config["Push:VapidPrivateKey"]);
        if (!string.IsNullOrWhiteSpace(configuredPublic) && !string.IsNullOrWhiteSpace(configuredPrivate))
        {
            PublicKey = configuredPublic.Trim();
            PrivateKey = configuredPrivate.Trim();
            return;
        }
        var path = Path.Combine(env.ContentRootPath, "vapid-keys.json");
        if (File.Exists(path))
        {
            var json = File.ReadAllText(path);
            var f = JsonSerializer.Deserialize<VapidFile>(json)
                ?? throw new InvalidOperationException("vapid-keys.json is malformed.");
            PublicKey = f.PublicKey;
            PrivateKey = f.PrivateKey;
            return;
        }
        var keys = VapidHelper.GenerateVapidKeys();
        PublicKey = keys.PublicKey;
        PrivateKey = keys.PrivateKey;
        File.WriteAllText(path, JsonSerializer.Serialize(new VapidFile(PublicKey, PrivateKey)));
    }

    public VapidDetails Details() => new(Subject, PublicKey, PrivateKey);
}
