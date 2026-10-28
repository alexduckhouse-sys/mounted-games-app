using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// The overall standings of a competition or one section. Hors concours teams are left out. Once finals exist the
/// final a team is in decides its place before points do; within a final teams go by total points, then
/// the age group's tie-break (<see cref="TieBreaker"/>). A finalist's total follows its section's final switches
/// (<see cref="SectionScoring"/>): all its points when they carry into the final, its final's points alone when not.
/// </summary>
public sealed class StandingsService(AppDbContext db, IMemoryCache? cache = null)
{
    private static long _version;
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<int, long> CompetitionVersions = new();

    /// <summary>Invalidates all cached standings snapshots across competitions.</summary>
    public static void BumpVersion() => Interlocked.Increment(ref _version);

    /// <summary>Invalidates cached standings snapshots for a specific competition.</summary>
    public static void Invalidate(int competitionId)
    {
        CompetitionVersions.AddOrUpdate(competitionId, 1, static (_, current) => current + 1);
        Interlocked.Increment(ref _version);
    }

    public async Task<List<StandingRow>> RowsAsync(int competitionId, int? sectionId = null, CancellationToken ct = default)
    {
        if (cache is not null)
        {
            var globalVersion = Interlocked.Read(ref _version);
            var compVersion = CompetitionVersions.GetOrAdd(competitionId, 0);
            var cacheKey = $"standings:v1:{competitionId}:{sectionId?.ToString() ?? "all"}:{globalVersion}:{compVersion}";
            if (cache.TryGetValue<IReadOnlyList<StandingRow>>(cacheKey, out var cached) && cached is not null)
                return cached.ToList();

            var computed = await ComputeRowsAsync(competitionId, sectionId, ct);
            cache.Set<IReadOnlyList<StandingRow>>(
                cacheKey,
                computed,
                new MemoryCacheEntryOptions
                {
                    SlidingExpiration = TimeSpan.FromSeconds(2),
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(5),
                });
            return computed.ToList();
        }

        return await ComputeRowsAsync(competitionId, sectionId, ct);
    }

    /// <summary>Standings from sessions before the given timetable position, using the same totals and tie-breaks as the current table.</summary>
    public async Task<List<StandingRow>> RowsBeforeSessionAsync(
        int competitionId, int beforeSessionId, int? sectionId = null, CancellationToken ct = default)
    {
        var boundary = await db.Sessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == beforeSessionId && s.CompetitionId == competitionId, ct)
            ?? throw new KeyNotFoundException("Session not found in this competition.");
        var priorSessions = await db.Sessions.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId
                && (s.OrderIndex < boundary.OrderIndex || (s.OrderIndex == boundary.OrderIndex && s.Id < boundary.Id)))
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races)
            .ToListAsync(ct);
        return await ComputeRowsAsync(competitionId, sectionId, ct, priorSessions);
    }

    private async Task<List<StandingRow>> ComputeRowsAsync(
        int competitionId, int? sectionId, CancellationToken ct, IReadOnlyList<Session>? priorSessions = null)
    {
        var teamsQ = db.Teams
            .AsNoTracking()
            .Include(t => t.Club)
            .Include(t => t.Results)
            .Where(t => t.CompetitionId == competitionId && !t.IsHorsConcours);
        if (sectionId.HasValue) teamsQ = teamsQ.Where(t => t.CompetitionSectionId == sectionId.Value);

        var teams = await teamsQ.ToListAsync(ct);
        if (priorSessions is not null)
        {
            var includedRaceIds = priorSessions.SelectMany(s => s.Heats).SelectMany(h => h.Races).Select(r => r.Id).ToHashSet();
            foreach (var team in teams)
                team.Results = team.Results.Where(r => includedRaceIds.Contains(r.RaceId)).ToList();
        }
        var tiers = priorSessions is null
            ? await FinalsTiers.LoadAsync(db, competitionId, ct)
            : FinalsTiers.From(priorSessions);
        var ties = await TieBreaker.LoadAsync(db, competitionId, ct);
        var sections = await db.CompetitionSections.AsNoTracking()
            .Where(x => x.CompetitionId == competitionId).ToDictionaryAsync(x => x.Id, ct);
        // Tack check bonus points are part of the total (so they move a team within its final, never past one)
        // and also reported on their own so the table shows why a total changed. They are not wins.
        var bonus = await TackCheck.TackCheckBonus.ForCompetitionAsync(db, competitionId, ct);

        // What each team scores for ranking, and the results that count towards its tie-break. A finalist in a section
        // that doesn't carry points is ranked, and its ties are settled, on its final alone.
        var scores = teams.ToDictionary(t => t.Id, t =>
        {
            var section = sections.GetValueOrDefault(t.CompetitionSectionId);
            var inFinal = tiers.TierOf(t.Id) is not null;
            var effectiveResults = ties.EffectiveResults(t.Results);
            var finalResults = effectiveResults.Where(r => ties.IsFinalRace(r.RaceId)).ToList();
            var finalPoints = finalResults.Sum(r => r.Points);
            var earlier = effectiveResults.Sum(r => r.Points) - finalPoints;
            var total = SectionScoring.Total(section, inFinal, earlier, finalPoints, bonus.GetValueOrDefault(t.Id));
            var alone = inFinal && !SectionScoring.CarriesIntoFinal(section);
            return (Total: total, Final: inFinal ? finalPoints : (double?)null, Earlier: inFinal ? earlier : (double?)null,
                TieResults: alone ? finalResults : effectiveResults, Effective: effectiveResults);
        });

        var rows = teams.Select(t => new StandingRow(
                t.Id, t.DisplayName, t.Club?.Name ?? string.Empty, t.BibColour,
                scores[t.Id].Total,
                t.Results.Count(r => !r.IsSitOut),
                scores[t.Id].Effective.Count(r => !r.IsSitOut && r.Placing == 1 && !r.Eliminated),
                t.Results.Count(r => r.Eliminated && ResultStatuses.Of(r) == ResultStatus.Eliminated),
                tiers.TierOf(t.Id),
                t.EntryStatus != TeamEntryStatus.Active,
                bonus.GetValueOrDefault(t.Id),
                ResultStatuses.TeamCardOf(t),
                ResultStatuses.TeamFlagOf(t.BibDescription),
                ResultStatuses.PublicBibDescription(t.BibDescription),
                scores[t.Id].Final, scores[t.Id].Earlier))
            .ToList();
        var facts = teams.ToDictionary(t => t.Id, t => ties.Facts(t.Id, t.CompetitionSectionId, scores[t.Id].TieResults, scores[t.Id].Total));

        // Within a final (or among non-finalists), teams level on points go in tie-break order: the age group's
        // rule, or the organiser's order after a run-off.
        var ordered = new List<StandingRow>(rows.Count);
        foreach (var g in rows
            .GroupBy(r => (Tier: r.FinalTier ?? FinalsTiers.NotInFinals, r.TotalPoints))
            .OrderBy(g => g.Key.Tier)
            .ThenByDescending(g => g.Key.TotalPoints))
        {
            var byTeam = g.ToDictionary(r => r.TeamId);
            var orderedFacts = ties.OrderLevel(g.Select(r => facts[r.TeamId]).ToList());
            var groupStart = ordered.Count;
            var chainStart = groupStart;
            for (var i = 0; i < orderedFacts.Count; i++)
            {
                var row = byTeam[orderedFacts[i].TeamId];
                string? reason = null;
                if (orderedFacts.Count > 1)
                {
                    if (i + 1 < orderedFacts.Count)
                    {
                        var belowRow = byTeam[orderedFacts[i + 1].TeamId];
                        reason = ties.Explain(orderedFacts, orderedFacts[i], orderedFacts[i + 1], belowRow.TeamName);
                    }
                    else if (i > 0)
                    {
                        var prevReason = ties.Explain(orderedFacts, orderedFacts[i - 1], orderedFacts[i], row.TeamName);
                        if (prevReason == "Level on points and countback (run-off if on cut-off)")
                            reason = prevReason;
                    }
                }
                // Shared place (1, 2, 2, 4): a team shares the one above it only while nothing separates them.
                if (i > 0 && ties.Settle(orderedFacts, orderedFacts[i - 1], orderedFacts[i]) != TieSettlement.Open)
                    chainStart = groupStart + i;
                ordered.Add((reason is null ? row : row with { TieBreakReason = reason }) with { Place = chainStart + 1 });
            }
        }
        // A team is joint when its neighbour in the table holds the same place.
        for (var i = 0; i < ordered.Count; i++)
        {
            var joint = (i > 0 && ordered[i - 1].Place == ordered[i].Place)
                || (i + 1 < ordered.Count && ordered[i + 1].Place == ordered[i].Place);
            if (joint) ordered[i] = ordered[i] with { Joint = true };
        }
        return ordered;
    }
}
