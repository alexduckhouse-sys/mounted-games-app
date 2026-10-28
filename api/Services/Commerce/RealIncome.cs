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
    /// orders earn nothing here: their payments come from the fake provider and no money moved. Cancelled entries do not
    /// count, and a refunded entry counts only the part that was not refunded.
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
        // A partial refund still sets the status to Refunded; what the organiser kept stays income.
        var retained = await db.SectionSignups
            .Where(x => x.Section!.CompetitionId == competitionId && x.Status == SignupPaymentStatus.Refunded)
            .Select(x => new
            {
                x.AmountMinor,
                Refunded = db.Set<SignupExtras>().Where(e => e.SignupId == x.Id)
                    .Select(e => e.RefundedAmountMinor).FirstOrDefault(),
            })
            .ToListAsync(cancellationToken);
        entries += retained.Sum(r => Math.Max(0, r.AmountMinor - Math.Min(r.AmountMinor, r.Refunded ?? r.AmountMinor)));
        var shop = await db.Set<EventOrder>()
            .Where(x => x.CompetitionId == competitionId && !x.IsTestOrder && x.Status == CommerceOrderStatus.Paid)
            .SumAsync(x => (int?)x.TotalMinor, cancellationToken) ?? 0;
        return new RealIncome(entries, shop);
    }
}
