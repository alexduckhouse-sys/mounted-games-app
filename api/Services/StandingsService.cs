using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// The overall standings of a competition or one section. Hors concours teams are left out. Once finals exist the
/// final a team is in decides its place before points do; within a final teams go by total points, then
/// the age group's tie-break (<see cref="TieBreaker"/>).
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
        // Tack check bonus points are part of the total (so they move a team within its final, never past one)
        // and also reported on their own so the table shows why a total changed. They are not wins.
        var bonus = await TackCheck.TackCheckBonus.ForCompetitionAsync(db, competitionId, ct);

        var rows = teams.Select(t => new StandingRow(
                t.Id, t.DisplayName, t.Club?.Name ?? string.Empty, t.BibColour,
                t.Results.Sum(r => r.Points) + bonus.GetValueOrDefault(t.Id),
                t.Results.Count,
                t.Results.Count(r => r.Placing == 1 && !r.Eliminated),
                t.Results.Count(r => r.Eliminated && ResultStatuses.Of(r) == ResultStatus.Eliminated),
                tiers.TierOf(t.Id),
                t.EntryStatus != TeamEntryStatus.Active,
                bonus.GetValueOrDefault(t.Id)))
            .ToList();
        var facts = teams.ToDictionary(t => t.Id, t => ties.Facts(t.Id, t.CompetitionSectionId, t.Results, t.Results.Sum(r => r.Points) + bonus.GetValueOrDefault(t.Id)));

        // Within a final (or among non-finalists), teams level on points go in tie-break order: the age group's
        // rule, or the organiser's order after a run-off.
        return rows
            .GroupBy(r => (Tier: r.FinalTier ?? FinalsTiers.NotInFinals, r.TotalPoints))
            .OrderBy(g => g.Key.Tier)
            .ThenByDescending(g => g.Key.TotalPoints)
            .SelectMany(g =>
            {
                var byTeam = g.ToDictionary(r => r.TeamId);
                return ties.OrderLevel(g.Select(r => facts[r.TeamId]).ToList()).Select(f => byTeam[f.TeamId]);
            })
            .ToList();
    }
}
