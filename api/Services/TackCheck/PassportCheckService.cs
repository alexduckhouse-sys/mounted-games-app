using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.EventTools;

namespace MountedGames.Api.Services.TackCheck;

/// <summary>
/// The passport and vaccination check on arrival, for competitions that turn it on. Staff only. Ponies come from
/// each team's latest declaration and are matched by name within that team only: many ponies share a name, so
/// nothing here compares ponies across teams or declarations.
/// </summary>
public sealed class PassportCheckService(AppDbContext db)
{
    /// <summary>The name a tick is stored under: trimmed, single-spaced and lower-case.</summary>
    public static string KeyOf(string name)
        => string.Join(' ', name.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToLowerInvariant();

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    public async Task<PassportCheckBoardDto?> BoardAsync(int competitionId, CancellationToken ct)
    {
        var competition = await db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.Club)
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.DeclarationForms).ThenInclude(x => x.Riders)
            .SingleOrDefaultAsync(x => x.Id == competitionId, ct);
        if (competition is null) return null;
        if (!competition.EnablePassportCheck) return new PassportCheckBoardDto(false, 0, 0, []);

        var checks = (await db.Set<PassportCheck>().AsNoTracking().Where(x => x.CompetitionId == competitionId).ToListAsync(ct))
            .ToDictionary(x => (x.TeamId, x.PonyKey));
        var sections = competition.Sections.OrderBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Id)
            .Select(section => new PassportCheckSectionDto(section.Id, section.DisplayName,
                section.Teams.OrderBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(t => t.Id).Select(team =>
                {
                    var riders = TackCheckService.DeclaredRiders(team).ToList();
                    var ponies = riders
                        .Where(r => TackCheckService.PonyName(r.HorseName) is not null)
                        .GroupBy(r => KeyOf(r.HorseName!))
                        .Select(g =>
                        {
                            checks.TryGetValue((team.Id, g.Key), out var check);
                            return new PassportCheckPonyDto(TackCheckService.PonyName(g.First().HorseName)!,
                                g.Select(r => r.FullName).ToList(), check?.CheckedAt, check?.CheckedByName);
                        }).ToList();
                    return new PassportCheckTeamDto(team.Id, team.DisplayName, team.Club?.Name ?? string.Empty,
                        team.EntryStatus != TeamEntryStatus.Active, team.IsHorsConcours, team.DeclarationForms.Count > 0, ponies);
                }).ToList())).ToList();
        var all = sections.SelectMany(s => s.Teams).SelectMany(t => t.Ponies).ToList();
        return new PassportCheckBoardDto(true, all.Count(p => p.CheckedAt is not null), all.Count, sections);
    }

    /// <summary>Turns the check on or off. Turning it off hides the ticks but keeps them.</summary>
    public async Task<bool> SetEnabledAsync(int competitionId, bool enabled, CancellationToken ct)
    {
        var competition = await db.Competitions.SingleOrDefaultAsync(x => x.Id == competitionId, ct);
        if (competition is null) return false;
        competition.EnablePassportCheck = enabled;
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>Ticks or clears one pony on one team. The pony must be on the team's latest declaration.</summary>
    public async Task<PassportCheckPonyDto> SetCheckedAsync(
        int competitionId, int teamId, SetPassportCheckRequest request, string? userId, string? userName, CancellationToken ct)
    {
        if (!await db.Competitions.AnyAsync(c => c.Id == competitionId && c.EnablePassportCheck, ct))
            throw new EventToolsException("The passport check is turned off for this competition.", StatusCodes.Status409Conflict);
        var team = await db.Teams.AsNoTracking().Include(t => t.DeclarationForms).ThenInclude(f => f.Riders)
            .SingleOrDefaultAsync(t => t.Id == teamId && t.CompetitionId == competitionId, ct)
            ?? throw new EventToolsException("That team is not in this competition.", StatusCodes.Status404NotFound);
        var key = KeyOf(request.PonyName ?? string.Empty);
        var riders = TackCheckService.DeclaredRiders(team)
            .Where(r => TackCheckService.PonyName(r.HorseName) is not null && KeyOf(r.HorseName!) == key).ToList();
        if (key.Length == 0 || riders.Count == 0)
            throw new EventToolsException("That pony is not on this team’s declaration.", StatusCodes.Status404NotFound);

        var existing = await db.Set<PassportCheck>().SingleOrDefaultAsync(x => x.TeamId == teamId && x.PonyKey == key, ct);
        if (request.Checked && existing is null)
        {
            existing = new PassportCheck
            {
                CompetitionId = competitionId, TeamId = teamId, PonyKey = key,
                PonyName = TackCheckService.PonyName(riders[0].HorseName)!,
                CheckedAt = DateTime.UtcNow, CheckedByUserId = userId,
                CheckedByName = string.IsNullOrWhiteSpace(userName) ? null : Truncate(userName.Trim(), 200),
            };
            db.Add(existing);
        }
        else if (!request.Checked && existing is not null)
        {
            db.Remove(existing);
            existing = null;
        }
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (request.Checked)
        {
            // Another steward ticked the same pony a moment earlier: theirs stands.
            db.ChangeTracker.Clear();
            existing = await db.Set<PassportCheck>().AsNoTracking().SingleAsync(x => x.TeamId == teamId && x.PonyKey == key, ct);
        }
        return new PassportCheckPonyDto(TackCheckService.PonyName(riders[0].HorseName)!, riders.Select(r => r.FullName).ToList(),
            existing?.CheckedAt, existing?.CheckedByName);
    }
}
