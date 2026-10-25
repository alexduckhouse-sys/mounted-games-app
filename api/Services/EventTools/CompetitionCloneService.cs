using MountedGames.Api.Data;
using MountedGames.Api.Dtos;

namespace MountedGames.Api.Services.EventTools;

/// <summary>
/// "Duplicate for next year": copies the competition's set-up (see <see cref="CompetitionSetup"/>) and nothing that belongs
/// to last year's entrants. No teams, heats, results, entries or payments are copied; sessions come across without heats,
/// so the new event draws its own.
/// </summary>
public sealed class CompetitionCloneService(AppDbContext db)
{
    public async Task<CloneCompetitionResultDto> CloneAsync(
        int sourceCompetitionId, CloneCompetitionRequest request, string creatorUserId, CancellationToken ct)
    {
        CompetitionSetupService.Validate(request.Name, request.StartDate, request.EndDate);
        var service = new CompetitionSetupService(db);
        var setup = await service.ReadAsync(sourceCompetitionId, ct);
        var (clone, sections, sessions) = await service.CreateAsync(setup, request.Name, request.StartDate, request.EndDate, creatorUserId, ct);
        return new CloneCompetitionResultDto(clone.Id, clone.Name, sections, 0, sessions, 0, 0);
    }
}
