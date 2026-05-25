using System.Text.Json;
using WebPush;

namespace MountedGames.Api.Services;

/// <summary>
/// Loads (or generates and persists) the VAPID keypair used to sign web-push
/// messages. Keys live in <c>vapid-keys.json</c> next to the DB so a restart
/// keeps existing browser subscriptions valid.
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
