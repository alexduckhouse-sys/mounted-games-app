using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
namespace MountedGames.Api.Services.Vaccinations;

/// <summary>Called by the existing private account export/deletion and event cleanup flows.</summary>
public static class VaccinationPrivacy
{
    public static async Task AnonymiseAccountAsync(AppDbContext db, string userId, CancellationToken ct = default)
    {
        await db.Set<EventVaccinationSettings>().Where(x => x.UpdatedByUserId == userId).ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedByUserId, (string?)null), ct);
        await db.Set<VaccinationHorse>().Where(x => x.CreatedByUserId == userId).ExecuteUpdateAsync(s => s.SetProperty(x => x.CreatedByUserId, (string?)null), ct);
        await db.Set<VaccinationEvidence>().Where(x => x.RecordedByUserId == userId).ExecuteUpdateAsync(s => s.SetProperty(x => x.RecordedByUserId, (string?)null).SetProperty(x => x.Notes, (string?)null), ct);
        await db.Set<VaccinationInspection>().Where(x => x.InspectedByUserId == userId).ExecuteUpdateAsync(s => s.SetProperty(x => x.InspectedByUserId, (string?)null), ct);
    }
    public static async Task<object> ExportForUserAsync(AppDbContext db, string userId, CancellationToken ct = default) => new
    {
        SuppliedHistories = await db.Set<VaccinationEvidence>().AsNoTracking().Where(x => x.RecordedByUserId == userId)
            .Select(x => new { x.CompetitionId, x.DeclarationHorseId, x.Revision, x.Source, x.DatesJson, x.CompleteHistory, x.ArrivalOn, x.LastOtherVaccinationOn, x.ExceptionReview, x.Notes, x.RecordedAt }).ToListAsync(ct),
        Inspections = await db.Set<VaccinationInspection>().AsNoTracking().Where(x => x.InspectedByUserId == userId)
            .Select(x => new { x.CompetitionId, x.Decision, x.Reason, x.InspectedAt, x.EvidenceRevision, x.PolicyVersionId, x.SettingsRevision }).ToListAsync(ct),
    };
    public static async Task DeleteCompetitionAsync(AppDbContext db, int competitionId, CancellationToken ct = default)
    {
        await db.Set<VaccinationInspection>().Where(x => x.CompetitionId == competitionId).ExecuteDeleteAsync(ct);
        await db.Set<VaccinationEvidence>().Where(x => x.CompetitionId == competitionId).ExecuteDeleteAsync(ct);
        await db.Set<VaccinationDeclarationHorse>().Where(x => x.CompetitionId == competitionId).ExecuteDeleteAsync(ct);
        await db.Set<VaccinationHorse>().Where(x => x.CompetitionId == competitionId).ExecuteDeleteAsync(ct);
        await db.Set<EventVaccinationSettings>().Where(x => x.CompetitionId == competitionId).ExecuteDeleteAsync(ct);
    }
}
