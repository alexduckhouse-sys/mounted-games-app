using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.EventTools;
namespace MountedGames.Api.Services.TackCheck;

/// <summary>Legacy inspection notes and the passport feature switch. Current checks use VaccinationService.</summary>
public sealed class PassportCheckService(AppDbContext db)
{
    public static string KeyOf(string name) => string.Join(' ', name.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToLowerInvariant();
    public static string? NormalizePassportCode(string? code) => string.IsNullOrWhiteSpace(code) ? null :
        string.Join(' ', code.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToUpperInvariant();
    /// <summary>A legacy inspection never establishes a complete vaccination history or a current admission.</summary>
    public static (bool Certified, string Status) EvaluateStatus(DateOnly referenceDate, bool hasCheckOrCert,
        ref string? lastFluVaccineDate, ref string? fluValidUntil, ref string? lastTetanusDate, ref string? tetanusValidUntil) =>
        (false, hasCheckOrCert ? "LegacyManualInspection" : "Unchecked");
    public async Task<PassportCheckBoardDto?> BoardAsync(int competitionId, CancellationToken ct)
    {
        var competition = await db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(c => c.Sections).ThenInclude(s => s.Teams).ThenInclude(t => t.Club)
            .Include(c => c.Sections).ThenInclude(s => s.Teams).ThenInclude(t => t.DeclarationForms).ThenInclude(f => f.Riders)
            .SingleOrDefaultAsync(c => c.Id == competitionId, ct);
        if (competition is null) return null;
        if (!competition.EnablePassportCheck) return new(false, 0, 0, []);
        var checks = await db.Set<PassportCheck>().AsNoTracking().Where(x => x.CompetitionId == competitionId).ToListAsync(ct);
        var sections = competition.Sections.OrderBy(s => s.DisplayName).Select(s => new PassportCheckSectionDto(s.Id, s.DisplayName,
            s.Teams.OrderBy(t => t.DisplayName).Select(t =>
            {
                var riders = TackCheckService.DeclaredRiders(t).Where(r => !string.IsNullOrWhiteSpace(r.HorseName)).ToList();
                var ponies = riders.Select(r =>
                {
                    var check = checks.SingleOrDefault(c => c.TeamId == t.Id && c.PonyKey == KeyOf(r.HorseName!));
                    // Ambiguous old name-only rows stay in storage; never attach their private details to either pony.
                    if (riders.Count(x => KeyOf(x.HorseName!) == KeyOf(r.HorseName!)) > 1) check = null;
                    return new PassportCheckPonyDto(r.HorseName!.Trim(), [r.FullName], check?.CheckedAt, check?.CheckedByName,
                        check?.PassportCode, check?.OwnerFullName, false, check is null ? "Unchecked" : "LegacyManualInspection",
                        check?.LastFluVaccineDate, check?.FluValidUntil, check?.LastTetanusDate, check?.TetanusValidUntil,
                        check?.InspectorRole, check?.OfficialNotes);
                }).ToArray();
                return new PassportCheckTeamDto(t.Id, t.DisplayName, t.Club?.Name ?? "", t.EntryStatus != TeamEntryStatus.Active,
                    t.IsHorsConcours, t.DeclarationForms.Count > 0, ponies);
            }).ToArray())).ToArray();
        return new(true, 0, sections.Sum(s => s.Teams.Sum(t => t.Ponies.Count)), sections);
    }
    public async Task<bool> SetEnabledAsync(int competitionId, bool enabled, CancellationToken ct)
    {
        var competition = await db.Competitions.SingleOrDefaultAsync(c => c.Id == competitionId, ct);
        if (competition is null) return false;
        competition.EnablePassportCheck = enabled; await db.SaveChangesAsync(ct); return true;
    }
    public Task<PassportCheckPonyDto> SetCheckedAsync(int competitionId, int teamId, SetPassportCheckRequest request,
        string? userId, string? userName, CancellationToken ct) => Task.FromException<PassportCheckPonyDto>(
            new EventToolsException("Reload the passport board to record dates and the official decision separately.", 409));
}
