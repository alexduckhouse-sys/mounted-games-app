using Microsoft.EntityFrameworkCore;
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
public sealed class StandingsService(AppDbContext db)
{
    public async Task<List<StandingRow>> RowsAsync(int competitionId, int? sectionId = null, CancellationToken ct = default)
    {
        var teamsQ = db.Teams
            .AsNoTracking()
            .Include(t => t.Club)
            .Include(t => t.Results)
            .Where(t => t.CompetitionId == competitionId && !t.IsHorsConcours);
        if (sectionId.HasValue) teamsQ = teamsQ.Where(t => t.CompetitionSectionId == sectionId.Value);

        var teams = await teamsQ.ToListAsync(ct);
        var tiers = await FinalsTiers.LoadAsync(db, competitionId, ct);
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
            var finalResults = t.Results.Where(r => ties.IsFinalRace(r.RaceId)).ToList();
            var finalPoints = finalResults.Sum(r => r.Points);
            var earlier = t.Results.Sum(r => r.Points) - finalPoints;
            var total = SectionScoring.Total(section, inFinal, earlier, finalPoints, bonus.GetValueOrDefault(t.Id));
            var alone = inFinal && !SectionScoring.CarriesIntoFinal(section);
            return (Total: total, Final: inFinal ? finalPoints : (double?)null, Earlier: inFinal ? earlier : (double?)null,
                TieResults: alone ? finalResults : t.Results);
        });

        var rows = teams.Select(t => new StandingRow(
                t.Id, t.DisplayName, t.Club?.Name ?? string.Empty, t.BibColour,
                scores[t.Id].Total,
                t.Results.Count,
                t.Results.Count(r => r.Placing == 1 && !r.Eliminated),
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
        return rows
            .GroupBy(r => (Tier: r.FinalTier ?? FinalsTiers.NotInFinals, r.TotalPoints))
            .OrderBy(g => g.Key.Tier)
            .ThenByDescending(g => g.Key.TotalPoints)
            .SelectMany(g =>
            {
                var byTeam = g.ToDictionary(r => r.TeamId);
                var orderedFacts = ties.OrderLevel(g.Select(r => facts[r.TeamId]).ToList());
                if (orderedFacts.Count < 2)
                    return orderedFacts.Select(f => byTeam[f.TeamId]);

                var groupRows = new List<StandingRow>(orderedFacts.Count);
                for (var i = 0; i < orderedFacts.Count; i++)
                {
                    var row = byTeam[orderedFacts[i].TeamId];
                    string? reason = null;
                    if (i + 1 < orderedFacts.Count)
                    {
                        var belowRow = byTeam[orderedFacts[i + 1].TeamId];
                        reason = ties.Explain(orderedFacts, orderedFacts[i], orderedFacts[i + 1], belowRow.TeamName);
                    }
                    else if (i > 0)
                    {
                        var prevReason = ties.Explain(orderedFacts, orderedFacts[i - 1], orderedFacts[i], row.TeamName);
                        if (prevReason == "Level on points and countback — run-off if on cut-off")
                            reason = prevReason;
                    }
                    groupRows.Add(reason is null ? row : row with { TieBreakReason = reason });
                }
                return groupRows;
            })
            .ToList();
    }
}
