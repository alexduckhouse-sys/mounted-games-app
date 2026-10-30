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
    public static async Task<PayoutsToDto?> PayoutsToAsync(this AppDbContext db, string? organiserUserId, string? decFormConfigJson = null, CancellationToken ct = default)
    {
        if (DecFormConfig.Parse(decFormConfigJson)?.PayoutClubId is { } pinnedClubId)
            return await db.PayoutsToForClubAsync(pinnedClubId, ct);
        if (string.IsNullOrEmpty(organiserUserId)) return null;
        var user = await db.Users.AsNoTracking()
            .Where(u => u.Id == organiserUserId)
            .Select(u => new { u.ClubId, u.FullName })
            .FirstOrDefaultAsync(ct);
        if (user is null) return null;
        if (user.ClubId is { } id) return await db.PayoutsToForClubAsync(id, ct);

        var userAccount = await db.UserPayoutAccounts.AsNoTracking()
            .Where(a => a.UserId == organiserUserId)
            .Select(a => new UserPayoutAccount
            {
                Status = a.Status,
                LegalName = a.LegalName,
                TradingName = a.TradingName,
                AccountLast4 = a.AccountLast4,
                IbanLast4 = a.IbanLast4,
                StripeAccountId = a.StripeAccountId,
                StripeChargesEnabled = a.StripeChargesEnabled,
                StripePayoutsEnabled = a.StripePayoutsEnabled,
                StripeDetailsSubmitted = a.StripeDetailsSubmitted,
                ManualBacsReady = a.ManualBacsReady,
            })
            .FirstOrDefaultAsync(ct);
        if (userAccount is null) return null;
        var ready = userAccount.Status == PayoutStatus.Ready;
        var displayName = !string.IsNullOrWhiteSpace(userAccount.TradingName)
            ? userAccount.TradingName!
            : !string.IsNullOrWhiteSpace(userAccount.LegalName)
                ? userAccount.LegalName!
                : user.FullName;
        return new PayoutsToDto(
            displayName,
            ready ? PayoutRules.MaskedAccount(userAccount) : null,
            ready,
            StripeConnected: !string.IsNullOrEmpty(userAccount.StripeAccountId),
            StripeChargesEnabled: userAccount.StripeChargesEnabled,
            StripePayoutsEnabled: userAccount.StripePayoutsEnabled,
            StripeDetailsSubmitted: userAccount.StripeDetailsSubmitted,
            ManualBacsReady: userAccount.ManualBacsReady);
    }

    /// <summary>The same public summary for a club by id. Null when the club doesn't exist.</summary>
    public static async Task<PayoutsToDto?> PayoutsToForClubAsync(this AppDbContext db, int id, CancellationToken ct = default)
    {
        var clubName = await db.Clubs.AsNoTracking().Where(c => c.Id == id).Select(c => c.Name).FirstOrDefaultAsync(ct);
        if (clubName is null) return null;
        var account = await db.ClubPayoutAccounts.AsNoTracking().Where(a => a.ClubId == id)
            .Select(a => new ClubPayoutAccount
            {
                Status = a.Status,
                AccountLast4 = a.AccountLast4,
                IbanLast4 = a.IbanLast4,
                StripeAccountId = a.StripeAccountId,
                StripeChargesEnabled = a.StripeChargesEnabled,
                StripePayoutsEnabled = a.StripePayoutsEnabled,
                StripeDetailsSubmitted = a.StripeDetailsSubmitted,
                ManualBacsReady = a.ManualBacsReady,
            })
            .FirstOrDefaultAsync(ct);
        var ready = account?.Status == PayoutStatus.Ready;
        return new PayoutsToDto(
            clubName,
            ready ? PayoutRules.MaskedAccount(account!) : null,
            ready,
            StripeConnected: !string.IsNullOrEmpty(account?.StripeAccountId),
            StripeChargesEnabled: account?.StripeChargesEnabled ?? false,
            StripePayoutsEnabled: account?.StripePayoutsEnabled ?? false,
            StripeDetailsSubmitted: account?.StripeDetailsSubmitted ?? false,
            ManualBacsReady: account?.ManualBacsReady ?? false);
    }
}
