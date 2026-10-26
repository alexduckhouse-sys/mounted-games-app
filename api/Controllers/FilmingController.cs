using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;

namespace MountedGames.Api.Controllers;

/// <summary>Riders who asked not to be filmed or photographed close up, for the people running the stream.</summary>
[ApiController]
[Route("api/competitions/{competitionId:int}/filming-optouts")]
public class FilmingController(AppDbContext db) : ControllerBase
{
    /// <summary>
    /// Every heat holding a team whose current declaration lists a rider with the opt-out. This is safeguarding data
    /// about named riders, so only the competition's staff (admins, the owner, the team) can ask for it.
    /// </summary>
    [HttpGet]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IEnumerable<FilmingOptOutDto>> List(int competitionId, CancellationToken ct)
    {
        // A team's latest locked declaration is the one in force.
        var forms = await db.DeclarationForms.AsNoTracking()
            .Where(d => d.IsLocked && d.Team!.CompetitionId == competitionId)
            .Select(d => new { d.Id, d.TeamId, d.SubmittedAt })
            .ToListAsync(ct);
        var latestIds = forms.GroupBy(f => f.TeamId)
            .Select(g => g.OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).First().Id)
            .ToArray();
        var current = (await db.RiderEntries.AsNoTracking()
            .Where(r => r.NoFilming && latestIds.Contains(r.DeclarationFormId))
            .Select(r => new { r.DeclarationForm!.TeamId, r.FullName, r.IsReserve })
            .ToListAsync(ct)).ToList();
        if (current.Count == 0) return [];

        var teamIds = current.Select(r => r.TeamId).Distinct().ToArray();
        var entries = await db.HeatEntries.AsNoTracking()
            .Where(e => teamIds.Contains(e.TeamId) && e.Heat!.Session!.CompetitionId == competitionId)
            .Select(e => new
            {
                e.TeamId, TeamName = e.Team!.DisplayName, e.LaneIndex,
                HeatId = e.HeatId, e.Heat!.Label, e.Heat.OrderIndex, e.Heat.FinishedAt,
                Races = e.Heat.Races.Select(r => new { r.IsComplete }).ToList(),
                SessionId = e.Heat.SessionId, SessionName = e.Heat.Session!.Name, SessionOrder = e.Heat.Session.OrderIndex,
                e.Heat.Session.ArenaName,
            })
            .ToListAsync(ct);

        // "Heat 2" counts within the session, the way the timetable does.
        var heatOrder = await db.Heats.AsNoTracking()
            .Where(h => h.Session!.CompetitionId == competitionId)
            .Select(h => new { h.Id, h.SessionId, h.OrderIndex })
            .ToListAsync(ct);
        var position = heatOrder.GroupBy(h => h.SessionId)
            .SelectMany(g => g.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id).Select((h, i) => (h.Id, Number: i + 1)))
            .ToDictionary(x => x.Id, x => x.Number);

        return entries
            .SelectMany(e =>
            {
                var finished = e.FinishedAt != null || (e.Races.Count > 0 && e.Races.All(r => r.IsComplete));
                return current.Where(r => r.TeamId == e.TeamId).Select(r => new FilmingOptOutDto(
                    e.HeatId, e.SessionId, e.SessionName, e.ArenaName,
                    string.IsNullOrWhiteSpace(e.Label) ? $"Heat {position.GetValueOrDefault(e.HeatId, 1)}" : e.Label!,
                    e.TeamId, e.TeamName, e.LaneIndex, r.FullName, r.IsReserve, finished, e.SessionOrder, e.OrderIndex));
            })
            .OrderBy(x => x.SessionOrder).ThenBy(x => x.HeatOrder).ThenBy(x => x.Lane).ThenBy(x => x.RiderName)
            .ToList();
    }
}
