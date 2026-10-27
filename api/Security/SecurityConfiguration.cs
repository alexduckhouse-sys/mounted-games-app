using System.Text;
using Microsoft.Extensions.Configuration.Json;

namespace MountedGames.Api.Security;

public static class SecurityConfiguration
{
    public static void Validate(IConfiguration configuration, IHostEnvironment environment)
    {
        if (environment.IsDevelopment()) return;
        RequireExternalSecret(configuration, "Jwt:Key", 32, required: true);
        RequireExternalSecret(configuration, "Admin:Key", 20, required: false);
        // Optional (Facebook sign-in is off without it). Facebook issues 32-character app secrets.
        RequireExternalSecret(configuration, "Auth:Facebook:AppSecret", 32, required: false);
        // Optional. When set it must be the SHA-256 of the master admin key in hex, so a typo can't silently disable it.
        var masterHash = configuration["MasterAdmin:KeyHash"];
        if (!string.IsNullOrWhiteSpace(masterHash) && !MasterAdminKey.IsValidHash(masterHash))
            throw new InvalidOperationException("MasterAdmin:KeyHash must be the SHA-256 of the key as 64 hex characters.");
        if (configuration.GetValue<bool>("Database:SeedDemoData"))
            throw new InvalidOperationException("Demo accounts must not be seeded outside Development.");
    }

    private static void RequireExternalSecret(IConfiguration configuration, string name, int minimumBytes, bool required)
    {
        var value = configuration[name];
        if (!required && string.IsNullOrWhiteSpace(value)) return;
        if (string.IsNullOrWhiteSpace(value) || Encoding.UTF8.GetByteCount(value) < minimumBytes)
            throw new InvalidOperationException($"Configure {name} with at least {minimumBytes} bytes of random secret material.");
        if (configuration is IConfigurationRoot root)
        {
            var provider = root.Providers.Reverse().FirstOrDefault(p => p.TryGet(name, out _));
            if (provider is JsonConfigurationProvider)
                throw new InvalidOperationException($"Supply {name} through deployment secrets, not an appsettings file.");
        }
    }
}
