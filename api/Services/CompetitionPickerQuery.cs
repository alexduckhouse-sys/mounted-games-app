using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;

namespace MountedGames.Api.Services;

public static class CompetitionPickerQuery
{
    public static async Task<CompetitionPickerPage> LoadAsync(
        AppDbContext db, bool past, int page, int pageSize, DateTime todayUtc, CancellationToken ct = default)
    {
        var query = db.Competitions.AsNoTracking();
        query = past
            ? query.Where(c => c.IsArchived || (c.EndDate ?? c.StartDate) < todayUtc)
            : query.Where(c => !c.IsArchived && (c.EndDate ?? c.StartDate) >= todayUtc);
        var ordered = past ? query.OrderByDescending(c => c.StartDate) : query.OrderBy(c => c.StartDate);
        // Project in SQL: no sections, teams, sessions, results or counts are fetched.
        var items = await ordered.ThenBy(c => c.Id).Skip((page - 1) * pageSize).Take(pageSize + 1)
            .Select(c => new CompetitionPickerItem(c.Id, c.Name, c.StartDate, c.EndDate, c.Icon))
            .ToListAsync(ct);
        return new CompetitionPickerPage(items.Take(pageSize).ToList(), items.Count > pageSize);
    }
}
