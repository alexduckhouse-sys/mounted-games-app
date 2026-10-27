using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Geo;

namespace MountedGames.Api.Services.Email;

/// <summary>A competition as the digest needs it: what the email says, and where it is.</summary>
public sealed record OpenCompetition(
    int Id, string Name, DateTime StartDate, DateTime? EndDate, string? Location, double? Latitude, double? Longitude, DateTime? EntriesCloseAt);

/// <summary>
/// Which competitions count as "open for entries" for the digest: not archived, not a demo event, not finished, with at least
/// one section, not locked, and the organiser's close time (if they set one) not passed. Written once so the admin's
/// pending list, the claim and the last check before each message all agree.
/// </summary>
public static class EntriesOpenRule
{
    /// <summary>Open competitions, optionally only some of them, optionally leaving out ones an earlier digest already announced.</summary>
    public static async Task<List<OpenCompetition>> OpenAsync(
        AppDbContext db, DateTime nowUtc, IReadOnlyCollection<int>? onlyIds, bool excludeAnnounced, CancellationToken ct)
    {
        var today = nowUtc.Date;
        var query = db.Competitions.AsNoTracking()
            .Where(c => !c.IsArchived && (c.EndDate ?? c.StartDate) >= today && !c.SignupsLocked && c.Sections.Any()
                && !db.Set<EventCommerceSettings>().Any(x => x.CompetitionId == c.Id && x.IsDemo));
        if (onlyIds is not null) query = query.Where(c => onlyIds.Contains(c.Id));
        if (excludeAnnounced) query = query.Where(c => !db.EntriesDigestCompetitions.Any(a => a.CompetitionId == c.Id));
        var rows = await query.OrderBy(c => c.StartDate).ThenBy(c => c.Id)
            .Select(c => new OpenCompetition(c.Id, c.Name, c.StartDate, c.EndDate, c.Location, c.Latitude, c.Longitude, null))
            .ToListAsync(ct);
        if (rows.Count == 0) return rows;

        var ids = rows.Select(r => r.Id).ToList();
        var closes = await db.Set<CompetitionEntrySettings>().AsNoTracking()
            .Where(s => ids.Contains(s.CompetitionId) && s.EntriesCloseAt != null)
            .Select(s => new { s.CompetitionId, s.EntriesCloseAt }).ToDictionaryAsync(s => s.CompetitionId, s => s.EntriesCloseAt, ct);
        var open = new List<OpenCompetition>(rows.Count);
        foreach (var row in rows)
        {
            var closeAt = closes.GetValueOrDefault(row.Id);
            if (closeAt is { } close && close <= nowUtc) continue;
            open.Add(row with { EntriesCloseAt = closeAt });
        }
        return open;
    }

    /// <summary>
    /// Nearest first when the person's rough place is known (venues we couldn't place come after, by date); otherwise by date.
    /// </summary>
    public static List<OpenCompetition> Order(IEnumerable<OpenCompetition> competitions, GeoPoint? origin)
    {
        var byDate = competitions.OrderBy(c => c.StartDate).ThenBy(c => c.Id);
        if (origin is not { } here) return byDate.ToList();
        return byDate
            .OrderBy(c => c.Latitude is null || c.Longitude is null ? 1 : 0)
            .ThenBy(c => c.Latitude is { } lat && c.Longitude is { } lon ? here.MilesTo(lat, lon) : 0)
            .ToList();
    }
}
