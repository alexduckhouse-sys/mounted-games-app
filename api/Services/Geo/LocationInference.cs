using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Services.Geo;

/// <summary>
/// Works out roughly where someone is without asking them and without storing a place: the middle of the venues of the
/// competitions they have entered, trained for or supported. Done when needed (an email going out, a page being asked
/// for) and thrown away. Demo events and venues we couldn't geocode don't count; only the ten latest venues do.
/// </summary>
public sealed class LocationInference(AppDbContext db)
{
    public const int VenuesToAverage = 10;

    /// <summary>
    /// A signed-in person's own history, by account only. The address on an account's token is never matched against the
    /// contact addresses typed on entry forms: accounts can be made for addresses nobody has confirmed, so that match would
    /// let someone read where another family competes from the distances the page returns.
    /// </summary>
    public Task<GeoPoint?> FromHistoryAsync(string? userId, CancellationToken ct)
        => string.IsNullOrEmpty(userId) ? Task.FromResult<GeoPoint?>(null) : CentroidAsync(userId, null, ct);

    /// <summary>
    /// An opt-in address: the account holding that address (if any) and entries made with it. Only used to order an email that
    /// goes to that same mailbox, so nothing about the places leaves it.
    /// </summary>
    public async Task<GeoPoint?> ForAddressAsync(string address, CancellationToken ct)
    {
        var email = NormaliseOrNull(address);
        if (email is null) return null;
        var upper = email.ToUpperInvariant();
        var userId = await db.Users.AsNoTracking().Where(u => u.NormalizedEmail == upper).Select(u => u.Id).FirstOrDefaultAsync(ct);
        return await CentroidAsync(userId, email, ct);
    }

    private static string? NormaliseOrNull(string? email)
        => EmailAddresses.TryNormalise(email, out var address) ? address : null;

    private async Task<GeoPoint?> CentroidAsync(string? userId, string? email, CancellationToken ct)
    {
        if (userId is null && email is null) return null;
        var ids = new HashSet<int>();

        ids.UnionWith(await db.SectionSignups.AsNoTracking()
            .Where(s => s.Status != SignupPaymentStatus.Cancelled
                && ((userId != null && s.UserId == userId) || (email != null && s.ContactEmail == email)))
            .Select(s => s.Section!.CompetitionId).Distinct().ToListAsync(ct));
        if (userId is not null)
        {
            ids.UnionWith(await db.Teams.AsNoTracking().Where(t => t.TrainerUserId == userId).Select(t => t.CompetitionId).Distinct().ToListAsync(ct));
            ids.UnionWith(await db.TeamSupporters.AsNoTracking()
                .Where(s => s.UserId == userId && s.Status == TeamSupporterStatus.Accepted)
                .Select(s => s.Team!.CompetitionId).Distinct().ToListAsync(ct));
        }
        if (ids.Count == 0) return null;

        var venues = await db.Competitions.AsNoTracking()
            .Where(c => ids.Contains(c.Id) && c.Latitude != null && c.Longitude != null
                && !db.Set<EventCommerceSettings>().Any(x => x.CompetitionId == c.Id && x.IsDemo))
            .OrderByDescending(c => c.StartDate).ThenBy(c => c.Id).Take(VenuesToAverage)
            .Select(c => new { Lat = c.Latitude!.Value, Lon = c.Longitude!.Value }).ToListAsync(ct);
        return venues.Count == 0 ? null : new GeoPoint(venues.Average(v => v.Lat), venues.Average(v => v.Lon));
    }
}
