using System.Text.Json;

namespace MountedGames.Api.Services;

/// <summary>
/// Reads and writes <c>Session.PlannedFinalRaces</c>: the race lists of the B, C... finals of a finals session, as a
/// JSON object keyed by final letter (<c>{"B":["Bending"],"C":["Flag"]}</c>). The A Final uses
/// <c>Session.PlannedRaces</c>, and a final with no list of its own does too. Null means no final has its own list.
/// </summary>
public static class PlannedFinalRaceLists
{
    public static IReadOnlyDictionary<string, IReadOnlyList<string>>? Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var raw = JsonSerializer.Deserialize<Dictionary<string, List<string>>>(json);
            if (raw is null) return null;
            var clean = raw.Where(kv => IsFinalLetter(kv.Key) && kv.Value is { Count: > 0 })
                .ToDictionary(kv => kv.Key.ToUpperInvariant(), kv => (IReadOnlyList<string>)kv.Value);
            return clean.Count == 0 ? null : clean;
        }
        catch (JsonException) { return null; }
    }

    /// <summary>True for a single letter B to Z (A is covered by <c>PlannedRaces</c>).</summary>
    public static bool IsFinalLetter(string? key)
        => key is { Length: 1 } && char.ToUpperInvariant(key[0]) is >= 'B' and <= 'Z';

    /// <summary>The first key that is not a letter B to Z, or null when all are fine.</summary>
    public static string? FirstInvalidKey(IReadOnlyDictionary<string, IReadOnlyList<string>>? lists)
        => lists?.Keys.FirstOrDefault(k => !IsFinalLetter(k));

    /// <summary>Cleans each list like <see cref="PlannedRaceList.Write"/> and drops empty ones; nothing left is stored as null.</summary>
    public static string? Write(IReadOnlyDictionary<string, IReadOnlyList<string>>? lists)
    {
        if (lists is null) return null;
        var clean = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var (key, races) in lists)
        {
            if (!IsFinalLetter(key)) continue;
            var written = PlannedRaceList.Read(PlannedRaceList.Write(races));
            if (written is { Count: > 0 }) clean[key.ToUpperInvariant()] = written.ToList();
        }
        return clean.Count == 0 ? null : JsonSerializer.Serialize(clean);
    }

    /// <summary>The race names for one final: its own list when it has one, otherwise the fallback.</summary>
    public static IReadOnlyList<string> For(char letter, string? json, IReadOnlyList<string> fallback)
        => Read(json) is { } lists && lists.TryGetValue(char.ToUpperInvariant(letter).ToString(), out var own) ? own : fallback;
}
