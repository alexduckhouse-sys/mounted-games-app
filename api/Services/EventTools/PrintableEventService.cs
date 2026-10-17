using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.EventTools;

public sealed class PrintableEventService(AppDbContext db)
{
    public async Task<PrintableDrawDto?> DrawAsync(int competitionId, CancellationToken ct)
    {
        var competition = await LoadAsync(competitionId, ct);
        if (competition is null) return null;
        var sessions = competition.Sessions.Where(x => !x.IsBreak)
            .OrderBy(x => x.OrderIndex).ThenBy(x => x.Id)
            .Select(x => new PrintableSessionDto(
                x.Id, x.Section?.DisplayName ?? string.Empty, x.Name, x.ArenaName, x.OrderIndex,
                x.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id).Select(h => new PrintableHeatDto(
                    h.Id, h.Label ?? $"Heat {h.OrderIndex}", h.ScheduledStart,
                    h.Entries.OrderBy(e => e.LaneIndex).Select(e => new PrintableTeamDto(
                        e.TeamId, e.Team!.DisplayName, e.Team.Club!.Name, e.Team.Suffix, e.LaneIndex)).ToArray(),
                    h.Races.OrderBy(r => r.OrderIndex).Select(r => new PrintableRaceDto(r.Id, r.Name, r.OrderIndex)).ToArray())).ToArray()))
            .ToArray();
        return new PrintableDrawDto(ToCompetition(competition), sessions);
    }

    public async Task<PrintableScoreSheetsDto?> ScoreSheetsAsync(int competitionId, CancellationToken ct)
    {
        var competition = await LoadAsync(competitionId, ct);
        if (competition is null) return null;
        var heats = competition.Sessions.Where(x => !x.IsBreak)
            .OrderBy(x => x.OrderIndex).SelectMany(x => x.Heats.OrderBy(h => h.OrderIndex).Select(h => new { Session = x, Heat = h }))
            .Select(x => new PrintableScoreHeatDto(
                x.Heat.Id, x.Heat.Label ?? $"Heat {x.Heat.OrderIndex}", x.Session.Section?.DisplayName ?? string.Empty,
                x.Session.Name, x.Heat.ScheduledStart,
                x.Heat.Races.OrderBy(r => r.OrderIndex).Select(r => new PrintableScoreRaceDto(
                    r.Id, r.Name,
                    x.Heat.Entries.OrderBy(e => e.LaneIndex).Select(e =>
                    {
                        var result = r.Results.SingleOrDefault(y => y.TeamId == e.TeamId);
                        return new PrintableScoreCellDto(e.TeamId, e.Team!.DisplayName, result?.Placing, result?.Eliminated ?? false, result?.Points);
                    }).ToArray())).ToArray()))
            .ToArray();
        return new PrintableScoreSheetsDto(ToCompetition(competition), heats);
    }

    public async Task<PrintableResultsDto?> ResultsAsync(int competitionId, CancellationToken ct)
    {
        var competition = await LoadAsync(competitionId, ct);
        if (competition is null) return null;
        var sections = competition.Sections.OrderBy(x => x.DisplayName).Select(section =>
        {
            var rows = section.Teams.Where(x => !x.IsHorsConcours).Select(team =>
            {
                var results = team.Results.Where(x => x.Race?.Heat?.Session?.CompetitionSectionId == section.Id).ToArray();
                return new
                {
                    Team = team,
                    Total = results.Sum(x => x.Points),
                    Run = results.Length,
                    Wins = results.Count(x => x.Placing == 1 && !x.Eliminated),
                    Eliminations = results.Count(x => x.Eliminated),
                };
            }).OrderByDescending(x => x.Total).ThenBy(x => x.Team.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Team.Id).ToList();
            int? previous = null;
            var rank = 0;
            var result = new List<PrintableResultRowDto>();
            for (var i = 0; i < rows.Count; i++)
            {
                if (previous != rows[i].Total) rank = i + 1;
                previous = rows[i].Total;
                result.Add(new PrintableResultRowDto(rank, rows[i].Team.Id, rows[i].Team.DisplayName,
                    rows[i].Team.Club?.Name ?? string.Empty, rows[i].Total, rows[i].Run, rows[i].Wins, rows[i].Eliminations));
            }
            return new PrintableSectionResultsDto(section.Id, section.DisplayName, result);
        }).ToArray();
        var races = competition.Sessions.Where(x => !x.IsBreak)
            .SelectMany(x => x.Heats).SelectMany(x => x.Races).ToArray();
        var provisional = races.Length == 0 || races.Any(x => !x.IsComplete);
        return new PrintableResultsDto(ToCompetition(competition), provisional, sections);
    }

    private Task<Competition?> LoadAsync(int competitionId, CancellationToken ct)
        => db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.Club)
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.Results).ThenInclude(x => x.Race)!.ThenInclude(x => x!.Heat)!.ThenInclude(x => x!.Session)
            .Include(x => x.Sessions).ThenInclude(x => x.Section)
            .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Entries).ThenInclude(x => x.Team)!.ThenInclude(x => x!.Club)
            .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Races).ThenInclude(x => x.Results)
            .SingleOrDefaultAsync(x => x.Id == competitionId, ct);

    private static PrintableCompetitionDto ToCompetition(Competition x)
        => new(x.Id, x.Name, x.Location, x.StartDate, x.EndDate);
}
