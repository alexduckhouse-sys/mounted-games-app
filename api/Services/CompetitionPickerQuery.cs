using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;

namespace MountedGames.Api.Services;

public static class CompetitionPickerQuery
{
    private sealed record LiveHeatRow(string? Label, int OrderIndex, int Id, DateTime? FinishedAt, int RaceCount, bool AllRacesComplete);
    private sealed record LiveSessionRow(int CompetitionId, int OrderIndex, string? SectionName, string? ArenaName, List<LiveHeatRow> Heats);

    public static async Task<CompetitionPickerPage> LoadAsync(
        AppDbContext db, bool past, int page, int pageSize, DateTime todayUtc, CancellationToken ct = default)
    {
        var query = db.Competitions.AsNoTracking();
        query = past
            ? query.Where(c => c.IsArchived || (c.EndDate ?? c.StartDate) < todayUtc)
            : query.Where(c => !c.IsArchived && (c.EndDate ?? c.StartDate) >= todayUtc);
        var ordered = past ? query.OrderByDescending(c => c.StartDate) : query.OrderBy(c => c.StartDate);
        // Project in SQL: no sections, teams, sessions or results are fetched, only a section count.
        var items = await ordered.ThenBy(c => c.Id).Skip((page - 1) * pageSize).Take(pageSize + 1)
            .Select(c => new CompetitionPickerItem(c.Id, c.Name, c.StartDate, c.EndDate, c.Icon, c.Location, c.Sections.Count, null,
                db.Set<EventCommerceSettings>().Any(x => x.CompetitionId == c.Id && x.IsDemo)))
            .ToListAsync(ct);
        var pageItems = items.Take(pageSize).ToList();
        if (!past) await AttachLiveAsync(db, pageItems, todayUtc, ct);
        return new CompetitionPickerPage(pageItems, items.Count > pageSize);
    }

    /// <summary>One extra query for the competitions running today; mirrors the active-heat rule in web/src/lib/timetableRows.ts.</summary>
    private static async Task AttachLiveAsync(AppDbContext db, List<CompetitionPickerItem> items, DateTime todayUtc, CancellationToken ct)
    {
        var today = todayUtc.Date;
        var ids = items
            .Where(i => i.StartDate.Date <= today && today <= (i.EndDate ?? i.StartDate).Date)
            .Select(i => i.Id).ToList();
        if (ids.Count == 0) return;

        var sessions = await db.Sessions.AsNoTracking()
            .Where(s => ids.Contains(s.CompetitionId) && s.Status == SessionStatus.InArena && s.Kind == SessionKind.Race && !s.IsBreak)
            .Select(s => new LiveSessionRow(
                s.CompetitionId, s.OrderIndex, s.Section != null ? s.Section.DisplayName : null, s.ArenaName,
                s.Heats.Select(h => new LiveHeatRow(h.Label, h.OrderIndex, h.Id, h.FinishedAt, h.Races.Count, h.Races.All(r => r.IsComplete))).ToList()))
            .ToListAsync(ct);

        var live = new Dictionary<int, PickerLiveHeat>();
        foreach (var session in sessions.OrderBy(s => s.OrderIndex))
        {
            if (live.ContainsKey(session.CompetitionId)) continue;
            var heats = session.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id).ToList();
            var index = heats.FindIndex(h => h.FinishedAt == null && !(h.RaceCount > 0 && h.AllRacesComplete));
            if (index < 0) continue;
            var label = heats[index].Label;
            var arena = session.ArenaName?.Trim();
            live[session.CompetitionId] = new PickerLiveHeat(
                session.SectionName,
                string.IsNullOrWhiteSpace(label) ? $"Heat {index + 1}" : label,
                string.IsNullOrEmpty(arena) ? null : arena);
        }

        for (var i = 0; i < items.Count; i++)
            if (live.TryGetValue(items[i].Id, out var heat)) items[i] = items[i] with { Live = heat };
    }
}
