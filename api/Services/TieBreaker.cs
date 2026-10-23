using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>What a team brings to a tie: its total and the results that can separate it from the others.</summary>
/// <param name="PlacingCounts">Index 0 is the number of 1st places, index 1 the 2nds, and so on (finished races only).</param>
/// <param name="RecentPoints">Points per race, the most recent race first.</param>
public sealed record TieFacts(int TeamId, int? SectionId, int Total, int[] PlacingCounts, int[] RecentPoints)
{
    public int Wins => PlacingCounts.Length > 0 ? PlacingCounts[0] : 0;
}

/// <summary>How a cut between two teams level on points was settled.</summary>
public enum TieSettlement
{
    /// <summary>The age group's rule separates them (countback or last race).</summary>
    Rule = 1,
    /// <summary>The organiser set the order (after a run-off, or by hand).</summary>
    Organiser = 2,
    /// <summary>Nothing separates them yet: the organiser needs to run a run-off or choose.</summary>
    Open = 3
}

/// <summary>
/// Orders teams level on points using their age group's <see cref="TieBreakRule"/>, or the organiser's
/// <see cref="FinalsTieOrder"/> when one is set for every team in the tie at its current total. Finals seeding,
/// the finals boundary check and the standings all order ties through this, so they agree.
/// Where nothing settles a tie (a run-off or manual rule with no order set, or a countback that is still level)
/// the provisional order is the countback, then team id, so the answer is the same every time.
/// </summary>
public sealed class TieBreaker
{
    private readonly IReadOnlyDictionary<int, TieBreakRule> _rules;
    private readonly IReadOnlyDictionary<int, FinalsTieOrder> _orders;
    private readonly IReadOnlyDictionary<int, (int Session, int Race, int Heat)> _raceOrder;

    public TieBreaker(
        IReadOnlyDictionary<int, TieBreakRule> rulesBySection,
        IReadOnlyDictionary<int, FinalsTieOrder> ordersByTeam,
        IReadOnlyDictionary<int, (int Session, int Race, int Heat)> raceOrder)
    {
        _rules = rulesBySection;
        _orders = ordersByTeam;
        _raceOrder = raceOrder;
    }

    public static async Task<TieBreaker> LoadAsync(AppDbContext db, int competitionId, CancellationToken ct = default)
    {
        var rules = await db.CompetitionSections.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId)
            .ToDictionaryAsync(s => s.Id, s => s.TieBreakRule, ct);
        var orders = await db.FinalsTieOrders.AsNoTracking()
            .Where(o => o.CompetitionId == competitionId)
            .ToDictionaryAsync(o => o.TeamId, ct);
        var races = await db.Races.AsNoTracking()
            .Where(r => r.Heat!.Session!.CompetitionId == competitionId)
            .Select(r => new { r.Id, Session = r.Heat!.Session!.OrderIndex, Race = r.OrderIndex, Heat = r.Heat.OrderIndex })
            .ToListAsync(ct);
        return new TieBreaker(rules, orders, races.ToDictionary(r => r.Id, r => (r.Session, r.Race, r.Heat)));
    }

    public TieBreakRule RuleFor(int? sectionId)
        => sectionId is { } id && _rules.TryGetValue(id, out var rule) ? rule : TieBreakRule.Countback;

    /// <param name="total">The team's total when it isn't just the sum of its race points (bonus points).</param>
    public TieFacts Facts(int teamId, int? sectionId, IEnumerable<Result> results, int? total = null)
    {
        var list = results.ToList();
        var maxPlace = list.Where(r => !r.Eliminated && r.Placing > 0).Select(r => r.Placing!.Value).DefaultIfEmpty(0).Max();
        var counts = new int[maxPlace];
        foreach (var r in list.Where(r => !r.Eliminated && r.Placing > 0)) counts[r.Placing!.Value - 1]++;
        var recent = list
            .OrderByDescending(r => _raceOrder.TryGetValue(r.RaceId, out var o) ? o : (int.MinValue, int.MinValue, int.MinValue))
            .Select(r => r.Points)
            .ToArray();
        return new TieFacts(teamId, sectionId, total ?? list.Sum(r => r.Points), counts, recent);
    }

    public TieFacts Facts(Team team) => Facts(team.Id, team.CompetitionSectionId, team.Results);

    /// <summary>Highest total first; teams level on points in tie-break order.</summary>
    public List<TieFacts> Rank(IEnumerable<TieFacts> teams)
        => teams.GroupBy(f => f.Total)
            .OrderByDescending(g => g.Key)
            .SelectMany(g => OrderLevel(g.ToList()))
            .ToList();

    /// <summary>Orders teams that are level on points, best first.</summary>
    public List<TieFacts> OrderLevel(IReadOnlyList<TieFacts> level)
    {
        if (level.Count < 2) return level.ToList();
        if (OrganiserOrdered(level))
            return level.OrderBy(f => _orders[f.TeamId].Position).ThenBy(f => f.TeamId).ToList();
        var rule = RuleOf(level);
        return level.Order(Comparer<TieFacts>.Create((a, b) => Compare(a, b, rule))).ToList();
    }

    /// <summary>True when the organiser has ordered every team in this tie at its current total.</summary>
    public bool OrganiserOrdered(IReadOnlyList<TieFacts> level) => level.Count > 1 && level.All(HasCurrentOrder);

    /// <summary>
    /// How the cut between <paramref name="above"/> and <paramref name="below"/> is settled. Both are in
    /// <paramref name="level"/>, the whole group level on points, already in <see cref="OrderLevel"/> order.
    /// </summary>
    public TieSettlement Settle(IReadOnlyList<TieFacts> level, TieFacts above, TieFacts below)
    {
        if (OrganiserOrdered(level)) return TieSettlement.Organiser;
        var rule = RuleOf(level);
        if (rule is TieBreakRule.RunOff or TieBreakRule.Manual) return TieSettlement.Open;
        return RuleKey(above, below, rule) != 0 ? TieSettlement.Rule : TieSettlement.Open;
    }

    /// <summary>The rule for a group: its age group's, or countback when the teams come from more than one.</summary>
    public TieBreakRule RuleOf(IEnumerable<TieFacts> level)
    {
        var sections = level.Select(f => f.SectionId).Distinct().ToList();
        return sections.Count == 1 ? RuleFor(sections[0]) : TieBreakRule.Countback;
    }

    private bool HasCurrentOrder(TieFacts f) => _orders.TryGetValue(f.TeamId, out var o) && o.Points == f.Total;

    /// <summary>Negative when <paramref name="a"/> ranks above <paramref name="b"/>.</summary>
    private static int Compare(TieFacts a, TieFacts b, TieBreakRule rule)
    {
        var byRule = RuleKey(a, b, rule);
        if (byRule != 0) return byRule;
        var byCountback = Lexicographic(a.PlacingCounts, b.PlacingCounts, padMissing: true);
        return byCountback != 0 ? byCountback : a.TeamId.CompareTo(b.TeamId);
    }

    private static int RuleKey(TieFacts a, TieFacts b, TieBreakRule rule) => rule switch
    {
        TieBreakRule.LastRace => Lexicographic(a.RecentPoints, b.RecentPoints, padMissing: false),
        TieBreakRule.Countback => Lexicographic(a.PlacingCounts, b.PlacingCounts, padMissing: true),
        _ => 0,
    };

    /// <summary>
    /// Bigger numbers rank higher, compared position by position. Placing counts pad a shorter list with zeros
    /// (no 4ths is 0 4ths); recent points compare only the races both teams have run.
    /// </summary>
    private static int Lexicographic(int[] a, int[] b, bool padMissing)
    {
        var length = padMissing ? Math.Max(a.Length, b.Length) : Math.Min(a.Length, b.Length);
        for (var i = 0; i < length; i++)
        {
            var x = i < a.Length ? a[i] : 0;
            var y = i < b.Length ? b[i] : 0;
            if (x != y) return y.CompareTo(x);
        }
        return 0;
    }
}
