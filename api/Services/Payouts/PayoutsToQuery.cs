using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.DecForms;

namespace MountedGames.Api.Services.Payouts;

public static class PayoutsToQuery
{
    /// <summary>
    /// The public, safe answer to "where do this event's entry fees go": the pinned club on the competition (or the
    /// organiser's club for legacy competitions), the masked account once it is Ready, and whether it is. No personal data.
    /// Null when neither the competition nor the organiser has a club.
    /// </summary>
    public static async Task<PayoutsToDto?> PayoutsToAsync(this AppDbContext db, string? organiserUserId, string? decFormConfigJson = null)
    {
        if (DecFormConfig.Parse(decFormConfigJson)?.PayoutClubId is { } pinnedClubId)
            return await db.PayoutsToForClubAsync(pinnedClubId);
        if (string.IsNullOrEmpty(organiserUserId)) return null;
        var clubId = await db.Users.AsNoTracking().Where(u => u.Id == organiserUserId).Select(u => u.ClubId).FirstOrDefaultAsync();
        return clubId is { } id ? await db.PayoutsToForClubAsync(id) : null;
    }

    /// <summary>The same public summary for a club by id. Null when the club doesn't exist.</summary>
    public static async Task<PayoutsToDto?> PayoutsToForClubAsync(this AppDbContext db, int id)
    {
        var clubName = await db.Clubs.AsNoTracking().Where(c => c.Id == id).Select(c => c.Name).FirstOrDefaultAsync();
        if (clubName is null) return null;
        var account = await db.ClubPayoutAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.ClubId == id);
        var ready = account?.Status == PayoutStatus.Ready;
        return new PayoutsToDto(clubName, ready ? PayoutRules.MaskedAccount(account!) : null, ready);
    }
}
