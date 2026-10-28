using System.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Security;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/competitions/{competitionId:int}/teams/{teamId:int}/progress")]
public sealed class TeamProgressController(AppDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<ActionResult<TeamProgressSnapshotDto>> Get(
        int competitionId, int teamId, CancellationToken ct)
    {
        return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            // Split collection reads avoid the entries × races join. Every read must still see one
            // database snapshot, including the team/section read before the session collections.
            var isolation = db.Database.IsNpgsql() ? IsolationLevel.RepeatableRead : IsolationLevel.Serializable;
            await using var transaction = await db.Database.BeginTransactionAsync(isolation, ct);
            var observedAt = clock.GetUtcNow();
            var team = await db.Teams.AsNoTracking()
                .Where(t => t.Id == teamId && t.CompetitionId == competitionId)
                .Select(t => new Team
                {
                    Id = t.Id,
                    CompetitionId = t.CompetitionId,
                    CompetitionSectionId = t.CompetitionSectionId,
                    EntryStatus = t.EntryStatus,
                    IsHorsConcours = t.IsHorsConcours,
                    Section = t.Section == null ? null : new CompetitionSection
                    {
                        Id = t.Section.Id,
                        CompetitionId = t.Section.CompetitionId,
                        HasFinal = t.Section.HasFinal,
                        UsesRaceFinals = t.Section.UsesRaceFinals,
                    },
                }).SingleOrDefaultAsync(ct);
            if (team is null) return (ActionResult<TeamProgressSnapshotDto>)NotFound();

            // Do not restrict this to the team's section: earlier heats in the same arena count too.
            // Project only fields used by the calculator, never declarations, contacts or result notes.
            var sessions = await db.Sessions.AsNoTracking().AsSplitQuery()
                .Where(s => s.CompetitionId == competitionId)
                .Select(s => new Session
                {
                    Id = s.Id,
                    CompetitionId = s.CompetitionId,
                    CompetitionSectionId = s.CompetitionSectionId,
                    Kind = s.Kind,
                    IsBreak = s.IsBreak,
                    Status = s.Status,
                    FinishedAt = s.FinishedAt,
                    OrderIndex = s.OrderIndex,
                    ArenaName = s.ArenaName,
                    Notes = s.Notes,
                    Heats = s.Heats.Select(h => new Heat
                    {
                        Id = h.Id,
                        SessionId = h.SessionId,
                        Label = h.Label,
                        OrderIndex = h.OrderIndex,
                        StartedAt = h.StartedAt,
                        FinishedAt = h.FinishedAt,
                        RaceRoundId = h.RaceRoundId,
                        RaceRoundStage = h.RaceRoundStage,
                        Entries = h.Entries.Select(e => new HeatEntry
                        {
                            HeatId = e.HeatId,
                            TeamId = e.TeamId,
                            LaneIndex = e.LaneIndex,
                        }).ToList(),
                        Races = h.Races.Select(r => new Race
                        {
                            Id = r.Id,
                            HeatId = r.HeatId,
                            IsComplete = r.IsComplete,
                            StartedAt = r.StartedAt,
                            FinishedAt = r.FinishedAt,
                        }).ToList(),
                    }).ToList(),
                }).ToListAsync(ct);

            var progress = TeamProgress.Calculate(team, team.Section, sessions, isCompleteSnapshot: true);
            await transaction.CommitAsync(ct);
            return new TeamProgressSnapshotDto(progress, observedAt, observedAt.AddSeconds(60));
        });
    }
}
