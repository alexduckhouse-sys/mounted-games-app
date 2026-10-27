using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Geo;

namespace MountedGames.Api.Services;

public static class CompetitionPickerQuery
{
    private sealed record LiveHeatRow(string? Label, int OrderIndex, int Id, DateTime? FinishedAt, int RaceCount, bool AllRacesComplete);
    private sealed record LiveSessionRow(int CompetitionId, int OrderIndex, string? SectionName, string? ArenaName, List<LiveHeatRow> Heats);

    public static async Task<CompetitionPickerPage> LoadAsync(
        AppDbContext db, bool past, int page, int pageSize, DateTime todayUtc, CancellationToken ct = default,
        int? year = null, string? location = null, string? search = null, string? userId = null)
    {
        var query = db.Competitions.AsNoTracking();
        query = past
            ? query.Where(c => c.IsArchived || (c.EndDate ?? c.StartDate) < todayUtc)
            : query.Where(c => !c.IsArchived && (c.EndDate ?? c.StartDate) >= todayUtc);
        if (userId is not null)
        {
            var clubId = await db.Users.Where(u => u.Id == userId).Select(u => u.ClubId).SingleOrDefaultAsync(ct);
            query = query.Where(c => db.Teams.Any(t => t.CompetitionId == c.Id &&
                (t.TrainerUserId == userId || (clubId != null && t.ClubId == clubId)
                    || t.Supporters.Any(s => s.UserId == userId && s.Status == TeamSupporterStatus.Accepted)))
                || db.SectionSignups.Any(s => s.Section!.CompetitionId == c.Id && s.UserId == userId
                    && (s.Status == SignupPaymentStatus.Paid || s.Status == SignupPaymentStatus.Pending)));
        }
        // Facets describe the whole matching archive, before pagination or individual filters.
        var years = past ? await query.Select(c => c.StartDate.Year).Distinct().OrderByDescending(y => y).ToListAsync(ct) : null;
        var locations = past ? await query.Where(c => c.Location != null && c.Location.Trim() != "")
            .Select(c => c.Location!.Trim()).Distinct().OrderBy(value => value).ToListAsync(ct) : null;
        if (year.HasValue) query = query.Where(c => c.StartDate.Year == year.Value);
        if (!string.IsNullOrWhiteSpace(location)) query = query.Where(c => c.Location != null && c.Location.Trim() == location.Trim());
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(c => c.Name.ToLower().Contains(term) || (c.Location != null && c.Location.ToLower().Contains(term)));
        }
        var ordered = past ? query.OrderByDescending(c => c.StartDate) : query.OrderBy(c => c.StartDate);
        // Project in SQL: no sections, teams, sessions or results are fetched, only a section count.
        var items = await ordered.ThenBy(c => c.Id).Skip((page - 1) * pageSize).Take(pageSize + 1)
            .Select(c => new CompetitionPickerItem(c.Id, c.Name, c.StartDate, c.EndDate, c.Icon, c.Location, c.Sections.Count, null,
                db.Set<EventCommerceSettings>().Any(x => x.CompetitionId == c.Id && x.IsDemo),
                !past && !c.SignupsLocked && c.Sections.Any()))
            .ToListAsync(ct);
        var pageItems = items.Take(pageSize).ToList();
        if (!past) await AttachLiveAsync(db, pageItems, todayUtc, ct);
        return new CompetitionPickerPage(pageItems, items.Count > pageSize, years, locations);
    }

    /// <summary>The most upcoming events the near-you list will order. A season has far fewer; the cap only bounds the work.</summary>
    public const int NearYouSetCap = 500;
    public const string SortNearest = "nearest";
    public const string SortSoonest = "soonest";

    /// <summary>
    /// The upcoming list for one viewer. The whole upcoming set is read, ordered and only then cut into pages, so page boundaries
    /// are right whichever order is used. Events on today come first. With a known place and <paramref name="nearest"/>, the rest
    /// run nearest first, events we couldn't place coming last by date; otherwise by date, as the plain picker does. The viewer's
    /// place is used for this call only: the answer holds whole-mile distances for the page and nothing that locates the viewer.
    /// </summary>
    public static async Task<CompetitionNearYouPage> LoadNearYouAsync(
        AppDbContext db, int page, int pageSize, DateTime todayUtc, GeoPoint? origin, bool nearest, CancellationToken ct = default)
    {
        var upcoming = db.Competitions.AsNoTracking().Where(c => !c.IsArchived && (c.EndDate ?? c.StartDate) >= todayUtc)
            .OrderBy(c => c.StartDate).ThenBy(c => c.Id).Take(NearYouSetCap);
        var items = await upcoming
            .Select(c => new CompetitionPickerItem(c.Id, c.Name, c.StartDate, c.EndDate, c.Icon, c.Location, c.Sections.Count, null,
                db.Set<EventCommerceSettings>().Any(x => x.CompetitionId == c.Id && x.IsDemo), !c.SignupsLocked && c.Sections.Any()))
            .ToListAsync(ct);
        var places = await upcoming.Where(c => c.Latitude != null && c.Longitude != null)
            .Select(c => new { c.Id, Lat = c.Latitude!.Value, Lon = c.Longitude!.Value }).ToDictionaryAsync(c => c.Id, ct);

        var useDistance = nearest && origin is not null;
        var miles = new Dictionary<int, double>();
        if (origin is { } here)
            foreach (var (id, place) in places) miles[id] = here.MilesTo(place.Lat, place.Lon);

        var today = todayUtc.Date;
        IEnumerable<CompetitionPickerItem> ordered = items;
        if (useDistance)
            ordered = items.OrderBy(i => i.StartDate.Date <= today && today <= (i.EndDate ?? i.StartDate).Date ? 0 : 1)
                .ThenBy(i => miles.ContainsKey(i.Id) ? 0 : 1)
                .ThenBy(i => miles.GetValueOrDefault(i.Id))
                .ThenBy(i => i.StartDate).ThenBy(i => i.Id);

        var all = ordered.ToList();
        var pageItems = all.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        await AttachLiveAsync(db, pageItems, todayUtc, ct);
        var distances = origin is null ? [] : pageItems.Where(i => miles.ContainsKey(i.Id))
            .Select(i => new PickerDistance(i.Id, (int)Math.Round(miles[i.Id]))).ToList();
        return new CompetitionNearYouPage(pageItems, page * pageSize < all.Count, origin is not null, useDistance ? SortNearest : SortSoonest, distances);
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
