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

    /// <summary>
    /// 0 for the A Final (or Grand Final), 1 for the B Final, and so on (including "Final A" / "Finale A"
    /// and multi-part finals like "A Final Part 1"); null for a label that isn't a lettered final.
    /// </summary>
    public static int? ParseLabel(string? label)
    {
        if (label is null) return null;
        var text = label.Trim();
        if (text.Length < 7) return null;

        var first = char.ToUpperInvariant(text[0]);
        if (first is >= 'A' and <= 'Z')
        {
            if (TryStripPrefix(text[1..], " Finale", out var afterLetterFinale) && IsValidSuffix(afterLetterFinale))
                return first - 'A';
            if (TryStripPrefix(text[1..], " Final", out var afterLetterFinal) && IsValidSuffix(afterLetterFinal))
                return first - 'A';
        }

        if (TryStripPrefix(text, "Finale ", out var afterFinale) || TryStripPrefix(text, "Final ", out afterFinale))
        {
            afterFinale = afterFinale.TrimStart();
            if (afterFinale.Length >= 1)
            {
                var letter = char.ToUpperInvariant(afterFinale[0]);
                if (letter is >= 'A' and <= 'Z' && IsValidSuffix(afterFinale[1..]))
                    return letter - 'A';
            }
        }

        foreach (var (prefix, tier) in NamedFinals)
        {
            if (TryStripPrefix(text, prefix, out var afterGrand) && IsValidSuffix(afterGrand))
                return tier;
        }

        return null;
    }

    private static readonly (string Prefix, int Tier)[] NamedFinals =
    [
        ("Grande Finale", 0),
        ("Grand Finale", 0),
        ("Grande Final", 0),
        ("Grand Final", 0),
        ("Championship Finale", 0),
        ("Championship Final", 0),
        ("Consolation Finale", 1),
        ("Consolation Final", 1),
        ("Plate Finale", 1),
        ("Plate Final", 1),
        ("Bowl Finale", 2),
        ("Bowl Final", 2),
        ("Shield Finale", 3),
        ("Shield Final", 3),
    ];

    private static bool TryStripPrefix(string text, string prefix, out string rest)
    {
        if (text.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            rest = text[prefix.Length..];
            return true;
        }
        rest = string.Empty;
        return false;
    }

    private static bool IsValidSuffix(string rawSuffix)
    {
        if (rawSuffix.Length == 0) return true;
        if (!char.IsWhiteSpace(rawSuffix[0]) && rawSuffix[0] is not ('-' or '·' or '–' or '—' or ':' or '/' or '('))
            return false;
        var suffix = rawSuffix.Trim();
        if (suffix.StartsWith('(') && suffix.EndsWith(')') && suffix.Length > 2)
            return true;
        if (suffix[0] is '-' or '·' or '–' or '—' or ':' or '/')
        {
            var afterSep = suffix[1..].TrimStart();
            return afterSep.Length > 0;
        }
        if (suffix.StartsWith("Part ", StringComparison.OrdinalIgnoreCase))
            suffix = suffix[5..].TrimStart();
        return suffix.Length > 0 && suffix.All(char.IsAsciiDigit);
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
