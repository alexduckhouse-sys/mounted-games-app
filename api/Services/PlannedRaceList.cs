using System.Text.Json;

namespace MountedGames.Api.Services;

/// <summary>Reads and writes <c>Session.PlannedRaces</c>: a JSON array of race names, null when none are chosen.</summary>
public static class PlannedRaceList
{
    public const int MaxRaces = 40;

    public static IReadOnlyList<string>? Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<List<string>>(json); }
        catch (JsonException) { return null; }
    }

    /// <summary>Trims names, drops blanks and caps the list; an empty result is stored as null (not chosen).</summary>
    public static string? Write(IEnumerable<string>? races)
    {
        var clean = (races ?? []).Select(r => r?.Trim() ?? string.Empty).Where(r => r.Length > 0)
            .Select(r => r.Length > 120 ? r[..120] : r).Take(MaxRaces).ToList();
        return clean.Count == 0 ? null : JsonSerializer.Serialize(clean);
    }
}
