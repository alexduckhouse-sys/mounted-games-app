using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// The overall standings of a competition or one section. Hors concours teams are left out. Once finals exist the
/// final a team is in decides its place before points do; within a final teams go by total points, then wins.
/// </summary>
public sealed class StandingsService(AppDbContext db)
{
    public async Task<List<StandingRow>> RowsAsync(int competitionId, int? sectionId = null, CancellationToken ct = default)
    {
        var teamsQ = db.Teams
            .Include(t => t.Club)
            .Include(t => t.Results).ThenInclude(r => r.Race)
            .Where(t => t.CompetitionId == competitionId && !t.IsHorsConcours);
        if (sectionId.HasValue) teamsQ = teamsQ.Where(t => t.CompetitionSectionId == sectionId.Value);

        var teams = await teamsQ.ToListAsync(ct);
        var tiers = await FinalsTiers.LoadAsync(db, competitionId, ct);

        return teams.Select(t => new StandingRow(
                t.Id, t.DisplayName, t.Club?.Name ?? string.Empty, t.BibColour,
                t.Results.Sum(r => r.Points),
                t.Results.Count,
                t.Results.Count(r => r.Placing == 1 && !r.Eliminated),
                t.Results.Count(r => r.Eliminated && ResultStatuses.Of(r) == ResultStatus.Eliminated),
                tiers.TierOf(t.Id),
                t.EntryStatus != TeamEntryStatus.Active))
            .OrderBy(r => r.FinalTier ?? FinalsTiers.NotInFinals)
            .ThenByDescending(r => r.TotalPoints)
            .ThenByDescending(r => r.Wins)
            .ToList();
    }
}
