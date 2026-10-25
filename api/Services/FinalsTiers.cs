using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// Which final each team is in. Heats labelled "A Final", "B Final", "C Final" and so on
/// (see <c>CompetitionsController.CreateFinals</c>) form tiers 0, 1, 2, ...; a team in none of
/// them has no tier. Overall standings sort by tier first so a B or C finalist, who scores
/// points in a weaker final, never overtakes an A finalist. Where a section has no finals
/// nobody has a tier and the order is just points.
/// </summary>
public sealed class FinalsTiers
{
    /// <summary>Sort key for a team that is in no final: after every finalist.</summary>
    public const int NotInFinals = int.MaxValue;

    private readonly Dictionary<int, int> _tierByTeam;
    private FinalsTiers(Dictionary<int, int> tierByTeam) => _tierByTeam = tierByTeam;

    /// <summary>0 for the A Final, 1 for the B Final, and so on (including multi-part finals like "A Final Part 1"); null for a label that isn't a lettered final.</summary>
    public static int? ParseLabel(string? label)
    {
        var text = label?.Trim();
        if (text is not { Length: >= 7 }) return null;
        var letter = char.ToUpperInvariant(text[0]);
        if (letter is < 'A' or > 'Z') return null;
        if (!text.AsSpan(1).StartsWith(" Final", StringComparison.OrdinalIgnoreCase)) return null;
        if (text.Length == 7) return letter - 'A';
        var suffix = text[7..].Trim();
        if (suffix.StartsWith('-') || suffix.StartsWith('·') || suffix.StartsWith('–'))
            suffix = suffix[1..].TrimStart();
        if (suffix.StartsWith("Part ", StringComparison.OrdinalIgnoreCase))
            suffix = suffix[5..].TrimStart();
        return suffix.Length > 0 && suffix.All(char.IsAsciiDigit) ? letter - 'A' : null;
    }

    /// <summary>Reads the tiers from the heats of the race sessions given (heats must have their entries loaded).</summary>
    public static FinalsTiers From(IEnumerable<Session> sessions)
        => FromEntries(sessions
            .Where(s => s.Kind == SessionKind.Race && !s.IsBreak)
            .SelectMany(s => s.Heats)
            .SelectMany(h => h.Entries.Select(e => (e.TeamId, h.Label))));

    public static async Task<FinalsTiers> LoadAsync(AppDbContext db, int competitionId, CancellationToken ct = default)
    {
        var entries = await db.HeatEntries.AsNoTracking()
            .Where(e => e.Heat!.Session!.CompetitionId == competitionId
                && e.Heat.Session.Kind == SessionKind.Race && !e.Heat.Session.IsBreak
                && e.Heat.Label != null)
            .Select(e => new { e.TeamId, e.Heat!.Label })
            .ToListAsync(ct);
        return FromEntries(entries.Select(e => (e.TeamId, e.Label)));
    }

    private static FinalsTiers FromEntries(IEnumerable<(int TeamId, string? Label)> entries)
    {
        var tiers = new Dictionary<int, int>();
        foreach (var (teamId, label) in entries)
        {
            if (ParseLabel(label) is not { } tier) continue;
            // If a team is somehow in more than one lettered final, the best one counts.
            if (!tiers.TryGetValue(teamId, out var current) || tier < current) tiers[teamId] = tier;
        }
        return new FinalsTiers(tiers);
    }

    /// <summary>The team's final, or null if it isn't in one.</summary>
    public int? TierOf(int teamId) => _tierByTeam.TryGetValue(teamId, out var tier) ? tier : null;

    /// <summary>Ascending sort key: the final's tier, then <see cref="NotInFinals"/>.</summary>
    public int SortKey(int teamId) => _tierByTeam.TryGetValue(teamId, out var tier) ? tier : NotInFinals;
}
