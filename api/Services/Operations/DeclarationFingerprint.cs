using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MountedGames.Api.Entities;
namespace MountedGames.Api.Services.Operations;
public static class DeclarationFingerprint
{
    // Include all scalar rider fields, never navigation properties or a raw copy of personal data.
    public static string Of(DeclarationForm form)
    {
        var properties = typeof(RiderEntry).GetProperties().Where(p => p.Name != nameof(RiderEntry.DeclarationForm)
            && p.Name != nameof(RiderEntry.SavedRider)).OrderBy(p => p.Name).ToArray();
        var riders = form.Riders.OrderBy(r => r.Id).Select(r => properties.ToDictionary(p => p.Name, p => p.GetValue(r)));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
            { form.Id, form.SubmittedAt, form.IsLocked, Riders = riders }))));
    }
}
