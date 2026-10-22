using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;

namespace MountedGames.Api.Services.Commerce;

/// <summary>Money an organiser has actually been paid, in pence.</summary>
public sealed record RealIncome(int EntriesMinor, int ShopMinor)
{
    public int TotalMinor => EntriesMinor + ShopMinor;

    /// <summary>
    /// The only place organiser totals and the committee report should get income from. Demo events and test
    /// orders earn nothing here: their payments come from the fake provider and no money moved. Refunded and
    /// cancelled entries do not count.
    /// </summary>
    public static async Task<RealIncome> ForCompetitionAsync(
        AppDbContext db, int competitionId, CancellationToken cancellationToken = default)
    {
        var isDemo = await db.Set<EventCommerceSettings>().AnyAsync(
            x => x.CompetitionId == competitionId && x.IsDemo, cancellationToken);
        if (isDemo) return new RealIncome(0, 0);

        var entries = await db.SectionSignups
            .Where(x => x.Section!.CompetitionId == competitionId && x.Status == SignupPaymentStatus.Paid)
            .SumAsync(x => (int?)x.AmountMinor, cancellationToken) ?? 0;
        var shop = await db.Set<EventOrder>()
            .Where(x => x.CompetitionId == competitionId && !x.IsTestOrder && x.Status == CommerceOrderStatus.Paid)
            .SumAsync(x => (int?)x.TotalMinor, cancellationToken) ?? 0;
        return new RealIncome(entries, shop);
    }
}
